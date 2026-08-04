import type { RunConfig, StoredEvent } from '@ready4vibe/contracts';

export const CLIENT_SDK_SCHEMA_VERSION = 'ready4vibe_client_sdk_v1' as const;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_RUN_ID_LENGTH = 256;
const MAX_PAIRING_CODE_LENGTH = 128;
const DEFAULT_MAX_FRAME_BYTES = 256 * 1024;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_RECONNECTS = 3;
const MAX_RECONNECTS = 10;
const DEFAULT_RECONNECT_DELAY_MS = 100;
const MAX_RECONNECT_DELAY_MS = 5_000;
const TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.needs_recovery']);

export interface HealthProjection {
  readonly status: 'ok' | 'degraded';
  readonly service: string;
  readonly version: string;
  readonly transport: { readonly kind: string; readonly tlsRequired: boolean; readonly boundAddresses: readonly string[] };
  readonly auth: { readonly pairingRequired: boolean };
  readonly storage: { readonly kind: string; readonly status: string };
  readonly sandbox: { readonly availableModes: readonly string[]; readonly externalRequiredForUntrusted: boolean };
  readonly approval: { readonly supportedDecisions: readonly string[] };
}

export interface PairingResult {
  readonly accessToken: string;
  readonly csrfToken: string;
  readonly sessionId: string;
  readonly expiresAt: number;
}

export interface ApprovalSummary {
  readonly approvalId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly risk: 'read' | 'write' | 'destructive' | 'network';
  readonly argumentBytes: number;
  readonly details?: { readonly sandboxProvider?: 'docker' | 'podman' | 'vm'; readonly sandboxImageDigest?: string; readonly network?: 'restricted' | 'enabled' };
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface RunSnapshot {
  readonly version: 1;
  readonly runId: string;
  readonly status: string;
  readonly config: RunConfig;
  readonly lastEventSeq: number;
  readonly output: string;
  readonly approvals?: readonly ApprovalSummary[];
  readonly final?: { readonly summary: string; readonly exitReason: string };
  readonly scheduler: { readonly queuePosition: number | null; readonly activeRunCount: number; readonly workspaceLease: string | null };
}

export interface RunCreateResult {
  readonly runId: string;
  readonly status: string;
}

export interface RunCancelResult {
  readonly runId: string;
  readonly status: string;
}

export interface RunRetryResult {
  readonly runId: string;
  readonly status: string;
  readonly retryOf: string;
}

export interface ApprovalResult {
  readonly runId: string;
  readonly approvalId: string;
  readonly status: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepLike = (milliseconds: number) => Promise<void>;

export interface ClientOptions {
  readonly fetcher?: FetchLike;
  readonly now?: () => number;
  readonly sleep?: SleepLike;
}

export interface StreamRunOptions {
  readonly after?: number;
  readonly signal?: AbortSignal;
  readonly maxReconnects?: number;
  readonly reconnectDelayMs?: number;
  readonly maxFrameBytes?: number;
}

export type DegradedProjection<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'degraded'; readonly reasonCode: string };

export class ClientError extends Error {
  constructor(
    readonly status: number | null,
    readonly code: string,
    message = 'Client request failed.',
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ClientError';
  }
}

export class VibeGoClient {
  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly now: () => number;
  private readonly sleep: SleepLike;
  private session: PairingResult | undefined;

  constructor(baseUrl = '', options: ClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  hasSession(): boolean {
    return this.session !== undefined && this.session.expiresAt > this.now();
  }

  clearSession(): void {
    this.session = undefined;
  }

  async health(): Promise<HealthProjection> {
    return this.request<HealthProjection>('/health', { method: 'GET' }, false);
  }

  async healthProjection(): Promise<DegradedProjection<HealthProjection>> {
    try {
      return { status: 'ready', value: await this.health() };
    } catch (error) {
      return { status: 'degraded', reasonCode: safeReasonCode(error) };
    }
  }

  async completePairing(code: string): Promise<PairingResult> {
    const value = code.trim();
    if (!value || value.length > MAX_PAIRING_CODE_LENGTH || /[\u0000-\u001F\u007F]/u.test(value)) {
      throw new ClientError(null, 'PAIRING_CODE_INVALID', 'Pairing code is invalid.');
    }
    const result = await this.request<PairingResult>('/api/v1/pairing/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: value }),
    }, false);
    if (!isPairingResult(result)) throw new ClientError(null, 'PAIRING_RESPONSE_INVALID', 'Pairing response is invalid.');
    this.session = result;
    return result;
  }

  async createRun(config: RunConfig): Promise<RunCreateResult> {
    return this.request<RunCreateResult>('/api/v1/runs', { method: 'POST', body: JSON.stringify(config) });
  }

  async getRun(runId: string): Promise<RunSnapshot> {
    return this.request<RunSnapshot>(runPath(runId), { method: 'GET' });
  }

  async readRunProjection(runId: string): Promise<DegradedProjection<RunSnapshot>> {
    try {
      return { status: 'ready', value: await this.getRun(runId) };
    } catch (error) {
      return { status: 'degraded', reasonCode: safeReasonCode(error) };
    }
  }

  async cancelRun(runId: string): Promise<RunCancelResult> {
    return this.request<RunCancelResult>(runPath(runId, 'cancel'), { method: 'POST' });
  }

  async retryRun(runId: string): Promise<RunRetryResult> {
    return this.request<RunRetryResult>(runPath(runId, 'retry'), {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'retry-as-new-run' }),
    });
  }

  async approveRun(runId: string, approvalId: string, decision: 'allow' | 'deny'): Promise<ApprovalResult> {
    if (!approvalId || approvalId.length > MAX_RUN_ID_LENGTH) throw new ClientError(null, 'APPROVAL_ID_INVALID', 'Approval id is invalid.');
    return this.request<ApprovalResult>(runPath(runId, 'approve'), {
      method: 'POST',
      body: JSON.stringify({ approvalId, decision }),
    });
  }

  async *streamRunEvents(runId: string, options: StreamRunOptions = {}): AsyncGenerator<StoredEvent> {
    const after = parseCursor(options.after ?? 0);
    const maxReconnects = boundedInteger(options.maxReconnects, DEFAULT_MAX_RECONNECTS, 0, MAX_RECONNECTS);
    const reconnectDelayMs = boundedInteger(options.reconnectDelayMs, DEFAULT_RECONNECT_DELAY_MS, 0, MAX_RECONNECT_DELAY_MS);
    const maxFrameBytes = boundedInteger(options.maxFrameBytes, DEFAULT_MAX_FRAME_BYTES, 1_024, MAX_FRAME_BYTES);
    let lastSeq = after;
    let reconnects = 0;
    while (true) {
      if (options.signal?.aborted) return;
      let shouldReconnect = false;
      try {
        const headers = this.authHeaders({ Accept: 'text/event-stream', 'Last-Event-ID': String(lastSeq) }, false);
        const response = await this.fetcher(`${this.baseUrl}${runPath(runId, `events?after=${lastSeq}`)}`, {
          method: 'GET',
          headers,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        if (!response.ok) throw await this.toApiError(response);
        if (!response.body) throw new ClientError(response.status, 'STREAM_EMPTY', 'Event stream is unavailable.', true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          while (true) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
            if (byteLength(buffer) > maxFrameBytes) throw new ClientError(response.status, 'SSE_FRAME_TOO_LARGE', 'Event frame exceeded the client limit.');
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const frame = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              const event = parseSseFrame(frame, maxFrameBytes);
              if (event && event.seq > lastSeq) {
                lastSeq = event.seq;
                yield event;
                if (TERMINAL_EVENT_TYPES.has(event.type)) return;
              }
              boundary = buffer.indexOf('\n\n');
            }
            if (chunk.done) break;
          }
        } finally {
          reader.releaseLock();
        }
        shouldReconnect = true;
      } catch (error) {
        if (options.signal?.aborted) return;
        if (error instanceof ClientError && !error.retryable && error.status !== null && error.status >= 400 && error.status < 500) throw error;
        if (error instanceof ClientError && error.code === 'SSE_FRAME_TOO_LARGE') throw error;
        shouldReconnect = true;
      }
      if (!shouldReconnect) return;
      if (reconnects >= maxReconnects) throw new ClientError(null, 'SSE_RECONNECT_EXHAUSTED', 'Event stream reconnect limit reached.');
      reconnects += 1;
      await this.sleep(Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * (2 ** (reconnects - 1))));
    }
  }

  private async request<T>(path: string, init: RequestInit, authenticated = true): Promise<T> {
    const headers = this.authHeaders({ Accept: 'application/json', ...headersFromInit(init.headers) }, authenticated);
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) throw await this.toApiError(response);
    try {
      return await response.json() as T;
    } catch {
      throw new ClientError(response.status, 'RESPONSE_INVALID', 'Server response is invalid.');
    }
  }

  private authHeaders(initial: Record<string, string>, authenticated: boolean): Record<string, string> {
    if (!authenticated) return initial;
    if (!this.session) throw new ClientError(401, 'PAIRING_REQUIRED', 'Pairing is required.');
    if (this.session.expiresAt <= this.now()) {
      this.session = undefined;
      throw new ClientError(401, 'SESSION_EXPIRED', 'Pairing session expired.');
    }
    return { ...initial, Authorization: `Bearer ${this.session.accessToken}`, ...(initial.Accept === 'text/event-stream' ? {} : { 'X-CSRF-Token': this.session.csrfToken }) };
  }

  private async toApiError(response: Response): Promise<ClientError> {
    try {
      const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
      const code = safeErrorCode(body.error?.code);
      const message = safeMessage(body.error?.message);
      return new ClientError(response.status, code, message, response.status >= 500 || response.status === 429);
    } catch {
      return new ClientError(response.status, 'HTTP_ERROR', 'Request failed.', response.status >= 500 || response.status === 429);
    }
  }
}

export function parseSseFrame(frame: string, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES): StoredEvent | undefined {
  if (byteLength(frame) > maxFrameBytes) return undefined;
  let id: string | undefined;
  let eventType: string | undefined;
  let data = '';
  for (const line of frame.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) eventType = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  if (!id || !data || (eventType && eventType.length > 128)) return undefined;
  const seq = Number(id);
  if (!Number.isSafeInteger(seq) || seq < 0) return undefined;
  try {
    const value = JSON.parse(data) as Record<string, unknown>;
    if (value.version !== 1 || value.seq !== seq || typeof value.id !== 'string' || value.id.length > 256 || typeof value.runId !== 'string' || value.runId.length > MAX_RUN_ID_LENGTH || typeof value.type !== 'string' || value.type.length === 0 || value.type.length > 128 || typeof value.at !== 'string' || value.at.length > 64) return undefined;
    return value as unknown as StoredEvent;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = value.trim();
  if (baseUrl.length > MAX_BASE_URL_LENGTH || /[\u0000-\u001F\u007F]/u.test(baseUrl)) throw new ClientError(null, 'BASE_URL_INVALID', 'Base URL is invalid.');
  if (!baseUrl) return '';
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('credentials');
    return parsed.toString().replace(/\/$/u, '');
  } catch {
    if (!baseUrl.startsWith('/') || baseUrl.includes('?') || baseUrl.includes('#')) throw new ClientError(null, 'BASE_URL_INVALID', 'Base URL is invalid.');
    return baseUrl.replace(/\/$/u, '');
  }
}

function runPath(runId: string, suffix = ''): string {
  const value = runId.trim();
  if (!value || value.length > MAX_RUN_ID_LENGTH || /[\u0000-\u001F\u007F]/u.test(value)) throw new ClientError(null, 'RUN_ID_INVALID', 'Run id is invalid.');
  return `/api/v1/runs/${encodeURIComponent(value)}${suffix ? `/${suffix}` : ''}`;
}

function headersFromInit(headers: HeadersInit | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (headers instanceof Headers) headers.forEach((value, key) => { result[key] = value; });
  else if (Array.isArray(headers)) for (const [key, value] of headers) result[key] = value;
  else if (headers) Object.assign(result, headers);
  return result;
}

function isPairingResult(value: unknown): value is PairingResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.accessToken === 'string' && record.accessToken.length > 0 && record.accessToken.length <= 8_192
    && typeof record.csrfToken === 'string' && record.csrfToken.length > 0 && record.csrfToken.length <= 8_192
    && typeof record.sessionId === 'string' && record.sessionId.length > 0 && record.sessionId.length <= 256
    && typeof record.expiresAt === 'number' && Number.isSafeInteger(record.expiresAt);
}

function parseCursor(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ClientError(null, 'SSE_CURSOR_INVALID', 'Event cursor is invalid.');
  return value;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ClientError(null, 'STREAM_OPTIONS_INVALID', 'Stream options are invalid.');
  return value;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function safeReasonCode(error: unknown): string {
  if (error instanceof ClientError) return error.code;
  return 'UNAVAILABLE';
}

function safeErrorCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z0-9_:-]{1,64}$/u.test(value)) return 'HTTP_ERROR';
  return value;
}

function safeMessage(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || /api[_-]?key|access[_-]?token|private[_-]?key|secret|password|[A-Za-z]:\\|(?:^|[\s"'(])\/(?:[^\s/]+\/)+/iu.test(value)) return 'Request failed.';
  return value;
}
