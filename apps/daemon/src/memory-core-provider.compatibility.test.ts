import { describe, expect, it, vi } from 'vitest';
import { TencentMemoryCoreProvider } from './memory-core-provider.js';
import { MEMORY_CORE_V3_FIXTURES } from './memory-core-v3-fixtures.js';

const identity = { teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo', sessionId: 'session_demo' };

describe('MemoryCore v3 compatibility fixtures', () => {
  it('accepts the documented health/search/conversation envelopes', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      calls.push(input);
      if (input.endsWith('/health')) return new Response(JSON.stringify(MEMORY_CORE_V3_FIXTURES.health));
      if (input.endsWith('/v3/atomic/search')) return new Response(JSON.stringify(MEMORY_CORE_V3_FIXTURES.search));
      return new Response(JSON.stringify(MEMORY_CORE_V3_FIXTURES.conversationAdd));
    });
    const provider = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl });
    await expect(provider.status()).resolves.toMatchObject({ available: true, revision: 'a'.repeat(40) });
    await expect(provider.recall({ identity, runId: 'run_12345678', query: 'fixture', maxItems: 4, maxBytes: 2_048 })).resolves.toMatchObject({ degraded: false, items: [{ id: 'memory_fixture_1' }] });
    await expect(provider.enqueueWrite({ identity, runId: 'run_12345678', summary: 'fixture summary', outcome: 'completed' })).resolves.toEqual({ accepted: true, queued: true });
    await provider.close();
    expect(calls).toEqual(['http://127.0.0.1:8420/health', 'http://127.0.0.1:8420/v3/atomic/search', 'http://127.0.0.1:8420/v3/conversation/add']);
  });

  it('fails closed for schema drift and privacy-shaped fixture data', async () => {
    const malformed = new TencentMemoryCoreProvider({ endpoint: 'http://127.0.0.1:8420', allowInsecureHttp: true, apiKey: 'memory-key', serviceId: 'vibego', identity, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ code: 0, data: { items: [{ id: 'memory_1', type: 'fact', content: 'apiKey=sk-' + 'x'.repeat(24) }] } }))) });
    await expect(malformed.recall({ identity, runId: 'run_12345678', query: 'privacy', maxItems: 4, maxBytes: 2_048 })).resolves.toMatchObject({ degraded: true, items: [] });
  });
});
