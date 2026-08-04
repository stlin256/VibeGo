import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from './index.js';

const request = {
  model: 'deepseek-v4-flash',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
  budget: { maxInputTokens: 100, maxOutputTokens: 100 },
  metadata: { runId: 'run_1', turnId: 'turn_1', requestId: 'req_1' },
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

describe('OpenAICompatibleProvider', () => {
  it('uses a complete explicit endpoint without rewriting its path', async () => {
    let called: string | undefined;
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      endpoint: 'https://api.deepseek.com/anthropic/v1/chat/completions',
      apiKey: 'test-secret',
      fetchImpl: async (input) => {
        called = input;
        return responseFromChunks(['data: [DONE]\n\n']);
      },
    });
    for await (const _event of provider.stream(request, new AbortController().signal)) { /* drain */ }
    expect(called).toBe('https://api.deepseek.com/anthropic/v1/chat/completions');
  });

  it('sends a streaming request and parses split SSE frames', async () => {
    let capturedInit: RequestInit | undefined;
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-secret',
      fetchImpl: async (_input, init) => {
        capturedInit = init;
        return responseFromChunks([
          'data: {"choices":[{"delta":{"content":"hel',
          'lo"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"shell","arguments":"{}"}}]}}]}\n\n',
          'data: {"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
          'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
          'data: [DONE]\n\n',
        ]);
      },
    });
    const events = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'tool-call-delta', callId: 'call-1', name: 'shell', argumentsChunk: '{}' },
      { type: 'usage', inputTokens: 3, outputTokens: 2 },
      { type: 'completed', finishReason: 'tool-calls' },
    ]);
    expect(capturedInit?.headers).toMatchObject({ Authorization: 'Bearer test-secret', Accept: 'text/event-stream' });
    expect(JSON.stringify(events)).not.toContain('test-secret');
    expect(String(capturedInit?.body)).toContain('deepseek-v4-flash');
  });

  it('redacts non-2xx response bodies from model errors', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-secret',
      fetchImpl: async () => new Response('secret provider body', { status: 401 }),
    });
    const events = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: 'error', code: 'MODEL_HTTP_401', retryable: false, safeMessage: 'The model provider returned HTTP 401.' }]);
    expect(JSON.stringify(events)).not.toContain('secret provider body');
  });

  it('clamps Retry-After metadata without exposing response headers', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: 'test-secret',
      fetchImpl: async () => new Response('provider body', { status: 429, headers: { 'retry-after': '60' } }),
    });
    const events = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: 'error', code: 'MODEL_HTTP_429', retryable: true, safeMessage: 'The model provider returned HTTP 429.', retryAfterMs: 30_000 }]);
    expect(JSON.stringify(events)).not.toContain('retry-after');
  });

  it('requires HTTPS unless insecure HTTP is explicit', () => {
    expect(() => new OpenAICompatibleProvider({ id: 'local', baseUrl: 'http://127.0.0.1:8080', apiKey: 'x' })).toThrow('requires HTTPS');
    expect(() => new OpenAICompatibleProvider({ id: 'local', baseUrl: 'http://127.0.0.1:8080', apiKey: 'x', allowInsecureHttp: true })).not.toThrow();
  });

  it('rejects provider URLs that could carry credentials or secret query parameters', () => {
    expect(() => new OpenAICompatibleProvider({ id: 'local', baseUrl: 'https://user:pass@example.test', apiKey: 'x' })).toThrow('must not contain credentials');
    expect(() => new OpenAICompatibleProvider({ id: 'local', baseUrl: 'https://example.test?api_key=leak', apiKey: 'x' })).toThrow('must not contain credentials');
  });

  it('turns malformed stream JSON into a safe error', async () => {
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test-secret',
      fetchImpl: async () => responseFromChunks(['data: {not-json}\n\n']),
    });
    const events = [];
    for await (const event of provider.stream(request, new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: 'error', code: 'MODEL_MALFORMED_JSON', retryable: false, safeMessage: 'The model provider returned malformed JSON.' }]);
  });

  it('honors an already-aborted signal without emitting provider data', async () => {
    const controller = new AbortController();
    controller.abort();
    let capturedSignal: AbortSignal | undefined;
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      apiKey: 'test-secret',
      fetchImpl: async (_input, init) => {
        capturedSignal = init?.signal as AbortSignal | undefined;
        return responseFromChunks(['data: {"choices":[{"delta":{"content":"must-not-appear"}}]}\n\n']);
      },
    });
    const events = [];
    for await (const event of provider.stream(request, controller.signal)) events.push(event);
    expect(capturedSignal).toBe(controller.signal);
    expect(events).toEqual([]);
  });
});
