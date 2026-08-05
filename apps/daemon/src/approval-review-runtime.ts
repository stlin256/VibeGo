import {
  ApprovalReviewerSnapshotSchema,
  ModelProviderSnapshotSchema,
  PermissionProfileRunSnapshotSchema,
  type ModelProvider,
  type PermissionProfileRunSnapshot,
} from '@ready4vibe/contracts';
import {
  SameAsRunApprovalReviewer,
  type ApprovalReviewBinding,
  type ApprovalReviewRunBindingInput,
} from '@ready4vibe/agent';
import { ApprovalReviewSettingsManager } from './approval-review-settings.js';

/**
 * Build the optional same-as-run reviewer binding at the daemon application
 * boundary. This function intentionally returns undefined for dedicated mode,
 * stale settings, missing model snapshots or missing permission snapshots;
 * those cases retain the existing deterministic approval path.
 */
export function createApprovalReviewBinding(
  settings: ApprovalReviewSettingsManager,
  input: ApprovalReviewRunBindingInput,
): ApprovalReviewBinding | undefined {
  const projection = settings.status();
  const durable = settings.settingsSnapshot();
  if (!durable.enabled || durable.reviewerSource !== 'same-as-run' || projection.status !== 'ready') return undefined;

  const modelSnapshot = ModelProviderSnapshotSchema.safeParse(input.modelSnapshot);
  if (!modelSnapshot.success) return undefined;
  const provider = input.modelProvider as ModelProvider;
  if (!provider || typeof provider !== 'object' || typeof provider.stream !== 'function') return undefined;

  const reviewerSnapshot = ApprovalReviewerSnapshotSchema.parse({
    schemaVersion: 'llm-approval/v1',
    reviewerSource: 'same-as-run',
    dedicatedProfileId: null,
    providerId: modelSnapshot.data.providerId,
    modelId: modelSnapshot.data.model,
    descriptorRevision: modelSnapshot.data.descriptorRevision,
    policyRevision: durable.policyRevision,
    reviewerRevision: durable.reviewerRevision,
    posture: durable.posture,
    limits: durable.limits,
    status: 'ready',
    capturedAt: new Date().toISOString(),
  });
  const permission = permissionSummary(input.permissionSnapshot);
  const sandbox = sandboxSummary(input);
  const reviewer = new SameAsRunApprovalReviewer({
    provider,
    modelSnapshot: modelSnapshot.data,
    reviewerSnapshot,
  });
  return {
    reviewer,
    snapshot: reviewerSnapshot,
    context: {
      workspaceId: input.config.workspaceId,
      taskTrust: input.config.taskTrust,
      permission,
      sandbox,
      network: sandbox.network,
      policyRevision: durable.policyRevision,
      reviewerRevision: durable.reviewerRevision,
    },
  };
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
