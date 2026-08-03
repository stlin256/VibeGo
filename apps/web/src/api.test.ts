import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, parseSseFrame, type FetchLike } from './api.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('ApiClient', () => {
  it('keeps pairing credentials in memory and sends Bearer/CSRF headers', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      return response({ runId: 'run_1', status: 'queued' });
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await client.createRun({} as never);
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[0]?.input).toBe('http://daemon/api/v1/pairing/complete');
    expect(calls[1]?.input).toBe('http://daemon/api/v1/runs');
    expect(calls[1]?.init?.body).not.toContain('access');
    client.clearSession();
    expect(client.hasSession()).toBe(false);
  });

  it('posts approval decisions in the body without putting credentials in the URL', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      return response({ runId: 'run_1', approvalId: 'ap_1', status: 'accepted' }, 202);
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    await expect(client.approveRun('run_1', 'ap_1', 'allow')).resolves.toMatchObject({ status: 'accepted' });
    expect(calls[1]?.input).toBe('http://daemon/api/v1/runs/run_1/approve');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ approvalId: 'ap_1', decision: 'allow' }));
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[1]?.input).not.toContain('access');
  });

  it('posts explicit recovery retry confirmation without URL secrets', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const client = new ApiClient('/daemon', async (input, init) => {
      calls.push({ input, init });
      return response({ runId: 'run_new', status: 'queued', retryOf: 'run_old' }, 202);
    });
    await client.retryRun('run_old');
    expect(calls[0]?.input).toBe('/daemon/api/v1/runs/run_old/retry');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ confirmation: 'retry-as-new-run' }));
    expect(calls[0]?.input).not.toContain('token');
  });

  it('reads certificate status through the authenticated API path', async () => {
    const calls: string[] = [];
    const client = new ApiClient('', async (input) => {
      calls.push(input);
      return response({ subject: 'CN=dev.example.test', issuer: 'CN=Test CA', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2030-01-01T00:00:00.000Z', daysRemaining: 1000, fingerprint256: 'AA:BB:CC', subjectAltNames: ['dev.example.test'] });
    });
    await expect(client.certificateStatus()).resolves.toMatchObject({ subject: 'CN=dev.example.test', daysRemaining: 1000 });
    expect(calls).toEqual(['/api/v1/certificates/status']);
  });

  it('parses SSE frames, ignores heartbeat/invalid data and stops at terminal event', async () => {
    expect(parseSseFrame(': heartbeat')).toBeUndefined();
    expect(parseSseFrame('id: 4\nevent: model.delta\ndata: {"version":1,"id":"e4","seq":4,"runId":"run_1","type":"model.delta","at":"now","payload":{}}')).toMatchObject({ seq: 4, type: 'model.delta' });
    const createSseStream = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('id: 1\nevent: model.delta\ndata: {"version":1,"id":"e1","seq":1,"runId":"run_1","type":"model.delta","at":"now","payload":{}}\n\n'));
        controller.enqueue(new TextEncoder().encode('id: 2\nevent: run.completed\ndata: {"version":1,"id":"e2","seq":2,"runId":"run_1","type":"run.completed","at":"now","payload":{}}\n\n'));
        controller.close();
      },
    });
    const fetcher: FetchLike = async (input) => {
      if (input.endsWith('/pairing/complete')) {
        return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      }
      return new Response(createSseStream(), { status: 200 });
    };
    const client = new ApiClient('http://daemon', fetcher);
    await client.completePairing('PAIR');
    const events: number[] = [];
    for await (const event of client.streamEvents('run_1')) events.push(event.seq);
    expect(events).toEqual([1, 2]);
  });

  it('projects safe API errors without exposing response internals', async () => {
    const client = new ApiClient('', async () => response({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required.' } }, 401));
    await expect(client.health()).rejects.toEqual(new ApiError(401, 'AUTH_REQUIRED', 'Authentication required.'));
  });
});
