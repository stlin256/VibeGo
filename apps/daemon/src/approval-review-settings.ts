import type {
  ApprovalReviewSettings,
  ApprovalReviewSettingsPatch,
  LlmApprovalSettingsProjection,
} from '@ready4vibe/contracts';
import {
  ApprovalReviewSettingsPatchSchema,
  ApprovalReviewSettingsSchema,
  LlmApprovalSettingsProjectionSchema,
  LLM_APPROVAL_SCHEMA_VERSION,
} from '@ready4vibe/contracts';
import type { SettingsStore } from '@ready4vibe/storage';

export const APPROVAL_REVIEW_SETTINGS_NAMESPACE = 'llm-approval' as const;
export const APPROVAL_REVIEW_SETTINGS_KEY = 'v1' as const;

export interface ApprovalReviewSettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly policyRevision?: () => string;
  readonly clock?: () => Date;
}

export class ApprovalReviewSettingsError extends Error {
  constructor(
    readonly code: 'INVALID_SETTINGS' | 'CORRUPT_SETTINGS' | 'PERSISTENCE_FAILED' | 'REVISION_CONFLICT' | 'STALE_POLICY_REVISION',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ApprovalReviewSettingsError';
  }
}

const DEFAULT_LIMITS = {
  maxLatencyMs: 1_500,
  maxRequestBytes: 16_384,
  maxResponseBytes: 8_192,
  cacheTtlMs: 0,
} as const;

export class ApprovalReviewSettingsManager {
  private readonly settings: SettingsStore;
  private readonly policyRevision: () => string;
  private readonly clock: () => Date;
  private settingsValue: ApprovalReviewSettings;
  private statusValue: 'disabled' | 'ready' | 'degraded' | 'blocked';
  private lastLatencyMs: number | null = null;
  private lastErrorCode: LlmApprovalSettingsProjection['lastErrorCode'] = null;
  private lastHealthAt: string | null = null;

  constructor(options: ApprovalReviewSettingsManagerOptions) {
    this.settings = options.settings;
    this.policyRevision = options.policyRevision ?? (() => 'policy-1');
    this.clock = options.clock ?? (() => new Date());
    this.settingsValue = this.loadSettings();
    this.statusValue = this.settingsValue.enabled ? 'ready' : 'disabled';
    this.recomputeStatus();
  }

  settingsSnapshot(): ApprovalReviewSettings {
    return { ...this.settingsValue, limits: { ...this.settingsValue.limits } };
  }

  status(): LlmApprovalSettingsProjection {
    this.recomputeStatus();
    return LlmApprovalSettingsProjectionSchema.parse({
      schemaVersion: LLM_APPROVAL_SCHEMA_VERSION,
      enabled: this.settingsValue.enabled,
      reviewerSource: this.settingsValue.reviewerSource,
      dedicatedProfileId: this.settingsValue.dedicatedProfileId,
      posture: this.settingsValue.posture,
      status: this.statusValue,
      reviewerRevision: this.settingsValue.reviewerRevision,
      policyRevision: this.settingsValue.policyRevision,
      limits: this.settingsValue.limits,
      lastLatencyMs: this.lastLatencyMs,
      lastErrorCode: this.lastErrorCode,
      lastHealthAt: this.lastHealthAt,
      nextStep: this.nextStep(),
      updatedAt: this.settingsValue.updatedAt,
    });
  }

  patch(input: unknown): LlmApprovalSettingsProjection {
    let patch: ApprovalReviewSettingsPatch;
    try {
      patch = ApprovalReviewSettingsPatchSchema.parse(input);
    } catch (error) {
      throw new ApprovalReviewSettingsError('INVALID_SETTINGS', 'Approval review settings are invalid.', { cause: error });
    }
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== this.settingsValue.reviewerRevision) {
      throw new ApprovalReviewSettingsError('REVISION_CONFLICT', 'Approval review settings changed; refresh before saving again.');
    }
    const currentPolicyRevision = this.currentPolicyRevision();
    const next = this.buildNextSettings(patch, currentPolicyRevision);
    this.persist(next);
    this.settingsValue = next;
    this.lastLatencyMs = null;
    this.lastErrorCode = null;
    this.lastHealthAt = null;
    this.statusValue = next.enabled ? 'ready' : 'disabled';
    this.recomputeStatus();
    return this.status();
  }

  /**
   * Probe is intentionally local in 63-3: it validates the persisted intent
   * and profile boundary without starting a provider, HTTP request or child
   * process. A provider-backed probe arrives with dedicated integration.
   */
  async probe(signal?: AbortSignal): Promise<LlmApprovalSettingsProjection> {
    if (signal?.aborted) return this.status();
    this.lastHealthAt = this.clock().toISOString();
    this.recomputeStatus();
    return this.status();
  }

  private buildNextSettings(patch: ApprovalReviewSettingsPatch, policyRevision: string): ApprovalReviewSettings {
    const source = patch.reviewerSource ?? this.settingsValue.reviewerSource;
    const enabled = patch.enabled ?? this.settingsValue.enabled;
    const posture = patch.posture ?? (enabled && this.settingsValue.posture === 'off' ? 'advisory-low-risk' : this.settingsValue.posture);
    const dedicatedProfileId = source === 'same-as-run'
      ? null
      : patch.dedicatedProfileId !== undefined ? patch.dedicatedProfileId : this.settingsValue.dedicatedProfileId;
    try {
      return ApprovalReviewSettingsSchema.parse({
        schemaVersion: LLM_APPROVAL_SCHEMA_VERSION,
        enabled,
        reviewerSource: source,
        dedicatedProfileId,
        posture: enabled ? posture : 'off',
        limits: {
          maxLatencyMs: patch.maxLatencyMs ?? this.settingsValue.limits.maxLatencyMs,
          maxRequestBytes: patch.maxRequestBytes ?? this.settingsValue.limits.maxRequestBytes,
          maxResponseBytes: patch.maxResponseBytes ?? this.settingsValue.limits.maxResponseBytes,
          cacheTtlMs: patch.cacheTtlMs ?? this.settingsValue.limits.cacheTtlMs,
        },
        reviewerRevision: nextRevision(this.settingsValue.reviewerRevision),
        policyRevision,
        updatedAt: this.clock().toISOString(),
      });
    } catch (error) {
      throw new ApprovalReviewSettingsError('INVALID_SETTINGS', 'Approval review settings are invalid.', { cause: error });
    }
  }

  private loadSettings(): ApprovalReviewSettings {
    const stored = this.settings.get<unknown>(APPROVAL_REVIEW_SETTINGS_NAMESPACE, APPROVAL_REVIEW_SETTINGS_KEY);
    if (stored === undefined) {
      const initial = ApprovalReviewSettingsSchema.parse({
        schemaVersion: LLM_APPROVAL_SCHEMA_VERSION,
        enabled: false,
        reviewerSource: 'same-as-run',
        dedicatedProfileId: null,
        posture: 'off',
        limits: DEFAULT_LIMITS,
        reviewerRevision: 'reviewer-1',
        policyRevision: this.currentPolicyRevision(),
        updatedAt: this.clock().toISOString(),
      });
      this.persist(initial);
      return initial;
    }
    try {
      return ApprovalReviewSettingsSchema.parse(stored);
    } catch (error) {
      throw new ApprovalReviewSettingsError('CORRUPT_SETTINGS', 'Stored approval review settings are invalid.', { cause: error });
    }
  }

  private persist(value: ApprovalReviewSettings): void {
    try {
      this.settings.set(APPROVAL_REVIEW_SETTINGS_NAMESPACE, APPROVAL_REVIEW_SETTINGS_KEY, value);
    } catch (error) {
      throw new ApprovalReviewSettingsError('PERSISTENCE_FAILED', 'Approval review settings could not be saved.', { cause: error });
    }
  }

  private recomputeStatus(): void {
    if (!this.settingsValue.enabled) {
      this.statusValue = 'disabled';
      this.lastErrorCode = null;
      return;
    }
    if (this.settingsValue.policyRevision !== this.currentPolicyRevision()) {
      this.statusValue = 'blocked';
      this.lastErrorCode = 'revision-stale';
      return;
    }
    if (this.settingsValue.reviewerSource === 'dedicated' && this.settingsValue.dedicatedProfileId === null) {
      this.statusValue = 'blocked';
      this.lastErrorCode = 'dedicated-profile-missing';
      return;
    }
    if (this.settingsValue.reviewerSource === 'dedicated') {
      this.statusValue = 'degraded';
      this.lastErrorCode = 'provider-unavailable';
      return;
    }
    this.statusValue = 'ready';
    this.lastErrorCode = null;
  }

  private currentPolicyRevision(): string {
    const revision = this.policyRevision();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(revision)) throw new ApprovalReviewSettingsError('STALE_POLICY_REVISION', 'The daemon policy revision is invalid.');
    return revision;
  }

  private nextStep(): string {
    if (!this.settingsValue.enabled) return 'Enable bounded approval review explicitly in Settings.';
    if (this.statusValue === 'blocked' && this.lastErrorCode === 'revision-stale') return 'Refresh the reviewer settings against the current daemon policy.';
    if (this.statusValue === 'blocked') return 'Select a dedicated reviewer profile before enabling this source.';
    if (this.statusValue === 'degraded') return 'Probe the dedicated reviewer provider before relying on review automation.';
    return 'Only exact, deterministic low-risk approval keys may be reviewed.';
  }
}

function nextRevision(value: string): string {
  const match = /^reviewer-(\d+)$/u.exec(value);
  const current = match ? Number(match[1]) : 0;
  return `reviewer-${Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1}`;
}
