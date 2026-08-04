import {
  ModelUsageRecordSchema,
  ProviderUsageObservationSchema,
  type ModelUsageRecord,
  type StoredEvent,
} from '@ready4vibe/contracts';
import {
  replayModelUsage,
  type ProviderUsageLifecycleAdapter,
  type ProviderUsageLifecycleResult,
} from './index.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;

export interface RunUsageObserverWriter {
  readonly appendBatch: (batch: { readonly modelUsages?: readonly ModelUsageRecord[] }) => Promise<unknown>;
}

export interface RunUsageObserverOptions {
  readonly adapter: ProviderUsageLifecycleAdapter;
}

export interface RunUsageObserverResult {
  readonly runId: string;
  readonly status: ProviderUsageLifecycleResult['status'] | 'noop';
  readonly usageIds: readonly string[];
  readonly errorCode?:
    | 'OBSERVABILITY_RUN_USAGE_INVALID'
    | 'OBSERVABILITY_RUN_USAGE_REPLAY_FAILED';
}

/**
 * Replays one settled run at the daemon application boundary. It consumes
 * existing bounded run events only; it never executes a provider or writes a
 * second event stream. The lifecycle adapter owns pricing, idempotency and
 * fail-soft ledger delivery.
 */
export class RunUsageObserver {
  private readonly adapter: ProviderUsageLifecycleAdapter;

  constructor(options: RunUsageObserverOptions) {
    this.adapter = options.adapter;
  }

  async recordTerminal(runId: string, events: readonly StoredEvent[]): Promise<RunUsageObserverResult> {
    if (!isSafeId(runId)) {
      return { runId: 'invalid', status: 'rejected', usageIds: [], errorCode: 'OBSERVABILITY_RUN_USAGE_INVALID' };
    }
    if (events.length === 0) return { runId, status: 'noop', usageIds: [] };

    try {
      const projection = replayModelUsage(events);
      if (projection.runId !== runId) {
        return { runId, status: 'rejected', usageIds: [], errorCode: 'OBSERVABILITY_RUN_USAGE_INVALID' };
      }
      if (projection.records.length === 0) return { runId, status: 'noop', usageIds: [] };
      const observations = projection.records.map(toProviderUsageObservation);
      const result = await this.adapter.recordBatch(observations);
      return {
        runId,
        status: result.status,
        usageIds: result.records.map((record) => record.usageId),
      };
    } catch {
      return { runId, status: 'degraded', usageIds: [], errorCode: 'OBSERVABILITY_RUN_USAGE_REPLAY_FAILED' };
    }
  }
}

function toProviderUsageObservation(record: ModelUsageRecord): unknown {
  const parsed = ModelUsageRecordSchema.parse(record);
  const { schemaVersion: _schemaVersion, cost: _cost, ...bounded } = parsed;
  return ProviderUsageObservationSchema.parse({
    ...bounded,
    schemaVersion: 'ready4vibe_provider_usage_observation_v1',
    dataSource: 'run-event',
  });
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}
