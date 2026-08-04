import type { ModelEvent, ModelProvider, ModelRequest } from '@ready4vibe/contracts';

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAIChatCompletionsStreamOptions {
  readonly endpoint: string;
  readonly request: ModelRequest;
  readonly signal: AbortSignal;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: FetchImplementation;
  readonly errorCodePrefix?: string;
  readonly providerLabel?: string;
}

export interface OpenAICompatibleProviderOptions {
  id: string;
  baseUrl: string;
  apiKey: string;
  allowInsecureHttp?: boolean;
  fetchImpl?: FetchImplementation;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: false } as const;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImplementation;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!options.id || !options.apiKey) throw new Error('provider id and api key are required');
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allowInsecureHttp === true)) {
      throw new Error('OpenAI-compatible provider requires HTTPS unless allowInsecureHttp is explicit');
    }
    if (url.username || url.password || url.hash || url.search) {
      throw new Error('OpenAI-compatible provider URL must not contain credentials, query parameters, or fragments');
    }
    this.id = options.id;
    this.endpoint = `${url.toString().replace(/\/$/, '')}/chat/completions`;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    yield* streamOpenAIChatCompletions({
      endpoint: this.endpoint,
      request,
      signal,
      apiKey: this.apiKey,
      fetchImpl: this.fetchImpl,
    });
  }
}

/**
 * Shared explicit-endpoint SSE adapter. Callers must provide the complete
 * endpoint; this function never appends a path segment.
 */
export async function* streamOpenAIChatCompletions(options: OpenAIChatCompletionsStreamOptions): AsyncIterable<ModelEvent> {
  const prefix = options.errorCodePrefix ?? 'MODEL';
  const label = options.providerLabel ?? 'The model provider';
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  let response: Response;
  try {
    response = await fetchImpl(options.endpoint, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        ...(options.headers ?? {}),
      },
      body: JSON.stringify({
        model: options.request.model,
        messages: options.request.messages,
        ...(options.request.tools.length > 0 ? { tools: options.request.tools } : {}),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: options.request.budget.maxOutputTokens,
      }),
      signal: options.signal,
    });
  } catch {
    if (!options.signal.aborted) yield { type: 'error', code: `${prefix}_NETWORK_ERROR`, retryable: true, safeMessage: `${label} could not be reached.` };
    return;
  }
  if (!response.ok) {
    if (!options.signal.aborted) yield {
      type: 'error',
      code: `${prefix}_HTTP_${response.status}`,
      retryable: response.status >= 500,
      safeMessage: `${label} returned HTTP ${response.status}.`,
    };
    return;
  }
  if (!response.body) {
    yield { type: 'error', code: `${prefix}_EMPTY_BODY`, retryable: true, safeMessage: `${label} returned an empty stream.` };
    return;
  }

  let completed = false;
  try {
    for await (const data of readSseData(response.body, options.signal)) {
      if (data === '[DONE]') {
        if (!completed) yield { type: 'completed', finishReason: 'stop' };
        return;
      }
      let payload: OpenAIChunk;
      try {
        payload = JSON.parse(data) as OpenAIChunk;
      } catch {
        if (!options.signal.aborted) yield { type: 'error', code: `${prefix}_MALFORMED_JSON`, retryable: false, safeMessage: `${label} returned malformed JSON.` };
        return;
      }
      for (const event of translateChunk(payload)) {
        if (event.type === 'completed') completed = true;
        yield event;
      }
    }
    if (!options.signal.aborted && !completed) yield { type: 'error', code: `${prefix}_STREAM_ENDED`, retryable: true, safeMessage: `${label} ended the stream unexpectedly.` };
  } catch {
    if (!options.signal.aborted) yield { type: 'error', code: `${prefix}_STREAM_ERROR`, retryable: true, safeMessage: `${label} stream failed.` };
  }
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function translateChunk(chunk: OpenAIChunk): ModelEvent[] {
  const events: ModelEvent[] = [];
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  if (delta?.content) events.push({ type: 'text-delta', text: delta.content });
  for (const call of delta?.tool_calls ?? []) {
    const name = call.function?.name;
    events.push({
      type: 'tool-call-delta',
      callId: call.id ?? `tool_call_${call.index ?? 0}`,
      ...(name ? { name } : {}),
      argumentsChunk: call.function?.arguments ?? '',
    });
  }
  if (chunk.usage && (chunk.usage.prompt_tokens !== undefined || chunk.usage.completion_tokens !== undefined)) {
    events.push({
      type: 'usage',
      ...(chunk.usage.prompt_tokens === undefined ? {} : { inputTokens: chunk.usage.prompt_tokens }),
      ...(chunk.usage.completion_tokens === undefined ? {} : { outputTokens: chunk.usage.completion_tokens }),
    });
  }
  if (choice?.finish_reason) events.push({ type: 'completed', finishReason: mapFinishReason(choice.finish_reason) });
  return events;
}

function mapFinishReason(reason: string): 'stop' | 'tool-calls' | 'length' | 'content-filter' {
  if (reason === 'tool_calls') return 'tool-calls';
  if (reason === 'length' || reason === 'max_tokens') return 'length';
  if (reason === 'content_filter') return 'content-filter';
  return 'stop';
}

async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) yield data;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = buffer.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}
