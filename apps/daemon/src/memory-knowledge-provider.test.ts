import { describe, expect, it, vi } from 'vitest';
import { TencentMemoryKnowledgeProvider, knowledgeResultToContextItems } from './memory-knowledge-provider.js';

const listData = (tools: Array<{ name: string; description: string; params: Record<string, unknown> }> = [{ name: 'search', description: 'Search pages.', params: { query: { type: 'string', required: true }, limit: { type: 'integer', default: 20 } } }]) => ({
  knowledge_id: 'wiki_demo',
  type: 'wiki',
  name: 'Demo docs',
  summary: 'A bounded fixture.',
  status: 'ready',
  tools,
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function provider(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, overrides: Record<string, unknown> = {}): TencentMemoryKnowledgeProvider {
  return new TencentMemoryKnowledgeProvider({
    endpoint: 'http://127.0.0.1:8421',
    allowInsecureHttp: true,
    serviceId: 'vibego',
    fetchImpl,
    ...overrides,
  });
}

describe('TencentMemoryKnowledgeProvider', () => {
  it('discovers the public descriptor, calls a read-only tool, and converts bounded output to retrieval context', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ input, ...(init ? { init } : {}) });
      if (input.endsWith('/tools/list')) return jsonResponse({ code: 0, message: 'ok', data: listData() });
      return jsonResponse({ code: 0, message: 'ok', data: { results: [{ title: 'Auth', snippet: 'Use the auth module.' }], count: 1 } });
    });
    const p = provider(fetchImpl);
    const listed = await p.listTools({ knowledgeId: 'wiki_demo' });
    expect(listed).toMatchObject({ degraded: false, resourceType: 'wiki', tools: [{ name: 'search' }] });
    const result = await p.call({ knowledgeId: 'wiki_demo', toolName: 'search', params: { query: 'auth', limit: 2 }, maxItems: 4, maxBytes: 2_048 });
    expect(result).toMatchObject({ degraded: false, items: [{ kind: 'knowledge', source: 'tencentdb-memory-knowledge', trust: 'untrusted' }] });
    expect(calls.map((call) => call.input)).toEqual([
      'http://127.0.0.1:8421/v3/tools/list',
      'http://127.0.0.1:8421/v3/tools/list',
      'http://127.0.0.1:8421/v3/tools/call',
    ]);
    expect(JSON.parse(String(calls.at(-1)?.init?.body))).toEqual({ knowledge_id: 'wiki_demo', tool_name: 'search', params: { query: 'auth', limit: 2 } });
    expect(calls.at(-1)?.init?.headers).toMatchObject({ 'x-tdai-service-id': 'vibego' });
    const context = knowledgeResultToContextItems(result, 'run_12345678');
    expect(context).toMatchObject([{ id: expect.stringContaining('run_12345678:knowledge:'), source: 'retrieval', trust: 'untrusted', role: 'assistant' }]);
    expect(context[0]?.content).toContain('[KNOWLEDGE tool=search source=tencentdb-memory-knowledge]');
  });

  it('probes the upstream health endpoint without requiring the v3 data envelope', async () => {
    const calls: string[] = [];
    const p = provider(async (input) => {
      calls.push(input);
      return jsonResponse({ status: 'ok', version: 'knowledge_rev_1' });
    });
    await expect(p.status()).resolves.toMatchObject({ available: true, degraded: false, capabilities: ['knowledge'] });
    expect(calls).toEqual(['http://127.0.0.1:8421/health']);
  });

  it('filters management/unknown descriptors and refuses unknown tools before /tools/call', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string) => {
      calls.push(input);
      return jsonResponse({ code: 0, message: 'ok', data: listData([
        { name: 'search', description: 'Search pages.', params: {} },
        { name: 'delete_knowledge', description: 'management', params: {} },
        { name: 'unknown_read', description: 'not in the contract', params: {} },
      ]) });
    });
    const p = provider(fetchImpl);
    const listed = await p.listTools({ knowledgeId: 'wiki_demo' });
    expect(listed.tools.map((tool) => tool.name)).toEqual(['search']);
    await expect(p.retrieve({ knowledgeId: 'wiki_demo', toolName: 'delete_knowledge', params: {}, maxItems: 4, maxBytes: 1_024 })).resolves.toMatchObject({ degraded: true, errorCode: 'forbidden', items: [] });
    expect(calls.every((input) => input.endsWith('/tools/list'))).toBe(true);
  });

  it('allows the documented CodeGraph read-only names but not Wiki-only cross-resource calls', async () => {
    const fetchImpl = vi.fn(async (input: string) => input.endsWith('/tools/list')
      ? jsonResponse({ code: 0, message: 'ok', data: { ...listData(), knowledge_id: 'codegraph_demo', type: 'code-graph', tools: [{ name: 'explore', description: 'Explore code.', params: { query: { type: 'string', required: true } } }] } })
      : jsonResponse({ code: 0, message: 'ok', data: { text: 'src/index.ts' } }));
    const p = provider(fetchImpl);
    await expect(p.retrieve({ knowledgeId: 'codegraph_demo', toolName: 'explore', params: { query: 'auth' }, maxItems: 2, maxBytes: 1_024 })).resolves.toMatchObject({ degraded: false });
    await expect(p.retrieve({ knowledgeId: 'codegraph_demo', toolName: 'read_page', params: { refs: ['x'] }, maxItems: 2, maxBytes: 1_024 })).resolves.toMatchObject({ degraded: true, errorCode: 'forbidden' });
  });

  it('maps timeout, abort, 5xx, malformed and schema responses to bounded degraded results', async () => {
    const waiting = provider(async (_input, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })), { timeoutMs: 5 });
    await expect(waiting.listTools({ knowledgeId: 'wiki_demo' })).resolves.toMatchObject({ degraded: true, errorCode: 'timeout', tools: [] });

    const controller = new AbortController();
    controller.abort();
    const aborted = provider(async (_input, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })));
    await expect(aborted.listTools({ knowledgeId: 'wiki_demo', signal: controller.signal })).resolves.toMatchObject({ degraded: true, errorCode: 'aborted' });

    const fiveHundred = provider(async () => jsonResponse({ code: 500, message: 'secret upstream error', data: null }, 503));
    await expect(fiveHundred.listTools({ knowledgeId: 'wiki_demo' })).resolves.toMatchObject({ degraded: true, errorCode: 'unavailable' });

    const malformed = provider(async () => new Response('{malformed', { status: 200 }));
    await expect(malformed.listTools({ knowledgeId: 'wiki_demo' })).resolves.toMatchObject({ degraded: true, errorCode: 'protocol' });

    const schema = provider(async () => jsonResponse({ code: 0, message: 'ok', data: { knowledge_id: 'wiki_demo', type: 'wiki', tools: 'not-an-array' } }));
    await expect(schema.listTools({ knowledgeId: 'wiki_demo' })).resolves.toMatchObject({ degraded: true, errorCode: 'schema' });
  });

  it('rejects oversized responses, bounds result count/bytes, and fails closed on privacy violations', async () => {
    const oversized = provider(async () => new Response('x'.repeat(2_000), { status: 200 }), { maxResponseBytes: 128 });
    await expect(oversized.listTools({ knowledgeId: 'wiki_demo' })).resolves.toMatchObject({ degraded: true, errorCode: 'too-large' });

    let phase = 0;
    const bounded = provider(async (input) => {
      phase += 1;
      if (input.endsWith('/tools/list')) return jsonResponse({ code: 0, message: 'ok', data: listData() });
      return jsonResponse({ code: 0, message: 'ok', data: { items: [{ id: 'one', content: 'one' }, { id: 'two', content: 'two' }, { id: 'three', content: 'three' }] } });
    });
    const result = await bounded.retrieve({ knowledgeId: 'wiki_demo', toolName: 'search', params: {}, maxItems: 2, maxBytes: 60 });
    expect(result.items).toHaveLength(2);
    expect(result.items.reduce((sum, item) => sum + new TextEncoder().encode(item.content).byteLength, 0)).toBeLessThanOrEqual(60);
    expect(phase).toBe(2);

    const privacy = provider(async (input) => input.endsWith('/tools/list')
      ? jsonResponse({ code: 0, message: 'ok', data: listData() })
      : jsonResponse({ code: 0, message: 'ok', data: { items: [{ content: 'C:\\Users\\private\\repo' }] } }));
    await expect(privacy.retrieve({ knowledgeId: 'wiki_demo', toolName: 'search', params: {}, maxItems: 2, maxBytes: 1_024 })).resolves.toMatchObject({ degraded: true, errorCode: 'privacy', items: [] });
  });

  it('requires explicit secure transport outside loopback and never exposes request secrets', () => {
    expect(() => new TencentMemoryKnowledgeProvider({ endpoint: 'http://knowledge.example.test', serviceId: 'vibego' })).toThrow(/HTTPS/iu);
    expect(() => new TencentMemoryKnowledgeProvider({ endpoint: 'https://user:pass@knowledge.example.test', serviceId: 'vibego' })).toThrow(/credentials/iu);
  });
});
