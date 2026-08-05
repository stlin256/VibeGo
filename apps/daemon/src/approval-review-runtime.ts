import {
  ApprovalReviewerSnapshotSchema,
  ModelProviderSnapshotSchema,
  PermissionProfileRunSnapshotSchema,
  type ModelProvider,
  type ModelProviderSnapshot,
  type PermissionProfileRunSnapshot,
} from '@ready4vibe/contracts';
import {
  DedicatedApprovalReviewer,
  SameAsRunApprovalReviewer,
  type ApprovalReviewBinding,
  type ApprovalReviewRunBindingInput,
} from '@ready4vibe/agent';
import { ApprovalReviewSettingsManager } from './approval-review-settings.js';

export interface DedicatedApprovalReviewProviderBinding {
  /** Must exactly match the daemon-owned reviewer setting. */
  readonly profileId: string;
  /** Runtime-only provider resolved from the daemon secret boundary. */
  readonly provider: ModelProvider;
  /** Secret-free snapshot for the dedicated reviewer model. */
  readonly modelSnapshot: ModelProviderSnapshot;
}

export interface ApprovalReviewBindingOptions {
  /**
   * Optional application-owned resolver. The production daemon deliberately
   * leaves this unset until multi-profile provider/secret storage is ready.
   */
  readonly dedicatedResolver?: (
    profileId: string,
    input: ApprovalReviewRunBindingInput,
  ) => DedicatedApprovalReviewProviderBinding | undefined;
}

/**
 * Build the optional reviewer binding at the daemon application boundary.
 * Same-as-run uses the provider captured by the current run. Dedicated mode
 * is only available when an explicit resolver returns a matching provider and
 * snapshot; without one it remains degraded and the deterministic Approval
 * path is unchanged.
 */
export function createApprovalReviewBinding(
  settings: ApprovalReviewSettingsManager,
  input: ApprovalReviewRunBindingInput,
  options: ApprovalReviewBindingOptions = {},
): ApprovalReviewBinding | undefined {
  const projection = settings.status();
  const durable = settings.settingsSnapshot();
  if (!durable.enabled || projection.status === 'blocked') return undefined;

  if (durable.reviewerSource === 'same-as-run') {
    if (projection.status !== 'ready') return undefined;
    const modelSnapshot = ModelProviderSnapshotSchema.safeParse(input.modelSnapshot);
    if (!modelSnapshot.success) return undefined;
    const provider = input.modelProvider as ModelProvider;
    if (!isProvider(provider)) return undefined;
    return buildBinding({
      source: 'same-as-run',
      provider,
      modelSnapshot: modelSnapshot.data,
      input,
      durable,
    });
  }

  const profileId = durable.dedicatedProfileId;
  if (!profileId || !options.dedicatedResolver) return undefined;
  const resolved = options.dedicatedResolver(profileId, input);
  if (!resolved || resolved.profileId !== profileId || !isProvider(resolved.provider)) return undefined;
  const modelSnapshot = ModelProviderSnapshotSchema.safeParse(resolved.modelSnapshot);
  if (!modelSnapshot.success || modelSnapshot.data.providerId !== resolved.provider.id) return undefined;
  return buildBinding({
    source: 'dedicated',
    dedicatedProfileId: profileId,
    provider: resolved.provider,
    modelSnapshot: modelSnapshot.data,
    input,
    durable,
  });
}

function buildBinding(options: {
  readonly source: 'same-as-run' | 'dedicated';
  readonly dedicatedProfileId?: string;
  readonly provider: ModelProvider;
  readonly modelSnapshot: ReturnType<typeof ModelProviderSnapshotSchema.parse>;
  readonly input: ApprovalReviewRunBindingInput;
  readonly durable: ReturnType<ApprovalReviewSettingsManager['settingsSnapshot']>;
}): ApprovalReviewBinding | undefined {
  try {
    const reviewerSnapshot = ApprovalReviewerSnapshotSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewerSource: options.source,
      dedicatedProfileId: options.dedicatedProfileId ?? null,
      providerId: options.modelSnapshot.providerId,
      modelId: options.modelSnapshot.model,
      descriptorRevision: options.modelSnapshot.descriptorRevision,
      policyRevision: options.durable.policyRevision,
      reviewerRevision: options.durable.reviewerRevision,
      posture: options.durable.posture,
      limits: options.durable.limits,
      status: 'ready',
      capturedAt: new Date().toISOString(),
    });
    const permission = permissionSummary(options.input.permissionSnapshot);
    const sandbox = sandboxSummary(options.input);
    const reviewer = options.source === 'same-as-run'
      ? new SameAsRunApprovalReviewer({ provider: options.provider, modelSnapshot: options.modelSnapshot, reviewerSnapshot })
      : new DedicatedApprovalReviewer({ provider: options.provider, modelSnapshot: options.modelSnapshot, reviewerSnapshot, dedicatedProfileId: options.dedicatedProfileId! });
    return {
      reviewer,
      snapshot: reviewerSnapshot,
      context: {
        workspaceId: options.input.config.workspaceId,
        taskTrust: options.input.config.taskTrust,
        permission,
        sandbox,
        network: sandbox.network,
        policyRevision: options.durable.policyRevision,
        reviewerRevision: options.durable.reviewerRevision,
      },
    };
  } catch {
    return undefined;
  }
}

function isProvider(value: unknown): value is ModelProvider {
  return typeof value === 'object' && value !== null && typeof (value as ModelProvider).id === 'string'
    && typeof (value as ModelProvider).stream === 'function';
}

function permissionSummary(value: unknown): {
  profileId: string;
  profileRevision: string;
  status: 'ready' | 'degraded' | 'blocked' | 'revoked' | 'expired';
  approvalPosture: 'bounded-auto' | 'explicit' | 'session-auto' | 'none';
  effectiveScope: 'run' | 'session' | 'none';
} {
  const parsed = PermissionProfileRunSnapshotSchema.safeParse(value);
  if (!parsed.success || parsed.data.effectiveProfile === null || parsed.data.effectiveScope === null) {
    return {
      profileId: 'permission-unavailable',
      profileRevision: 'permission-unavailable',
      status: 'blocked',
      approvalPosture: 'none',
      effectiveScope: 'none',
    };
  }
  const snapshot: PermissionProfileRunSnapshot = parsed.data;
  const effectiveProfile = snapshot.effectiveProfile;
  const effectiveScope = snapshot.effectiveScope;
  if (effectiveProfile === null || effectiveScope === null) {
    return {
      profileId: 'permission-unavailable',
      profileRevision: 'permission-unavailable',
      status: 'blocked',
      approvalPosture: 'none',
      effectiveScope: 'none',
    };
  }
  return {
    profileId: effectiveProfile.profileId,
    profileRevision: snapshot.profileRevision,
    status: snapshot.status,
    approvalPosture: effectiveScope.approvalPosture,
    effectiveScope: 'run',
  };
}

function sandboxSummary(input: ApprovalReviewRunBindingInput): {
  mode: 'read-only' | 'workspace-write' | 'external-sandbox' | 'danger-full-access';
  provider: 'docker' | 'podman' | 'vm' | null;
  status: 'ready' | 'degraded' | 'blocked';
  network: 'restricted' | 'enabled';
} {
  const sandbox = input.config.sandbox;
  const network = sandbox.network ?? 'restricted';
  if (sandbox.mode === 'danger-full-access') return { mode: sandbox.mode, provider: null, status: 'blocked', network };
  if (input.config.taskTrust === 'untrusted-content') {
    return { mode: sandbox.mode, provider: sandbox.mode === 'external-sandbox' ? sandbox.provider ?? null : null, status: 'blocked', network };
  }
  if (sandbox.mode === 'external-sandbox') {
    return { mode: sandbox.mode, provider: sandbox.provider ?? null, status: 'degraded', network };
  }
  return { mode: sandbox.mode, provider: null, status: 'ready', network };
}
