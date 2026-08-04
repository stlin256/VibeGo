import {
  AgentMemoryIdentitySchema,
  AgentMemoryRecallRequestSchema,
  AgentMemoryStatusSchema,
  AgentMemoryWriteRequestSchema,
  type AgentMemoryErrorCode,
  type AgentMemoryIdentity,
  type AgentMemoryMode,
  type AgentMemoryProvider,
  type AgentMemoryRecallRequest,
  type AgentMemoryRecallResult,
  type AgentMemoryStatus,
  type AgentMemoryWriteRequest,
  type AgentMemoryWriteResult,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
} from '@ready4vibe/contracts';
import { streamOpenAIChatCompletions, type FetchImplementation } from '@ready4vibe/model-openai';

const SAFE_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,511}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u;
const MAX_HEALTH_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface TencentMemoryProxyProviderOptions {
  readonly endpoint: string;
  readonly identity: AgentMemoryIdentity;
  readonly spaceId?: string;
  readonly chatCompletionsPath?: string;
  readonly healthPath?: string;
  readonly proxyApiKey?: string;
  /** Optional upstream credential owned by the proxy deployment. */
  readonly upstreamApiKey?: string;
  readonly fallback?: ModelProvider;
  readonly fallbackToDirectProvider?: boolean;
  readonly mode?: Extract<AgentMemoryMode, 'proxy' | 'full-stack'>;
  readonly allowInsecureHttp?: boolean;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchImplementation;
}

export class MemoryProxyProviderError extends Error {
  constructor(readonly code: AgentMemoryErrorCode, message: string) {
    super(message);
    this.name = 'MemoryProxyProviderError';
  }
}

/**
 * Explicit adapter for TencentDB MemoryProxy's OpenAI-compatible route.
 *
 * It deliberately implements the memory port as a validated no-op: the
 * MemoryProxy process owns injection and conversation write-back. The same
 * object implements ModelProvider so a run snapshot freezes the proxy path,
 * identity headers, fallback policy, and direct provider together.
 */
export class TencentMemoryProxyProvider implements AgentMemoryProvider, ModelProvider {
  readonly id = 'tencentdb-agent-memory' as const;
  readonly mode: Extract<AgentMemoryMode, 'proxy' | 'full-stack'>;
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: false } as const;

  private readonly chatEndpoint: string;
  private readonly healthEndpoint: string;
  private readonly identity: AgentMemoryIdentity;
  private readonly proxyApiKey: string | undefined;
  private readonly upstreamApiKey: string | undefined;
  private readonly fallback: ModelProvider | undefined;
  private readonly fallbackToDirectProvider: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchImplementation;
  private closed = false;
  private available = false;
  private degraded = true;
  private lastErrorCode: AgentMemoryErrorCode | null = 'unavailable';
  private lastHealthAt: string | null = null;

  constructor(options: TencentMemoryProxyProviderOptions) {
    const endpoint = parseEndpoint(options.endpoint, options.allowInsecureHttp === true);
    const identity = AgentMemoryIdentitySchema.parse(options.identity);
    const spaceId = validateId(options.spaceId ?? identity.teamId, 'spaceId');
    const chatPath = validatePath(options.chatCompletionsPath ?? '/proxy/{spaceId}/v1/chat/completions', 'chatCompletionsPath')
      .replaceAll('{spaceId}', spaceId);
    const healthPath = validatePath(options.healthPath ?? '/health', 'healthPath');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error('MemoryProxy timeoutMs must be between 1 and 60000.');
    }
    if (options.proxyApiKey !== undefined) validateCredential(options.proxyApiKey, 'proxyApiKey');
    if (options.upstreamApiKey !== undefined) validateCredential(options.upstreamApiKey, 'upstreamApiKey');
    this.chatEndpoint = joinEndpoint(endpoint, chatPath);
    this.healthEndpoint = joinEndpoint(endpoint, healthPath);
    this.identity = identity;
    this.proxyApiKey = options.proxyApiKey;
    this.upstreamApiKey = options.upstreamApiKey;
    this.fallback = options.fallback;
    this.fallbackToDirectProvider = options.fallbackToDirectProvider ?? true;
    this.mode = options.mode ?? 'proxy';
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async status(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    if (this.closed) return this.statusValue(false, true, 'unavailable');
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.healthEndpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new MemoryProxyProviderError('health', 'MemoryProxy health probe failed.');
      const length = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(length) && length > MAX_HEALTH_BYTES) throw new MemoryProxyProviderError('protocol', 'MemoryProxy health response is too large.');
      // Consume a bounded body so a keep-alive connection is not left with an
      // unread response. The body content is intentionally not exposed.
      if (response.body) {
        const body = await response.text();
        if (Buffer.byteLength(body, 'utf8') > MAX_HEALTH_BYTES) throw new MemoryProxyProviderError('protocol', 'MemoryProxy health response is too large.');
      }
      this.available = true;
      this.degraded = false;
      this.lastErrorCode = null;
      this.lastHealthAt = new Date().toISOString();
      return this.statusValue(true, false, null);
    } catch (error) {
      const code = timedOut || controller.signal.aborted && !signal?.aborted ? 'timeout' : errorCode(error);
      this.available = false;
      this.degraded = true;
      this.lastErrorCode = code;
      return this.statusValue(false, true, code);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async recall(request: AgentMemoryRecallRequest): Promise<AgentMemoryRecallResult> {
    AgentMemoryRecallRequestSchema.parse(request);
    this.assertIdentity(request.identity);
    return { items: [], sourceRevision: null, elapsedMs: 0, degraded: false };
  }

  async enqueueWrite(request: AgentMemoryWriteRequest): Promise<AgentMemoryWriteResult> {
    AgentMemoryWriteRequestSchema.parse(request);
    this.assertIdentity(request.identity);
    return { accepted: false, queued: false };
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (this.closed) {
      yield* this.fallbackOrError(request, signal, { type: 'error', code: 'MEMORY_PROXY_NETWORK_ERROR', retryable: true, safeMessage: 'The memory proxy is unavailable.' });
      return;
    }
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let timedOut = false;
    let sawOutput = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      for await (const event of streamOpenAIChatCompletions({
        endpoint: this.chatEndpoint,
        request,
        signal: controller.signal,
        ...(this.upstreamApiKey ? { apiKey: this.upstreamApiKey } : {}),
        headers: this.identityHeaders(),
        fetchImpl: this.fetchImpl,
        errorCodePrefix: 'MEMORY_PROXY',
        providerLabel: 'The memory proxy',
      })) {
        if (signal.aborted) return;
        if (event.type === 'error') {
          const normalized = timedOut
            ? { type: 'error', code: 'MEMORY_PROXY_TIMEOUT', retryable: true, safeMessage: 'The memory proxy request timed out.' } as const
            : event;
          if (!sawOutput && this.shouldFallback(normalized)) {
            this.markFailure(normalized);
            yield* this.fallbackOrError(request, signal, normalized);
            return;
          }
          this.markFailure(normalized);
          yield normalized;
          return;
        }
        sawOutput = true;
        this.markSuccess();
        yield event;
      }
      if (signal.aborted) return;
      if (timedOut) {
        const timeoutEvent = { type: 'error', code: 'MEMORY_PROXY_TIMEOUT', retryable: true, safeMessage: 'The memory proxy request timed out.' } as const;
        this.markFailure(timeoutEvent);
        if (!sawOutput) yield* this.fallbackOrError(request, signal, timeoutEvent);
        else yield timeoutEvent;
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private async *fallbackOrError(request: ModelRequest, signal: AbortSignal, error: ModelEvent & { type: 'error' }): AsyncIterable<ModelEvent> {
    if (this.fallback && this.fallbackToDirectProvider && !signal.aborted) {
      yield* this.fallback.stream(request, signal);
      return;
    }
    yield error;
  }

  private shouldFallback(event: ModelEvent & { type: 'error' }): boolean {
    if (!this.fallback || !this.fallbackToDirectProvider) return false;
    return event.code === 'MEMORY_PROXY_NETWORK_ERROR'
      || event.code === 'MEMORY_PROXY_EMPTY_BODY'
      || event.code === 'MEMORY_PROXY_STREAM_ERROR'
      || event.code === 'MEMORY_PROXY_STREAM_ENDED'
      || /^MEMORY_PROXY_HTTP_5\d\d$/u.test(event.code)
      || event.code === 'MEMORY_PROXY_TIMEOUT';
  }

  private identityHeaders(): Record<string, string> {
    return {
      ...(this.proxyApiKey ? { 'x-tdai-user-key': this.proxyApiKey } : {}),
      'x-team-id': this.identity.teamId,
      'x-agent-id': this.identity.agentId,
      'x-user-id': this.identity.userId,
      ...(this.identity.sessionId ? { 'x-session-id': this.identity.sessionId } : {}),
    };
  }

  private assertIdentity(identity: AgentMemoryIdentity): void {
    const parsed = AgentMemoryIdentitySchema.parse(identity);
    if (parsed.teamId !== this.identity.teamId || parsed.agentId !== this.identity.agentId || parsed.userId !== this.identity.userId || parsed.sessionId !== this.identity.sessionId) {
      throw new MemoryProxyProviderError('protocol', 'MemoryProxy identity does not match the run snapshot.');
    }
  }

  private markSuccess(): void {
    this.available = true;
    this.degraded = false;
    this.lastErrorCode = null;
  }

  private markFailure(event: ModelEvent & { type: 'error' }): void {
    this.available = false;
    this.degraded = true;
    this.lastErrorCode = errorCodeFromModelEvent(event);
  }

  private statusValue(available: boolean, degraded: boolean, lastErrorCode: AgentMemoryErrorCode | null): AgentMemoryStatus {
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0',
      enabled: true,
      mode: this.mode,
      available,
      degraded,
      revision: null,
      previousRevision: null,
      lastHealthAt: this.lastHealthAt,
      lastUpdateAt: null,
      updateState: available ? 'ready' : 'degraded',
      lastErrorCode,
      capabilities: ['proxy'],
    });
  }
}

function parseEndpoint(value: string, allowInsecureHttp: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('MemoryProxy endpoint must be a valid URL.'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (allowInsecureHttp || loopback))) throw new Error('MemoryProxy endpoint requires HTTPS unless insecure loopback HTTP is explicit.');
  if (url.username || url.password) throw new Error('MemoryProxy endpoint must not contain credentials.');
  if (url.search) throw new Error('MemoryProxy endpoint must not contain query parameters.');
  if (url.hash) throw new Error('MemoryProxy endpoint must not contain fragments.');
  return url.toString().replace(/\/$/u, '');
}

function validatePath(value: string, field: string): string {
  const normalized = value.replaceAll('{spaceId}', 'spaceId');
  if (!SAFE_PATH.test(normalized) || value.includes('..') || (value.includes('{') && value !== '/proxy/{spaceId}/v1/chat/completions')) {
    throw new Error(`MemoryProxy ${field} is invalid.`);
  }
  return value;
}

function validateId(value: string, field: string): string {
  if (!SAFE_ID.test(value)) throw new Error(`MemoryProxy ${field} is invalid.`);
  return value;
}

function validateCredential(value: string, field: string): void {
  if (value.length > 8_192 || /[\r\n]/u.test(value)) throw new Error(`MemoryProxy ${field} is invalid.`);
}

function joinEndpoint(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/$/u, '')}${path}`;
}

function errorCode(error: unknown): AgentMemoryErrorCode {
  if (error instanceof MemoryProxyProviderError) return error.code;
  return 'unavailable';
}

function errorCodeFromModelEvent(event: ModelEvent & { type: 'error' }): AgentMemoryErrorCode {
  if (event.code === 'MEMORY_PROXY_TIMEOUT') return 'timeout';
  if (event.code.includes('MALFORMED') || event.code.includes('STREAM')) return 'protocol';
  if (event.code.includes('HTTP_')) return event.code.endsWith('401') || event.code.endsWith('403') ? 'unavailable' : 'health';
  return 'unavailable';
}
