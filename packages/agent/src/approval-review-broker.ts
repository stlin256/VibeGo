import {
  ApprovalReviewDecisionRecordSchema,
  ApprovalReviewEventDraftSchema,
  ApprovalReviewRequestSchema,
  type ApprovalGoalSummary,
  type ApprovalReviewDecisionRecord,
  type ApprovalReviewEventDraft,
  type ApprovalPermissionSummary,
  type ApprovalReviewRequest,
  type ApprovalReviewerSnapshot,
  type ApprovalSandboxSummary,
} from '@ready4vibe/contracts';
import { type ApprovalBroker, type ApprovalDecision, type ApprovalRequest, type ApprovalResolution, type ApprovalDecisionResult } from './approval.js';
import { canonicalApprovalReviewJson, fingerprintApprovalReview, type ApprovalReviewer } from './approval-review.js';

/**
 * Secret-free run metadata used to construct a reviewer request. The
 * application service owns this context; the reviewer wrapper never derives it
 * from a prompt, tool argument or host path.
 */
export interface ApprovalReviewRequestContext {
  readonly workspaceId: string;
  readonly taskTrust: 'trusted-workspace' | 'untrusted-content';
  readonly permission: ApprovalPermissionSummary;
  readonly sandbox: ApprovalSandboxSummary;
  readonly network: 'restricted' | 'enabled';
  readonly goal?: ApprovalGoalSummary;
  readonly policyRevision: string;
  readonly reviewerRevision: string;
}

/** Immutable per-run application binding captured before AgentLoop starts. */
export interface ApprovalReviewBinding {
  readonly reviewer: ApprovalReviewer;
  readonly snapshot: ApprovalReviewerSnapshot;
  readonly context: ApprovalReviewRequestContext;
}

export interface ApprovalReviewRunBindingInput {
  readonly runId: string;
  readonly config: {
    readonly workspaceId: string;
    readonly taskTrust: 'trusted-workspace' | 'untrusted-content';
    readonly sandbox: {
      readonly mode: 'read-only' | 'workspace-write' | 'external-sandbox' | 'danger-full-access';
      readonly network?: 'restricted' | 'enabled';
      readonly provider?: 'docker' | 'podman' | 'vm';
    };
  };
  readonly modelProvider: unknown;
  readonly modelSnapshot?: unknown;
  readonly permissionSnapshot?: unknown;
}

export type ApprovalReviewBindingFactory = (input: ApprovalReviewRunBindingInput) => ApprovalReviewBinding | undefined;

/**
 * Normalize the existing ApprovalRequest into the strict reviewer contract.
 * Only bounded metadata and fingerprints are retained. In particular, the
 * request has no command, raw argument, prompt, output, environment or path.
 */
export function buildApprovalReviewRequest(
  request: ApprovalRequest,
  context: ApprovalReviewRequestContext,
  now: () => number = Date.now,
): ApprovalReviewRequest {
  const operationClass = operationClassForRisk(request.risk);
  const risk = riskForApproval(request.risk);
  const argumentFingerprint = fingerprintApprovalReview({
    toolId: request.toolId,
    toolVersion: request.toolVersion,
    argumentBytes: request.argumentBytes,
  });
  const exactKeyMaterial = {
    runId: request.runId,
    turnId: request.turnId,
    callId: request.callId,
    workspaceId: context.workspaceId,
    toolId: request.toolId,
    toolVersion: request.toolVersion,
    risk,
    operationClass,
    argumentFingerprint,
    argumentBytes: request.argumentBytes,
    taskTrust: context.taskTrust,
    permission: context.permission,
    sandbox: context.sandbox,
    network: context.network,
    policyRevision: context.policyRevision,
    reviewerRevision: context.reviewerRevision,
  } as const;
  const approvalKeyFingerprint = fingerprintApprovalReview(exactKeyMaterial);
  const reviewId = `review_${fingerprintApprovalReview({ approvalId: request.approvalId }).slice(0, 40)}`;
  const labels = [`argument-bytes:${request.argumentBytes}`];
  const value = {
    schemaVersion: 'llm-approval/v1' as const,
    reviewId,
    runId: request.runId,
    turnId: request.turnId,
    correlationId: request.callId,
    approvalKey: `approval.v1.${approvalKeyFingerprint}`,
    approvalKeyFingerprint,
    workspaceId: context.workspaceId,
    tool: {
      toolId: request.toolId,
      toolVersion: request.toolVersion,
      operationClass,
      risk,
      summary: 'Bounded tool approval request',
      argumentFingerprint,
      argumentLabels: labels,
    },
    taskTrust: context.taskTrust,
    permission: context.permission,
    sandbox: context.sandbox,
    network: context.network,
    ...(context.goal === undefined ? {} : { goal: context.goal }),
    policyRevision: context.policyRevision,
    reviewerRevision: context.reviewerRevision,
    deadlineAt: new Date(request.expiresAt).toISOString(),
  };
  // Keep a clock parameter in the public helper so callers can validate an
  // already-expired request without changing the serialized contract.
  void now;
  return ApprovalReviewRequestSchema.parse(value);
}

export interface ApprovalReviewBrokerOptions {
  readonly delegate: ApprovalBroker;
  readonly bindingForRun: (runId: string) => ApprovalReviewBinding | undefined;
  readonly now?: () => number;
  /** Optional bounded audit projection; sink failures never affect a run. */
  readonly eventSink?: (event: ApprovalReviewEventDraft) => void | Promise<void>;
}

interface ReviewCacheEntry {
  readonly runId: string;
  readonly decision: Awaited<ReturnType<ApprovalReviewer['review']>>;
  readonly expiresAt: number;
}

interface ReviewInFlightEntry {
  readonly runId: string;
  readonly cacheKey: string;
  readonly request: ApprovalReviewRequest;
  readonly snapshot: ApprovalReviewerSnapshot;
  readonly promise: Promise<Awaited<ReturnType<ApprovalReviewer['review']>>>;
  readonly controller: AbortController;
  waiters: number;
  revoked: boolean;
}

interface ReviewHandle {
  readonly promise: Promise<Awaited<ReturnType<ApprovalReviewer['review']>>>;
  readonly release: () => void;
}

/**
 * Application-layer reviewer wrapper. The delegate remains the only
 * ApprovalBroker authority: an LLM allow is applied by resolving a normal
 * delegate pending entry, while all other outcomes leave the user approval
 * pending. AgentLoop and RunManager's historical default path are untouched.
 */
export class ApprovalReviewBroker implements ApprovalBroker {
  readonly timeoutMs: number;
  private readonly delegate: ApprovalBroker;
  private readonly bindingForRun: (runId: string) => ApprovalReviewBinding | undefined;
  private readonly now: () => number;
  private readonly eventSink: ((event: ApprovalReviewEventDraft) => void | Promise<void>) | undefined;
  private readonly cache = new Map<string, ReviewCacheEntry>();
  private readonly inFlight = new Map<string, ReviewInFlightEntry>();

  constructor(options: ApprovalReviewBrokerOptions) {
    this.delegate = options.delegate;
    this.bindingForRun = options.bindingForRun;
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
    this.timeoutMs = options.delegate.timeoutMs;
  }

  waitForDecision(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResolution> {
    // Create the normal pending request first. This preserves the existing
    // approval.required event/UI timing and lets the user decide while review
    // is still in flight.
    const decisionPromise = this.delegate.waitForDecision(request, signal);
    const binding = this.bindingForRun(request.runId);
    if (binding === undefined || binding.snapshot.status === 'disabled' || binding.snapshot.posture === 'off') return decisionPromise;

    let reviewRequest: ApprovalReviewRequest;
    try {
      reviewRequest = buildApprovalReviewRequest(request, binding.context, this.now);
    } catch {
      return decisionPromise;
    }

    const cacheKey = fingerprintApprovalReview({
      runId: request.runId,
      approvalKeyFingerprint: reviewRequest.approvalKeyFingerprint,
      reviewerRevision: binding.snapshot.reviewerRevision,
      policyRevision: binding.snapshot.policyRevision,
    });
    const handle = this.reviewOnce(cacheKey, request.runId, reviewRequest, binding);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      handle.release();
    };
    const onAbort = (): void => release();
    signal?.addEventListener('abort', onAbort, { once: true });
    void handle.promise.then((decision) => {
      if (signal?.aborted || !shouldAutoResolve(binding.snapshot, decision, reviewRequest, this.now())) return;
      // The delegate is still authoritative. If the user already decided or
      // the request expired/cancelled, decide() returns a non-accepted result
      // and no grant is created.
      this.delegate.decide(request.approvalId, 'allow', request.runId);
    }).catch(() => undefined).finally(() => {
      signal?.removeEventListener('abort', onAbort);
      release();
    });
    return decisionPromise;
  }

  decide(approvalId: string, decision: ApprovalDecision, runId?: string): ApprovalDecisionResult {
    return this.delegate.decide(approvalId, decision, runId);
  }

  pending(runId?: string): readonly ApprovalRequest[] {
    return this.delegate.pending(runId);
  }

  /** Invalidate all reviewer cache state for a terminal/revoked run. */
  disposeRun(runId: string): void {
    for (const [key, entry] of this.cache) if (entry.runId === runId) this.cache.delete(key);
    for (const [key, entry] of this.inFlight) {
      if (entry.runId !== runId) continue;
      if (!entry.revoked) {
        entry.revoked = true;
        this.emitTerminalEvent(entry.cacheKey, entry.request, unavailableDecision(entry.request, entry.snapshot, this.now(), 'review-revoked'), 'review.revoked');
      }
      entry.controller.abort();
      this.inFlight.delete(key);
    }
  }

  private emitRequestedEvent(cacheKey: string, request: ApprovalReviewRequest): void {
    const sink = this.eventSink;
    if (!sink) return;
    const event = reviewEvent(cacheKey, request, null, this.now(), 'review.requested');
    void Promise.resolve().then(() => sink(event)).catch(() => undefined);
  }

  private emitTerminalEvent(
    cacheKey: string,
    request: ApprovalReviewRequest,
    decision: ApprovalReviewDecisionRecord,
    eventType?: 'review.completed' | 'review.unavailable' | 'review.revoked',
  ): void {
    const sink = this.eventSink;
    if (!sink) return;
    const resolvedType = eventType ?? (decision.decision === 'unavailable' ? 'review.unavailable' : 'review.completed');
    const event = reviewEvent(cacheKey, request, decision, this.now(), resolvedType);
    void Promise.resolve().then(() => sink(event)).catch(() => undefined);
  }

  private reviewOnce(
    cacheKey: string,
    runId: string,
    request: ApprovalReviewRequest,
    binding: ApprovalReviewBinding,
  ): ReviewHandle {
    const now = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      if (cached.expiresAt > now) return { promise: Promise.resolve(cached.decision), release: () => undefined };
      this.cache.delete(cacheKey);
    }
    const pending = this.inFlight.get(cacheKey);
    if (pending !== undefined) {
      pending.waiters += 1;
      let released = false;
      return {
        promise: pending.promise,
        release: () => {
          if (released) return;
          released = true;
          pending.waiters = Math.max(0, pending.waiters - 1);
          if (pending.waiters === 0) pending.controller.abort();
        },
      };
    }

    // Review cancellation is bounded by the reviewer adapter's own deadline;
    // it is deliberately independent of one caller's AbortSignal so an
    // identical request in the same run does not cancel another caller's
    // shared review. The delegate still observes the caller's signal.
    const controller = new AbortController();
    this.emitRequestedEvent(cacheKey, request);
    const promise = binding.reviewer.review(request, controller.signal)
      .catch(() => unavailableDecision(request, binding.snapshot, this.now(), 'provider-unavailable'))
      .then((decision) => {
        if (!entry.revoked) this.emitTerminalEvent(cacheKey, request, decision);
        const ttl = binding.snapshot.limits.cacheTtlMs;
        const deadline = Date.parse(request.deadlineAt);
        const expiresAt = Math.min(
          now + Math.max(0, ttl),
          Number.isFinite(deadline) ? deadline : now,
          decision.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(decision.expiresAt),
        );
        if (ttl > 0 && expiresAt > this.now()) this.cache.set(cacheKey, { runId, decision, expiresAt });
        return decision;
      })
      .finally(() => {
        const current = this.inFlight.get(cacheKey);
        if (current?.promise === promise) this.inFlight.delete(cacheKey);
      });
    const entry: ReviewInFlightEntry = { runId, cacheKey, request, snapshot: binding.snapshot, promise, controller, waiters: 1, revoked: false };
    this.inFlight.set(cacheKey, entry);
    let released = false;
    return {
      promise,
      release: () => {
        if (released) return;
        released = true;
        entry.waiters = Math.max(0, entry.waiters - 1);
        if (entry.waiters === 0) entry.controller.abort();
      },
    };
  }
}

function unavailableDecision(
  request: ApprovalReviewRequest,
  snapshot: ApprovalReviewerSnapshot,
  now: number,
  reasonCode: 'provider-unavailable' | 'review-revoked',
): ApprovalReviewDecisionRecord {
  return ApprovalReviewDecisionRecordSchema.parse({
    schemaVersion: 'llm-approval/v1',
    reviewId: request.reviewId,
    decision: 'unavailable',
    reasonCode,
    explanation: reasonCode === 'review-revoked' ? 'The reviewer was revoked with the run.' : 'The reviewer provider failed before returning a decision.',
    reviewerRevision: snapshot.reviewerRevision,
    policyRevision: request.policyRevision,
    latencyMs: 0,
    expiresAt: null,
    approvalKeyFingerprint: request.approvalKeyFingerprint,
    reviewedAt: new Date(now).toISOString(),
  });
}

function reviewEvent(
  cacheKey: string,
  request: ApprovalReviewRequest,
  decision: ApprovalReviewDecisionRecord | null,
  now: number,
  eventType: ApprovalReviewEventDraft['eventType'],
): ApprovalReviewEventDraft {
  const reasonCode = decision?.reasonCode ?? 'eligible';
  const eventId = `reviewevt_${fingerprintApprovalReview({ cacheKey, eventType, reviewId: request.reviewId, approvalKeyFingerprint: request.approvalKeyFingerprint, decision: decision?.decision ?? null, reasonCode }).slice(0, 48)}`;
  return ApprovalReviewEventDraftSchema.parse({
    schemaVersion: 'llm-approval/v1',
    eventId,
    idempotencyKey: `review:${cacheKey}:${eventType}`,
    eventType,
    reviewId: request.reviewId,
    runId: request.runId,
    turnId: request.turnId,
    correlationId: request.correlationId,
    approvalKeyFingerprint: request.approvalKeyFingerprint,
    reviewerRevision: request.reviewerRevision,
    policyRevision: request.policyRevision,
    decision: decision?.decision ?? null,
    reasonCode,
    latencyMs: decision?.latencyMs ?? null,
    expiresAt: decision?.expiresAt ?? null,
    at: new Date(now).toISOString(),
  });
}

function shouldAutoResolve(
  snapshot: ApprovalReviewerSnapshot,
  decision: Awaited<ReturnType<ApprovalReviewer['review']>>,
  request: ApprovalReviewRequest,
  now: number,
): boolean {
  if (snapshot.posture !== 'bounded-auto-low-risk' || snapshot.status !== 'ready') return false;
  if (decision.decision !== 'allow' || decision.approvalKeyFingerprint !== request.approvalKeyFingerprint) return false;
  if (request.reviewerRevision !== snapshot.reviewerRevision || request.policyRevision !== snapshot.policyRevision) return false;
  if (decision.reviewerRevision !== snapshot.reviewerRevision || decision.policyRevision !== request.policyRevision) return false;
  if (decision.expiresAt === null || Date.parse(decision.expiresAt) <= now) return false;
  if (request.taskTrust !== 'trusted-workspace' || request.network !== 'restricted') return false;
  if (request.tool.risk !== 'read-only' && request.tool.risk !== 'workspace-write') return false;
  if (request.tool.operationClass !== 'read' && request.tool.operationClass !== 'write') return false;
  if (request.sandbox.status !== 'ready' || (request.sandbox.mode !== 'read-only' && request.sandbox.mode !== 'workspace-write')) return false;
  if (request.permission.status !== 'ready' || request.permission.effectiveScope === 'none') return false;
  return true;
}

function operationClassForRisk(risk: ApprovalRequest['risk']): 'read' | 'write' | 'destructive' | 'network' {
  if (risk === 'read') return 'read';
  if (risk === 'write') return 'write';
  if (risk === 'destructive') return 'destructive';
  return 'network';
}

function riskForApproval(risk: ApprovalRequest['risk']): 'read-only' | 'workspace-write' | 'destructive' | 'network' {
  if (risk === 'read') return 'read-only';
  if (risk === 'write') return 'workspace-write';
  if (risk === 'destructive') return 'destructive';
  return 'network';
}

/** Exported for focused tests and redaction evidence. */
export function approvalReviewRequestFingerprint(request: ApprovalReviewRequest): string {
  return fingerprintApprovalReview(JSON.parse(canonicalApprovalReviewJson({
    runId: request.runId,
    turnId: request.turnId,
    workspaceId: request.workspaceId,
    approvalKeyFingerprint: request.approvalKeyFingerprint,
    tool: request.tool,
    taskTrust: request.taskTrust,
    permission: request.permission,
    sandbox: request.sandbox,
    network: request.network,
    ...(request.goal === undefined ? {} : { goal: request.goal }),
    policyRevision: request.policyRevision,
    reviewerRevision: request.reviewerRevision,
  })));
}
