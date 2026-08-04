import {
  ModelUsageRecordSchema,
  ProviderCapabilitySnapshotSchema,
  ProviderDescriptorSchema,
  ProviderUsageObservationSchema,
  type ModelUsageRecord,
  type ProviderCapabilitySnapshot,
  type ProviderDescriptor,
} from '@ready4vibe/contracts';

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
