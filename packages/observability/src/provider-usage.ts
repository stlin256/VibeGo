import { createHash } from 'node:crypto';
import {
  ModelUsageRecordSchema,
  ProviderCapabilitySnapshotSchema,
  ProviderDescriptorSchema,
  ProviderUsageObservationSchema,
  type ModelUsageRecord,
  type ProviderCapabilitySnapshot,
  type ProviderDescriptor,
} from '@ready4vibe/contracts';

const TOKEN_DIMENSIONS = [
  'input', 'output', 'cachedInput', 'cacheCreation', 'reasoning', 'toolInput', 'toolOutput',
  'audioInput', 'audioOutput', 'acceptedPrediction', 'rejectedPrediction',
] as const;
type TokenDimension = typeof TOKEN_DIMENSIONS[number];
type UsageSource = NonNullable<ModelUsageRecord['dataSource']>;

const USAGE_SOURCE_PRIORITY: Record<UsageSource, number> = {
  reconciled: 0,
  'provider-usage': 1,
  'session-import': 2,
  'run-event': 3,
};

/**
 * A small in-memory registry for bounded provider metadata. It deliberately
 * has no transport, secret-store, model execution, or persistence concerns.
 */
export class ProviderRegistry {
  private readonly descriptors = new Map<string, ProviderDescriptor>();

  register(input: unknown): ProviderDescriptor {
    const parsed = ProviderDescriptorSchema.parse(input);
    const stored = deepFreeze(clone(parsed));
    this.descriptors.set(stored.providerId, stored);
    return clone(stored);
  }

  get(providerId: string): ProviderDescriptor | undefined {
    const stored = this.descriptors.get(providerId);
    return stored ? deepFreeze(clone(stored)) : undefined;
  }

  has(providerId: string): boolean {
    return this.descriptors.has(providerId);
  }

  list(): readonly ProviderDescriptor[] {
    return Object.freeze([...this.descriptors.values()]
      .sort((left, right) => left.providerId.localeCompare(right.providerId))
      .map((descriptor) => deepFreeze(clone(descriptor))));
  }

  /**
   * Captures the capability fields for a run. Later registrations cannot
   * mutate this object, so provider changes affect only future snapshots.
   */
  snapshot(providerId: string, capturedAt: string, descriptorRevision: string): ProviderCapabilitySnapshot {
    const descriptor = this.descriptors.get(providerId);
    if (!descriptor) throw new Error(`unknown provider: ${providerId}`);
    const snapshot = ProviderCapabilitySnapshotSchema.parse({
      schemaVersion: 'ready4vibe_provider_capability_snapshot_v1',
      providerId: descriptor.providerId,
      capturedAt,
      descriptorRevision,
      capabilities: { ...descriptor.capabilities },
    });
    return deepFreeze(clone(snapshot));
  }
}

export class ProviderUsageConflictError extends Error {
  readonly code = 'PROVIDER_USAGE_CONFLICT';

  constructor(readonly conflictKey: string, message = 'Provider usage facts conflict and cannot be reconciled.') {
    super(message);
    this.name = 'ProviderUsageConflictError';
  }
}

export interface ProviderUsageReconciliationResult {
  readonly records: readonly ModelUsageRecord[];
  readonly duplicateUsageIds: readonly string[];
}

/**
 * Converts an already bounded provider observation into the single usage
 * record contract used by the observability ledger. Raw provider responses
 * are intentionally not accepted by this function or retained in its output.
 */
export function normalizeProviderUsageObservation(input: unknown): ModelUsageRecord {
  const observation = ProviderUsageObservationSchema.parse(input);
  const record = ModelUsageRecordSchema.parse({
    schemaVersion: 'ready4vibe_model_usage_v1',
    usageId: observation.usageId,
    runId: observation.runId,
    turnId: observation.turnId,
    requestId: observation.requestId,
    providerId: observation.providerId,
    model: observation.model,
    requestModel: observation.requestModel,
    pricingModel: observation.pricingModel,
    attempt: observation.attempt,
    startedAt: observation.startedAt,
    ...(observation.completedAt === undefined ? {} : { completedAt: observation.completedAt }),
    ...(observation.latencyMs === undefined ? {} : { latencyMs: observation.latencyMs }),
    ...(observation.timeToFirstByteMs === undefined ? {} : { timeToFirstByteMs: observation.timeToFirstByteMs }),
    status: observation.status,
    tokens: { ...observation.tokens },
    tokenAccuracy: observation.tokenAccuracy,
    inputTokenSemantics: observation.inputTokenSemantics,
    dataSource: observation.dataSource,
    ...(observation.reconciledFrom === undefined ? {} : { reconciledFrom: [...observation.reconciledFrom] }),
    ...(observation.sourceRevision === undefined ? {} : { sourceRevision: observation.sourceRevision }),
  });
  return deepFreeze(clone(record));
}

/**
 * Deduplicates and reconciles bounded usage records before they enter the
 * existing observability ledger. It never guesses when two sources report
 * different token, status, or identity facts.
 */
export function reconcileProviderUsageRecords(input: readonly unknown[]): ProviderUsageReconciliationResult {
  if (input.length > 4_096) throw new ProviderUsageConflictError('batch', 'Provider usage reconciliation batch exceeded its bounded limit.');

  const byUsageId = new Map<string, { record: ModelUsageRecord; fingerprint: string }>();
  const duplicateUsageIds: string[] = [];
  for (const candidate of input) {
    const record = ModelUsageRecordSchema.parse(candidate);
    const fingerprint = fingerprintModelUsageRecord(record);
    const previous = byUsageId.get(record.usageId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ProviderUsageConflictError(record.usageId);
      duplicateUsageIds.push(record.usageId);
      continue;
    }
    byUsageId.set(record.usageId, { record, fingerprint });
  }

  const groups = new Map<string, ModelUsageRecord[]>();
  for (const { record } of byUsageId.values()) {
    const key = semanticKey(record);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }

  const records: ModelUsageRecord[] = [];
  for (const group of groups.values()) {
    records.push(group.length === 1 ? group[0]! : reconcileGroup(group));
  }
  records.sort(compareUsageRecords);
  duplicateUsageIds.sort(compareText);
  return deepFreeze({
    records: records.map((record) => deepFreeze(clone(record))),
    duplicateUsageIds: [...duplicateUsageIds],
  });
}

function reconcileGroup(group: readonly ModelUsageRecord[]): ModelUsageRecord {
  const ordered = [...group].sort((left, right) => {
    const priority = sourcePriority(left) - sourcePriority(right);
    return priority || compareText(left.usageId, right.usageId);
  });
  const primary = ordered[0]!;

  for (const record of ordered.slice(1)) {
    if (record.runId !== primary.runId || record.turnId !== primary.turnId || record.requestId !== primary.requestId || record.attempt !== primary.attempt) {
      throw new ProviderUsageConflictError(semanticKey(primary), 'Provider usage identity facts conflict.');
    }
    if (record.providerId !== primary.providerId || record.model !== primary.model) {
      throw new ProviderUsageConflictError(semanticKey(primary), 'Provider or model identity facts conflict.');
    }
  }

  const tokens: Record<TokenDimension, number | undefined> = {} as Record<TokenDimension, number | undefined>;
  for (const dimension of TOKEN_DIMENSIONS) {
    tokens[dimension] = mergeTokenDimension(ordered, dimension, semanticKey(primary));
  }
  const sourceIds = [...new Set(ordered.flatMap((record) => [record.usageId, ...(record.reconciledFrom ?? [])]))].sort(compareText);
  if (sourceIds.length < 2 || sourceIds.length > 8) {
    throw new ProviderUsageConflictError(semanticKey(primary), 'Reconciliation source references exceeded their bounded limit.');
  }

  const mergedRequestModel = mergeOptionalText(ordered.map((record) => record.requestModel), semanticKey(primary), 'request model');
  const mergedPricingModel = mergeOptionalText(ordered.map((record) => record.pricingModel), semanticKey(primary), 'pricing model');
  const mergedSourceRevision = mergeOptionalText(ordered.map((record) => record.sourceRevision), semanticKey(primary), 'source revision');
  const mergedCost = mergeOptionalCost(ordered, semanticKey(primary));
  const mergedStatus = mergeStatus(ordered, semanticKey(primary));
  const mergedSemantics = mergeInputSemantics(ordered, semanticKey(primary));
  const mergedAccuracy = chooseAccuracy(ordered.map((record) => record.tokenAccuracy));
  const completedAt = ordered.find((record) => record.completedAt !== undefined)?.completedAt;
  const latencyMs = ordered.find((record) => record.latencyMs !== undefined)?.latencyMs;
  const timeToFirstByteMs = ordered.find((record) => record.timeToFirstByteMs !== undefined)?.timeToFirstByteMs;

  const candidate = {
    schemaVersion: 'ready4vibe_model_usage_v1' as const,
    usageId: `reconciled_${sha256(semanticKey(primary)).slice(0, 32)}`,
    runId: primary.runId,
    turnId: primary.turnId,
    requestId: primary.requestId,
    providerId: primary.providerId,
    model: primary.model,
    ...(mergedRequestModel === undefined ? {} : { requestModel: mergedRequestModel }),
    ...(mergedPricingModel === undefined ? {} : { pricingModel: mergedPricingModel }),
    attempt: primary.attempt,
    startedAt: ordered.find((record) => record.startedAt !== undefined)?.startedAt ?? primary.startedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(timeToFirstByteMs === undefined ? {} : { timeToFirstByteMs }),
    status: mergedStatus,
    tokens: Object.fromEntries(TOKEN_DIMENSIONS.filter((dimension) => tokens[dimension] !== undefined).map((dimension) => [dimension, tokens[dimension]])),
    tokenAccuracy: mergedAccuracy,
    inputTokenSemantics: mergedSemantics,
    dataSource: 'reconciled' as const,
    reconciledFrom: sourceIds,
    ...(mergedCost === undefined ? {} : { cost: mergedCost }),
    ...(mergedSourceRevision === undefined ? {} : { sourceRevision: mergedSourceRevision }),
  };
  return ModelUsageRecordSchema.parse(candidate);
}

function mergeTokenDimension(records: readonly ModelUsageRecord[], dimension: TokenDimension, conflictKey: string): number | undefined {
  const values = records.map((record) => record.tokens[dimension]).filter((value): value is number => value !== undefined);
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new ProviderUsageConflictError(conflictKey, `Token dimension ${dimension} conflicts.`);
  return unique[0];
}

function mergeOptionalText(values: readonly (string | undefined)[], conflictKey: string, label: string): string | undefined {
  const unique = [...new Set(values.filter((value): value is string => value !== undefined))];
  if (unique.length > 1) throw new ProviderUsageConflictError(conflictKey, `${label} facts conflict.`);
  return unique[0];
}

function mergeOptionalCost(records: readonly ModelUsageRecord[], conflictKey: string): ModelUsageRecord['cost'] | undefined {
  const values = records.map((record) => record.cost).filter((value): value is NonNullable<ModelUsageRecord['cost']> => value !== undefined);
  const fingerprints = values.map((value) => canonicalJson(value));
  if (new Set(fingerprints).size > 1) throw new ProviderUsageConflictError(conflictKey, 'Cost facts conflict.');
  return values[0];
}

function mergeStatus(records: readonly ModelUsageRecord[], conflictKey: string): ModelUsageRecord['status'] {
  const known = [...new Set(records.map((record) => record.status).filter((status) => status !== 'unknown'))];
  if (known.length > 1) throw new ProviderUsageConflictError(conflictKey, 'Status facts conflict.');
  return known[0] ?? 'unknown';
}

function mergeInputSemantics(records: readonly ModelUsageRecord[], conflictKey: string): NonNullable<ModelUsageRecord['inputTokenSemantics']> {
  const known = [...new Set(records.map((record) => record.inputTokenSemantics).filter((value): value is NonNullable<ModelUsageRecord['inputTokenSemantics']> => value !== undefined && value !== 'unknown'))];
  if (known.length > 1) throw new ProviderUsageConflictError(conflictKey, 'Input token semantics conflict.');
  return known[0] ?? 'unknown';
}

function chooseAccuracy(values: readonly ModelUsageRecord['tokenAccuracy'][]): ModelUsageRecord['tokenAccuracy'] {
  const priority: Record<ModelUsageRecord['tokenAccuracy'], number> = { reported: 0, estimated: 1, unknown: 2 };
  return [...values].sort((left, right) => priority[left] - priority[right])[0]!;
}

function sourcePriority(record: ModelUsageRecord): number {
  return USAGE_SOURCE_PRIORITY[record.dataSource ?? 'run-event'];
}

function semanticKey(record: ModelUsageRecord): string {
  return canonicalJson([record.runId, record.turnId, record.requestId, record.attempt]);
}

function compareUsageRecords(left: ModelUsageRecord, right: ModelUsageRecord): number {
  return compareText(left.startedAt, right.startedAt)
    || compareText(left.runId, right.runId)
    || compareText(left.turnId, right.turnId)
    || compareText(left.requestId, right.requestId)
    || left.attempt - right.attempt
    || compareText(left.usageId, right.usageId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fingerprintModelUsageRecord(record: ModelUsageRecord): string {
  return sha256(canonicalJson(ModelUsageRecordSchema.parse(record)));
}

function canonicalJson(value: unknown): string {
  if (value === undefined) throw new ProviderUsageConflictError('canonical-json', 'Undefined cannot be fingerprinted.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ProviderUsageConflictError('canonical-json', 'Non-finite number cannot be fingerprinted.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => compareText(left, right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new ProviderUsageConflictError('canonical-json', 'Unsupported value cannot be fingerprinted.');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
