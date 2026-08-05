import { createHash } from 'node:crypto';
import {
  ApprovalReviewDecisionRecordSchema,
  ApprovalReviewEventSchema,
  ApprovalReviewRequestSchema,
  ApprovalReviewerSnapshotSchema,
  type ApprovalReviewDecisionRecord,
  type ApprovalReviewEvent,
  type ApprovalReviewRequest,
  type ApprovalReviewerSnapshot,
} from '@ready4vibe/contracts';

export interface ApprovalReviewer {
  readonly snapshot: ApprovalReviewerSnapshot;
  review(request: ApprovalReviewRequest, signal: AbortSignal): Promise<ApprovalReviewDecisionRecord>;
}

export interface NoopApprovalReviewerOptions {
  /** Keep tests deterministic without introducing a provider or clock dependency. */
  readonly capturedAt?: string;
  readonly policyRevision?: string;
}

/**
 * Default reviewer implementation. It intentionally has no provider port,
 * fetch implementation, subprocess handle or prompt builder. Disabled review
 * therefore cannot create an accidental network/model dependency.
 */
export class NoopApprovalReviewer implements ApprovalReviewer {
  readonly snapshot: ApprovalReviewerSnapshot;

  constructor(options: NoopApprovalReviewerOptions = {}) {
    this.snapshot = Object.freeze(ApprovalReviewerSnapshotSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewerSource: 'same-as-run',
      dedicatedProfileId: null,
      providerId: null,
      modelId: null,
      descriptorRevision: null,
      policyRevision: options.policyRevision ?? 'policy-disabled',
      reviewerRevision: 'reviewer-disabled',
      posture: 'off',
      limits: { maxLatencyMs: 1_500, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs: 0 },
      status: 'disabled',
      capturedAt: options.capturedAt ?? new Date().toISOString(),
    }));
  }

  async review(request: ApprovalReviewRequest, signal: AbortSignal): Promise<ApprovalReviewDecisionRecord> {
    const parsed = ApprovalReviewRequestSchema.parse(request);
    // The signal is deliberately observed only to document the cancellation
    // boundary. No work is started by this implementation in either state.
    void signal;
    return ApprovalReviewDecisionRecordSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewId: parsed.reviewId,
      decision: 'unavailable',
      reasonCode: 'reviewer-disabled',
      explanation: 'LLM approval review is disabled.',
      reviewerRevision: this.snapshot.reviewerRevision,
      policyRevision: parsed.policyRevision,
      latencyMs: 0,
      expiresAt: null,
      approvalKeyFingerprint: parsed.approvalKeyFingerprint,
      reviewedAt: new Date().toISOString(),
    });
  }
}

/** Stable JSON encoding used for exact-key/cache/event fingerprints. */
export function canonicalApprovalReviewJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('approval review value is not JSON serializable');
    }
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('approval review value is not JSON serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalApprovalReviewJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalApprovalReviewJson(record[key])}`).join(',')}}`;
}

export function fingerprintApprovalReview(value: unknown): string {
  return createHash('sha256').update(canonicalApprovalReviewJson(value), 'utf8').digest('hex');
}

export function fingerprintApprovalReviewEvent(event: ApprovalReviewEvent, includeEventId = true): string {
  const { appendSequence: _appendSequence, eventId: _eventId, ...withoutSequence } = event;
  return fingerprintApprovalReview(includeEventId ? { ...withoutSequence, eventId: event.eventId } : withoutSequence);
}

export type ApprovalReviewAppendResult =
  | { readonly status: 'appended'; readonly event: ApprovalReviewEvent }
  | { readonly status: 'duplicate'; readonly event: ApprovalReviewEvent };

export class ApprovalReviewLedgerError extends Error {
  constructor(readonly code: 'APPROVAL_REVIEW_EVENT_CONFLICT' | 'APPROVAL_REVIEW_IDEMPOTENCY_CONFLICT', message: string) {
    super(message);
    this.name = 'ApprovalReviewLedgerError';
  }
}

/**
 * Small in-memory idempotency boundary for Phase 63-1 tests. It is not an
 * ApprovalBroker and does not grant capabilities; durable storage is a later
 * application slice.
 */
export class InMemoryApprovalReviewLedger {
  private readonly byEventId = new Map<string, { fingerprint: string; event: ApprovalReviewEvent }>();
  private readonly byIdempotencyKey = new Map<string, { fingerprint: string; event: ApprovalReviewEvent }>();

  append(input: ApprovalReviewEvent): ApprovalReviewAppendResult {
    const event = ApprovalReviewEventSchema.parse(input);
    const eventFingerprint = fingerprintApprovalReviewEvent(event, true);
    const semanticFingerprint = fingerprintApprovalReviewEvent(event, false);
    const existingEvent = this.byEventId.get(event.eventId);
    if (existingEvent) {
      if (existingEvent.fingerprint === eventFingerprint) return { status: 'duplicate', event: existingEvent.event };
      throw new ApprovalReviewLedgerError('APPROVAL_REVIEW_EVENT_CONFLICT', 'An approval review event id was reused with different content.');
    }
    const existingKey = this.byIdempotencyKey.get(event.idempotencyKey);
    if (existingKey) {
      if (existingKey.fingerprint === semanticFingerprint) return { status: 'duplicate', event: existingKey.event };
      throw new ApprovalReviewLedgerError('APPROVAL_REVIEW_IDEMPOTENCY_CONFLICT', 'An approval review idempotency key was reused with different content.');
    }
    this.byEventId.set(event.eventId, { fingerprint: eventFingerprint, event });
    this.byIdempotencyKey.set(event.idempotencyKey, { fingerprint: semanticFingerprint, event });
    return { status: 'appended', event };
  }

  get(eventId: string): ApprovalReviewEvent | undefined {
    return this.byEventId.get(eventId)?.event;
  }

  clear(): void {
    this.byEventId.clear();
    this.byIdempotencyKey.clear();
  }
}
