import { describe, expect, it } from 'vitest';
import {
  ModelProviderSnapshotSchema,
  type PermissionProfileRunSnapshot,
} from '@ready4vibe/contracts';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { ApprovalReviewSettingsManager } from './approval-review-settings.js';
import { createApprovalReviewBinding } from './approval-review-runtime.js';

const provider = {
  id: 'fake',
  capabilities: { streaming: true, toolCalls: true, structuredOutput: true },
  async *stream() { yield { type: 'completed' as const, finishReason: 'stop' as const }; },
};

const modelSnapshot = ModelProviderSnapshotSchema.parse({
  schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
  providerId: 'fake',
  model: 'deterministic',
  pricingModel: 'deterministic',
  descriptorRevision: 'descriptor-1',
  endpointPolicy: { kind: 'provider-default' },
  capabilities: {
    streaming: true,
    toolCalls: true,
    structuredOutput: true,
    reasoning: false,
    promptCaching: false,
    audioInput: false,
    audioOutput: false,
  },
  capturedAt: '2026-08-05T00:00:00.000Z',
});

const permissionProfile = {
  schemaVersion: 'ready4vibe_permission_profile_v1' as const,
  profileId: 'workspace-coding' as const,
  filesystemScope: 'workspace-only' as const,
  processScope: 'none' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalPosture: 'bounded-auto' as const,
  taskTrust: 'trusted-workspace' as const,
  workspaceId: 'workspace-1',
  policyRevision: 'policy-1',
  profileRevision: 'profile-1',
  requiresConfirmation: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const permissionSnapshot: PermissionProfileRunSnapshot = {
  schemaVersion: 'ready4vibe_permission_profile_run_snapshot_v1',
  status: 'ready',
  reasonCode: 'PROFILE_READY',
  profileRevision: 'profile-1',
  policyRevision: 'policy-1',
  requestedProfile: permissionProfile,
  effectiveProfile: permissionProfile,
  effectiveScope: {
    kind: 'run',
    profileId: 'workspace-coding',
    filesystemScope: 'workspace-only',
    processScope: 'none',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalPosture: 'bounded-auto',
    taskTrust: 'trusted-workspace',
    workspaceId: 'workspace-1',
  },
  grantId: null,
  grantExpiresAt: null,
  capturedAt: '2026-08-05T00:00:00.000Z',
};

const input = {
  runId: 'run_approval_runtime',
  config: {
    workspaceId: 'workspace-1',
    taskTrust: 'trusted-workspace' as const,
    sandbox: { mode: 'workspace-write' as const, network: 'restricted' as const, writableRoots: ['C:\\workspace'] },
  },
  modelProvider: provider,
  modelSnapshot,
  permissionSnapshot,
};

describe('createApprovalReviewBinding', () => {
  it('keeps the migration default disabled and has no binding', () => {
    const settings = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    expect(createApprovalReviewBinding(settings, input)).toBeUndefined();
  });

  it('captures same-as-run provider, reviewer and permission/sandbox summaries', () => {
    const settings = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    settings.patch({ enabled: true });
    const binding = createApprovalReviewBinding(settings, input);
    expect(binding).toBeDefined();
    expect(binding?.snapshot).toMatchObject({ providerId: 'fake', modelId: 'deterministic', status: 'ready', posture: 'advisory-low-risk' });
    expect(binding?.context.permission).toMatchObject({ profileId: 'workspace-coding', status: 'ready', effectiveScope: 'run' });
    expect(binding?.context.sandbox).toMatchObject({ mode: 'workspace-write', status: 'ready', network: 'restricted' });
  });

  it('fails closed to no binding for stale/dedicated/missing snapshots', () => {
    let policy = 'policy-1';
    const settings = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => policy });
    settings.patch({ enabled: true });
    policy = 'policy-2';
    expect(createApprovalReviewBinding(settings, input)).toBeUndefined();

    const dedicatedStore = new InMemorySettingsStore();
    const dedicated = new ApprovalReviewSettingsManager({ settings: dedicatedStore, policyRevision: () => 'policy-1' });
    dedicated.patch({ enabled: true, reviewerSource: 'dedicated', dedicatedProfileId: 'reviewer-profile' });
    expect(createApprovalReviewBinding(dedicated, input)).toBeUndefined();
    const fresh = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    fresh.patch({ enabled: true });
    expect(createApprovalReviewBinding(fresh, { ...input, modelSnapshot: undefined, permissionSnapshot: undefined })).toBeUndefined();
  });

  it('uses only an explicit dedicated resolver and never reuses the active run provider', () => {
    const settings = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    settings.patch({ enabled: true, reviewerSource: 'dedicated', dedicatedProfileId: 'reviewer-profile' });
    const dedicatedProvider = {
      id: 'dedicated-provider',
      capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
      async *stream() { yield { type: 'completed' as const, finishReason: 'stop' as const }; },
    };
    const dedicatedSnapshot = ModelProviderSnapshotSchema.parse({
      ...modelSnapshot,
      providerId: 'dedicated-provider',
      model: 'dedicated-reviewer-model',
      descriptorRevision: 'dedicated-descriptor-1',
    });
    const binding = createApprovalReviewBinding(settings, input, {
      dedicatedResolver: (profileId) => profileId === 'reviewer-profile'
        ? { profileId, provider: dedicatedProvider, modelSnapshot: dedicatedSnapshot }
        : undefined,
    });
    expect(binding).toBeDefined();
    expect(binding?.snapshot).toMatchObject({ reviewerSource: 'dedicated', dedicatedProfileId: 'reviewer-profile', providerId: 'dedicated-provider' });
    expect(binding?.reviewer).not.toBeUndefined();
    expect(createApprovalReviewBinding(settings, input)).toBeUndefined();
  });

  it('fails closed for unknown profiles and provider/snapshot mismatches', () => {
    const settings = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    settings.patch({ enabled: true, reviewerSource: 'dedicated', dedicatedProfileId: 'reviewer-profile' });
    expect(createApprovalReviewBinding(settings, input, { dedicatedResolver: () => undefined })).toBeUndefined();
    const mismatchedProvider = { ...provider, id: 'other-provider' };
    expect(createApprovalReviewBinding(settings, input, {
      dedicatedResolver: () => ({ profileId: 'reviewer-profile', provider: mismatchedProvider, modelSnapshot }),
    })).toBeUndefined();
    expect(createApprovalReviewBinding(settings, input, {
      dedicatedResolver: () => ({ profileId: 'other-profile', provider, modelSnapshot }),
    })).toBeUndefined();
  });

  it('marks untrusted content and full-host as ineligible without widening scope', () => {
    const settings = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    settings.patch({ enabled: true });
    const binding = createApprovalReviewBinding(settings, {
      ...input,
      config: { ...input.config, taskTrust: 'untrusted-content', sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' } },
    });
    expect(binding?.context.sandbox.status).toBe('blocked');
    const fullHost = createApprovalReviewBinding(settings, {
      ...input,
      config: { ...input.config, sandbox: { mode: 'danger-full-access' } },
    });
    expect(fullHost?.context.sandbox.status).toBe('blocked');
  });
});
