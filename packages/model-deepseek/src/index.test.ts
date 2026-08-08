import { describe, expect, it } from 'vitest';
import type { ModelEvent, ModelRequest } from '@ready4vibe/contracts';
import {
  DeepSeekProvider,
  mapDeepSeekHttpError,
  newTranslationState,
  translateDeepSeekAnthropicEvent,
  translateDeepSeekChatChunk,
  translateDeepSeekResponsesEvent,
} from './index.js';

const config = {
  schemaVersion: 'deepseek-provider/v1' as const,
  providerId: 'deepseek' as const,
  endpointProfile: 'openai-chat-completions' as const,
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-v4-flash',
  authRef: 'secret.deepseek.primary',
  thinkingMode: 'auto' as const,
  toolCalling: 'enabled' as const,
  webSearch: 'off' as const,
  reviewer: 'off' as const,
  timeoutMs: 10_000,
  maxRetries: 2,
  maxOutputTokens: 1_024,
  revision: 'cfg-1',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

const request: ModelRequest = {
  model: config.model,
  messages: [{ role: 'user', content: 'Say hello.' }],
  tools: [{ type: 'function', name: 'filesystem.read' }],
  budget: { maxInputTokens: 1_000, maxOutputTokens: 1_024 },
  metadata: { runId: 'run-1', turnId: 'turn-1', requestId: 'request-1' },
};

function responseFor(events: string[], status = 200, headers: Record<string, string> = {}): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join('');
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const result: ModelEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

describe('DeepSeek protocol translators', () => {
  it('translates Chat Completions text, multiple tool calls, usage and finish reason', () => {
    expect(translateDeepSeekChatChunk({ choices: [{ delta: { content: 'Hi' } }] })).toEqual([{ type: 'text-delta', text: 'Hi' }]);
    expect(translateDeepSeekChatChunk({ choices: [{ delta: { tool_calls: [
      { index: 0, id: 'call-a', function: { name: 'filesystem.read', arguments: '{"path":"' } },
      { index: 1, id: 'call-b', function: { name: 'shell.exec', arguments: '{"argv":[]}' } },
    ] } }]})).toEqual([
      { type: 'tool-call-delta', callId: 'call-a', name: 'filesystem.read', argumentsChunk: '{"path":"' },
      { type: 'tool-call-delta', callId: 'call-b', name: 'shell.exec', argumentsChunk: '{"argv":[]}' },
    ]);
    expect(translateDeepSeekChatChunk({ usage: { prompt_tokens: 4, completion_tokens: 6 }, choices: [{ finish_reason: 'tool_calls', delta: {} }] })).toEqual([
      { type: 'usage', inputTokens: 4, outputTokens: 6 },
      { type: 'completed', finishReason: 'tool-calls' },
    ]);
  });

  it('maps Responses and Anthropic Messages events without exposing reasoning payloads', () => {
    expect(translateDeepSeekResponsesEvent({ type: 'response.output_text.delta', delta: 'ok' })).toEqual([{ type: 'text-delta', text: 'ok' }]);
    expect(translateDeepSeekResponsesEvent({ type: 'response.function_call_arguments.delta', call_id: 'call-1', name: 'filesystem.read', delta: '{}' })).toEqual([
      { type: 'tool-call-delta', callId: 'call-1', name: 'filesystem.read', argumentsChunk: '{}' },
    ]);
    expect(translateDeepSeekResponsesEvent({ type: 'response.reasoning_summary_text.delta', delta: 'private thought' })).toEqual([]);
    expect(translateDeepSeekResponsesEvent({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 3, output_tokens: 5 } } })).toEqual([
      { type: 'usage', inputTokens: 3, outputTokens: 5 },
      { type: 'completed', finishReason: 'stop' },
    ]);
    expect(translateDeepSeekResponsesEvent({ type: 'response.incomplete', response: { status: 'incomplete', usage: { input_tokens: 3, output_tokens: 5 } } })).toEqual([
      { type: 'usage', inputTokens: 3, outputTokens: 5 },
      { type: 'completed', finishReason: 'length' },
    ]);
    expect(translateDeepSeekResponsesEvent({ type: 'response.output_text.done', text: 'ok' })).toEqual([]);
    expect(translateDeepSeekResponsesEvent({ type: 'response.queued', response: { status: 'queued' } })).toEqual([]);
    const toolState = newTranslationState();
    expect(translateDeepSeekResponsesEvent({ type: 'response.output_item.added', item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'filesystem_read', arguments: '' } }, toolState)).toEqual([
      { type: 'tool-call-delta', callId: 'call-1', name: 'filesystem_read', argumentsChunk: '' },
    ]);
    // DeepSeek deltas carry only the item id; the call id resolves via the output item.
    expect(translateDeepSeekResponsesEvent({ type: 'response.function_call_arguments.delta', item_id: 'item-1', delta: '{"path"' }, toolState)).toEqual([
      { type: 'tool-call-delta', callId: 'call-1', argumentsChunk: '{"path"' },
    ]);
    // The done item carries the buffered arguments again; streamed deltas win.
    expect(translateDeepSeekResponsesEvent({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call-1', name: 'filesystem_read', arguments: '{"path":"note.txt"}' } }, toolState)).toEqual([
      { type: 'tool-call-delta', callId: 'call-1', name: 'filesystem_read', argumentsChunk: '' },
    ]);
    // Without streamed deltas the buffered done arguments are delivered once.
    expect(translateDeepSeekResponsesEvent({ type: 'response.output_item.done', item: { type: 'function_call', call_id: 'call-2', name: 'filesystem_read', arguments: '{"path":"a"}' } }, toolState)).toEqual([
      { type: 'tool-call-delta', callId: 'call-2', name: 'filesystem_read', argumentsChunk: '{"path":"a"}' },
    ]);
    expect(translateDeepSeekAnthropicEvent({ type: 'message_start', message: { usage: { input_tokens: 2 } } })).toEqual([{ type: 'usage', inputTokens: 2 }]);
    expect(translateDeepSeekAnthropicEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } })).toEqual([{ type: 'text-delta', text: 'ok' }]);
    expect(translateDeepSeekAnthropicEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } })).toEqual([
      { type: 'usage', outputTokens: 4 },
      { type: 'completed', finishReason: 'tool-calls' },
    ]);
  });

  it('tolerates reasoning-model chunks with null content', () => {
    expect(translateDeepSeekChatChunk({ choices: [{ index: 0, delta: { role: 'assistant', content: null, reasoning_content: '' } }] })).toEqual([]);
    expect(translateDeepSeekChatChunk({ choices: [{ index: 0, delta: { content: null, reasoning_content: 'think' } }] })).toEqual([]);
    expect(translateDeepSeekChatChunk({ choices: [{ index: 0, delta: { content: 'hello', reasoning_content: null } }] })).toEqual([{ type: 'text-delta', text: 'hello' }]);
  });

  it('fails closed on malformed protocol events and maps HTTP retry semantics', () => {
    expect(translateDeepSeekChatChunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 42 } }] } }] })[0]).toMatchObject({ type: 'error', code: 'DEEPSEEK_MALFORMED_EVENT', retryable: false });
    expect(translateDeepSeekResponsesEvent({ type: 'unknown.provider.event', value: true })[0]).toMatchObject({ type: 'error', code: 'DEEPSEEK_MALFORMED_EVENT', retryable: false });
    expect(mapDeepSeekHttpError(429, '2')).toMatchObject({ type: 'error', code: 'DEEPSEEK_HTTP_429', retryable: true, retryAfterMs: 2_000 });
    expect(mapDeepSeekHttpError(401, null)).toMatchObject({ type: 'error', code: 'DEEPSEEK_HTTP_401', retryable: false });
    expect(mapDeepSeekHttpError(503, null)).toMatchObject({ type: 'error', code: 'DEEPSEEK_HTTP_5XX', retryable: true });
  });
});

describe('DeepSeekProvider', () => {
  it('uses the complete endpoint and does not leak the runtime key into events', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new DeepSeekProvider({
      config,
      apiKey: 'sk-' + 'a'.repeat(32),
      fetchImpl: async (input, init) => {
        calls.push({ input, ...(init === undefined ? {} : { init }) });
        return responseFor([
          JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }),
          JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
          '[DONE]',
        ]);
      },
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe(config.endpoint);
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ model: config.model, stream: true, stream_options: { include_usage: true } });
    expect(JSON.stringify(events)).not.toContain('sk-');
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'usage', inputTokens: 1, outputTokens: 2 },
      { type: 'completed', finishReason: 'stop' },
    ]);
  });

  it('uses explicit paths and headers for Responses and Anthropic profiles', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const responsesProvider = new DeepSeekProvider({
      config: {
        ...config,
        endpointProfile: 'openai-responses',
        endpoint: 'https://api.deepseek.com/v1/responses',
        webSearch: 'provider-owned',
      },
      capability: {
        schemaVersion: 'deepseek-provider-capability/v1',
        providerId: 'deepseek',
        endpointProfile: 'openai-responses',
        model: 'deepseek-v4-flash',
        descriptorRevision: 'probe-1',
        capturedAt: '2026-08-05T10:00:00.000Z',
        status: 'ready',
        streaming: true,
        toolCalls: true,
        structuredOutput: false,
        reasoning: false,
        usage: true,
        webSearch: true,
        contextLimit: 100_000,
        outputLimit: 4_096,
        degradedReason: null,
      },
      apiKey: 'runtime-secret',
      fetchImpl: async (input, init) => {
        calls.push({ input, ...(init === undefined ? {} : { init }) });
        return responseFor(['{"type":"response.completed","response":{"status":"completed"}}', '[DONE]']);
      },
    });
    await collect(responsesProvider.stream(request, new AbortController().signal));
    const responseBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(calls[0]?.input).toBe('https://api.deepseek.com/v1/responses');
    expect(responseBody.input).toEqual(request.messages);
    expect(responseBody.tools).toEqual([{ type: 'function', name: 'filesystem.read' }, { type: 'web_search' }]);
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe('Bearer runtime-secret');

    const anthropicProvider = new DeepSeekProvider({
      config: {
        ...config,
        endpointProfile: 'anthropic-messages',
        endpoint: 'https://api.deepseek.com/anthropic/v1/messages',
      },
      apiKey: 'runtime-secret',
      fetchImpl: async (input, init) => {
        calls.push({ input, ...(init === undefined ? {} : { init }) });
        return responseFor(['{"type":"message_stop"}']);
      },
    });
    await collect(anthropicProvider.stream(request, new AbortController().signal));
    expect(calls[1]?.input).toBe('https://api.deepseek.com/anthropic/v1/messages');
    const anthropicHeaders = calls[1]?.init?.headers as Record<string, string>;
    expect(anthropicHeaders['x-api-key']).toBe('runtime-secret');
    expect(anthropicHeaders.Authorization).toBeUndefined();
  });

  it('fails closed when provider-owned search has no ready capability snapshot', () => {
    expect(() => new DeepSeekProvider({
      config: {
        ...config,
        endpointProfile: 'openai-responses',
        endpoint: 'https://api.deepseek.com/v1/responses',
        webSearch: 'provider-owned',
      },
      apiKey: 'runtime-secret',
    })).toThrow('DEEPSEEK_SEARCH_DEGRADED');
  });

  it('does not emit a retry or replay after a visible partial stream', async () => {
    let calls = 0;
    const provider = new DeepSeekProvider({
      config,
      apiKey: 'runtime-secret',
      fetchImpl: async () => {
        calls += 1;
        return responseFor([JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })]);
      },
    });
    const events = await collect(provider.stream(request, new AbortController().signal));
    expect(calls).toBe(1);
    expect(events).toEqual([
      { type: 'text-delta', text: 'partial' },
      { type: 'error', code: 'DEEPSEEK_STREAM_DISCONNECTED', retryable: true, safeMessage: 'DeepSeek stream disconnected.' },
    ]);
  });

  it('propagates cancellation without converting abort into a provider error', async () => {
    const controller = new AbortController();
    const provider = new DeepSeekProvider({
      config,
      apiKey: 'runtime-secret',
      fetchImpl: async (_input, init) => {
        init?.signal?.addEventListener('abort', () => undefined);
        controller.abort();
        return responseFor([JSON.stringify({ choices: [{ delta: { content: 'late' } }] })]);
      },
    });
    const events = await collect(provider.stream(request, controller.signal));
    expect(events).toEqual([]);
  });

  it('flattens chat-completions tools and translates tool history for the Responses profile', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const provider = new DeepSeekProvider({
      config: {
        ...config,
        endpointProfile: 'openai-responses',
        endpoint: 'https://api.deepseek.com/v1/responses',
      },
      apiKey: 'runtime-secret',
      fetchImpl: async (input, init) => {
        calls.push({ input, ...(init === undefined ? {} : { init }) });
        return responseFor(['{"type":"response.completed","response":{"status":"completed"}}', '[DONE]']);
      },
    });
    const historyRequest: ModelRequest = {
      ...request,
      messages: [
        { role: 'user', content: 'Read note.txt' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'filesystem_read', arguments: '{"path":"note.txt"}' } }] },
        { role: 'tool', tool_call_id: 'call-1', content: '{"content":"hello"}' },
      ],
      tools: [{ type: 'function', function: { name: 'filesystem_read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }],
    };
    await collect(provider.stream(historyRequest, new AbortController().signal));
    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    expect(body.tools).toEqual([{ type: 'function', name: 'filesystem_read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }]);
    expect(body.input).toEqual([
      { role: 'user', content: 'Read note.txt' },
      { type: 'function_call', call_id: 'call-1', name: 'filesystem_read', arguments: '{"path":"note.txt"}' },
      { type: 'function_call_output', call_id: 'call-1', output: '{"content":"hello"}' },
    ]);
  });
});
