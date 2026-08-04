import { createHash } from 'node:crypto';
import {
  AgentMemoryKnowledgeCallRequestSchema,
  AgentMemoryKnowledgeListRequestSchema,
  AgentMemoryKnowledgeResultSchema,
  AgentMemoryKnowledgeToolDescriptorSchema,
  AgentMemoryKnowledgeToolListSchema,
  AgentMemoryStatusSchema,
  type AgentMemoryErrorCode,
  type AgentMemoryKnowledgeCallRequest,
  type AgentMemoryKnowledgeErrorCode,
  type AgentMemoryKnowledgeListRequest,
  type AgentMemoryKnowledgeProvider,
  type AgentMemoryKnowledgeResult,
  type AgentMemoryKnowledgeResourceType,
  type AgentMemoryKnowledgeToolDescriptor,
  type AgentMemoryKnowledgeToolList,
  type AgentMemoryStatus,
} from '@ready4vibe/contracts';
import type { ContextItem } from '@ready4vibe/context';
import { findAgentMemoryPrivacyViolations } from '@ready4vibe/contracts';

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_MAX_ITEM_BYTES = 16 * 1024;
const MAX_HEALTH_BYTES = 8 * 1024;
const SAFE_SERVICE_ID = /^[A-Za-z0-9_-]{1,200}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

const WIKI_TOOLS = new Set(['get_info', 'search', 'list_pages', 'read_page', 'get_graph', 'list_raw', 'read_raw']);
const CODE_GRAPH_TOOLS = new Set(['get_info', 'search', 'explore', 'callers', 'callees', 'impact', 'node', 'status', 'files']);

export type MemoryKnowledgeFetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

export interface MemoryKnowledgeProviderOptions {
  readonly endpoint: string;
  readonly serviceId: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxItemBytes?: number;
  readonly allowInsecureHttp?: boolean;
  readonly fetchImpl?: MemoryKnowledgeFetchImplementation;
}

export class MemoryKnowledgeProviderError extends Error {
  constructor(readonly code: AgentMemoryKnowledgeErrorCode, message = 'MemoryKnowledge request failed.') {
    super(message);
    this.name = 'MemoryKnowledgeProviderError';
  }
}

/**
 * Daemon-local adapter for MemoryKnowledge's public v3 tools surface. It is
 * intentionally a retrieval port, not a generic tool executor: only the
 * documented read-only tool names can reach the upstream service.
 */
export class TencentMemoryKnowledgeProvider implements AgentMemoryKnowledgeProvider {
  readonly id = 'tencentdb-memory-knowledge' as const;

  private readonly endpoint: string;
  private readonly serviceId: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxItemBytes: number;
  private readonly fetchImpl: MemoryKnowledgeFetchImplementation;
  private closed = false;
  private lastErrorCode: AgentMemoryKnowledgeErrorCode | null = null;
  private lastHealthAt: string | null = null;

  constructor(options: MemoryKnowledgeProviderOptions) {
    this.endpoint = parseEndpoint(options.endpoint, options.allowInsecureHttp === true);
    if (!SAFE_SERVICE_ID.test(options.serviceId)) throw new Error('MemoryKnowledge serviceId is invalid.');
    this.serviceId = options.serviceId;
    this.timeoutMs = boundedPositive(options.timeoutMs, DEFAULT_TIMEOUT_MS, 60_000, 'timeoutMs');
    this.maxResponseBytes = boundedPositive(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 2 * 1024 * 1024, 'maxResponseBytes');
    this.maxItemBytes = boundedPositive(options.maxItemBytes, DEFAULT_MAX_ITEM_BYTES, 64 * 1024, 'maxItemBytes');
    this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  async status(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const payload = await this.request('/health', 'GET', undefined, signal, MAX_HEALTH_BYTES);
      const record = asRecord(payload);
      if (!record || typeof record.status !== 'string') throw new MemoryKnowledgeProviderError('schema');
      this.lastErrorCode = null;
      this.lastHealthAt = checkedAt;
      return this.statusValue(true, false, null);
    } catch (error) {
      const code = errorCode(error);
      this.lastErrorCode = code;
      this.lastHealthAt = checkedAt;
      return this.statusValue(false, true, toAgentMemoryErrorCode(code));
    }
  }

  async listTools(request: AgentMemoryKnowledgeListRequest): Promise<AgentMemoryKnowledgeToolList> {
    const parsed = AgentMemoryKnowledgeListRequestSchema.parse(request);
    const startedAt = Date.now();
    try {
      const data = await this.request('/v3/tools/list', 'POST', { knowledge_id: parsed.knowledgeId }, parsed.signal);
      const result = parseToolList(data, parsed.knowledgeId, elapsedMs(startedAt));
      this.lastErrorCode = null;
      return result;
    } catch (error) {
      const code = errorCode(error);
      this.lastErrorCode = code;
      return degradedToolList(parsed.knowledgeId, elapsedMs(startedAt), code);
    }
  }

  /** Explicit bounded alias matching the upstream `/tools/call` name. */
  call(request: AgentMemoryKnowledgeCallRequest): Promise<AgentMemoryKnowledgeResult> {
    return this.retrieve(request);
  }

  async retrieve(request: AgentMemoryKnowledgeCallRequest): Promise<AgentMemoryKnowledgeResult> {
    const parsed = AgentMemoryKnowledgeCallRequestSchema.parse(request);
    const startedAt = Date.now();
    const listed = await this.listTools({ knowledgeId: parsed.knowledgeId, ...(parsed.signal ? { signal: parsed.signal } : {}) });
    if (listed.degraded) return degradedResult(parsed, elapsedMs(startedAt), listed.errorCode ?? 'unavailable', listed.sourceRevision);
    if (!listed.tools.some((tool) => tool.name === parsed.toolName)) {
      this.lastErrorCode = 'forbidden';
      return degradedResult(parsed, elapsedMs(startedAt), 'forbidden', listed.sourceRevision);
    }
    try {
      const data = await this.request('/v3/tools/call', 'POST', {
        knowledge_id: parsed.knowledgeId,
        tool_name: parsed.toolName,
        params: parsed.params,
      }, parsed.signal);
      const items = mapKnowledgeItems(data, parsed, listed.sourceRevision, this.maxItemBytes);
      this.lastErrorCode = null;
      return AgentMemoryKnowledgeResultSchema.parse({
        schemaVersion: 'ready4vibe_agent_memory_knowledge_result_v1',
        knowledgeId: parsed.knowledgeId,
        toolName: parsed.toolName,
        items,
        sourceRevision: listed.sourceRevision,
        elapsedMs: elapsedMs(startedAt),
        degraded: false,
        errorCode: null,
      });
    } catch (error) {
      const code = errorCode(error);
      this.lastErrorCode = code;
      return degradedResult(parsed, elapsedMs(startedAt), code, listed.sourceRevision);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private statusValue(available: boolean, degraded: boolean, lastErrorCode: AgentMemoryErrorCode | null): AgentMemoryStatus {
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0',
      enabled: true,
      mode: 'full-stack',
      available,
      degraded,
      revision: null,
      previousRevision: null,
      lastHealthAt: this.lastHealthAt,
      lastUpdateAt: null,
      updateState: available ? 'ready' : 'degraded',
      lastErrorCode,
      capabilities: ['knowledge'],
    });
  }

  private async request(path: string, method: 'GET' | 'POST', body: Record<string, unknown> | undefined, signal: AbortSignal | undefined, responseLimit = this.maxResponseBytes): Promise<unknown> {
    if (this.closed) throw new MemoryKnowledgeProviderError('unavailable', 'MemoryKnowledge provider is closed.');
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort();
    if (signal?.aborted) throw new MemoryKnowledgeProviderError('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.endpoint}${path}`, {
          method,
          headers: {
            Accept: 'application/json',
            'x-tdai-service-id': this.serviceId,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: controller.signal,
        });
      } catch {
        if (signal?.aborted) throw new MemoryKnowledgeProviderError('aborted');
        if (timedOut) throw new MemoryKnowledgeProviderError('timeout');
        throw new MemoryKnowledgeProviderError('unavailable');
      }
      const raw = await readResponseText(response, responseLimit, controller.signal, () => timedOut, () => signal?.aborted === true);
      if (!response.ok) {
        throw new MemoryKnowledgeProviderError(response.status === 408 || response.status === 429 || response.status >= 500 ? 'unavailable' : 'schema');
      }
      let envelope: unknown;
      try { envelope = JSON.parse(raw) as unknown; } catch { throw new MemoryKnowledgeProviderError('protocol'); }
      const record = asRecord(envelope);
      if (path === '/health' && record && typeof record.status === 'string' && typeof record.code !== 'number') return record;
      if (!record || typeof record.code !== 'number') throw new MemoryKnowledgeProviderError('protocol');
      if (record.code !== 0) throw new MemoryKnowledgeProviderError(record.code >= 500 ? 'unavailable' : 'schema');
      return record.data ?? {};
    } catch (error) {
      if (error instanceof MemoryKnowledgeProviderError) throw error;
      if (signal?.aborted) throw new MemoryKnowledgeProviderError('aborted');
      if (timedOut) throw new MemoryKnowledgeProviderError('timeout');
      throw new MemoryKnowledgeProviderError('protocol');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}

export function knowledgeResultToContextItems(result: AgentMemoryKnowledgeResult, runId: string): ContextItem[] {
  const parsed = AgentMemoryKnowledgeResultSchema.parse(result);
  if (parsed.degraded) return [];
  const ids = new Set<string>();
  return parsed.items.map((item) => {
    const baseId = `${runId}:knowledge:${item.id}`;
    let id = baseId;
    let suffix = 1;
    while (ids.has(id)) id = `${baseId}:${suffix++}`;
    ids.add(id);
    return {
      id,
      source: 'retrieval' as const,
      trust: 'untrusted' as const,
      role: 'assistant' as const,
      content: `[KNOWLEDGE tool=${parsed.toolName} source=${item.source}]\n${item.content}`,
    };
  });
}

function parseToolList(value: unknown, knowledgeId: string, elapsed: number): AgentMemoryKnowledgeToolList {
  const record = asRecord(value);
  if (!record || record.knowledge_id !== knowledgeId || (record.type !== 'wiki' && record.type !== 'code-graph') || typeof record.name !== 'string' || (record.summary !== null && typeof record.summary !== 'string') || typeof record.status !== 'string' || !Array.isArray(record.tools)) {
    throw new MemoryKnowledgeProviderError('schema');
  }
  const resourceType = record.type as AgentMemoryKnowledgeResourceType;
  const allowed = resourceType === 'wiki' ? WIKI_TOOLS : CODE_GRAPH_TOOLS;
  const tools: AgentMemoryKnowledgeToolDescriptor[] = [];
  for (const raw of record.tools) {
    const candidate = asRecord(raw);
    // Unknown and management operations are intentionally omitted from the
    // public descriptor instead of being made callable by upstream changes.
    if (!candidate || typeof candidate.name !== 'string' || !allowed.has(candidate.name)) continue;
    try {
      tools.push(AgentMemoryKnowledgeToolDescriptorSchema.parse(candidate));
    } catch (error) {
      if (findAgentMemoryPrivacyViolations(candidate).length > 0) throw new MemoryKnowledgeProviderError('privacy');
      throw new MemoryKnowledgeProviderError('schema', error instanceof Error ? error.message : undefined);
    }
  }
  const sourceRevision = readRevision(record.revision ?? record.version);
  try {
    return AgentMemoryKnowledgeToolListSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_knowledge_tools_v1',
      knowledgeId,
      resourceType,
      name: record.name,
      summary: record.summary,
      status: record.status,
      tools,
      sourceRevision,
      elapsedMs: elapsed,
      degraded: false,
      errorCode: null,
    });
  } catch (error) {
    if (findAgentMemoryPrivacyViolations(record).length > 0) throw new MemoryKnowledgeProviderError('privacy');
    throw new MemoryKnowledgeProviderError('schema', error instanceof Error ? error.message : undefined);
  }
}

function mapKnowledgeItems(value: unknown, request: AgentMemoryKnowledgeCallRequest, sourceRevision: string | null, maxItemBytes: number) {
  const violations = findAgentMemoryPrivacyViolations(value);
  if (violations.length > 0) throw new MemoryKnowledgeProviderError('privacy');
  const candidates = extractCandidates(value);
  const items = [];
  let usedBytes = 0;
  for (const candidate of candidates.slice(0, request.maxItems)) {
    const raw = typeof candidate === 'string' ? candidate : JSON.stringify(candidate);
    if (!raw) continue;
    const remaining = request.maxBytes - usedBytes;
    if (remaining <= 0) break;
    const content = truncateUtf8(raw, Math.min(maxItemBytes, remaining));
    if (!content) continue;
    const id = `knowledge_${createHash('sha256').update(`${request.knowledgeId}|${request.toolName}|${raw}`).digest('hex').slice(0, 24)}`;
    items.push({
      id,
      content,
      kind: 'knowledge' as const,
      source: 'tencentdb-memory-knowledge' as const,
      trust: 'untrusted' as const,
      ...(sourceRevision ? { revision: sourceRevision } : {}),
    });
    usedBytes += new TextEncoder().encode(content).byteLength;
  }
  return items;
}

function extractCandidates(value: unknown): unknown[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  const preferred = ['items', 'results', 'links', 'nodes', 'edges', 'communities', 'files'];
  const arrays = preferred.flatMap((key) => Array.isArray(record[key]) ? record[key] as unknown[] : []);
  if (arrays.length > 0) return arrays;
  if ('text' in record && typeof record.text === 'string') return [record.text];
  return [record];
}

function degradedToolList(knowledgeId: string, elapsed: number, errorCode: AgentMemoryKnowledgeErrorCode): AgentMemoryKnowledgeToolList {
  return AgentMemoryKnowledgeToolListSchema.parse({
    schemaVersion: 'ready4vibe_agent_memory_knowledge_tools_v1',
    knowledgeId,
    resourceType: 'wiki',
    name: 'Unavailable knowledge resource',
    summary: null,
    status: 'degraded',
    tools: [],
    sourceRevision: null,
    elapsedMs: elapsed,
    degraded: true,
    errorCode,
  });
}

function degradedResult(request: AgentMemoryKnowledgeCallRequest, elapsed: number, errorCode: AgentMemoryKnowledgeErrorCode, sourceRevision: string | null): AgentMemoryKnowledgeResult {
  return AgentMemoryKnowledgeResultSchema.parse({
    schemaVersion: 'ready4vibe_agent_memory_knowledge_result_v1',
    knowledgeId: request.knowledgeId,
    toolName: request.toolName,
    items: [],
    sourceRevision,
    elapsedMs: elapsed,
    degraded: true,
    errorCode,
  });
}

function parseEndpoint(value: string, allowInsecureHttp: boolean): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('MemoryKnowledge endpoint must be a valid URL.'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (allowInsecureHttp || loopback))) throw new Error('MemoryKnowledge endpoint requires HTTPS unless insecure loopback HTTP is explicit.');
  if (url.username || url.password) throw new Error('MemoryKnowledge endpoint must not contain credentials.');
  if (url.search || url.hash) throw new Error('MemoryKnowledge endpoint must not contain query parameters or fragments.');
  return url.toString().replace(/\/$/u, '');
}

function boundedPositive(value: number | undefined, fallback: number, max: number, field: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0 || result > max) throw new Error(`MemoryKnowledge ${field} must be between 1 and ${max}.`);
  return result;
}

async function readResponseText(response: Response, maxBytes: number, signal: AbortSignal, timedOut: () => boolean, aborted: () => boolean): Promise<string> {
  if (!response.body) {
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new MemoryKnowledgeProviderError('too-large');
    return raw;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let value = '';
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new MemoryKnowledgeProviderError('too-large');
      value += decoder.decode(next.value, { stream: true });
    }
    value += decoder.decode();
    if (aborted()) throw new MemoryKnowledgeProviderError('aborted');
    if (timedOut() || signal.aborted) throw new MemoryKnowledgeProviderError('timeout');
    return value;
  } catch (error) {
    if (error instanceof MemoryKnowledgeProviderError) throw error;
    if (aborted()) throw new MemoryKnowledgeProviderError('aborted');
    if (timedOut() || signal.aborted) throw new MemoryKnowledgeProviderError('timeout');
    throw new MemoryKnowledgeProviderError('protocol');
  } finally {
    reader.releaseLock();
  }
}

function readRevision(value: unknown): string | null {
  return typeof value === 'string' && REVISION.test(value) ? value : null;
}

function elapsedMs(startedAt: number): number {
  return Math.min(60_000, Math.max(0, Date.now() - startedAt));
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(encoded.slice(0, maxBytes));
}

function errorCode(error: unknown): AgentMemoryKnowledgeErrorCode {
  return error instanceof MemoryKnowledgeProviderError ? error.code : 'protocol';
}

function toAgentMemoryErrorCode(code: AgentMemoryKnowledgeErrorCode): AgentMemoryErrorCode {
  if (code === 'timeout') return 'timeout';
  if (code === 'schema') return 'schema';
  if (code === 'too-large' || code === 'protocol' || code === 'privacy' || code === 'aborted') return 'protocol';
  if (code === 'forbidden') return 'unavailable';
  return 'unavailable';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
