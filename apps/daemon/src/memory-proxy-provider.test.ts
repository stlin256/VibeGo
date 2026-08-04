import { describe, expect, it, vi } from 'vitest';
import type { AgentMemoryIdentity, ModelEvent, ModelProvider, ModelRequest } from '@ready4vibe/contracts';
import { TencentMemoryProxyProvider } from './memory-proxy-provider.js';

const identity: AgentMemoryIdentity = {
  teamId: 'team_demo',
  agentId: 'agent_demo',
  userId: 'user_demo',
  sessionId: 'session_demo',
};

const request: ModelRequest = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  budget: { maxInputTokens: 100, maxOutputTokens: 100 },
  metadata: { runId: 'run_12345678', turnId: 'turn_12345678', requestId: 'req_12345678' },
};

function responseFromChunks(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

function directProvider(events: readonly ModelEvent[]): ModelProvider & { calls: number } {
  const provider = {
    id: 'direct',
    capabilities: { streaming: true, toolCalls: true, structuredOutput: false } as const,
    calls: 0,
    async *stream(_request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelEvent> {
      provider.calls += 1;
      yield* events;
    },
  };
  return provider;
}

describe('TencentMemoryProxyProvider', () => {
  it('uses the explicit proxy path and bounded identity headers without appending a second path', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      proxyApiKey: 'proxy-secret',
      fetchImpl: async (input, init) => {
        calls.push({ input, ...(init ? { init } : {}) });
        return responseFromChunks([
          'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
          'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      },
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('https://proxy.example.test/proxy/team_demo/v1/chat/completions');
    expect(calls[0]?.input).not.toContain('/chat/completions/chat/completions');
    expect(calls[0]?.init?.headers).toMatchObject({
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'x-tdai-user-key': 'proxy-secret',
      'x-team-id': 'team_demo',
      'x-agent-id': 'agent_demo',
      'x-user-id': 'user_demo',
      'x-session-id': 'session_demo',
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'completed', finishReason: 'stop' },
    ]);
    expect(JSON.stringify(events)).not.toContain('proxy-secret');
  });

  it('probes health without exposing credentials and reports proxy capability', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      proxyApiKey: 'proxy-secret',
      fetchImpl: async (input, init) => {
        calls.push({ input, ...(init ? { init } : {}) });
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    await expect(provider.status()).resolves.toMatchObject({
      enabled: true,
      mode: 'proxy',
      available: true,
      degraded: false,
      capabilities: ['proxy'],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('https://proxy.example.test/health');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(JSON.stringify(calls[0]?.init)).not.toContain('proxy-secret');
  });

  it('falls back to the captured direct provider only before proxy output starts', async () => {
    const fallback = directProvider([
      { type: 'text-delta', text: 'direct' },
      { type: 'completed', finishReason: 'stop' },
    ]);
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      fallback,
      fallbackToDirectProvider: true,
      fetchImpl: async () => { throw new Error('proxy is down'); },
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);

    expect(events).toEqual([
      { type: 'text-delta', text: 'direct' },
      { type: 'completed', finishReason: 'stop' },
    ]);
    expect(fallback.calls).toBe(1);
    await expect(provider.status()).resolves.toMatchObject({ degraded: true, lastErrorCode: 'unavailable' });
  });

  it('does not replay a partially streamed proxy response through fallback', async () => {
    const fallback = directProvider([{ type: 'text-delta', text: 'duplicate' }, { type: 'completed', finishReason: 'stop' }]);
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      fallback,
      fallbackToDirectProvider: true,
      fetchImpl: async () => responseFromChunks([
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        'data: {not-json}\n\n',
      ]),
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);

    expect(events[0]).toEqual({ type: 'text-delta', text: 'partial' });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'MEMORY_PROXY_MALFORMED_JSON' });
    expect(fallback.calls).toBe(0);
  });

  it('does not fall back for a deterministic proxy 4xx response', async () => {
    const fallback = directProvider([{ type: 'completed', finishReason: 'stop' }]);
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      fallback,
      fallbackToDirectProvider: true,
      fetchImpl: async () => new Response('secret upstream error', { status: 401 }),
    });

    const events: ModelEvent[] = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toEqual([{
      type: 'error',
      code: 'MEMORY_PROXY_HTTP_401',
      retryable: false,
      safeMessage: 'The memory proxy returned HTTP 401.',
    }]);
    expect(fallback.calls).toBe(0);
    expect(JSON.stringify(events)).not.toContain('secret upstream error');
  });

  it('turns a bounded proxy timeout into a direct fallback when enabled', async () => {
    const fallback = directProvider([{ type: 'completed', finishReason: 'stop' }]);
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      timeoutMs: 5,
      fallback,
      fallbackToDirectProvider: true,
      fetchImpl: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      }),
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events).toEqual([{ type: 'completed', finishReason: 'stop' }]);
    expect(fallback.calls).toBe(1);
    await expect(provider.status()).resolves.toMatchObject({ degraded: true, lastErrorCode: 'timeout' });
  });

  it('can explicitly fail closed instead of using a direct fallback', async () => {
    const fallback = directProvider([{ type: 'completed', finishReason: 'stop' }]);
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      fallback,
      fallbackToDirectProvider: false,
      fetchImpl: async () => { throw new Error('proxy is down'); },
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(events).toEqual([{
      type: 'error',
      code: 'MEMORY_PROXY_NETWORK_ERROR',
      retryable: true,
      safeMessage: 'The memory proxy could not be reached.',
    }]);
    expect(fallback.calls).toBe(0);
  });

  it('keeps recall/write no-op and validates their bounded contracts because Proxy owns both operations', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    const provider = new TencentMemoryProxyProvider({ endpoint: 'https://proxy.example.test', identity, fetchImpl });
    await expect(provider.recall({ identity, runId: 'run_12345678', query: 'hello', maxItems: 4, maxBytes: 1024 })).resolves.toMatchObject({ items: [], degraded: false });
    await expect(provider.enqueueWrite({ identity, runId: 'run_12345678', summary: 'done', outcome: 'completed' })).resolves.toEqual({ accepted: false, queued: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(provider.enqueueWrite({ identity, runId: 'run_12345678', summary: 'token=secret', outcome: 'completed' })).rejects.toThrow();
  });

  it('rejects unsafe endpoint, path, and identity configuration', () => {
    expect(() => new TencentMemoryProxyProvider({ endpoint: 'https://user:pass@example.test', identity })).toThrow(/credentials/iu);
    expect(() => new TencentMemoryProxyProvider({ endpoint: 'https://proxy.example.test?token=secret', identity })).toThrow(/query/iu);
    expect(() => new TencentMemoryProxyProvider({ endpoint: 'https://proxy.example.test', identity, chatCompletionsPath: '/proxy/team/v1/messages?token=secret' })).toThrow(/path/iu);
    expect(() => new TencentMemoryProxyProvider({ endpoint: 'http://proxy.example.test', identity })).toThrow(/HTTPS/iu);
  });

  it('isolates concurrent streams and keeps the direct provider shared but unclosed', async () => {
    const calls: string[] = [];
    const fallback = directProvider([{ type: 'completed', finishReason: 'stop' }]);
    const provider = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity,
      fallback,
      fallbackToDirectProvider: true,
      fetchImpl: async (input) => {
        calls.push(input);
        throw new Error('proxy unavailable');
      },
    });
    await Promise.all([
      collect(provider.stream({ ...request, metadata: { ...request.metadata, runId: 'run_12345678' } }, new AbortController().signal)),
      collect(provider.stream({ ...request, metadata: { ...request.metadata, runId: 'run_abcdefgh' } }, new AbortController().signal)),
    ]);
    expect(calls).toEqual([
      'https://proxy.example.test/proxy/team_demo/v1/chat/completions',
      'https://proxy.example.test/proxy/team_demo/v1/chat/completions',
    ]);
    expect(fallback.calls).toBe(2);
    await provider.close();
    expect(fallback.calls).toBe(2);
  });
});

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
