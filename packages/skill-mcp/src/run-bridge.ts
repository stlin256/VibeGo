import { createHash } from 'node:crypto';
import type { McpCapabilityDescriptor } from './capability.js';

export type McpExecutionErrorCode =
  | 'MCP_CALL_INVALID'
  | 'MCP_CALL_TOO_LARGE'
  | 'MCP_CALL_REPLAY_CONFLICT'
  | 'MCP_CALL_LIMIT_EXCEEDED'
  | 'MCP_CALL_ABORTED'
  | 'MCP_CALL_TIMEOUT'
  | 'MCP_CALL_UNAVAILABLE';

export class McpExecutionError extends Error {
  constructor(readonly code: McpExecutionErrorCode, message = executionMessage(code)) {
    super(message);
    this.name = 'McpExecutionError';
  }
}

export interface McpToolCallRequest {
  readonly runId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly descriptor: McpCapabilityDescriptor;
  readonly input: unknown;
  readonly signal: AbortSignal;
}

export interface McpToolCallPort {
  call(request: McpToolCallRequest): Promise<unknown>;
  close?(): Promise<void>;
}

export interface McpExecutionLedgerOptions {
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxEntries?: number;
}

interface LedgerEntry {
  readonly fingerprint: string;
  readonly descriptorRevision: string;
  readonly promise: Promise<unknown>;
  result?: unknown;
  error?: McpExecutionError;
}

/**
 * Run-local idempotency boundary for remote MCP calls. It stores only a
 * fingerprint and a bounded, privacy-sanitised result; it is not a durable
 * event store and is intentionally discarded when a run ends.
 */
export class McpExecutionLedger {
  private readonly entries = new Map<string, LedgerEntry>();
  private readonly maxInputBytes: number;
  private readonly maxOutputBytes: number;
  private readonly maxEntries: number;

  constructor(options: McpExecutionLedgerOptions = {}) {
    this.maxInputBytes = positiveLimit(options.maxInputBytes, 64 * 1024);
    this.maxOutputBytes = positiveLimit(options.maxOutputBytes, 128 * 1024);
    this.maxEntries = positiveLimit(options.maxEntries, 512);
  }

  execute(request: McpToolCallRequest, invoke: (request: McpToolCallRequest) => Promise<unknown>): Promise<unknown> {
    try {
      validateRequest(request, this.maxInputBytes);
    } catch (error) {
      return Promise.reject(normalizeExecutionError(error));
    }
    const identity = `${request.runId}\u0000${request.turnId}\u0000${request.callId}`;
    const fingerprint = fingerprintFor(request);
    const existing = this.entries.get(identity);
    if (existing) {
      if (existing.fingerprint !== fingerprint || existing.descriptorRevision !== request.descriptor.revision) {
        return Promise.reject(new McpExecutionError('MCP_CALL_REPLAY_CONFLICT'));
      }
      if (existing.error) return Promise.reject(existing.error);
      if (existing.result !== undefined) return Promise.resolve(existing.result);
      return existing.promise;
    }
    if (this.entries.size >= this.maxEntries) return Promise.reject(new McpExecutionError('MCP_CALL_LIMIT_EXCEEDED'));

    let entry!: LedgerEntry;
    const promise = Promise.resolve()
      .then(() => invoke(request))
      .then((value) => {
        const sanitized = sanitizeOutput(value, this.maxOutputBytes);
        entry.result = sanitized;
        return sanitized;
      })
      .catch((error: unknown) => {
        const normalized = normalizeExecutionError(error);
        entry.error = normalized;
        throw normalized;
      });
    entry = { fingerprint, descriptorRevision: request.descriptor.revision, promise };
    this.entries.set(identity, entry);
    return promise;
  }

  size(): number {
    return this.entries.size;
  }
}

export interface McpProtocolRequestSession {
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  close?(): Promise<void>;
}

/** Adapter from the verified protocol session to the run-scoped call port. */
export class McpProtocolToolCallPort implements McpToolCallPort {
  constructor(private readonly session: McpProtocolRequestSession) {}

  async call(request: McpToolCallRequest): Promise<unknown> {
    validateDescriptor(request.descriptor);
    if (request.signal.aborted) throw new McpExecutionError('MCP_CALL_ABORTED');
    try {
      return await this.session.request('tools/call', {
        name: request.descriptor.id,
        arguments: request.input,
      }, request.signal);
    } catch (error) {
      throw normalizeExecutionError(error, request.signal);
    }
  }

  async close(): Promise<void> {
    await this.session.close?.();
  }
}

export function descriptorToMcpToolReference(descriptor: McpCapabilityDescriptor): string {
  validateDescriptor(descriptor);
  return `${descriptor.serverId}/tool/${descriptor.id}@${descriptor.revision}`;
}

function validateRequest(request: McpToolCallRequest, maxInputBytes: number): void {
  if (!isBoundedId(request.runId) || !isBoundedId(request.turnId) || !isBoundedId(request.callId)) {
    throw new McpExecutionError('MCP_CALL_INVALID');
  }
  validateDescriptor(request.descriptor);
  if (request.signal.aborted) throw new McpExecutionError('MCP_CALL_ABORTED');
  try {
    const encoded = canonicalJson(request.input);
    if (Buffer.byteLength(encoded, 'utf8') > maxInputBytes) throw new McpExecutionError('MCP_CALL_TOO_LARGE');
    assertSafeInput(request.input);
  } catch (error) {
    if (error instanceof McpExecutionError) throw error;
    throw new McpExecutionError('MCP_CALL_INVALID');
  }
}

function validateDescriptor(descriptor: McpCapabilityDescriptor): void {
  if (descriptor.kind !== 'tool' || descriptor.executable !== true || !isBoundedId(descriptor.serverId) || !isBoundedId(descriptor.id) || !isVersion(descriptor.version) || !isVersion(descriptor.revision)) {
    throw new McpExecutionError('MCP_CALL_INVALID');
  }
}

function fingerprintFor(request: McpToolCallRequest): string {
  const canonical = canonicalJson({
    serverId: request.descriptor.serverId,
    toolId: request.descriptor.id,
    toolVersion: request.descriptor.version,
    revision: request.descriptor.revision,
    input: request.input,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function sanitizeOutput(value: unknown, maxBytes: number): unknown {
  const sanitized = sanitizeValue(value, 0);
  const encoded = canonicalJson(sanitized === DROP ? null : sanitized);
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new McpExecutionError('MCP_CALL_TOO_LARGE');
  return deepFreeze(sanitized === DROP ? null : sanitized);
}

const DROP = Symbol('drop');
const SECRET_KEY = /(?:^|[_-])(api[_-]?key|access[_-]?token|token|password|secret|private[_-]?key)(?:$|[_-])/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const POSIX_ABSOLUTE_PATH = /^\/(?:[A-Za-z0-9._-]+[\\/]|$)/u;
const CONTROL = /[\u0000-\u001F\u007F]/u;

function sanitizeValue(value: unknown, depth: number, key?: string): unknown {
  if (depth > 8) return DROP;
  if (key && SECRET_KEY.test(key)) return DROP;
  if (typeof value === 'string') {
    if (CONTROL.test(value) || SECRET_VALUE.test(value) || WINDOWS_ABSOLUTE_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value)) return DROP;
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : DROP;
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    for (const item of value.slice(0, 256)) {
      const next = sanitizeValue(item, depth + 1);
      if (next !== DROP) output.push(next);
    }
    return output;
  }
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 256)) {
      if (CONTROL.test(childKey) || SECRET_KEY.test(childKey)) continue;
      const next = sanitizeValue(childValue, depth + 1, childKey);
      if (next !== DROP) output[childKey] = next;
    }
    return output;
  }
  return DROP;
}

function assertSafeInput(value: unknown, depth = 0): void {
  if (depth > 8) throw new McpExecutionError('MCP_CALL_INVALID');
  if (typeof value === 'string') {
    if (CONTROL.test(value)) throw new McpExecutionError('MCP_CALL_INVALID');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertSafeInput(item, depth + 1));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (CONTROL.test(key) || SECRET_KEY.test(key)) throw new McpExecutionError('MCP_CALL_INVALID');
      assertSafeInput(child, depth + 1);
    }
  }
}

function normalizeExecutionError(error: unknown, signal?: AbortSignal): McpExecutionError {
  if (error instanceof McpExecutionError) return error;
  if (signal?.aborted || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'MCP_ABORTED')) return new McpExecutionError('MCP_CALL_ABORTED');
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code);
    if (code === 'MCP_TIMEOUT') return new McpExecutionError('MCP_CALL_TIMEOUT');
    if (code === 'MCP_MESSAGE_TOO_LARGE') return new McpExecutionError('MCP_CALL_TOO_LARGE');
  }
  return new McpExecutionError('MCP_CALL_UNAVAILABLE');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('non-json value');
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new McpExecutionError('MCP_CALL_INVALID');
  return value;
}

function executionMessage(code: McpExecutionErrorCode): string {
  const messages: Record<McpExecutionErrorCode, string> = {
    MCP_CALL_INVALID: 'The MCP call is invalid.',
    MCP_CALL_TOO_LARGE: 'The MCP call exceeded its byte limit.',
    MCP_CALL_REPLAY_CONFLICT: 'The MCP call replay does not match the original request.',
    MCP_CALL_LIMIT_EXCEEDED: 'The MCP call ledger is full.',
    MCP_CALL_ABORTED: 'The MCP call was cancelled.',
    MCP_CALL_TIMEOUT: 'The MCP call timed out.',
    MCP_CALL_UNAVAILABLE: 'The MCP call is unavailable.',
  };
  return messages[code];
}
