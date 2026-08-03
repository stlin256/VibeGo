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
});
