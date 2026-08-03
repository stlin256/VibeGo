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
