import { describe, expect, it } from 'vitest';
import {
  ApprovalReviewDecisionRecordSchema,
  ApprovalReviewEventSchema,
  ApprovalReviewRequestSchema,
  ApprovalReviewerSnapshotSchema,
  LlmApprovalSettingsProjectionSchema,
  findLlmApprovalPrivacyViolations,
} from './llm-approval.js';

const limits = { maxLatencyMs: 1_500, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs: 0 };
const snapshot = {
  schemaVersion: 'llm-approval/v1' as const,
  reviewerSource: 'same-as-run' as const,
  dedicatedProfileId: null,
  providerId: null,
  modelId: null,
  descriptorRevision: null,
  policyRevision: 'policy-1',
  reviewerRevision: 'reviewer-disabled',
  posture: 'off' as const,
  limits,
  status: 'disabled' as const,
  capturedAt: '2026-08-05T00:00:00.000Z',
};
const request = {
  schemaVersion: 'llm-approval/v1' as const,
  reviewId: 'review-1',
  runId: 'run-1',
  turnId: 'turn-1',
  correlationId: 'corr-1',
  approvalKey: `approval.v1.${'a'.repeat(64)}`,
  approvalKeyFingerprint: 'b'.repeat(64),
  workspaceId: 'workspace-1',
  tool: {
    toolId: 'filesystem.read',
    toolVersion: '1.0.0',
    operationClass: 'read' as const,
    risk: 'read-only' as const,
    summary: 'Read a bounded workspace item.',
    argumentFingerprint: 'c'.repeat(64),
    argumentLabels: ['relative-path'],
  },
  taskTrust: 'trusted-workspace' as const,
  permission: { profileId: 'workspace-coding', profileRevision: 'profile-1', status: 'ready' as const, approvalPosture: 'bounded-auto' as const, effectiveScope: 'run' as const },
  sandbox: { mode: 'workspace-write' as const, provider: null, status: 'ready' as const, network: 'restricted' as const },
  network: 'restricted' as const,
  policyRevision: 'policy-1',
  reviewerRevision: 'reviewer-1',
  deadlineAt: '2026-08-05T00:00:02.000Z',
};

describe('llm-approval/v1 contracts', () => {
  it('accepts a disabled snapshot and rejects unknown fields', () => {
    expect(ApprovalReviewerSnapshotSchema.parse(snapshot)).toMatchObject({ status: 'disabled', posture: 'off' });
    expect(() => ApprovalReviewerSnapshotSchema.parse({ ...snapshot, extra: true })).toThrow();
  });

  it('rejects secret-shaped, absolute-path, URL and unbounded data', () => {
    expect(findLlmApprovalPrivacyViolations({ apiKey: 'sk-' + 'a'.repeat(24) }).length).toBeGreaterThan(0);
    expect(() => ApprovalReviewRequestSchema.parse({ ...request, workspaceId: 'C:\\workspace' })).toThrow(/absolute path/iu);
    expect(() => ApprovalReviewRequestSchema.parse({ ...request, tool: { ...request.tool, summary: 'https://example.test' } })).toThrow(/URL/iu);
    expect(() => ApprovalReviewRequestSchema.parse({ ...request, tool: { ...request.tool, summary: 'x'.repeat(513) } })).toThrow();
    expect(() => ApprovalReviewRequestSchema.parse({ ...request, environment: 'HOME=secret' })).toThrow();
  });

  it('requires exact bounded request summaries and matching network state', () => {
    expect(ApprovalReviewRequestSchema.parse(request)).toMatchObject({ reviewId: 'review-1', tool: { argumentFingerprint: 'c'.repeat(64) } });
    expect(() => ApprovalReviewRequestSchema.parse({ ...request, network: 'enabled' })).toThrow(/network summary/iu);
    expect(() => ApprovalReviewRequestSchema.parse({ ...request, tool: { ...request.tool, extra: 'raw command' } })).toThrow();
  });

  it('requires expiry only for an allow decision and rejects unknown decision values', () => {
    const allow = {
      schemaVersion: 'llm-approval/v1' as const,
      reviewId: 'review-1',
      decision: 'allow' as const,
      reasonCode: 'eligible' as const,
      explanation: 'Exact low-risk key is eligible.',
      reviewerRevision: 'reviewer-1',
      policyRevision: 'policy-1',
      latencyMs: 42,
      expiresAt: '2026-08-05T00:00:03.000Z',
      approvalKeyFingerprint: 'b'.repeat(64),
      reviewedAt: '2026-08-05T00:00:02.000Z',
    };
    expect(ApprovalReviewDecisionRecordSchema.parse(allow).decision).toBe('allow');
    expect(() => ApprovalReviewDecisionRecordSchema.parse({ ...allow, expiresAt: null })).toThrow(/expiry/iu);
    expect(() => ApprovalReviewDecisionRecordSchema.parse({ ...allow, decision: 'ask' })).toThrow();
  });

  it('keeps settings migration default off and bounds status metadata', () => {
    const settings = LlmApprovalSettingsProjectionSchema.parse({
      schemaVersion: 'llm-approval/v1',
      enabled: false,
      reviewerSource: 'same-as-run',
      dedicatedProfileId: null,
      posture: 'off',
      status: 'disabled',
      reviewerRevision: 'reviewer-disabled',
      policyRevision: 'policy-1',
      limits,
      lastLatencyMs: null,
      lastErrorCode: 'reviewer-disabled',
      lastHealthAt: null,
      nextStep: 'Enable bounded review explicitly in Settings.',
      updatedAt: '2026-08-05T00:00:00.000Z',
    });
    expect(settings.enabled).toBe(false);
    expect(() => LlmApprovalSettingsProjectionSchema.parse({ ...settings, enabled: false, status: 'ready' })).toThrow();
  });

  it('keeps audit events bounded and separates requested from terminal decisions', () => {
    const base = {
      schemaVersion: 'llm-approval/v1' as const,
      eventId: 'event-1',
      idempotencyKey: 'review-1-requested',
      appendSequence: 1,
      eventType: 'review.requested' as const,
      reviewId: 'review-1',
      runId: 'run-1',
      turnId: 'turn-1',
      correlationId: 'corr-1',
      approvalKeyFingerprint: 'b'.repeat(64),
      reviewerRevision: 'reviewer-1',
      policyRevision: 'policy-1',
      decision: null,
      reasonCode: 'eligible' as const,
      latencyMs: null,
      expiresAt: null,
      at: '2026-08-05T00:00:00.000Z',
    };
    expect(ApprovalReviewEventSchema.parse(base).eventType).toBe('review.requested');
    expect(() => ApprovalReviewEventSchema.parse({ ...base, decision: 'allow' })).toThrow();
    expect(() => ApprovalReviewEventSchema.parse({ ...base, idempotencyKey: 'https://example.test' })).toThrow(/URL/iu);
  });
});
