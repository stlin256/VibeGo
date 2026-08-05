import {
  CapabilityProfileResolutionSchema,
  CapabilityProfileSettingsPatchSchema,
  CapabilityProfileSettingsSchema,
  CapabilityProfileSettingsStatusSchema,
  CAPABILITY_PROFILE_SCHEMA_VERSION,
  CAPABILITY_PROFILE_SETTINGS_SCHEMA_VERSION,
  type CapabilityProfile,
  type CapabilityProfileSettings,
  type CapabilityProfileSettingsStatus,
} from '@ready4vibe/contracts';
import {
  resolveCapabilityProfile,
  type CapabilityProfilePolicy,
} from '@ready4vibe/policy';
import type { SettingsStore } from '@ready4vibe/storage';

export const CAPABILITY_PROFILE_SETTINGS_NAMESPACE = 'capability-profile' as const;
export const CAPABILITY_PROFILE_SETTINGS_KEY = 'v1' as const;

export interface CapabilityProfileSettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly policy: () => CapabilityProfilePolicy;
  readonly clock?: () => Date;
}

export class CapabilityProfileSettingsError extends Error {
  constructor(
    readonly code: 'INVALID_SETTINGS' | 'CORRUPT_SETTINGS' | 'PERSISTENCE_FAILED' | 'REVISION_CONFLICT' | 'STALE_POLICY_REVISION',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CapabilityProfileSettingsError';
  }
}

export interface CapabilityProfileSettingsManager {
  status(): CapabilityProfileSettingsStatus;
  patch(input: unknown): CapabilityProfileSettingsStatus;
  reset(expectedRevision?: string): CapabilityProfileSettingsStatus;
}

export class DurableCapabilityProfileSettingsManager implements CapabilityProfileSettingsManager {
  private readonly settings: SettingsStore;
  private readonly policy: () => CapabilityProfilePolicy;
  private readonly clock: () => Date;
  private settingsValue: CapabilityProfileSettings;
  private previousRevision: string | null = null;

  constructor(options: CapabilityProfileSettingsManagerOptions) {
    this.settings = options.settings;
    this.policy = options.policy;
    this.clock = options.clock ?? (() => new Date());
    this.settingsValue = this.loadSettings();
    this.recoverStaleProfile();
  }

  status(): CapabilityProfileSettingsStatus {
    const evaluatedAt = this.clock().toISOString();
    const resolution = CapabilityProfileResolutionSchema.parse(resolveCapabilityProfile(
      this.settingsValue.profile,
      this.policy(),
      evaluatedAt,
    ));
    return CapabilityProfileSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_capability_profile_settings_status_v1',
      settings: this.settingsValue,
      resolution,
      currentRevision: this.settingsValue.profileRevision,
      previousRevision: this.previousRevision,
    });
  }

  patch(input: unknown): CapabilityProfileSettingsStatus {
    let patch;
    try {
      patch = CapabilityProfileSettingsPatchSchema.parse(input);
    } catch (error) {
      throw new CapabilityProfileSettingsError('INVALID_SETTINGS', 'Capability profile settings are invalid.', { cause: error });
    }
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== this.settingsValue.profileRevision) {
      throw new CapabilityProfileSettingsError('REVISION_CONFLICT', 'Capability profile revision is stale.');
    }
    const currentPolicy = this.policy();
    if (patch.profile.policyRevision !== currentPolicy.policyRevision) {
      throw new CapabilityProfileSettingsError('STALE_POLICY_REVISION', 'Capability profile policy revision is stale.');
    }
    const next = this.createSettings(patch.profile, nextRevision(this.settingsValue.profileRevision));
    this.persist(next);
    this.previousRevision = this.settingsValue.profileRevision;
    this.settingsValue = next;
    return this.status();
  }

  reset(expectedRevision?: string): CapabilityProfileSettingsStatus {
    if (expectedRevision !== undefined && expectedRevision !== this.settingsValue.profileRevision) {
      throw new CapabilityProfileSettingsError('REVISION_CONFLICT', 'Capability profile revision is stale.');
    }
    const currentPolicy = this.policy();
    const now = this.clock().toISOString();
    const preview = createPreviewProfile(currentPolicy.policyRevision, now);
    const next = this.createSettings(preview, nextRevision(this.settingsValue.profileRevision));
    this.persist(next);
    this.previousRevision = this.settingsValue.profileRevision;
    this.settingsValue = next;
    return this.status();
  }

  private loadSettings(): CapabilityProfileSettings {
    const stored = this.settings.get<unknown>(CAPABILITY_PROFILE_SETTINGS_NAMESPACE, CAPABILITY_PROFILE_SETTINGS_KEY);
    if (stored === undefined) {
      const policy = this.policy();
      const initial = this.createSettings(createPreviewProfile(policy.policyRevision, this.clock().toISOString()), 'profile-1');
      this.persist(initial);
      return initial;
    }
    try {
      return CapabilityProfileSettingsSchema.parse(stored);
    } catch (error) {
      throw new CapabilityProfileSettingsError('CORRUPT_SETTINGS', 'Stored capability profile settings are invalid.', { cause: error });
    }
  }

  private recoverStaleProfile(): void {
    const currentPolicy = this.policy();
    if (this.settingsValue.profile.policyRevision === currentPolicy.policyRevision) return;
    const previous = this.settingsValue.profileRevision;
    const next = this.createSettings(createPreviewProfile(currentPolicy.policyRevision, this.clock().toISOString()), nextRevision(previous));
    this.persist(next);
    this.previousRevision = previous;
    this.settingsValue = next;
  }

  private createSettings(profile: CapabilityProfile, profileRevision: string): CapabilityProfileSettings {
    return CapabilityProfileSettingsSchema.parse({
      schemaVersion: CAPABILITY_PROFILE_SETTINGS_SCHEMA_VERSION,
      profile: { ...profile, updatedAt: this.clock().toISOString() },
      profileRevision,
      updatedAt: this.clock().toISOString(),
    });
  }

  private persist(value: CapabilityProfileSettings): void {
    try {
      this.settings.set(CAPABILITY_PROFILE_SETTINGS_NAMESPACE, CAPABILITY_PROFILE_SETTINGS_KEY, value);
    } catch (error) {
      throw new CapabilityProfileSettingsError('PERSISTENCE_FAILED', 'Capability profile settings could not be saved.', { cause: error });
    }
  }
}

function createPreviewProfile(policyRevision: string, updatedAt: string): CapabilityProfile {
  return {
    schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
    profileId: 'preview',
    transportMode: 'loopback',
    modelMode: 'fake',
    filesystemMode: 'off',
    shellMode: 'off',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalMode: 'none',
    policyRevision,
    requiresAcknowledgement: false,
    updatedAt,
  };
}

function nextRevision(value: string): string {
  const match = /^profile-(\d+)$/u.exec(value);
  const current = match ? Number(match[1]) : 0;
  const next = Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1;
  return `profile-${next}`;
}
