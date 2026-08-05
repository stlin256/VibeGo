import {
  DedicatedReviewerProfileSchema,
  DedicatedReviewerProfilesStatusSchema,
  ModelProviderSnapshotSchema,
  type DedicatedReviewerProfile,
  type DedicatedReviewerProfilesStatus,
  type ModelProvider,
  type ModelProviderSnapshot,
} from '@ready4vibe/contracts';
import { OpenAICompatibleProvider, type FetchImplementation } from '@ready4vibe/model-openai';
import type { SettingsStore } from '@ready4vibe/storage';

export const DEDICATED_REVIEWER_PROFILES_NAMESPACE = 'llm-approval' as const;
export const DEDICATED_REVIEWER_PROFILES_KEY = 'profiles' as const;
const MAX_PROFILES = 8;

export interface DedicatedReviewerProfileConfigureInput {
  readonly profileId: string;
  readonly providerId: 'openai-compatible';
  readonly endpoint: string;
  readonly modelName: string;
  /** Write-only runtime credential. It is never part of a durable/status DTO. */
  readonly apiKey: string;
  readonly expectedRevision?: string;
}

export interface DedicatedReviewerProfileProviderBinding {
  readonly profileId: string;
  readonly provider: ModelProvider;
  readonly modelSnapshot: ModelProviderSnapshot;
}

export interface DedicatedReviewerProfilesManagerOptions {
  readonly settings: SettingsStore;
  readonly clock?: () => Date;
  readonly fetchImpl?: FetchImplementation;
}

export class DedicatedReviewerProfilesError extends Error {
  constructor(
    readonly code: 'INVALID_PROFILE' | 'PROFILE_LIMIT' | 'PROFILE_NOT_FOUND' | 'REVISION_CONFLICT' | 'PERSISTENCE_FAILED' | 'CORRUPT_SETTINGS',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'DedicatedReviewerProfilesError';
  }
}

interface RuntimeProfile {
  readonly profile: DedicatedReviewerProfile;
  readonly provider: OpenAICompatibleProvider;
}

/**
 * Small daemon-owned registry for explicit dedicated reviewer profiles.
 * Durable metadata and runtime credentials are intentionally separate: the
 * latter is held only by the provider object in this process.
 */
export class DedicatedReviewerProfilesManager {
  private readonly settings: SettingsStore;
  private readonly clock: () => Date;
  private readonly fetchImpl: FetchImplementation | undefined;
  private profiles: DedicatedReviewerProfile[];
  private readonly runtime = new Map<string, RuntimeProfile>();
  private revisionCounter: number;

  constructor(options: DedicatedReviewerProfilesManagerOptions) {
    this.settings = options.settings;
    this.clock = options.clock ?? (() => new Date());
    this.fetchImpl = options.fetchImpl;
    this.profiles = this.loadProfiles();
    this.revisionCounter = this.profiles.reduce((max, profile) => Math.max(max, revisionNumber(profile.profileRevision)), 0);
  }

  status(): DedicatedReviewerProfilesStatus {
    const profiles = [...this.profiles]
      .sort((left, right) => left.profileId.localeCompare(right.profileId))
      .map((profile) => ({
        ...profile,
        credentialState: this.runtime.has(profile.profileId) ? 'available' as const : 'required' as const,
      }));
    return DedicatedReviewerProfilesStatusSchema.parse({
      schemaVersion: 'ready4vibe_dedicated_reviewer_profiles_status_v1',
      currentRevision: `reviewer-profiles-${this.revisionCounter}`,
      profiles,
      updatedAt: this.clock().toISOString(),
    });
  }

  configure(input: DedicatedReviewerProfileConfigureInput): DedicatedReviewerProfilesStatus {
    const normalized = normalizeConfigureInput(input);
    const existing = this.profiles.find((profile) => profile.profileId === normalized.profileId);
    if (normalized.expectedRevision !== undefined && normalized.expectedRevision !== existing?.profileRevision) {
      throw new DedicatedReviewerProfilesError('REVISION_CONFLICT', 'Dedicated reviewer profile changed; refresh before saving again.');
    }
    if (!existing && this.profiles.length >= MAX_PROFILES) {
      throw new DedicatedReviewerProfilesError('PROFILE_LIMIT', 'The dedicated reviewer profile limit has been reached.');
    }
    const profile = DedicatedReviewerProfileSchema.parse({
      schemaVersion: 'ready4vibe_dedicated_reviewer_profile_v1',
      profileId: normalized.profileId,
      providerId: normalized.providerId,
      endpoint: normalized.endpoint,
      modelName: normalized.modelName,
      profileRevision: `reviewer-profile-${this.revisionCounter + 1}`,
      updatedAt: this.clock().toISOString(),
    });
    let provider: OpenAICompatibleProvider;
    try {
      provider = new OpenAICompatibleProvider({
        id: profile.providerId,
        endpoint: profile.endpoint,
        apiKey: normalized.apiKey,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
    } catch (error) {
      throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'Dedicated reviewer provider configuration is invalid.', { cause: error });
    }
    const next = existing
      ? this.profiles.map((entry) => entry.profileId === profile.profileId ? profile : entry)
      : [...this.profiles, profile];
    this.persistProfiles(next);
    this.profiles = next;
    this.revisionCounter += 1;
    this.runtime.set(profile.profileId, { profile, provider });
    return this.status();
  }

  remove(profileId: string, expectedRevision?: string): DedicatedReviewerProfilesStatus {
    const profile = this.profiles.find((entry) => entry.profileId === profileId);
    if (!profile) throw new DedicatedReviewerProfilesError('PROFILE_NOT_FOUND', 'Dedicated reviewer profile was not found.');
    if (expectedRevision !== undefined && expectedRevision !== profile.profileRevision) {
      throw new DedicatedReviewerProfilesError('REVISION_CONFLICT', 'Dedicated reviewer profile changed; refresh before removing it.');
    }
    const next = this.profiles.filter((entry) => entry.profileId !== profileId);
    this.persistProfiles(next);
    this.profiles = next;
    this.revisionCounter += 1;
    this.runtime.delete(profileId);
    return this.status();
  }

  /** Synchronous local readiness check used by the approval settings projection. */
  hasRuntimeBinding(profileId: string): boolean {
    return this.runtime.has(profileId);
  }

  /** Resolve only an explicit profile with a credential configured in this process. */
  resolve(profileId: string): DedicatedReviewerProfileProviderBinding | undefined {
    const runtime = this.runtime.get(profileId);
    if (!runtime) return undefined;
    const modelSnapshot = ModelProviderSnapshotSchema.safeParse({
      schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
      providerId: runtime.profile.providerId,
      model: runtime.profile.modelName,
      pricingModel: runtime.profile.modelName,
      descriptorRevision: runtime.profile.profileRevision,
      endpointPolicy: { kind: 'explicit-url', baseUrl: runtime.profile.endpoint },
      capabilities: {
        streaming: runtime.provider.capabilities.streaming,
        toolCalls: runtime.provider.capabilities.toolCalls,
        structuredOutput: runtime.provider.capabilities.structuredOutput,
        reasoning: false,
        promptCaching: false,
        audioInput: false,
        audioOutput: false,
      },
      capturedAt: this.clock().toISOString(),
    });
    if (!modelSnapshot.success || modelSnapshot.data.providerId !== runtime.provider.id) return undefined;
    return { profileId, provider: runtime.provider, modelSnapshot: deepFreeze(modelSnapshot.data) };
  }

  private loadProfiles(): DedicatedReviewerProfile[] {
    const stored = this.settings.get<unknown>(DEDICATED_REVIEWER_PROFILES_NAMESPACE, DEDICATED_REVIEWER_PROFILES_KEY);
    if (stored === undefined) return [];
    if (!Array.isArray(stored) || stored.length > MAX_PROFILES) {
      throw new DedicatedReviewerProfilesError('CORRUPT_SETTINGS', 'Stored dedicated reviewer profiles are invalid.');
    }
    try {
      const profiles = stored.map((value) => DedicatedReviewerProfileSchema.parse(value));
      if (new Set(profiles.map((profile) => profile.profileId)).size !== profiles.length) {
        throw new Error('duplicate profile id');
      }
      return profiles;
    } catch (error) {
      if (error instanceof DedicatedReviewerProfilesError) throw error;
      throw new DedicatedReviewerProfilesError('CORRUPT_SETTINGS', 'Stored dedicated reviewer profiles are invalid.', { cause: error });
    }
  }

  private persistProfiles(profiles: readonly DedicatedReviewerProfile[]): void {
    try {
      this.settings.set(DEDICATED_REVIEWER_PROFILES_NAMESPACE, DEDICATED_REVIEWER_PROFILES_KEY, profiles);
    } catch (error) {
      throw new DedicatedReviewerProfilesError('PERSISTENCE_FAILED', 'Dedicated reviewer profiles could not be saved.', { cause: error });
    }
  }
}

function normalizeConfigureInput(input: DedicatedReviewerProfileConfigureInput): DedicatedReviewerProfileConfigureInput {
  if (!input || typeof input !== 'object') throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'Dedicated reviewer profile is invalid.');
  const candidate = input as unknown as Record<string, unknown>;
  const allowed = new Set(['profileId', 'providerId', 'endpoint', 'modelName', 'apiKey', 'expectedRevision']);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'Dedicated reviewer profile contains unsupported fields.');
  if (input.providerId !== 'openai-compatible') throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'Only the openai-compatible reviewer provider is supported in this slice.');
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0 || input.apiKey.length > 4_096 || /[\r\n]/u.test(input.apiKey)) {
    throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'A write-only reviewer credential is required.');
  }
  if (input.expectedRevision !== undefined && (typeof input.expectedRevision !== 'string' || input.expectedRevision.length > 128 || /[\r\n]/u.test(input.expectedRevision))) {
    throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'The expected profile revision is invalid.');
  }
  const parsed = DedicatedReviewerProfileSchema.safeParse({
    schemaVersion: 'ready4vibe_dedicated_reviewer_profile_v1',
    profileId: input.profileId,
    providerId: input.providerId,
    endpoint: input.endpoint,
    modelName: input.modelName,
    profileRevision: 'reviewer-profile-input',
    updatedAt: '2026-08-06T00:00:00.000Z',
  });
  if (!parsed.success) throw new DedicatedReviewerProfilesError('INVALID_PROFILE', 'Dedicated reviewer profile is invalid.', { cause: parsed.error });
  return {
    profileId: parsed.data.profileId,
    providerId: parsed.data.providerId as 'openai-compatible',
    endpoint: parsed.data.endpoint,
    modelName: parsed.data.modelName,
    apiKey: input.apiKey,
    ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
  };
}

function revisionNumber(value: string): number {
  const match = /^reviewer-profile-(\d+)$/u.exec(value);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
