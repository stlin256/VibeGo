import { createHash } from 'node:crypto';
import {
  ModelEventSchema,
  ModelReplayResultSchema,
  ModelRetryPlanSchema,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  type ModelReplayResult,
  type ModelRetryPlan,
  type ModelReplayToolCall,
  type ModelReplayUsage,
} from '@ready4vibe/contracts';

const DEFAULT_MAX_EVENTS = 4_096;
const DEFAULT_MAX_TEXT_BYTES = 256 * 1024;
const DEFAULT_MAX_TOOL_ARGUMENT_BYTES = 256 * 1024;

export interface ModelReplayOptions {
  readonly maxEvents?: number;
  readonly maxTextBytes?: number;
  readonly maxToolArgumentBytes?: number;
}

export class ModelReplayError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'ModelReplayError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Replays a bounded provider stream into one canonical assistant/tool result.
 * The function never includes raw provider payloads in an error message.
 */
export function replayModelEvents(events: Iterable<ModelEvent | unknown>, options: ModelReplayOptions = {}): ModelReplayResult {
  const maxEvents = boundedPositive(options.maxEvents ?? DEFAULT_MAX_EVENTS, DEFAULT_MAX_EVENTS, DEFAULT_MAX_EVENTS);
  const maxTextBytes = boundedPositive(options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES, DEFAULT_MAX_TEXT_BYTES, 4 * 1024 * 1024);
  const maxToolArgumentBytes = boundedPositive(options.maxToolArgumentBytes ?? DEFAULT_MAX_TOOL_ARGUMENT_BYTES, DEFAULT_MAX_TOOL_ARGUMENT_BYTES, 4 * 1024 * 1024);
  const textParts: string[] = [];
  const toolCalls = new Map<string, { name?: string; arguments: string }>();
  let usage: ModelReplayUsage | undefined;
  let finishReason: ModelReplayResult['finishReason'];
  let eventCount = 0;
  let totalTextBytes = 0;
  let terminal = false;

  for (const input of events) {
    eventCount += 1;
    if (eventCount > maxEvents) throw new ModelReplayError('MODEL_EVENT_LIMIT_EXCEEDED', 'Model event count exceeded the server limit.');
    const parsed = ModelEventSchema.safeParse(input);
    if (!parsed.success) throw new ModelReplayError('MODEL_EVENT_SCHEMA_MISMATCH', 'Model provider returned an unsupported event.');
    const event = parsed.data;
    if (terminal) {
      // Some providers send a framing-only stop after a terminal delta. It is
      // idempotent when it carries the same reason (or the generic stop).
      if (event.type === 'completed' && (event.finishReason === 'stop' || event.finishReason === finishReason)) continue;
      throw new ModelReplayError('MODEL_EVENT_AFTER_TERMINAL', 'Model provider emitted an event after completion.');
    }
    switch (event.type) {
      case 'text-delta': {
        totalTextBytes += Buffer.byteLength(event.text, 'utf8');
        if (totalTextBytes > maxTextBytes) throw new ModelReplayError('MODEL_TEXT_LIMIT_EXCEEDED', 'Model text exceeded the server limit.');
        textParts.push(event.text);
        break;
      }
      case 'tool-call-delta': {
        const current = toolCalls.get(event.callId) ?? { arguments: '' };
        if (event.name !== undefined) {
          if (current.name !== undefined && current.name !== event.name) throw new ModelReplayError('MODEL_TOOL_NAME_CONFLICT', 'Model emitted conflicting tool names.');
          current.name = event.name;
        }
        current.arguments += event.argumentsChunk;
        if (Buffer.byteLength(current.arguments, 'utf8') > maxToolArgumentBytes) {
          throw new ModelReplayError('MODEL_TOOL_ARGUMENT_LIMIT_EXCEEDED', 'Model tool arguments exceeded the server limit.');
        }
        toolCalls.set(event.callId, current);
        break;
      }
      case 'usage':
        usage = { ...(event.inputTokens === undefined ? {} : { inputTokens: event.inputTokens }), ...(event.outputTokens === undefined ? {} : { outputTokens: event.outputTokens }) };
        break;
      case 'completed':
        if (finishReason !== undefined && finishReason !== event.finishReason) throw new ModelReplayError('MODEL_FINISH_REASON_CONFLICT', 'Model emitted conflicting terminal states.');
        finishReason = event.finishReason;
        terminal = true;
        break;
      case 'error':
        throw new ModelReplayError(event.code, event.safeMessage, event.retryable);
    }
  }

  const canonicalToolCalls: ModelReplayToolCall[] = [];
  for (const [callId, call] of toolCalls) {
    if (!call.name) throw new ModelReplayError('MODEL_TOOL_NAME_MISSING', 'Model tool call did not include a tool name.');
    canonicalToolCalls.push({ callId, name: call.name, arguments: call.arguments });
  }
  const canonical = {
    text: textParts.join(''),
    toolCalls: canonicalToolCalls,
    ...(usage === undefined ? {} : { usage }),
    ...(finishReason === undefined ? {} : { finishReason }),
  };
  const fingerprint = createHash('sha256').update(canonicalJson(canonical)).digest('hex');
  return ModelReplayResultSchema.parse({
    schemaVersion: 'ready4vibe_model_event_v1',
    ...canonical,
    eventCount,
    fingerprint,
  });
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export type RequestReplayResult = 'new' | 'noop';

export class RequestReplayConflictError extends Error {
  constructor() {
    super('model request conflict: id has a different payload');
    this.name = 'RequestReplayConflictError';
  }
}

/** In-memory idempotency port for a run/turn/request boundary. */
export class RequestReplayLedger {
  private readonly fingerprints = new Map<string, string>();

  record(requestId: string, payload: unknown): RequestReplayResult {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u.test(requestId)) throw new Error('request id is invalid');
    const fingerprint = createHash('sha256').update(canonicalJson(payload)).digest('hex');
    const previous = this.fingerprints.get(requestId);
    if (!previous) {
      this.fingerprints.set(requestId, fingerprint);
      return 'new';
    }
    if (previous === fingerprint) return 'noop';
    throw new RequestReplayConflictError();
  }
}

export interface RetryPolicyOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export type RetryInput =
  | { readonly kind: 'transport' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'http'; readonly status: number; readonly retryAfterMs?: number };

export function retryPlanFor(input: RetryInput, attempt: number, options: RetryPolicyOptions): ModelRetryPlan | undefined {
  const maxAttempts = boundedPositive(options.maxAttempts, 3, 8);
  const baseDelayMs = boundedNonNegative(options.baseDelayMs, 100, 30_000);
  const maxDelayMs = boundedNonNegative(options.maxDelayMs, 2_000, 30_000);
  if (!Number.isSafeInteger(attempt) || attempt <= 0 || attempt >= maxAttempts) return undefined;
  const reason = input.kind === 'transport' ? 'transport' : input.kind === 'timeout' ? 'timeout' : input.status === 429 ? 'rate-limit' : input.status >= 500 && input.status <= 599 ? 'upstream-5xx' : undefined;
  if (!reason) return undefined;
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
  const serverDelay = input.kind === 'http' && input.retryAfterMs !== undefined ? clamp(input.retryAfterMs, 0, maxDelayMs) : 0;
  return ModelRetryPlanSchema.parse({
    schemaVersion: 'ready4vibe_model_retry_plan_v1',
    attempt,
    maxAttempts,
    delayMs: Math.max(exponential, serverDelay),
    reason,
    retryable: true,
  });
}

export type RetrySleep = (delayMs: number, signal: AbortSignal) => Promise<void>;

export async function waitForRetry(delayMs: number, signal: AbortSignal, sleep: RetrySleep = defaultSleep): Promise<void> {
  if (signal.aborted) throw abortError();
  await sleep(delayMs, signal);
  if (signal.aborted) throw abortError();
}

export interface RetryingModelProviderOptions {
  readonly provider: ModelProvider;
  readonly policy: RetryPolicyOptions;
  readonly sleep?: RetrySleep;
}

/**
 * Retries only before a stream has emitted data. Once a delta is visible, the
 * original attempt is terminal and is never replayed with a second request.
 */
export class RetryingModelProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities: ModelProvider['capabilities'];
  private readonly provider: ModelProvider;
  private readonly policy: RetryPolicyOptions;
  private readonly sleep: RetrySleep;

  constructor(options: RetryingModelProviderOptions) {
    this.provider = options.provider;
    this.id = options.provider.id;
    this.capabilities = options.provider.capabilities;
    this.policy = options.policy;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    for (let attempt = 1; ; attempt += 1) {
      let emitted = false;
      let retryableError: ModelEvent & { type: 'error' } | undefined;
      for await (const event of this.provider.stream(request, signal)) {
        if (signal.aborted) return;
        if (event.type === 'error' && !emitted && event.retryable) {
          retryableError = event;
          break;
        }
        emitted = true;
        yield event;
      }
      if (!retryableError || emitted) {
        if (retryableError) yield retryableError;
        return;
      }
      const plan = retryPlanFor(classifyRetryInput(retryableError), attempt, this.policy);
      if (!plan) {
        yield retryableError;
        return;
      }
      await waitForRetry(plan.delayMs, signal, this.sleep);
    }
  }
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

function boundedPositive(value: number, fallback: number, max = 4_096): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

function boundedNonNegative(value: number, fallback: number, max: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, max) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.trunc(value))) : min;
}

function classifyRetryInput(event: Extract<ModelEvent, { type: 'error' }>): RetryInput {
  const match = /_HTTP_(\d{3})$/u.exec(event.code);
  if (match?.[1]) return { kind: 'http', status: Number(match[1]), ...(event.retryAfterMs === undefined ? {} : { retryAfterMs: event.retryAfterMs }) };
  if (/_TIMEOUT$/u.test(event.code)) return { kind: 'timeout' };
  return { kind: 'transport' };
}
