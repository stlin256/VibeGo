import {
  AgentMemoryIdentitySchema,
  AgentMemoryItemSchema,
  AgentMemoryOperationsSchema,
  AgentMemoryRecallRequestSchema,
  AgentMemoryStatusSchema,
  AgentMemoryWriteRequestSchema,
  type AgentMemoryErrorCode,
  type AgentMemoryItem,
  type AgentMemoryOperations,
  type AgentMemoryProvider,
  type AgentMemoryRecallRequest,
  type AgentMemoryRecallResult,
  type AgentMemoryStatus,
  type AgentMemoryWriteRequest,
  type AgentMemoryWriteResult,
} from '@ready4vibe/contracts';

const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_WRITE_BYTES = 32 * 1024;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_PENDING_WRITES = 256;

export type MemoryCoreFetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface MemoryCoreProviderOptions {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly serviceId: string;
  readonly identity: AgentMemoryRecallRequest['identity'];
  readonly timeoutMs?: number;
  readonly allowInsecureHttp?: boolean;
  readonly fetchImpl?: MemoryCoreFetchImplementation;
}

export class MemoryCoreProviderError extends Error {
  constructor(readonly code: AgentMemoryErrorCode, message = 'MemoryCore request failed.') {
    super(message);
    this.name = 'MemoryCoreProviderError';
  }
}

/**
 * Explicit HTTP adapter for the public MemoryCore v3 data plane. It keeps the
 * upstream SDK out of the daemon runtime while preserving the same endpoint,
 * isolation fields, bearer header, and response envelope contract.
 */
export class TencentMemoryCoreProvider implements AgentMemoryProvider {
  readonly id = 'tencentdb-agent-memory' as const;
  readonly mode = 'memory-core' as const;

  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly serviceId: string;
  private readonly identity: AgentMemoryRecallRequest['identity'];
  private readonly timeoutMs: number;
  private readonly fetchImpl: MemoryCoreFetchImplementation;
  private writeQueue: Promise<void> = Promise.resolve();
  private closed = false;
  private revision: string | null = null;
  private lastErrorCode: AgentMemoryErrorCode | null = null;
  private healthLatencyMs: number | null = null;
  private recallHits = 0;
  private recallMisses = 0;
  private lastRecallAt: string | null = null;
  private pendingWrites = 0;
  private writeInFlight = false;
  private acceptedWrites = 0;
  private failedWrites = 0;
  private lastWriteAttemptAt: string | null = null;
  private lastWriteErrorCode: AgentMemoryErrorCode | null = null;

  constructor(options: MemoryCoreProviderOptions) {
    const endpoint = parseEndpoint(options.endpoint, options.allowInsecureHttp === true);
    if (!options.apiKey.trim()) throw new Error('MemoryCore apiKey is required.');
    if (!options.serviceId.trim() || options.serviceId.length > 128 || /[\r\n]/u.test(options.serviceId)) {
      throw new Error('MemoryCore serviceId is invalid.');
    }
    const timeoutMs = options.timeoutMs ?? 8_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
      throw new Error('MemoryCore timeoutMs must be between 1 and 60000.');
    }
    this.endpoint = endpoint;
    this.apiKey = options.apiKey;
    this.serviceId = options.serviceId;
    this.identity = AgentMemoryIdentitySchema.parse(options.identity);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async status(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const payload = await this.request('/health', 'GET', undefined, signal);
      const revision = readRevision(payload);
      this.revision = revision;
      this.lastErrorCode = null;
      this.healthLatencyMs = elapsedMs(startedAt);
      return this.statusValue({
        available: true,
        degraded: false,
        revision,
        lastHealthAt: checkedAt,
        updateState: 'ready',
        lastErrorCode: null,
      });
    } catch (error) {
      const code = errorCode(error);
      this.lastErrorCode = code;
      this.healthLatencyMs = elapsedMs(startedAt);
      return this.statusValue({
        available: false,
        degraded: true,
        revision: this.revision,
        lastHealthAt: checkedAt,
        updateState: 'degraded',
        lastErrorCode: code,
      });
    }
  }

  async recall(request: AgentMemoryRecallRequest): Promise<AgentMemoryRecallResult> {
    const parsed = AgentMemoryRecallRequestSchema.parse(request);
    const startedAt = Date.now();
    if (!sameIdentity(parsed.identity, this.identity)) {
      this.lastErrorCode = 'schema';
      this.recordRecall(false);
      return {
        items: [],
        sourceRevision: this.revision,
        elapsedMs: elapsedMs(startedAt),
        degraded: true,
      };
    }
    try {
      const data = await this.request('/v3/atomic/search', 'POST', {
        team_id: parsed.identity.teamId,
        agent_id: parsed.identity.agentId,
        user_id: parsed.identity.userId,
        ...(parsed.identity.sessionId ? { session_id: parsed.identity.sessionId } : {}),
        query: parsed.query,
        limit: parsed.maxItems,
      }, parsed.signal);
      const items = mapRecallItems(data, parsed.maxItems, parsed.maxBytes, this.revision);
      this.lastErrorCode = null;
      this.recordRecall(items.length > 0);
      return {
        items,
        sourceRevision: this.revision,
        elapsedMs: elapsedMs(startedAt),
        degraded: false,
      };
    } catch (error) {
      this.lastErrorCode = errorCode(error);
      this.recordRecall(false);
      return {
        items: [],
        sourceRevision: this.revision,
        elapsedMs: elapsedMs(startedAt),
        degraded: true,
      };
    }
  }

  async enqueueWrite(request: AgentMemoryWriteRequest): Promise<AgentMemoryWriteResult> {
    const parsed = AgentMemoryWriteRequestSchema.parse(request);
    if (this.closed || !parsed.identity.sessionId || !sameIdentity(parsed.identity, this.identity)) {
      if (!sameIdentity(parsed.identity, this.identity)) this.lastErrorCode = 'schema';
      return { accepted: false, queued: false };
    }
    if (this.pendingWrites >= MAX_PENDING_WRITES) {
      this.lastErrorCode = 'unavailable';
      this.failedWrites = Math.min(1_000_000_000, this.failedWrites + 1);
      this.lastWriteErrorCode = 'unavailable';
      return { accepted: false, queued: false };
    }
    this.pendingWrites += 1;
    this.acceptedWrites = Math.min(1_000_000_000, this.acceptedWrites + 1);
    this.writeQueue = this.writeQueue
      .then(async () => {
        this.writeInFlight = true;
        this.lastWriteAttemptAt = new Date().toISOString();
        try {
          await this.write(parsed);
          this.lastWriteErrorCode = null;
        } catch (error) {
          this.failedWrites = Math.min(1_000_000_000, this.failedWrites + 1);
          this.lastWriteErrorCode = errorCode(error);
          throw error;
        } finally {
          this.writeInFlight = false;
          this.pendingWrites = Math.max(0, this.pendingWrites - 1);
        }
      })
      .catch((error: unknown) => {
        this.lastErrorCode = errorCode(error);
      });
    return { accepted: true, queued: true };
  }

  operations(): AgentMemoryOperations {
    return AgentMemoryOperationsSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_operations_v1',
      currentRevision: this.revision,
      previousRevision: null,
      healthLatencyMs: this.healthLatencyMs,
      recall: { hits: this.recallHits, misses: this.recallMisses, lastAt: this.lastRecallAt },
      writeQueue: {
        pending: this.pendingWrites,
        inFlight: this.writeInFlight,
        accepted: this.acceptedWrites,
        failed: this.failedWrites,
        lastAttemptAt: this.lastWriteAttemptAt,
        lastErrorCode: this.lastWriteErrorCode,
      },
      updates: [],
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.writeQueue;
  }

  private async write(request: AgentMemoryWriteRequest): Promise<void> {
    const content = buildWriteContent(request);
    await this.request('/v3/conversation/add', 'POST', {
      team_id: request.identity.teamId,
      agent_id: request.identity.agentId,
      user_id: request.identity.userId,
      session_id: request.identity.sessionId,
      messages: [{ role: 'assistant', content }],
    });
    this.lastErrorCode = null;
  }

  private recordRecall(hit: boolean): void {
    if (hit) this.recallHits = Math.min(1_000_000_000, this.recallHits + 1);
    else this.recallMisses = Math.min(1_000_000_000, this.recallMisses + 1);
    this.lastRecallAt = new Date().toISOString();
  }

  private statusValue(overrides: Pick<AgentMemoryStatus, 'available' | 'degraded' | 'revision' | 'lastHealthAt' | 'updateState' | 'lastErrorCode'>): AgentMemoryStatus {
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0',
      enabled: true,
      mode: 'memory-core',
      available: overrides.available,
      degraded: overrides.degraded,
      revision: overrides.revision,
      previousRevision: null,
      lastHealthAt: overrides.lastHealthAt,
      lastUpdateAt: null,
      updateState: overrides.updateState,
      lastErrorCode: overrides.lastErrorCode,
      capabilities: ['recall', 'write-back'],
    });
  }

  private async request(path: string, method: 'GET' | 'POST', body: Record<string, unknown> | undefined, signal?: AbortSignal): Promise<unknown> {
    if (this.closed) throw new MemoryCoreProviderError('unavailable', 'MemoryCore provider is closed.');
    const response = await fetchWithTimeout(this.fetchImpl, `${this.endpoint}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'x-tdai-service-id': this.serviceId,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, this.timeoutMs, signal);
    const raw = await readResponseText(response, MAX_RESPONSE_BYTES, signal);
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw) as unknown;
    } catch {
      throw new MemoryCoreProviderError('protocol');
    }
    if (!response.ok) {
      throw new MemoryCoreProviderError(response.status === 408 || response.status === 429 || response.status >= 500 ? 'unavailable' : 'schema');
    }
    const record = asRecord(envelope);
    // MemoryCore's health endpoint is a small status document rather than the
    // v3 `{ code, data }` envelope used by data-plane calls.
    if (path === '/health' && record && typeof record.status === 'string' && typeof record.code !== 'number') {
      return record;
    }
    if (!record || typeof record.code !== 'number') throw new MemoryCoreProviderError('protocol');
    if (record.code !== 0) throw new MemoryCoreProviderError(record.code >= 500 ? 'unavailable' : 'schema');
    return record.data ?? {};
  }
}

function parseEndpoint(value: string, allowInsecureHttp: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('MemoryCore endpoint must be a valid URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && allowInsecureHttp)) {
    throw new Error('MemoryCore endpoint requires HTTPS unless insecure HTTP is explicit.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('MemoryCore endpoint must not contain credentials, query parameters, or fragments.');
  }
  return url.toString().replace(/\/$/u, '');
}

function mapRecallItems(value: unknown, maxItems: number, maxBytes: number, sourceRevision: string | null): AgentMemoryItem[] {
  const record = asRecord(value);
  const rawItems = record?.items;
  if (!Array.isArray(rawItems)) throw new MemoryCoreProviderError('protocol');
  const items: AgentMemoryItem[] = [];
  let usedBytes = 0;
  for (const raw of rawItems.slice(0, maxItems)) {
    const item = asRecord(raw);
    if (!item || typeof item.id !== 'string' || typeof item.content !== 'string' || typeof item.type !== 'string') {
      throw new MemoryCoreProviderError('protocol');
    }
    const remaining = maxBytes - usedBytes;
    if (remaining <= 0) break;
    const content = truncateUtf8(item.content, Math.min(64 * 1024, remaining));
    if (!content) continue;
    const candidate = AgentMemoryItemSchema.parse({
      id: item.id,
      content,
      kind: mapKind(item.type),
      ...(typeof item.score === 'number' && Number.isFinite(item.score) ? { score: Math.min(1, Math.max(0, item.score)) } : {}),
      source: 'tencentdb-memory-core',
      trust: 'untrusted',
      ...(sourceRevision ? { revision: sourceRevision } : {}),
    });
    items.push(candidate);
    usedBytes += new TextEncoder().encode(content).byteLength;
  }
  return items;
}

function mapKind(value: string): AgentMemoryItem['kind'] {
  const normalized = value.toLowerCase();
  if (normalized.includes('preference')) return 'preference';
  if (normalized.includes('decision')) return 'decision';
  if (normalized.includes('skill')) return 'skill';
  if (normalized.includes('summary')) return 'summary';
  if (normalized.includes('knowledge')) return 'knowledge';
  return 'fact';
}

function buildWriteContent(request: AgentMemoryWriteRequest): string {
  const sections = [
    `Outcome: ${request.outcome}`,
    `Summary:\n${request.summary}`,
    ...(request.facts?.length ? [`Facts:\n${request.facts.join('\n')}`] : []),
    ...(request.decisions?.length ? [`Decisions:\n${request.decisions.join('\n')}`] : []),
    ...(request.evidenceRefs?.length ? [`Evidence refs: ${request.evidenceRefs.join(', ')}`] : []),
  ];
  return truncateUtf8(sections.join('\n\n'), MAX_WRITE_BYTES);
}

async function fetchWithTimeout(
  fetchImpl: MemoryCoreFetchImplementation,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new MemoryCoreProviderError('timeout');
    throw new MemoryCoreProviderError('unavailable');
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

async function readResponseText(response: Response, maxBytes: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new MemoryCoreProviderError('protocol');
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let value = '';
  try {
    while (!signal?.aborted) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new MemoryCoreProviderError('protocol');
      value += decoder.decode(next.value, { stream: true });
    }
    value += decoder.decode();
    if (signal?.aborted) throw new MemoryCoreProviderError('timeout');
    return value;
  } finally {
    reader.releaseLock();
  }
}

function readRevision(value: unknown): string | null {
  const record = asRecord(value);
  const candidate = record?.revision ?? record?.version ?? record?.commit;
  return typeof candidate === 'string' && REVISION_PATTERN.test(candidate) ? candidate : null;
}

function elapsedMs(startedAt: number): number {
  return Math.min(60_000, Math.max(0, Date.now() - startedAt));
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(encoded.slice(0, maxBytes));
}

function errorCode(error: unknown): AgentMemoryErrorCode {
  return error instanceof MemoryCoreProviderError ? error.code : 'protocol';
}

function sameIdentity(
  left: AgentMemoryRecallRequest['identity'],
  right: AgentMemoryRecallRequest['identity'],
): boolean {
  return left.teamId === right.teamId
    && left.agentId === right.agentId
    && left.userId === right.userId
    // A provider created from durable settings has no session scope. A run
    // may add its explicit session id at call time; a provider created for a
    // fixed session still rejects every other session (fail-closed).
    && (right.sessionId === undefined || left.sessionId === right.sessionId);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
