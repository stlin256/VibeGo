import {
  DeepSeekConfigSchema,
  type DeepSeekConfig,
  type DeepSeekCapabilitySnapshot,
  type DeepSeekEndpointProfile,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
} from '@ready4vibe/contracts';

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface DeepSeekProviderOptions {
  readonly config: DeepSeekConfig;
  /** Required for high/max thinking; unprobed capabilities fail closed. */
  readonly capability?: DeepSeekCapabilitySnapshot;
  /** Runtime-only credential. It is never included in events, errors or snapshots. */
  readonly apiKey: string;
  readonly fetchImpl?: FetchImplementation;
}

export interface DeepSeekTranslationState {
  readonly chatCallIds: Map<number, string>;
  readonly anthropicToolIds: Map<number, string>;
  anthropicTerminal?: boolean;
}

export class DeepSeekProvider implements ModelProvider {
  readonly id = 'deepseek';
  readonly capabilities: ModelProvider['capabilities'];
  private readonly config: DeepSeekConfig;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImplementation;

  constructor(options: DeepSeekProviderOptions) {
    this.config = DeepSeekConfigSchema.parse(options.config);
    if (typeof options.apiKey !== 'string' || options.apiKey.length === 0) throw new Error('DeepSeek runtime credential is required');
    if ((this.config.thinkingMode === 'high' || this.config.thinkingMode === 'max')
      && (!options.capability || options.capability.status !== 'ready' || !options.capability.reasoning)) {
      throw new Error('DEEPSEEK_THINKING_UNSUPPORTED');
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.capabilities = {
      streaming: true,
      toolCalls: this.config.toolCalling === 'enabled',
      structuredOutput: false,
    } as const;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    yield* streamDeepSeek({ config: this.config, apiKey: this.apiKey, request, signal, fetchImpl: this.fetchImpl });
  }
}

export interface StreamDeepSeekOptions {
  readonly config: DeepSeekConfig;
  readonly apiKey: string;
  readonly request: ModelRequest;
  readonly signal: AbortSignal;
  readonly fetchImpl?: FetchImplementation;
}

/**
 * Explicit DeepSeek protocol boundary. The caller supplies a complete endpoint
 * selected by the validated profile; this function never appends a path.
 */
export async function* streamDeepSeek(options: StreamDeepSeekOptions): AsyncIterable<ModelEvent> {
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const state: DeepSeekTranslationState = { chatCallIds: new Map(), anthropicToolIds: new Map() };
  let response: Response;
  try {
    response = await fetchImpl(options.config.endpoint, buildRequest(options.config, options.request, options.apiKey, options.signal));
  } catch {
    if (!options.signal.aborted) yield disconnectedEvent();
    return;
  }
  if (options.signal.aborted) return;
  if (!response.ok) {
    yield mapDeepSeekHttpError(response.status, response.headers.get('retry-after'));
    return;
  }
  if (!response.body) {
    yield disconnectedEvent();
    return;
  }

  let terminal = false;
  let pendingCompletion: Extract<ModelEvent, { type: 'completed' }> | undefined;
  try {
    for await (const data of readSseData(response.body, options.signal)) {
      if (options.signal.aborted) return;
      if (data === '[DONE]') {
        if (pendingCompletion) yield pendingCompletion;
        else if (!terminal) yield { type: 'completed', finishReason: 'stop' };
        return;
      }
      let payload: unknown;
      try {
        payload = JSON.parse(data) as unknown;
      } catch {
        yield malformedEvent();
        return;
      }
      const events = translateByProfile(options.config.endpointProfile, payload, state);
      for (const event of events) {
        if (options.signal.aborted) return;
        if (event.type === 'completed') {
          if (!pendingCompletion) pendingCompletion = event;
          terminal = true;
          continue;
        }
        if (terminal && (event.type === 'text-delta' || event.type === 'tool-call-delta')) {
          yield malformedEvent();
          return;
        }
        yield event;
      }
    }
    if (!options.signal.aborted) {
      if (pendingCompletion) yield pendingCompletion;
      else if (!terminal) yield disconnectedEvent();
    }
  } catch {
    if (!options.signal.aborted) yield disconnectedEvent();
  }
}

export function translateDeepSeekChatChunk(input: unknown, state: DeepSeekTranslationState = newTranslationState()): ModelEvent[] {
  const record = asRecord(input);
  if (!record) return [malformedEvent()];
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const usage = asRecord(record.usage);
  if (choices.length === 0 && !usage) return [malformedEvent()];
  const events: ModelEvent[] = [];
  if (usage) {
    const inputTokens = nonNegativeInteger(usage.prompt_tokens);
    const outputTokens = nonNegativeInteger(usage.completion_tokens);
    if (inputTokens === undefined && outputTokens === undefined) return [malformedEvent()];
    events.push({ type: 'usage', ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) });
  }
  for (const choiceValue of choices) {
    const choice = asRecord(choiceValue);
    const delta = asRecord(choice?.delta);
    if (!choice || !delta) return [malformedEvent()];
    if (delta.content !== undefined) {
      if (typeof delta.content !== 'string') return [malformedEvent()];
      if (delta.content.length > 256 * 1024) return [malformedEvent()];
      if (delta.content.length > 0) events.push({ type: 'text-delta', text: delta.content });
    }
    const toolCalls = delta.tool_calls;
    if (toolCalls !== undefined) {
      if (!Array.isArray(toolCalls) || toolCalls.length > 64) return [malformedEvent()];
      for (const toolValue of toolCalls) {
        const tool = asRecord(toolValue);
        const index = nonNegativeInteger(tool?.index) ?? 0;
        const fn = asRecord(tool?.function);
        const callIdValue = stringValue(tool?.id);
        const previous = state.chatCallIds.get(index);
        const callId = callIdValue ?? previous ?? `deepseek_tool_call_${index}`;
        if (!isSafeCallId(callId)) return [malformedEvent()];
        state.chatCallIds.set(index, callId);
        const name = stringValue(fn?.name);
        const argumentsChunk = fn?.arguments;
        if (argumentsChunk !== undefined && typeof argumentsChunk !== 'string') return [malformedEvent()];
        if (name === undefined && argumentsChunk === undefined && callIdValue === undefined) return [malformedEvent()];
        events.push({
          type: 'tool-call-delta',
          callId,
          ...(name === undefined ? {} : { name }),
          argumentsChunk: argumentsChunk ?? '',
        });
      }
    }
    const finishReason = stringValue(choice.finish_reason);
    if (finishReason) events.push({ type: 'completed', finishReason: mapFinishReason(finishReason) });
  }
  return events;
}

export function translateDeepSeekResponsesEvent(input: unknown, state: DeepSeekTranslationState = newTranslationState()): ModelEvent[] {
  const record = asRecord(input);
  const type = stringValue(record?.type);
  if (!record || !type) return [malformedEvent()];
  if (type === 'response.output_text.delta') return textEvent(record.delta);
  if (type === 'response.function_call_arguments.delta') {
    const callId = stringValue(record.call_id) ?? stringValue(record.item_id);
    const argumentsChunk = record.delta;
    if (!callId || !isSafeCallId(callId) || typeof argumentsChunk !== 'string') return [malformedEvent()];
    const name = stringValue(record.name);
    return [{ type: 'tool-call-delta', callId, ...(name ? { name } : {}), argumentsChunk }];
  }
  if (type === 'response.completed') {
    const response = asRecord(record.response);
    if (!response) return [malformedEvent()];
    const usage = asRecord(response.usage);
    const events: ModelEvent[] = [];
    if (usage) {
      const inputTokens = nonNegativeInteger(usage.input_tokens);
      const outputTokens = nonNegativeInteger(usage.output_tokens);
      if (inputTokens === undefined && outputTokens === undefined) return [malformedEvent()];
      events.push({ type: 'usage', ...(inputTokens === undefined ? {} : { inputTokens }), ...(outputTokens === undefined ? {} : { outputTokens }) });
    }
    const output = Array.isArray(response.output) ? response.output : [];
    const hasToolCall = output.some((entry) => asRecord(entry)?.type === 'function_call');
    const status = stringValue(response.status) ?? 'completed';
    events.push({ type: 'completed', finishReason: hasToolCall ? 'tool-calls' : mapFinishReason(status) });
    return events;
  }
  if (type === 'response.failed') return [{ type: 'error', code: 'DEEPSEEK_STREAM_DISCONNECTED', retryable: true, safeMessage: 'DeepSeek response failed.' }];
  if (type === 'response.error') return [malformedEvent()];
  if (type === 'response.created' || type === 'response.in_progress' || type === 'response.output_item.added'
    || type === 'response.output_item.done' || type === 'response.content_part.added'
    || type === 'response.content_part.done' || type === 'response.web_search_call.in_progress'
    || type === 'response.web_search_call.searching' || type === 'response.web_search_call.completed'
    || type.startsWith('response.reasoning')) return [];
  return [malformedEvent()];
}

export function translateDeepSeekAnthropicEvent(input: unknown, state: DeepSeekTranslationState = newTranslationState()): ModelEvent[] {
  const record = asRecord(input);
  const type = stringValue(record?.type);
  if (!record || !type) return [malformedEvent()];
  if (type === 'message_start') {
    const usage = asRecord(asRecord(record.message)?.usage);
    const inputTokens = nonNegativeInteger(usage?.input_tokens);
    return inputTokens === undefined ? [] : [{ type: 'usage', inputTokens }];
  }
  if (type === 'content_block_start') {
    const block = asRecord(record.content_block);
    if (block?.type !== 'tool_use') return [];
    const index = nonNegativeInteger(record.index) ?? 0;
    const callId = stringValue(block.id) ?? `deepseek_tool_call_${index}`;
    const name = stringValue(block.name);
    if (!isSafeCallId(callId) || !name) return [malformedEvent()];
    state.anthropicToolIds.set(index, callId);
    return [{ type: 'tool-call-delta', callId, name, argumentsChunk: '' }];
  }
  if (type === 'content_block_delta') {
    const delta = asRecord(record.delta);
    if (delta?.type === 'text_delta') return textEvent(delta.text);
    if (delta?.type === 'input_json_delta') {
      const index = nonNegativeInteger(record.index) ?? 0;
      const callId = state.anthropicToolIds.get(index) ?? `deepseek_tool_call_${index}`;
      if (!isSafeCallId(callId) || typeof delta.partial_json !== 'string') return [malformedEvent()];
      return [{ type: 'tool-call-delta', callId, argumentsChunk: delta.partial_json }];
    }
    return [];
  }
  if (type === 'message_delta') {
    const delta = asRecord(record.delta);
    const usage = asRecord(record.usage);
    const outputTokens = nonNegativeInteger(usage?.output_tokens);
    const events: ModelEvent[] = outputTokens === undefined ? [] : [{ type: 'usage', outputTokens }];
    const stopReason = stringValue(delta?.stop_reason);
    if (stopReason) {
      state.anthropicTerminal = true;
      events.push({ type: 'completed', finishReason: mapFinishReason(stopReason) });
    }
    return events;
  }
  if (type === 'message_stop') {
    if (state.anthropicTerminal) return [];
    state.anthropicTerminal = true;
    return [{ type: 'completed', finishReason: 'stop' }];
  }
  if (type === 'ping' || type === 'content_block_stop') return [];
  if (type === 'error') return [{ type: 'error', code: 'DEEPSEEK_STREAM_DISCONNECTED', retryable: true, safeMessage: 'DeepSeek response failed.' }];
  return [malformedEvent()];
}

export function mapDeepSeekHttpError(status: number, retryAfter: string | null): Extract<ModelEvent, { type: 'error' }> {
  const retryable = status === 429 || status >= 500;
  const code = status === 429
    ? 'DEEPSEEK_HTTP_429'
    : status >= 500
      ? 'DEEPSEEK_HTTP_5XX'
      : status === 401
        ? 'DEEPSEEK_HTTP_401'
        : status === 402
          ? 'DEEPSEEK_HTTP_402'
          : status === 403
            ? 'DEEPSEEK_HTTP_403'
            : status === 404
              ? 'DEEPSEEK_HTTP_404'
              : 'DEEPSEEK_HTTP_400';
  const retryAfterMs = retryable && status === 429 ? parseRetryAfter(retryAfter) : undefined;
  return {
    type: 'error',
    code,
    retryable,
    safeMessage: `DeepSeek returned HTTP ${status}.`,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

function buildRequest(config: DeepSeekConfig, request: ModelRequest, apiKey: string, signal: AbortSignal): RequestInit {
  const body = config.endpointProfile === 'openai-chat-completions'
    ? {
      model: request.model,
      messages: request.messages,
      ...(config.toolCalling === 'enabled' && request.tools.length > 0 ? { tools: request.tools } : {}),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: request.budget.maxOutputTokens,
      ...thinkingBody(config.thinkingMode),
    }
    : config.endpointProfile === 'openai-responses'
      ? {
        model: request.model,
        input: request.messages,
        ...(config.toolCalling === 'enabled' && request.tools.length > 0 ? { tools: request.tools } : {}),
        stream: true,
        max_output_tokens: request.budget.maxOutputTokens,
        ...thinkingBody(config.thinkingMode),
        ...(config.webSearch === 'provider-owned' ? {
          tools: [...(config.toolCalling === 'enabled' ? request.tools : []), { type: 'web_search' }],
        } : {}),
      }
      : {
        model: request.model,
        messages: request.messages,
        ...(config.toolCalling === 'enabled' && request.tools.length > 0 ? { tools: request.tools } : {}),
        max_tokens: request.budget.maxOutputTokens,
        stream: true,
        ...anthropicThinkingBody(config.thinkingMode),
      };
  const headers = config.endpointProfile === 'anthropic-messages'
    ? {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
    : {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
  return { method: 'POST', headers, body: JSON.stringify(body), signal };
}

function thinkingBody(mode: DeepSeekConfig['thinkingMode']): Record<string, unknown> {
  if (mode === 'off') return { thinking: { type: 'disabled' } };
  if (mode === 'high') return { thinking: { type: 'enabled', effort: 'high' } };
  if (mode === 'max') return { thinking: { type: 'enabled', effort: 'max' } };
  return {};
}

function anthropicThinkingBody(mode: DeepSeekConfig['thinkingMode']): Record<string, unknown> {
  if (mode === 'off') return {};
  return { thinking: { type: 'enabled', budget_tokens: mode === 'max' ? 8_192 : mode === 'high' ? 4_096 : 2_048 } };
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
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) yield data;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() && !signal.aborted) {
      const data = buffer.split(/\r?\n/u).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function translateByProfile(profile: DeepSeekEndpointProfile, input: unknown, state: DeepSeekTranslationState): ModelEvent[] {
  if (profile === 'openai-chat-completions') return translateDeepSeekChatChunk(input, state);
  if (profile === 'openai-responses') return translateDeepSeekResponsesEvent(input, state);
  return translateDeepSeekAnthropicEvent(input, state);
}

function textEvent(value: unknown): ModelEvent[] {
  return typeof value === 'string' && value.length <= 256 * 1024 ? (value.length === 0 ? [] : [{ type: 'text-delta', text: value }]) : [malformedEvent()];
}

function malformedEvent(): Extract<ModelEvent, { type: 'error' }> {
  return { type: 'error', code: 'DEEPSEEK_MALFORMED_EVENT', retryable: false, safeMessage: 'DeepSeek returned a malformed event.' };
}

function disconnectedEvent(): Extract<ModelEvent, { type: 'error' }> {
  return { type: 'error', code: 'DEEPSEEK_STREAM_DISCONNECTED', retryable: true, safeMessage: 'DeepSeek stream disconnected.' };
}

function newTranslationState(): DeepSeekTranslationState {
  return { chatCallIds: new Map(), anthropicToolIds: new Map() };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000_000 ? value : undefined;
}

function isSafeCallId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u.test(value);
}

function mapFinishReason(reason: string): 'stop' | 'tool-calls' | 'length' | 'content-filter' {
  if (reason === 'tool_calls' || reason === 'tool_use' || reason === 'function_call') return 'tool-calls';
  if (reason === 'length' || reason === 'max_tokens' || reason === 'incomplete') return 'length';
  if (reason === 'content_filter' || reason === 'refusal') return 'content-filter';
  return 'stop';
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(30_000, Math.trunc(seconds * 1_000));
}

export * from './capabilities.js';
