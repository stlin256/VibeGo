import { describe, expect, it } from 'vitest';
import { ClientError, VibeGoClient, parseSseFrame, type FetchLike } from './index.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function event(seq: number, type = 'model.delta'): string {
  return `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ version: 1, id: `event_${seq}`, seq, runId: 'run_1', type, at: '2026-08-05T00:00:00.000Z', payload: { seq } })}\n\n`;
}

describe('VibeGoClient', () => {
  it('keeps pairing credentials in memory and adds CSRF only to JSON mutations', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    const fetcher: FetchLike = async (input, init) => {
      calls.push({ input, init });
      if (input.endsWith('/pairing/complete')) return response({ accessToken: 'access', csrfToken: 'csrf', sessionId: 'session', expiresAt: 2_000 });
      return response({ runId: 'run_1', status: 'queued' });
    };
    const client = new VibeGoClient('https://host.test', { fetcher, now: () => 1_000 });
    await client.completePairing('PAIR');
    await client.createRun({} as never);
    expect(calls[1]?.init?.headers).toMatchObject({ Authorization: 'Bearer access', 'X-CSRF-Token': 'csrf' });
    expect(calls[1]?.input).not.toContain('access');
    client.clearSession();
    expect(client.hasSession()).toBe(false);
  });

  it('rejects URL credentials/query tokens and bounded invalid identifiers', () => {
    expect(() => new VibeGoClient('https://user:pass@host.test')).toThrowError(new ClientError(null, 'BASE_URL_INVALID', 'Base URL is invalid.'));
    expect(() => new VibeGoClient('https://host.test/?token=secret')).toThrowError(/Base URL/u);
    expect(parseSseFrame(`id: 1\ndata: ${JSON.stringify({ version: 1, id: 'e', seq: 1, runId: 'run_1', type: 'model.delta', at: 'now', payload: {} })}\n\n`)).toMatchObject({ seq: 1 });
    expect(parseSseFrame(`id: 1\ndata: ${'x'.repeat(300_000)}\n\n`)).toBeUndefined();
  });

  it('reconnects SSE with the last cursor, suppresses duplicates and stops at terminal', async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    let attempt = 0;
    const streams = [
      new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(event(1))); controller.close(); } }),
      new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(event(1) + event(2, 'run.completed'))); controller.close(); } }),
    ];
    const client = new VibeGoClient('https://host.test', {
      fetcher: async (input, init) => {
        calls.push({ input, init });
        return new Response(streams[attempt++], { status: 200 });
      },
      sleep: async () => undefined,
    });
    const values: number[] = [];
    for await (const value of client.streamRunEvents('run_1', { maxReconnects: 2 })) values.push(value.seq);
    expect(values).toEqual([1, 2]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toContain('after=1');
    expect(calls[1]?.init?.headers).toMatchObject({ 'Last-Event-ID': '1' });
  });

  it('supports abort and bounded degraded projections without raw fetch errors', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new VibeGoClient('', { fetcher: async () => { throw new Error('raw endpoint secret'); } });
    const values: unknown[] = [];
    for await (const value of client.streamRunEvents('run_1', { signal: controller.signal })) values.push(value);
    expect(values).toEqual([]);
    const projection = await new VibeGoClient('', { fetcher: async () => response({ error: { code: 'STORAGE_DOWN', message: 'C:\\private\\secret' } }, 503) }).healthProjection();
    expect(projection).toEqual({ status: 'degraded', reasonCode: 'STORAGE_DOWN' });
    expect(JSON.stringify(projection)).not.toContain('private');
    const unixProjection = await new VibeGoClient('', { fetcher: async () => response({ error: { code: 'STORAGE_DOWN', message: 'failed at /home/tester/private' } }, 503) }).healthProjection();
    expect(JSON.stringify(unixProjection)).not.toContain('/home/tester');
  });

  it('does not retry authentication failures and bounds reconnect exhaustion', async () => {
    const auth = new VibeGoClient('', { fetcher: async () => response({ error: { code: 'AUTH_REQUIRED', message: 'Pairing required.' } }, 401) });
    await expect(async () => { for await (const _event of auth.streamRunEvents('run_1')) { /* no-op */ } }).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
    let calls = 0;
    const unavailable = new VibeGoClient('', { fetcher: async () => { calls += 1; throw new TypeError('network internals'); }, sleep: async () => undefined });
    await expect(async () => { for await (const _event of unavailable.streamRunEvents('run_1', { maxReconnects: 1 })) { /* no-op */ } }).rejects.toMatchObject({ code: 'SSE_RECONNECT_EXHAUSTED' });
    expect(calls).toBe(2);
  });
});
