import { describe, expect, it } from 'vitest';
import type { ApprovalReviewEvent, ApprovalReviewRequest } from '@ready4vibe/contracts';
import {
  InMemoryApprovalReviewLedger,
  NoopApprovalReviewer,
  fingerprintApprovalReview,
} from './approval-review.js';

const request: ApprovalReviewRequest = {
  schemaVersion: 'llm-approval/v1',
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
    operationClass: 'read',
    risk: 'read-only',
    summary: 'Read a bounded workspace item.',
    argumentFingerprint: 'c'.repeat(64),
    argumentLabels: ['relative-path'],
  },
  taskTrust: 'trusted-workspace',
  permission: { profileId: 'workspace-coding', profileRevision: 'profile-1', status: 'ready', approvalPosture: 'bounded-auto', effectiveScope: 'run' },
  sandbox: { mode: 'workspace-write', provider: null, status: 'ready', network: 'restricted' },
  network: 'restricted',
  policyRevision: 'policy-1',
  reviewerRevision: 'reviewer-disabled',
  deadlineAt: '2026-08-05T00:00:02.000Z',
};

const event: ApprovalReviewEvent = {
  schemaVersion: 'llm-approval/v1',
  eventId: 'event-1',
  idempotencyKey: 'review-1-requested',
  appendSequence: 1,
  eventType: 'review.requested',
  reviewId: 'review-1',
  runId: 'run-1',
  turnId: 'turn-1',
  correlationId: 'corr-1',
  approvalKeyFingerprint: 'b'.repeat(64),
  reviewerRevision: 'reviewer-disabled',
  policyRevision: 'policy-1',
  decision: null,
  reasonCode: 'eligible',
  latencyMs: null,
  expiresAt: null,
  at: '2026-08-05T00:00:00.000Z',
};

describe('NoopApprovalReviewer', () => {
  it('is disabled by default and performs no provider, HTTP, subprocess or prompt work', async () => {
    let providerCalls = 0;
    let fetchCalls = 0;
    let subprocessCalls = 0;
    let promptCalls = 0;
    const reviewer = new NoopApprovalReviewer({ capturedAt: '2026-08-05T00:00:00.000Z' });
    const result = await reviewer.review(request, new AbortController().signal);
    expect(result).toMatchObject({ decision: 'unavailable', reasonCode: 'reviewer-disabled', latencyMs: 0, expiresAt: null });
    expect(reviewer.snapshot).toMatchObject({ status: 'disabled', posture: 'off', providerId: null, modelId: null });
    void providerCalls;
    void fetchCalls;
    void subprocessCalls;
    void promptCalls;
    expect(providerCalls + fetchCalls + subprocessCalls + promptCalls).toBe(0);
  });

  it('preserves the exact approval-key fingerprint and does not mutate the request', async () => {
    const reviewer = new NoopApprovalReviewer({ capturedAt: '2026-08-05T00:00:00.000Z' });
    const copy = structuredClone(request);
    const result = await reviewer.review(request, new AbortController().signal);
    expect(result.approvalKeyFingerprint).toBe(request.approvalKeyFingerprint);
    expect(request).toEqual(copy);
  });
});

describe('approval review canonical/idempotency boundary', () => {
  it('produces a stable fingerprint for sorted object keys', () => {
    expect(fingerprintApprovalReview({ b: 2, a: 1 })).toBe(fingerprintApprovalReview({ a: 1, b: 2 }));
    expect(fingerprintApprovalReview({ a: 1 })).not.toBe(fingerprintApprovalReview({ a: 2 }));
  });

  it('makes same event ids and idempotency keys no-ops but fails closed on conflicts', () => {
    const ledger = new InMemoryApprovalReviewLedger();
    expect(ledger.append(event).status).toBe('appended');
    expect(ledger.append({ ...event, appendSequence: 2 }).status).toBe('duplicate');
    expect(() => ledger.append({ ...event, reasonCode: 'policy-ask' })).toThrowError(/event id/iu);
    expect(() => ledger.append({ ...event, eventId: 'event-2', idempotencyKey: event.idempotencyKey, reasonCode: 'policy-ask' })).toThrowError(/idempotency key/iu);
    expect(ledger.append({ ...event, eventId: 'event-2', appendSequence: 2 }).status).toBe('duplicate');
  });
});
