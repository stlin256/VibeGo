import { describe, expect, it } from 'vitest';
import type { DeepSeekSearchResponse } from '@ready4vibe/contracts';
import { DeepSeekProvider, DeepSeekSearchError } from './index.js';

const response: DeepSeekSearchResponse = {
  schemaVersion: 'deepseek-provider-search/v1',
  query: 'bounded query',
  items: [{
    schemaVersion: 'deepseek-provider-search-item/v1',
    source: 'retrieval',
    trust: 'untrusted',
    referenceId: 'ref-1',
    title: 'Result',
    snippet: 'Bounded result text.',
    url: 'https://example.com/result',
  }],
  truncated: false,
};

const config = {
  schemaVersion: 'deepseek-provider/v1' as const,
  providerId: 'deepseek' as const,
  endpointProfile: 'openai-responses' as const,
  endpoint: 'https://api.deepseek.com/v1/responses',
  model: 'deepseek-v4-flash',
  authRef: 'secret.deepseek.search',
  thinkingMode: 'off' as const,
  toolCalling: 'disabled' as const,
  webSearch: 'provider-owned' as const,
  reviewer: 'off' as const,
  timeoutMs: 100,
  maxRetries: 2,
  maxOutputTokens: 1_024,
  revision: 'cfg-search-1',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const capability = {
  schemaVersion: 'deepseek-provider-capability/v1' as const,
  providerId: 'deepseek' as const,
  endpointProfile: 'openai-responses' as const,
  model: 'deepseek-v4-flash',
  descriptorRevision: 'probe-search-1',
  capturedAt: '2026-08-06T00:00:00.000Z',
  status: 'ready' as const,
  streaming: true,
  toolCalls: false,
  structuredOutput: false,
  reasoning: false,
  usage: true,
  webSearch: true,
  contextLimit: 'unknown' as const,
  outputLimit: 1_024,
  degradedReason: null,
};

function provider(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>, overrides: Record<string, unknown> = {}) {
  return new DeepSeekProvider({ config: { ...config, ...overrides }, capability, apiKey: 'sk-' + 'a'.repeat(32), fetchImpl });
}

describe('DeepSeek provider-owned search adapter', () => {
  it('uses the complete Responses endpoint and returns only the strict search contract', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const p = provider(async (input, init) => {
      calls.push({ input, ...(init === undefined ? {} : { init }) });
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    await expect(p.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'bounded query', maxItems: 4, maxBytes: 4_096 }, new AbortController().signal)).resolves.toEqual(response);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(config.endpoint);
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: config.model, stream: false, tools: [{ type: 'web_search' }] });
    expect(body.input).toEqual([{ role: 'user', content: 'bounded query' }]);
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer ' + 'sk-' + 'a'.repeat(32));
  });

  it('applies request item and byte bounds before returning retrieval data', async () => {
    const p = provider(async () => new Response(JSON.stringify({
      ...response,
      items: [response.items[0], { ...response.items[0], referenceId: 'ref-2', snippet: 'second' }],
      truncated: false,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const bounded = await p.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'bounded query', maxItems: 1, maxBytes: 4_096 }, new AbortController().signal);
    expect(bounded.items).toHaveLength(1);
    expect(bounded.truncated).toBe(true);
  });

  it('fails closed for an ineligible config before making a request', async () => {
    let calls = 0;
    const p = provider(async () => { calls += 1; return new Response('{}'); }, { webSearch: 'off' });
    await expect(p.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'q' }, new AbortController().signal)).rejects.toMatchObject({ code: 'DEEPSEEK_SEARCH_DEGRADED' });
    expect(calls).toBe(0);
  });

  it('maps HTTP, malformed and cancellation failures without retry or raw data', async () => {
    let calls = 0;
    const failed = provider(async () => { calls += 1; return new Response('Authorization: secret', { status: 503 }); });
    await expect(failed.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'q' }, new AbortController().signal)).rejects.toMatchObject({ code: 'DEEPSEEK_HTTP_5XX' });
    const malformed = provider(async () => new Response(JSON.stringify({ bad: true }), { status: 200 }));
    await expect(malformed.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'q' }, new AbortController().signal)).rejects.toMatchObject({ code: 'DEEPSEEK_SEARCH_PROTOCOL_INVALID' });
    const controller = new AbortController();
    controller.abort();
    const cancelled = provider(async () => { calls += 1; return new Response(JSON.stringify(response)); });
    await expect(cancelled.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'q' }, controller.signal)).rejects.toMatchObject({ code: 'DEEPSEEK_SEARCH_CANCELLED' });
    expect(calls).toBe(1);
    expect(JSON.stringify(new DeepSeekSearchError('DEEPSEEK_SEARCH_DEGRADED'))).not.toContain('secret');
  });

  it('propagates timeout to the request and returns a bounded timeout code', async () => {
    let aborted = false;
    const p = provider(async (_input, init) => {
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
      throw new Error('aborted');
    }, { timeoutMs: 10 });
    await expect(p.search({ schemaVersion: 'deepseek-provider-search-request/v1', query: 'q' }, new AbortController().signal)).rejects.toMatchObject({ code: 'DEEPSEEK_SEARCH_TIMEOUT' });
    expect(aborted).toBe(true);
  });
});
