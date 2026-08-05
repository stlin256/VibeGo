import {
  DeepSeekCapabilityDescriptorSchema,
  DeepSeekConfigSchema,
  DeepSeekProbeResultSchema,
  type DeepSeekCapabilitySnapshot,
  type DeepSeekCapabilityDescriptor,
  type DeepSeekConfig,
  type DeepSeekErrorCode,
  type DeepSeekProbeResult,
} from '@ready4vibe/contracts';

import type { FetchImplementation } from './index.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

export interface DeepSeekProbeOptions {
  readonly config: DeepSeekConfig;
  /** Runtime-only credential; never appears in the result. */
  readonly apiKey?: string;
  readonly fetchImpl?: FetchImplementation;
  readonly signal?: AbortSignal;
  readonly now?: () => string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

/**
 * Probe the exact configured endpoint. The adapter never appends `/models` or
 * otherwise guesses a provider route. The request is explicit and bounded;
 * callers must invoke it only from a user action.
 */
export async function probeDeepSeek(options: DeepSeekProbeOptions): Promise<DeepSeekProbeResult> {
  const config = DeepSeekConfigSchema.parse(options.config);
  const checkedAt = options.now?.() ?? new Date().toISOString();
  if (!options.apiKey) return failure(checkedAt, null, 'DEEPSEEK_CREDENTIAL_REQUIRED');
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 50, 30_000);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, MAX_RESPONSE_BYTES, 1_024, 512 * 1024);
  const fetchImpl = options.fetchImpl ?? ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  }
  const startedAt = Date.now();
  try {
    let response: Response;
    try {
      response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: probeHeaders(config.endpointProfile, options.apiKey),
        body: JSON.stringify(probeBody(config)),
        signal: controller.signal,
      });
    } catch {
      return failure(checkedAt, elapsedMs(startedAt), controller.signal.aborted ? 'DEEPSEEK_TIMEOUT' : 'DEEPSEEK_STREAM_DISCONNECTED');
    }
    if (!response.ok) return failure(checkedAt, elapsedMs(startedAt), mapHttpError(response.status));
    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED');
    let raw: string;
    try { raw = await response.text(); } catch { return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED'); }
    if (new TextEncoder().encode(raw).byteLength > maxResponseBytes) return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED');
    let payload: unknown;
    try { payload = JSON.parse(raw) as unknown; } catch { return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED'); }
    if (!looksLikeResponse(config.endpointProfile, payload)) return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED');
    const descriptor = readCapabilityDescriptor(payload);
    if (descriptor === 'invalid') return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED');
    const declared = descriptor === undefined ? undefined : descriptor;
    if (declared?.webSearch === true && config.endpointProfile !== 'openai-responses') {
      return failure(checkedAt, elapsedMs(startedAt), 'DEEPSEEK_PROTOCOL_UNSUPPORTED');
    }

    const capability: DeepSeekCapabilitySnapshot = {
      schemaVersion: 'deepseek-provider-capability/v1',
      providerId: 'deepseek',
      endpointProfile: config.endpointProfile,
      model: config.model,
      descriptorRevision: config.revision,
      capturedAt: checkedAt,
      status: 'ready',
      // The probe validates the selected protocol and bounded response. It
      // deliberately does not infer reasoning/search support from a prompt.
      streaming: declared?.streaming ?? true,
      toolCalls: declared?.toolCalls ?? false,
      structuredOutput: declared?.structuredOutput ?? false,
      reasoning: declared?.reasoning ?? false,
      usage: declared?.usage ?? hasUsage(payload),
      webSearch: declared?.webSearch ?? false,
      contextLimit: declared?.contextLimit ?? config.contextLimit ?? 'unknown',
      outputLimit: declared?.outputLimit ?? config.maxOutputTokens,
      degradedReason: null,
    };
    return DeepSeekProbeResultSchema.parse({
      schemaVersion: 'deepseek-provider-probe/v1',
      status: 'ready',
      checkedAt,
      latencyMs: elapsedMs(startedAt),
      errorCode: null,
      capabilities: capability,
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function probeHeaders(profile: DeepSeekConfig['endpointProfile'], apiKey: string): Record<string, string> {
  if (profile === 'anthropic-messages') {
    return { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
  }
  return { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

function probeBody(config: DeepSeekConfig): Record<string, unknown> {
  if (config.endpointProfile === 'anthropic-messages') {
    return { model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }], stream: false };
  }
  if (config.endpointProfile === 'openai-responses') {
    return { model: config.model, input: [{ role: 'user', content: 'ping' }], max_output_tokens: 1, stream: false };
  }
  return { model: config.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false };
}

function looksLikeResponse(profile: DeepSeekConfig['endpointProfile'], value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (profile === 'openai-chat-completions') return Array.isArray(record.choices);
  if (profile === 'openai-responses') return Array.isArray(record.output) || typeof record.status === 'string';
  return Array.isArray(record.content) || typeof record.type === 'string';
}

function hasUsage(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'usage' in value;
}

function readCapabilityDescriptor(value: unknown): DeepSeekCapabilityDescriptor | 'invalid' | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(value, 'capabilities')) return undefined;
  const parsed = DeepSeekCapabilityDescriptorSchema.safeParse((value as Record<string, unknown>).capabilities);
  return parsed.success ? parsed.data : 'invalid';
}

function failure(checkedAt: string, latencyMs: number | null, errorCode: DeepSeekErrorCode): DeepSeekProbeResult {
  return DeepSeekProbeResultSchema.parse({
    schemaVersion: 'deepseek-provider-probe/v1',
    status: errorCode === 'DEEPSEEK_TIMEOUT' || errorCode === 'DEEPSEEK_STREAM_DISCONNECTED' || errorCode === 'DEEPSEEK_HTTP_429' || errorCode === 'DEEPSEEK_HTTP_5XX' ? 'degraded' : 'blocked',
    checkedAt,
    latencyMs,
    errorCode,
    capabilities: null,
  });
}

function mapHttpError(status: number): DeepSeekErrorCode {
  if (status === 401) return 'DEEPSEEK_HTTP_401';
  if (status === 402) return 'DEEPSEEK_HTTP_402';
  if (status === 403) return 'DEEPSEEK_HTTP_403';
  if (status === 404) return 'DEEPSEEK_HTTP_404';
  if (status === 429) return 'DEEPSEEK_HTTP_429';
  if (status >= 500) return 'DEEPSEEK_HTTP_5XX';
  return 'DEEPSEEK_HTTP_400';
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('DEEPSEEK_PROBE_OPTIONS_INVALID');
  return value;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.min(120_000, Date.now() - startedAt));
}
