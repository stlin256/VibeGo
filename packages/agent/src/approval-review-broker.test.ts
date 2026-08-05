import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalReviewDecisionRecordSchema,
  type ApprovalReviewDecisionRecord,
  type ApprovalReviewRequest,
  type ApprovalReviewerSnapshot,
} from '@ready4vibe/contracts';
import { InMemoryApprovalBroker, type ApprovalRequest } from './approval.js';
import {
  ApprovalReviewBroker,
  type ApprovalReviewBinding,
  type ApprovalReviewRequestContext,
  buildApprovalReviewRequest,
} from './approval-review-broker.js';
import type { ApprovalReviewer } from './approval-review.js';

const snapshot = (posture: ApprovalReviewerSnapshot['posture'] = 'bounded-auto-low-risk', cacheTtlMs = 0): ApprovalReviewerSnapshot => ({
  schemaVersion: 'llm-approval/v1',
  reviewerSource: 'same-as-run',
  dedicatedProfileId: null,
  providerId: 'fake',
  modelId: 'reviewer-model',
  descriptorRevision: 'descriptor-1',
  policyRevision: 'policy-1',
  reviewerRevision: 'reviewer-1',
  posture,
  limits: { maxLatencyMs: 1_000, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs },
  status: 'ready',
  capturedAt: '2026-08-05T00:00:00.000Z',
});

const context: ApprovalReviewRequestContext = {
  workspaceId: 'workspace-1',
  taskTrust: 'trusted-workspace',
  permission: {
    profileId: 'workspace-coding',
    profileRevision: 'profile-1',
    status: 'ready',
    approvalPosture: 'bounded-auto',
    effectiveScope: 'run',
  },
  sandbox: { mode: 'workspace-write', provider: null, status: 'ready', network: 'restricted' },
  network: 'restricted',
  policyRevision: 'policy-1',
  reviewerRevision: 'reviewer-1',
};

const approval = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  approvalId: 'ap_approval_1',
  runId: 'run_approval_1',
  turnId: 'turn_1',
  callId: 'call_1',
  toolId: 'filesystem.read',
  toolVersion: '1.0.0',
  risk: 'read',
  argumentBytes: 32,
  createdAt: Date.now(),
  expiresAt: Date.now() + 30_000,
  ...overrides,
});

class FakeReviewer implements ApprovalReviewer {
  readonly snapshot: ApprovalReviewerSnapshot;
  readonly requests: ApprovalReviewRequest[] = [];
  private readonly decision: ApprovalReviewDecisionRecord['decision'];
  private readonly delayMs: number;

  constructor(snapshotValue: ApprovalReviewerSnapshot, decision: ApprovalReviewDecisionRecord['decision'] = 'allow', delayMs = 0) {
    this.snapshot = snapshotValue;
    this.decision = decision;
    this.delayMs = delayMs;
  }

  async review(request: ApprovalReviewRequest): Promise<ApprovalReviewDecisionRecord> {
    this.requests.push(request);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return ApprovalReviewDecisionRecordSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewId: request.reviewId,
      decision: this.decision,
      reasonCode: this.decision === 'allow' ? 'eligible' : this.decision === 'deny' ? 'policy-denied' : 'provider-unavailable',
      explanation: this.decision === 'allow' ? 'Exact bounded key is eligible.' : 'Review did not confirm this request.',
      reviewerRevision: request.reviewerRevision,
      policyRevision: request.policyRevision,
      latencyMs: this.delayMs,
      expiresAt: this.decision === 'allow' ? request.deadlineAt : null,
      approvalKeyFingerprint: request.approvalKeyFingerprint,
      reviewedAt: '2026-08-05T00:00:00.000Z',
    });
  }
}

function binding(reviewer: FakeReviewer): ApprovalReviewBinding {
  return { reviewer, snapshot: reviewer.snapshot, context };
}

describe('ApprovalReviewBroker', () => {
  it('preserves the historical delegate path when no binding exists', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => undefined });
    const pending = broker.waitForDecision(approval());
    expect(broker.pending('run_approval_1')).toHaveLength(1);
    expect(broker.decide('ap_approval_1', 'allow', 'run_approval_1')).toBe('accepted');
    await expect(pending).resolves.toBe('allow');
  });

  it('uses the normal delegate entry for bounded auto allow', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const reviewer = new FakeReviewer(snapshot());
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => binding(reviewer) });
    const pending = broker.waitForDecision(approval());
    await expect(pending).resolves.toBe('allow');
    expect(reviewer.requests).toHaveLength(1);
    expect(delegate.pending()).toHaveLength(0);
  });

  it('emits one bounded requested/terminal projection and maps reviewer rejection to unavailable', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const events: Array<Record<string, unknown>> = [];
    const reviewer: ApprovalReviewer = {
      snapshot: snapshot('advisory-low-risk'),
      review: async () => { throw new Error('provider body must not escape'); },
    };
    const broker = new ApprovalReviewBroker({
      delegate,
      bindingForRun: () => ({ reviewer, snapshot: reviewer.snapshot, context }),
      eventSink: (event) => { events.push(event); },
    });
    const pending = broker.waitForDecision(approval());
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events.map((event) => event.eventType)).toEqual(['review.requested', 'review.unavailable']);
    expect(events[0]).toMatchObject({ decision: null, reasonCode: 'eligible' });
    expect(events[1]).toMatchObject({ decision: 'unavailable', reasonCode: 'provider-unavailable', latencyMs: expect.any(Number) });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('provider body');
    expect(serialized).not.toMatch(/command|prompt|C:\\\\|\/Users\//iu);
    expect(broker.decide('ap_approval_1', 'deny', 'run_approval_1')).toBe('accepted');
    await expect(pending).resolves.toBe('deny');
  });

  it('does not let a durable event sink failure change the deterministic approval result', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const reviewer = new FakeReviewer(snapshot());
    const broker = new ApprovalReviewBroker({
      delegate,
      bindingForRun: () => binding(reviewer),
      eventSink: () => { throw new Error('storage unavailable'); },
    });
    const pending = broker.waitForDecision(approval());
    await expect(pending).resolves.toBe('allow');
    expect(delegate.pending()).toHaveLength(0);
  });

  it('emits a single revoked event when a run is disposed while review is in flight', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const events: Array<Record<string, unknown>> = [];
    const reviewer: ApprovalReviewer = {
      snapshot: snapshot(),
      review: async (_request, signal) => await new Promise<ApprovalReviewDecisionRecord>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
    };
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => ({ reviewer, snapshot: reviewer.snapshot, context }), eventSink: (event) => { events.push(event); } });
    const pending = broker.waitForDecision(approval({ approvalId: 'ap_revoked' }));
    await vi.waitFor(() => expect(events).toHaveLength(1));
    broker.disposeRun('run_approval_1');
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events[1]).toMatchObject({ eventType: 'review.revoked', decision: 'unavailable', reasonCode: 'review-revoked' });
    expect(events.filter((event) => event.eventType === 'review.revoked')).toHaveLength(1);
    expect(broker.decide('ap_revoked', 'deny', 'run_approval_1')).toBe('accepted');
    await expect(pending).resolves.toBe('deny');
  });

  it('keeps advisory allow and reviewer denial on the user approval path', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const advisory = new FakeReviewer(snapshot('advisory-low-risk'));
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => binding(advisory) });
    const pending = broker.waitForDecision(approval());
    await vi.waitFor(() => expect(advisory.requests).toHaveLength(1));
    expect(delegate.pending()).toHaveLength(1);
    expect(broker.decide('ap_approval_1', 'deny', 'run_approval_1')).toBe('accepted');
    await expect(pending).resolves.toBe('deny');

    const deniedDelegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const denied = new FakeReviewer(snapshot(), 'deny');
    const deniedBroker = new ApprovalReviewBroker({ delegate: deniedDelegate, bindingForRun: () => binding(denied) });
    const deniedPending = deniedBroker.waitForDecision(approval({ approvalId: 'ap_approval_2' }));
    await vi.waitFor(() => expect(denied.requests).toHaveLength(1));
    expect(deniedDelegate.pending()).toHaveLength(1);
    deniedBroker.decide('ap_approval_2', 'allow', 'run_approval_1');
    await expect(deniedPending).resolves.toBe('allow');
  });

  it('never auto-resolves destructive, network or untrusted requests', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const reviewer = new FakeReviewer(snapshot());
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => binding(reviewer) });
    const pending = broker.waitForDecision(approval({ risk: 'destructive' }));
    await vi.waitFor(() => expect(reviewer.requests).toHaveLength(1));
    expect(delegate.pending()).toHaveLength(1);
    broker.decide('ap_approval_1', 'deny', 'run_approval_1');
    await expect(pending).resolves.toBe('deny');
  });

  it('shares only an identical same-run review and keeps runs isolated', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const reviewer = new FakeReviewer(snapshot('bounded-auto-low-risk', 10_000), 'allow', 10);
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => binding(reviewer) });
    const first = broker.waitForDecision(approval());
    const second = broker.waitForDecision(approval({ approvalId: 'ap_approval_2' }));
    await expect(first).resolves.toBe('allow');
    await expect(second).resolves.toBe('allow');
    expect(reviewer.requests).toHaveLength(1);

    const otherRun = broker.waitForDecision(approval({ approvalId: 'ap_approval_3', runId: 'run_approval_2' }));
    await expect(otherRun).resolves.toBe('allow');
    expect(reviewer.requests).toHaveLength(2);
  });

  it('invalidates the bounded cache when scope or time changes', async () => {
    let now = Date.now();
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const reviewer = new FakeReviewer(snapshot('bounded-auto-low-risk', 100));
    let current = binding(reviewer);
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => current, now: () => now });

    const first = broker.waitForDecision(approval());
    await expect(first).resolves.toBe('allow');
    expect(reviewer.requests).toHaveLength(1);

    current = { ...current, context: { ...current.context, workspaceId: 'workspace-2' } };
    const changedScope = broker.waitForDecision(approval({ approvalId: 'ap_scope_changed' }));
    await expect(changedScope).resolves.toBe('allow');
    expect(reviewer.requests).toHaveLength(2);

    now += 101;
    const expired = broker.waitForDecision(approval({ approvalId: 'ap_ttl_expired' }));
    await expect(expired).resolves.toBe('allow');
    expect(reviewer.requests).toHaveLength(3);
  });

  it('disposes in-flight review state on terminal/restart cleanup without replaying a tool call', async () => {
    const delegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    let aborted = false;
    const reviewer: ApprovalReviewer = {
      snapshot: snapshot('bounded-auto-low-risk', 10_000),
      review: async (request, signal) => await new Promise<ApprovalReviewDecisionRecord>((resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('review aborted')); }, { once: true });
        void request;
      }),
    };
    const reviewBinding: ApprovalReviewBinding = { reviewer, snapshot: reviewer.snapshot, context };
    const broker = new ApprovalReviewBroker({ delegate, bindingForRun: () => reviewBinding });
    const pending = broker.waitForDecision(approval({ approvalId: 'ap_dispose' }));
    await vi.waitFor(() => expect(delegate.pending()).toHaveLength(1));
    broker.disposeRun('run_approval_1');
    expect(aborted).toBe(true);
    expect(broker.decide('ap_dispose', 'deny', 'run_approval_1')).toBe('accepted');
    await expect(pending).resolves.toBe('deny');
    expect(delegate.pending()).toHaveLength(0);
  });

  it('does not leak request contents into the normalized contract', () => {
    const normalized = buildApprovalReviewRequest(approval(), context);
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toMatch(/prompt|transcript|command|environment|C:\\\\|\/Users\//iu);
    expect(normalized.tool.argumentLabels).toEqual(['argument-bytes:32']);
    expect(normalized.approvalKey).toMatch(/^approval\.v1\.[a-f0-9]{64}$/u);
  });

  it('fails closed on stale binding revisions and propagates caller cancellation', async () => {
    const staleDelegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const staleReviewer = new FakeReviewer(snapshot());
    const staleBinding = { ...binding(staleReviewer), context: { ...context, policyRevision: 'policy-2' } };
    const staleBroker = new ApprovalReviewBroker({ delegate: staleDelegate, bindingForRun: () => staleBinding });
    const stalePending = staleBroker.waitForDecision(approval());
    await vi.waitFor(() => expect(staleReviewer.requests).toHaveLength(1));
    expect(staleDelegate.pending()).toHaveLength(1);
    staleBroker.decide('ap_approval_1', 'deny', 'run_approval_1');
    await expect(stalePending).resolves.toBe('deny');

    const cancellableDelegate = new InMemoryApprovalBroker({ timeoutMs: 30_000 });
    const cancellable: ApprovalReviewer = {
      snapshot: snapshot(),
      review: async (_request, signal) => await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
    };
    const cancellableBroker = new ApprovalReviewBroker({ delegate: cancellableDelegate, bindingForRun: () => ({ reviewer: cancellable, snapshot: cancellable.snapshot, context }) });
    const controller = new AbortController();
    const cancelled = cancellableBroker.waitForDecision(approval({ approvalId: 'ap_approval_cancel' }), controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancellableDelegate.pending()).toHaveLength(0);
  });
});
