import { ModelProbeResultSchema, type ModelProbeResult } from '@ready4vibe/contracts';

const DEFAULT_MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;
const SAFE_MODEL_ID = /^[^\u0000-\u001F\u007F\r\n]{1,256}$/u;

export type ProbeFetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProbeOptions {
  readonly endpoint: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly apiKey?: string;
  readonly allowInsecureHttp?: boolean;
  readonly fetchImpl?: ProbeFetchImplementation;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly now?: () => string;
}

/**
 * Performs an explicit, read-only OpenAI-compatible `/models` probe. It never
 * appends a path, sends a prompt, creates a run or exposes the credential/body.
 */
export async function probeOpenAICompatibleModels(options: OpenAICompatibleProbeOptions): Promise<ModelProbeResult> {
  const checkedAt = options.now?.() ?? new Date().toISOString();
  const endpoint = validateEndpoint(options.endpoint, options.allowInsecureHttp === true);
  const providerId = boundedProviderId(options.providerId);
  const modelId = boundedModelId(options.modelId);
  const timeoutMs = boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 50, MAX_TIMEOUT_MS);
  const maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1_024, MAX_RESPONSE_BYTES);
  const fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
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
      response = await fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.apiKey ? { Authorization: `Bearer ${validateApiKey(options.apiKey)}` } : {}),
        },
        signal: controller.signal,
      });
    } catch {
      return probeFailure(checkedAt, elapsedMs(startedAt), mapAbortToError(controller.signal, options.signal));
    }
    if (!response.ok) return probeFailure(checkedAt, elapsedMs(startedAt), mapHttpError(response.status));
    if (!response.body) return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch');
    const contentLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch');
    let raw: string;
    try { raw = await response.text(); } catch { return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch'); }
    if (byteLength(raw) > maxResponseBytes) return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch');
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch'); }
    if (!isRecord(payload) || !Array.isArray(payload.data)) return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch');
    const ids = payload.data.slice(0, 256).map((entry) => isRecord(entry) && typeof entry.id === 'string' ? entry.id : undefined).filter((value): value is string => value !== undefined && SAFE_MODEL_ID.test(value));
    if (ids.length === 0 && payload.data.length > 0) return probeFailure(checkedAt, elapsedMs(startedAt), 'protocol-mismatch');
    if (!ids.includes(modelId)) return probeFailure(checkedAt, elapsedMs(startedAt), 'model-not-found');
    return ModelProbeResultSchema.parse({
      schemaVersion: 'ready4vibe_model_probe_result_v1',
      status: 'ready',
      checkedAt,
      latencyMs: elapsedMs(startedAt),
      revision: 'probe-v1',
      errorCode: null,
      capabilities: {
        schemaVersion: 'ready4vibe_model_capability_snapshot_v1',
        providerId,
        modelId,
        descriptorRevision: 'probe-v1',
        capturedAt: checkedAt,
        streaming: 'unknown',
        toolCalls: 'unknown',
        vision: 'unknown',
        embeddings: 'unknown',
        contextLimit: 'unknown',
        outputLimit: 'unknown',
      },
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

function probeFailure(checkedAt: string, latencyMs: number, errorCode: ModelProbeResult['errorCode']): ModelProbeResult {
  return ModelProbeResultSchema.parse({
    schemaVersion: 'ready4vibe_model_probe_result_v1',
    status: errorCode === 'rate-limited' || errorCode === 'provider-unreachable' ? 'degraded' : 'blocked',
    checkedAt,
    latencyMs,
    revision: null,
    errorCode,
    capabilities: null,
  });
}

function mapHttpError(status: number): NonNullable<ModelProbeResult['errorCode']> {
  if (status === 401 || status === 403) return 'auth-rejected';
  if (status === 404) return 'protocol-mismatch';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'provider-unreachable';
  return 'protocol-mismatch';
}

function mapAbortToError(signal: AbortSignal, parent: AbortSignal | undefined): NonNullable<ModelProbeResult['errorCode']> {
  return signal.aborted || parent?.aborted ? 'provider-unreachable' : 'provider-unreachable';
}

function validateEndpoint(value: string, allowInsecureHttp: boolean): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048 || /[\u0000-\u001F\u007F\r\n]/u.test(value)) throw new Error('PROBE_ENDPOINT_INVALID');
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('PROBE_ENDPOINT_INVALID'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && allowInsecureHttp && isLoopback(parsed.hostname))) throw new Error('PROBE_ENDPOINT_INVALID');
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('PROBE_ENDPOINT_INVALID');
  return parsed.toString().replace(/\/$/u, '');
}

function validateApiKey(value: string): string {
  if (value.length === 0 || value.length > 4_096 || /[\r\n]/u.test(value)) throw new Error('PROBE_CREDENTIAL_INVALID');
  return value;
}

function boundedProviderId(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u.test(value)) throw new Error('PROBE_PROVIDER_INVALID');
  return value;
}

function boundedModelId(value: string): string {
  if (typeof value !== 'string' || !SAFE_MODEL_ID.test(value)) throw new Error('PROBE_MODEL_INVALID');
  return value;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('PROBE_OPTIONS_INVALID');
  return value;
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.min(120_000, Date.now() - startedAt));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
