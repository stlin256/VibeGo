import { describe, expect, it, vi } from 'vitest';
import { TencentMemoryCoreProvider } from './memory-core-provider.js';

const identity = { teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo', sessionId: 'session_demo' };

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('TencentMemoryCoreProvider', () => {
  it('requires an explicit insecure-http decision and rejects credential-shaped endpoints', () => {
    expect(() => new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', apiKey: 'memory-key', serviceId: 'vibego', identity })).toThrow(/HTTPS/);
    expect(() => new TencentMemoryCoreProvider({ endpoint: 'https://user:pass@example.test', apiKey: 'memory-key', serviceId: 'vibego', identity })).toThrow(/credentials/);
    expect(() => new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: '', serviceId: 'vibego', identity })).toThrow(/apiKey/);
  });

  it('uses the public health and v3 atomic search contracts with bounded untrusted results', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      calls.push(init === undefined ? { input } : { input, init });
      if (input.endsWith('/health')) return response({ status: 'ok', version: 'rev_123' });
      return response({ code: 0, message: 'ok', request_id: 'req-1', data: { items: [{ id: 'memory_1', type: 'preference', content: 'Use pnpm test.', score: 0.9 }] } });
    });
    const provider = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl });
    await expect(provider.status()).resolves.toMatchObject({ available: true, revision: 'rev_123', capabilities: ['recall', 'write-back'] });
    const result = await provider.recall({ identity, runId: 'run_12345678', query: 'test command', maxItems: 4, maxBytes: 1_024 });
    expect(result).toMatchObject({ degraded: false, items: [{ kind: 'preference', trust: 'untrusted', source: 'tencentdb-memory-core' }] });
    expect(calls[1]?.input).toBe('http://127.0.0.1:8420/v3/atomic/search');
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ team_id: 'team_demo', agent_id: 'agent_demo', user_id: 'user_demo', session_id: 'session_demo', query: 'test command', limit: 4 });
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer memory-key');
  });

  it('degrades instead of throwing when health, protocol, or upstream calls fail', async () => {
    const fetchImpl = vi.fn(async () => response({ code: 500, message: 'do not expose this', request_id: 'req-2' }));
    const provider = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl });
    await expect(provider.status()).resolves.toMatchObject({ available: false, degraded: true, lastErrorCode: 'unavailable' });
    await expect(provider.recall({ identity, runId: 'run_12345678', query: 'recall', maxItems: 4, maxBytes: 1_024 })).resolves.toMatchObject({ items: [], degraded: true });

    const malformed = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl: vi.fn(async () => new Response('{malformed', { status: 200 })) });
    await expect(malformed.recall({ identity, runId: 'run_12345678', query: 'malformed', maxItems: 4, maxBytes: 1_024 })).resolves.toMatchObject({ items: [], degraded: true });

    const mismatch = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl: vi.fn(async () => response({ code: 0, data: { items: [{ id: 'memory_1', content: 'x' }] } })) });
    await expect(mismatch.recall({ identity, runId: 'run_12345678', query: 'schema', maxItems: 4, maxBytes: 1_024 })).resolves.toMatchObject({ items: [], degraded: true });

    const timeout = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, timeoutMs: 5, fetchImpl: vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))) });
    await expect(timeout.recall({ identity, runId: 'run_12345678', query: 'timeout', maxItems: 4, maxBytes: 1_024 })).resolves.toMatchObject({ items: [], degraded: true });
  });

  it('queues compact write-back only when a session id is available', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => { calls.push(init === undefined ? { input } : { input, init }); return response({ code: 0, message: 'ok', request_id: 'req-3', data: { accepted_ids: ['msg_1'] } }); });
    const provider = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl });
    await expect(provider.enqueueWrite({ identity, runId: 'run_12345678', summary: 'Completed tests.', facts: ['All unit tests pass.'], decisions: ['Keep memory optional.'], evidenceRefs: ['evt_123'], outcome: 'completed' })).resolves.toEqual({ accepted: true, queued: true });
    await provider.close();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('http://127.0.0.1:8420/v3/conversation/add');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { messages: Array<{ content: string }>; run_id?: string };
    expect(body.run_id).toBeUndefined();
    expect(body.messages[0]?.content).toContain('Completed tests.');
    expect(body.messages[0]?.content).toContain('Evidence refs: evt_123');
    const noSession = await provider.enqueueWrite({ identity: { ...identity, sessionId: undefined }, runId: 'run_12345678', summary: 'skip', outcome: 'completed' });
    expect(noSession).toEqual({ accepted: false, queued: false });
    const beforeMismatch = calls.length;
    const mismatchedIdentity = await provider.enqueueWrite({ identity: { ...identity, userId: 'other_user' }, runId: 'run_12345678', summary: 'skip', outcome: 'completed' });
    expect(mismatchedIdentity).toEqual({ accepted: false, queued: false });
    expect(calls).toHaveLength(beforeMismatch);
  });
});
