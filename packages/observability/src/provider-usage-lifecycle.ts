import {
  findProviderUsagePrivacyViolations,
  ModelUsageRecordSchema,
  type ModelUsageRecord,
} from '@ready4vibe/contracts';
import {
  calculateModelUsageCost,
  PricingCatalog,
  type PricingCalculationOptions,
} from './pricing.js';
import {
  normalizeProviderUsageObservation,
  ProviderUsageConflictError,
  reconcileProviderUsageRecords,
} from './provider-usage.js';
import { canonicalObservabilityJson, fingerprintUsageRecord } from './index.js';

const MAX_INPUT_BYTES = 512 * 1024;

export interface ProviderUsageLifecycleWriter {
  readonly appendBatch: (batch: { readonly modelUsages?: readonly ModelUsageRecord[] }) => Promise<unknown>;
}

export interface ProviderUsageLifecycleAdapterOptions {
  readonly writer: ProviderUsageLifecycleWriter;
  readonly pricingCatalog?: PricingCatalog;
  readonly pricingRevision?: string;
  readonly pricingAt?: (record: ModelUsageRecord) => string;
}

export type ProviderUsageLifecycleResultStatus = 'recorded' | 'noop' | 'conflict' | 'rejected' | 'degraded';

export interface ProviderUsageLifecycleResult {
  readonly status: ProviderUsageLifecycleResultStatus;
  readonly records: readonly ModelUsageRecord[];
  readonly duplicateUsageIds: readonly string[];
  readonly unknownDimensions: readonly string[];
  readonly errorCode?:
    | 'OBSERVABILITY_USAGE_PRIVACY'
    | 'OBSERVABILITY_USAGE_INVALID'
    | 'OBSERVABILITY_USAGE_CONFLICT'
    | 'OBSERVABILITY_USAGE_WRITE_FAILED';
}

/**
 * Application boundary for provider usage. It accepts only the public,
 * bounded ProviderUsageObservation shape; raw provider responses are never a
 * parameter and never survive normalization. The adapter is deliberately
 * transport-free and may be used by a future RunManager observer.
 */
export class ProviderUsageLifecycleAdapter {
  private readonly writer: ProviderUsageLifecycleWriter;
  private readonly pricingCatalog: PricingCatalog;
  private readonly pricingRevision: string | undefined;
  private readonly pricingAt: (record: ModelUsageRecord) => string;
  private readonly recorded = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<ProviderUsageLifecycleResult>>();
  private readonly inFlightUsage = new Map<string, { readonly fingerprint: string; readonly promise: Promise<ProviderUsageLifecycleResult> }>();

  constructor(options: ProviderUsageLifecycleAdapterOptions) {
    this.writer = options.writer;
    this.pricingCatalog = options.pricingCatalog ?? new PricingCatalog();
    this.pricingRevision = options.pricingRevision;
    this.pricingAt = options.pricingAt ?? ((record) => record.startedAt);
  }

  record(input: unknown): Promise<ProviderUsageLifecycleResult> {
    return this.recordBatch([input]);
  }

  /**
   * Normalizes, reconciles and prices a bounded batch before one writer call.
   * Same usage ids/payloads are no-ops; changed facts are conflicts. A writer
   * failure leaves the idempotency map untouched so a later call can retry the
   * ledger append without re-running a provider request.
   */
  async recordBatch(inputs: readonly unknown[]): Promise<ProviderUsageLifecycleResult> {
    const normalized = normalizeBatch(inputs);
    if (!normalized.ok) return normalized.result;

    let reconciled: ReturnType<typeof reconcileProviderUsageRecords>;
    try {
      reconciled = reconcileProviderUsageRecords(normalized.records);
    } catch (error) {
      return {
        status: error instanceof ProviderUsageConflictError ? 'conflict' : 'rejected',
        records: [],
        duplicateUsageIds: [],
        unknownDimensions: [],
        errorCode: error instanceof ProviderUsageConflictError ? 'OBSERVABILITY_USAGE_CONFLICT' : 'OBSERVABILITY_USAGE_INVALID',
      };
    }

    const unknownDimensions = new Set<string>();
    const pricedRecords: ModelUsageRecord[] = [];
    try {
      for (const record of reconciled.records) {
        const options: PricingCalculationOptions = {
          ...(this.pricingRevision === undefined ? {} : { pricingRevision: this.pricingRevision }),
          at: this.pricingAt(record),
        };
        const projection = calculateModelUsageCost(record, this.pricingCatalog, options);
        for (const dimension of projection.unknownDimensions) unknownDimensions.add(`${record.usageId}:${dimension}`);
        const priced = projection.cost === undefined
          ? record
          : withAccuracy(ModelUsageRecordSchema.parse({ ...record, cost: projection.cost }), record.tokenAccuracy);
        pricedRecords.push(ModelUsageRecordSchema.parse(priced));
      }
    } catch {
      return {
        status: 'rejected',
        records: [],
        duplicateUsageIds: reconciled.duplicateUsageIds,
        unknownDimensions: [...unknownDimensions].sort(compareText),
        errorCode: 'OBSERVABILITY_USAGE_INVALID',
      };
    }

    const pending: ModelUsageRecord[] = [];
    const activePromises: Promise<ProviderUsageLifecycleResult>[] = [];
    for (const record of pricedRecords) {
      const fingerprint = fingerprintUsageRecord(record);
      const existing = this.recorded.get(record.usageId);
      if (existing !== undefined) {
        if (existing !== fingerprint) return conflictResult(pricedRecords, reconciled.duplicateUsageIds, unknownDimensions);
        continue;
      }
      const active = this.inFlightUsage.get(record.usageId);
      if (active) {
        if (active.fingerprint !== fingerprint) return conflictResult(pricedRecords, reconciled.duplicateUsageIds, unknownDimensions);
        activePromises.push(active.promise);
        continue;
      }
      pending.push(record);
    }

    if (pending.length === 0) {
      for (const active of activePromises) {
        const activeResult = await active;
        if (activeResult.status === 'degraded' || activeResult.status === 'conflict' || activeResult.status === 'rejected') return activeResult;
      }
      return {
        status: 'noop',
        records: pricedRecords,
        duplicateUsageIds: reconciled.duplicateUsageIds,
        unknownDimensions: [...unknownDimensions].sort(compareText),
      };
    }

    const key = batchKey(pending);
    const batchInFlight = this.inFlight.get(key);
    if (batchInFlight) return batchInFlight;
    const pendingResult = this.appendPending(pending, pricedRecords, reconciled.duplicateUsageIds, [...unknownDimensions].sort(compareText));
    this.inFlight.set(key, pendingResult);
    for (const record of pending) this.inFlightUsage.set(record.usageId, { fingerprint: fingerprintUsageRecord(record), promise: pendingResult });
    try {
      return await pendingResult;
    } finally {
      if (this.inFlight.get(key) === pendingResult) this.inFlight.delete(key);
      for (const record of pending) {
        if (this.inFlightUsage.get(record.usageId)?.promise === pendingResult) this.inFlightUsage.delete(record.usageId);
      }
    }
  }

  private async appendPending(
    pending: readonly ModelUsageRecord[],
    allRecords: readonly ModelUsageRecord[],
    duplicateUsageIds: readonly string[],
    unknownDimensions: readonly string[],
  ): Promise<ProviderUsageLifecycleResult> {
    try {
      await this.writer.appendBatch({ modelUsages: pending });
      for (const record of pending) this.recorded.set(record.usageId, fingerprintUsageRecord(record));
      return { status: 'recorded', records: allRecords, duplicateUsageIds, unknownDimensions };
    } catch {
      return {
        status: 'degraded',
        records: allRecords,
        duplicateUsageIds,
        unknownDimensions,
        errorCode: 'OBSERVABILITY_USAGE_WRITE_FAILED',
      };
    }
  }
}

function normalizeBatch(inputs: readonly unknown[]):
  | { readonly ok: true; readonly records: readonly ModelUsageRecord[] }
  | { readonly ok: false; readonly result: ProviderUsageLifecycleResult } {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 4_096) {
    return {
      ok: false,
      result: { status: 'rejected', records: [], duplicateUsageIds: [], unknownDimensions: [], errorCode: 'OBSERVABILITY_USAGE_INVALID' },
    };
  }
  const serializedInput = safeSerialize(inputValues(inputs));
  if (serializedInput.length > MAX_INPUT_BYTES) {
    return {
      ok: false,
      result: { status: 'rejected', records: [], duplicateUsageIds: [], unknownDimensions: [], errorCode: 'OBSERVABILITY_USAGE_INVALID' },
    };
  }
  try {
    return { ok: true, records: inputs.map((input) => normalizeProviderUsageObservation(input)) };
  } catch {
    const privacy = /secret|absolute path|api[_-]?key|access[_-]?token|password|credential|environment|\benv\b/iu.test(serializedInput)
      || hasProviderUsagePrivacyViolation(inputs);
    return {
      ok: false,
      result: {
        status: 'rejected',
        records: [],
        duplicateUsageIds: [],
        unknownDimensions: [],
        errorCode: privacy ? 'OBSERVABILITY_USAGE_PRIVACY' : 'OBSERVABILITY_USAGE_INVALID',
      },
    };
  }
}

function hasProviderUsagePrivacyViolation(value: unknown): boolean {
  try {
    return findProviderUsagePrivacyViolations(value).length > 0;
  } catch {
    return true;
  }
}

function withAccuracy(record: ModelUsageRecord, tokenAccuracy: ModelUsageRecord['tokenAccuracy']): ModelUsageRecord {
  if (!record.cost) return record;
  const accuracy = tokenAccuracy === 'unknown' || record.cost.accuracy === 'unknown'
    ? 'unknown'
    : tokenAccuracy === 'estimated' || record.cost.accuracy === 'estimated'
      ? 'estimated'
      : 'exact';
  return ModelUsageRecordSchema.parse({ ...record, cost: { ...record.cost, accuracy } });
}

function conflictResult(records: readonly ModelUsageRecord[], duplicateUsageIds: readonly string[], unknownDimensions: ReadonlySet<string>): ProviderUsageLifecycleResult {
  return {
    status: 'conflict',
    records,
    duplicateUsageIds,
    unknownDimensions: [...unknownDimensions].sort(compareText),
    errorCode: 'OBSERVABILITY_USAGE_CONFLICT',
  };
}

function batchKey(records: readonly ModelUsageRecord[]): string {
  return createFingerprint(records.map((record) => [record.usageId, fingerprintUsageRecord(record)]));
}

function createFingerprint(value: unknown): string {
  // A deterministic string key is sufficient for the in-memory in-flight map;
  // durable idempotency remains owned by the SQLite ledger.
  return canonicalObservabilityJson(value);
}

function inputValues(inputs: readonly unknown[]): unknown {
  return inputs.length > 16 ? inputs.slice(0, 16) : inputs;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return 'uninspectable input';
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
