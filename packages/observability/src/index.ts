import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AuditEventSchema,
  ModelUsageRecordSchema,
  ResourceSampleSchema,
  ToolUsageRecordSchema,
  UsageRollupSchema,
  UsageProjectionSchema,
  type AuditEvent,
  type ModelUsageRecord,
  type ResourceSample,
  type StoredEvent,
  type ToolUsageRecord,
  type UsageRollup,
  type UsageProjection,
} from '@ready4vibe/contracts';

const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

type EventRecord = StoredEvent<unknown>;
export type AuditEventDraft = Omit<AuditEvent, 'appendSequence' | 'previousHash' | 'eventHash'>;

interface TurnState {
  readonly turnId: string;
  startedAt: string;
  requestCount: number;
  model: string;
  usageInput?: number;
  usageOutput?: number;
  usageCachedInput?: number;
  usageReasoning?: number;
  usageSeen: boolean;
  status: ModelUsageRecord['status'];
  completedAt?: string;
  requestId?: string;
}

export class UsageProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageProjectionError';
  }
}

/**
 * Canonical JSON for hashes and deterministic projections. Undefined values
 * are rejected instead of silently disappearing, which keeps fingerprints
 * stable across runtimes and prevents accidental secret/path redaction drift.
 */
export function canonicalObservabilityJson(value: unknown): string {
  if (value === undefined) throw new UsageProjectionError('undefined is not canonical JSON');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new UsageProjectionError('value is not canonical JSON');
    return encoded;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new UsageProjectionError('non-finite number is not canonical JSON');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalObservabilityJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalObservabilityJson(entry)}`).join(',')}}`;
  }
  throw new UsageProjectionError('unsupported value is not canonical JSON');
}

export function fingerprintUsageRecord(record: ModelUsageRecord): string {
  const parsed = ModelUsageRecordSchema.parse(record);
  return sha256(canonicalObservabilityJson(parsed));
}

export function fingerprintResourceSample(sample: ResourceSample): string {
  return sha256(canonicalObservabilityJson(ResourceSampleSchema.parse(sample)));
}

export function fingerprintToolUsageRecord(record: ToolUsageRecord): string {
  return sha256(canonicalObservabilityJson(ToolUsageRecordSchema.parse(record)));
}

/** Hashes the event content excluding eventHash, which is the value derived from it. */
export function fingerprintAuditEvent(event: AuditEvent): string {
  const parsed = AuditEventSchema.parse(event);
  const { eventHash: _eventHash, ...content } = parsed;
  return sha256(canonicalObservabilityJson(content));
}

/** Fingerprint only user/application supplied audit content for eventId idempotency. */
export function fingerprintAuditContent(event: AuditEvent | AuditEventDraft): string {
  const { appendSequence: _appendSequence, previousHash: _previousHash, eventHash: _eventHash, ...content } = event as AuditEvent;
  return sha256(canonicalObservabilityJson(content));
}

const ZERO_HASH = '0'.repeat(64);

/** Assigns the sequence/hash fields after validating a bounded audit draft. */
export function sealAuditEvent(draft: AuditEventDraft, appendSequence: number, previousHash: string | null): AuditEvent {
  const candidate = AuditEventSchema.parse({ ...draft, appendSequence, previousHash, eventHash: ZERO_HASH });
  return { ...candidate, eventHash: fingerprintAuditEvent(candidate) };
}

export function verifyAuditChain(events: readonly AuditEvent[]): boolean {
  try {
    let previousHash: string | null = null;
    let previousSequence = 0;
    for (const candidate of events) {
      const event = AuditEventSchema.parse(candidate);
      if (event.appendSequence !== previousSequence + 1) return false;
      if (event.previousHash !== previousHash) return false;
      if (event.eventHash !== fingerprintAuditEvent(event)) return false;
      previousHash = event.eventHash;
      previousSequence = event.appendSequence;
    }
    return true;
  } catch {
    return false;
  }
}

/** Rebuilds deterministic UTC-hour rollups without reading a store or running probes. */
export function buildUsageRollups(
  records: readonly ModelUsageRecord[],
  samples: readonly ResourceSample[],
  audits: readonly AuditEvent[],
): readonly UsageRollup[] {
  if (records.length + samples.length + audits.length > 100_000) throw new UsageProjectionError('rollup input exceeded bounded limit');
  const buckets = new Map<string, { records: ModelUsageRecord[]; samples: ResourceSample[]; audits: AuditEvent[] }>();
  const bucket = (timestamp: string) => {
    const milliseconds = Date.parse(timestamp);
    if (!Number.isFinite(milliseconds)) throw new UsageProjectionError('rollup timestamp is invalid');
    const start = new Date(Math.floor(milliseconds / 3_600_000) * 3_600_000).toISOString();
    const existing = buckets.get(start) ?? { records: [], samples: [], audits: [] };
    buckets.set(start, existing);
    return existing;
  };
  for (const record of records) bucket(record.startedAt).records.push(ModelUsageRecordSchema.parse(record));
  for (const sample of samples) bucket(sample.sampledAt).samples.push(ResourceSampleSchema.parse(sample));
  for (const audit of audits) bucket(audit.at).audits.push(AuditEventSchema.parse(audit));

  const result: UsageRollup[] = [];
  for (const [periodStart, source] of [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const periodEnd = new Date(Date.parse(periodStart) + 3_600_000).toISOString();
    const rollup: UsageRollup = {
      schemaVersion: 'ready4vibe_usage_rollup_v1',
      rollupId: derivedId('rollup', periodStart),
      period: 'hour',
      periodStart,
      periodEnd,
      modelAttempts: source.records.length,
      modelRequests: new Set(source.records.map((record) => record.requestId)).size,
      input: summarize(source.records, 'input'),
      output: summarize(source.records, 'output'),
      cachedInput: summarize(source.records, 'cachedInput'),
      reasoning: summarize(source.records, 'reasoning'),
      sampleCount: source.samples.length,
      droppedSampleCount: sumBounded(source.samples.map((sample) => sample.droppedSampleCount)),
      auditEventCount: source.audits.length,
      sourceChecksum: sha256(canonicalObservabilityJson({
        records: source.records.map((record) => [record.usageId, fingerprintUsageRecord(record)]).sort(),
        samples: source.samples.map((sample) => [sample.sampleId, fingerprintResourceSample(sample)]).sort(),
        audits: source.audits.map((audit) => [audit.eventId, fingerprintAuditEvent(audit)]).sort(),
      })),
    };
    result.push(UsageRollupSchema.parse(rollup));
  }
  return Object.freeze(result);
}

/**
 * Replays only bounded model metadata from run_events. It intentionally does
 * not copy arbitrary payloads into the projection: prompts, tool output,
 * commands, paths and credentials therefore cannot leak through this read
 * model. Duplicate delivery of the same stored event id is a no-op; a reused
 * id with different content fails closed.
 */
export function replayModelUsage(events: readonly StoredEvent[]): UsageProjection {
  const unique = normalizeEvents(events);
  const runId = unique[0]?.runId;
  if (!runId) throw new UsageProjectionError('at least one event is required');

  let providerId = 'unknown';
  let defaultModel = 'unknown-model';
  const turns = new Map<string, TurnState>();
  let terminalAt: string | undefined;
  let terminalStatus: ModelUsageRecord['status'] | undefined;

  for (const event of unique) {
    const payload = asRecord(event.payload);
    switch (event.type) {
      case 'run.created': {
        const config = asRecord(payload?.config);
        const model = asRecord(config?.model);
        providerId = safeLabel(model?.provider, 'unknown');
        defaultModel = safeLabel(model?.name, 'unknown-model');
        break;
      }
      case 'turn.started': {
        const turnId = safeId(payload?.turnId);
        if (!turnId) break;
        const existing = turns.get(turnId);
        if (!existing) {
          turns.set(turnId, {
            turnId,
            startedAt: event.at,
            requestCount: 0,
            model: defaultModel,
            usageSeen: false,
            status: 'unknown',
          });
        }
        break;
      }
      case 'model.requested': {
        const state = getTurn(turns, payload?.turnId, event.at, defaultModel);
        state.requestCount += 1;
        state.model = safeLabel(payload?.model, state.model);
        const requestId = safeId(payload?.requestId) ?? safeId(asRecord(payload?.metadata)?.requestId);
        if (requestId) state.requestId = requestId;
        break;
      }
      case 'model.usage': {
        const state = getTurn(turns, payload?.turnId, event.at, defaultModel);
        state.usageSeen = true;
        const input = readCounter(payload?.inputTokens);
        const output = readCounter(payload?.outputTokens);
        const cachedInput = readCounter(payload?.cachedInputTokens);
        const reasoning = readCounter(payload?.reasoningTokens);
        if (input !== undefined) state.usageInput = addCounter(state.usageInput, input);
        if (output !== undefined) state.usageOutput = addCounter(state.usageOutput, output);
        if (cachedInput !== undefined) state.usageCachedInput = addCounter(state.usageCachedInput, cachedInput);
        if (reasoning !== undefined) state.usageReasoning = addCounter(state.usageReasoning, reasoning);
        break;
      }
      case 'model.completed': {
        const state = getTurn(turns, payload?.turnId, event.at, defaultModel);
        state.status = 'completed';
        state.completedAt = event.at;
        break;
      }
      case 'model.error': {
        const state = getTurn(turns, payload?.turnId, event.at, defaultModel);
        state.status = 'failed';
        state.completedAt = event.at;
        break;
      }
      case 'run.failed':
        terminalAt = event.at;
        terminalStatus = 'failed';
        break;
      case 'run.cancelled':
        terminalAt = event.at;
        terminalStatus = 'cancelled';
        break;
      case 'run.needs_recovery':
        terminalAt = event.at;
        terminalStatus = 'unknown';
        break;
      default:
        break;
    }
  }

  const records: ModelUsageRecord[] = [];
  for (const state of [...turns.values()].sort((left, right) => left.turnId.localeCompare(right.turnId))) {
    if (!state.usageSeen) continue;
    const attempt = Math.max(1, state.requestCount);
    const completedAt = state.completedAt ?? terminalAt;
    const status = state.status === 'unknown' ? (terminalStatus ?? 'unknown') : state.status;
    const tokens = {
      ...(state.usageInput === undefined ? {} : { input: state.usageInput }),
      ...(state.usageOutput === undefined ? {} : { output: state.usageOutput }),
      ...(state.usageCachedInput === undefined ? {} : { cachedInput: state.usageCachedInput }),
      ...(state.usageReasoning === undefined ? {} : { reasoning: state.usageReasoning }),
    };
    const record: ModelUsageRecord = {
      schemaVersion: 'ready4vibe_model_usage_v1',
      usageId: derivedId('usage', runId, state.turnId, String(attempt)),
      runId,
      turnId: state.turnId,
      requestId: state.requestId ?? derivedId('request', runId, state.turnId, String(attempt)),
      providerId,
      model: state.model,
      requestModel: state.model,
      pricingModel: state.model,
      attempt,
      startedAt: state.startedAt,
      ...(completedAt ? { completedAt } : {}),
      ...(completedAt ? { latencyMs: elapsedMs(state.startedAt, completedAt) } : {}),
      status,
      tokens,
      tokenAccuracy: Object.keys(tokens).length > 0 ? 'reported' : 'unknown',
      inputTokenSemantics: 'unknown',
      dataSource: 'run-event',
    };
    records.push(ModelUsageRecordSchema.parse(record));
  }

  const projection: UsageProjection = {
    schemaVersion: 'ready4vibe_usage_projection_v1',
    runId,
    records,
    totals: {
      input: summarize(records, 'input'),
      output: summarize(records, 'output'),
      cachedInput: summarize(records, 'cachedInput'),
      reasoning: summarize(records, 'reasoning'),
    },
    sourceEventCount: unique.length,
    sourceChecksum: sha256(canonicalObservabilityJson(unique.map((event) => ({
      id: event.id,
      seq: event.seq,
      runId: event.runId,
      type: event.type,
      source: event.source,
      correlationId: event.correlationId,
      at: event.at,
    })))),
  };
  return UsageProjectionSchema.parse(projection);
}

function normalizeEvents(events: readonly StoredEvent[]): EventRecord[] {
  if (events.length === 0) throw new UsageProjectionError('at least one event is required');
  const byId = new Map<string, { fingerprint: string; event: EventRecord }>();
  let runId: string | undefined;
  for (const candidate of events) {
    const event = candidate as EventRecord;
    if (!safeId(event.runId)) throw new UsageProjectionError('event runId must be a bounded id');
    if (!runId) runId = event.runId;
    if (event.runId !== runId) throw new UsageProjectionError('all usage events must belong to the same run');
    if (!safeId(event.id) || !Number.isSafeInteger(event.seq) || event.seq < 1 || typeof event.type !== 'string' || !safeLabel(event.type, '')) {
      throw new UsageProjectionError('event metadata failed the bounded contract');
    }
    if (!ISO_TIMESTAMP.safeParse(event.at).success) throw new UsageProjectionError('event timestamp failed the contract');
    const fingerprint = sha256(canonicalObservabilityJson({
      runId: event.runId, type: event.type, source: event.source, correlationId: event.correlationId,
      payload: event.payload, at: event.at, seq: event.seq,
    }));
    const previous = byId.get(event.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new UsageProjectionError(`event id conflict: ${event.id}`);
      continue;
    }
    byId.set(event.id, { fingerprint, event });
  }
  return [...byId.values()].map(({ event }) => event).sort((left, right) => left.seq - right.seq || left.id.localeCompare(right.id));
}

function getTurn(turns: Map<string, TurnState>, value: unknown, at: string, defaultModel: string): TurnState {
  const turnId = safeId(value) ?? derivedId('turn', at);
  const existing = turns.get(turnId);
  if (existing) return existing;
  const state: TurnState = { turnId, startedAt: at, requestCount: 0, model: defaultModel, usageSeen: false, status: 'unknown' };
  turns.set(turnId, state);
  return state;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_ID.test(value) && !SECRET_VALUE.test(value) && !WINDOWS_ABSOLUTE.test(value) && !UNC_ABSOLUTE.test(value) && !POSIX_ABSOLUTE.test(value) ? value : undefined;
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !SAFE_LABEL.test(value) || SECRET_VALUE.test(value) || WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) return fallback;
  return value;
}

function readCounter(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000 ? value : undefined;
}

function addCounter(current: number | undefined, next: number): number {
  const total = (current ?? 0) + next;
  if (!Number.isSafeInteger(total) || total > 1_000_000_000_000) throw new UsageProjectionError('usage counter exceeded bounded limit');
  return total;
}

function elapsedMs(startedAt: string, completedAt: string): number | undefined {
  const value = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000 ? value : undefined;
}

function summarize(records: readonly ModelUsageRecord[], key: 'input' | 'output' | 'cachedInput' | 'reasoning') {
  let total = 0;
  let knownRecords = 0;
  for (const record of records) {
    const value = record.tokens[key];
    if (value === undefined) continue;
    total = total + value;
    if (!Number.isSafeInteger(total) || total > 1_000_000_000_000) throw new UsageProjectionError('usage summary exceeded bounded limit');
    knownRecords += 1;
  }
  return { total: knownRecords > 0 ? total : null, knownRecords, unknownRecords: records.length - knownRecords };
}

function sumBounded(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total) || total > 1_000_000_000_000) throw new UsageProjectionError('rollup counter exceeded bounded limit');
  }
  return total;
}

function derivedId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${sha256(parts.join('\u0000')).slice(0, 32)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export * from './provider-usage.js';
export * from './pricing.js';
export * from './resource-collector.js';
export * from './audit-adapter.js';
export * from './api.js';
