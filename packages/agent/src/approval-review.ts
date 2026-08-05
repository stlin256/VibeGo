import { createHash } from 'node:crypto';
import {
  ApprovalReviewDecisionRecordSchema,
  ApprovalReviewEventSchema,
  ApprovalReviewModelOutputSchema,
  ApprovalReviewRequestSchema,
  ApprovalReviewerSnapshotSchema,
  ModelEventSchema,
  ModelProviderSnapshotSchema,
  type ApprovalReviewDecisionRecord,
  type ApprovalReviewEvent,
  type ApprovalReviewModelOutput,
  type ApprovalReviewRequest,
  type ApprovalReviewerSnapshot,
  type ModelProvider,
  type ModelProviderSnapshot,
  type ModelRequest,
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

interface ProviderApprovalReviewerOptions {
  readonly provider: ModelProvider;
  readonly modelSnapshot: ModelProviderSnapshot;
  readonly reviewerSnapshot: ApprovalReviewerSnapshot;
  readonly now?: () => number;
  readonly expectedSource: 'same-as-run' | 'dedicated';
  readonly expectedDedicatedProfileId?: string;
}

export interface SameAsRunApprovalReviewerOptions {
  readonly provider: ModelProvider;
  readonly modelSnapshot: ModelProviderSnapshot;
  readonly reviewerSnapshot: ApprovalReviewerSnapshot;
  readonly now?: () => number;
}

export interface DedicatedApprovalReviewerOptions {
  readonly provider: ModelProvider;
  readonly modelSnapshot: ModelProviderSnapshot;
  readonly reviewerSnapshot: ApprovalReviewerSnapshot;
  /** The profile id resolved by the daemon-owned provider/secret boundary. */
  readonly dedicatedProfileId: string;
  readonly now?: () => number;
}

/**
 * Bounded adapter for the provider already captured by an in-flight run.
 * It consumes only normalized review metadata and never forwards the user
 * prompt, transcript, command, tool output, environment or host path.
 */
class ProviderApprovalReviewer implements ApprovalReviewer {
  readonly snapshot: ApprovalReviewerSnapshot;
  private readonly provider: ModelProvider;
  private readonly modelSnapshot: ModelProviderSnapshot;
  private readonly now: () => number;

  constructor(options: ProviderApprovalReviewerOptions) {
    this.provider = options.provider;
    this.modelSnapshot = deepFreeze(ModelProviderSnapshotSchema.parse(options.modelSnapshot));
    this.snapshot = deepFreeze(ApprovalReviewerSnapshotSchema.parse(options.reviewerSnapshot));
    this.now = options.now ?? Date.now;
    if (this.snapshot.reviewerSource !== options.expectedSource) throw new Error(`${options.expectedSource} reviewer requires a matching reviewer snapshot`);
    if (options.expectedSource === 'dedicated') {
      if (!options.expectedDedicatedProfileId || this.snapshot.dedicatedProfileId !== options.expectedDedicatedProfileId) {
        throw new Error('dedicated reviewer profile does not match the reviewer snapshot');
      }
    }
    if (this.snapshot.providerId !== null && this.snapshot.providerId !== this.modelSnapshot.providerId) throw new Error('reviewer/provider snapshot mismatch');
    if (this.snapshot.modelId !== null && this.snapshot.modelId !== this.modelSnapshot.model) throw new Error('reviewer/model snapshot mismatch');
    if (this.snapshot.descriptorRevision !== null && this.snapshot.descriptorRevision !== this.modelSnapshot.descriptorRevision) throw new Error('reviewer descriptor revision mismatch');
    if (this.provider.id !== this.modelSnapshot.providerId) throw new Error('provider id does not match the frozen model snapshot');
  }

  async review(request: ApprovalReviewRequest, signal: AbortSignal): Promise<ApprovalReviewDecisionRecord> {
    const parsed = ApprovalReviewRequestSchema.parse(request);
    const startedAt = this.now();
    if (signal.aborted) return this.unavailable(parsed, 'cancelled', startedAt);
    const preflight = this.preflight(parsed);
    if (preflight !== undefined) return this.unavailable(parsed, preflight, startedAt);

    const modelRequest = this.buildModelRequest(parsed);
    if (byteLength(canonicalApprovalReviewJson(modelRequest)) > this.snapshot.limits.maxRequestBytes) {
      return this.unavailable(parsed, 'request-too-large', startedAt);
    }

    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
      controller.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.snapshot.limits.maxLatencyMs);
    let output = '';
    let completed = false;
    try {
      for await (const rawEvent of this.provider.stream(modelRequest, controller.signal)) {
        const event = ModelEventSchema.safeParse(rawEvent);
        if (!event.success) return this.unavailable(parsed, 'schema-mismatch', startedAt);
        if (event.data.type === 'text-delta') {
          output += event.data.text;
          if (byteLength(output) > this.snapshot.limits.maxResponseBytes) {
            controller.abort();
            return this.unavailable(parsed, 'response-too-large', startedAt);
          }
        } else if (event.data.type === 'tool-call-delta') {
          return this.unavailable(parsed, 'schema-mismatch', startedAt);
        } else if (event.data.type === 'error') {
          return this.unavailable(parsed, mapProviderError(event.data.code), startedAt);
        } else if (event.data.type === 'completed') {
          completed = true;
          if (event.data.finishReason !== 'stop') return this.unavailable(parsed, 'malformed-response', startedAt);
        }
      }
      if (timedOut) return this.unavailable(parsed, 'timeout', startedAt);
      if (cancelled || signal.aborted) return this.unavailable(parsed, 'cancelled', startedAt);
      if (!completed) return this.unavailable(parsed, 'malformed-response', startedAt);
      return this.mapModelOutput(parsed, output, startedAt);
    } catch {
      if (timedOut) return this.unavailable(parsed, 'timeout', startedAt);
      if (cancelled || signal.aborted) return this.unavailable(parsed, 'cancelled', startedAt);
      return this.unavailable(parsed, 'provider-unavailable', startedAt);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private preflight(request: ApprovalReviewRequest): 'reviewer-disabled' | 'provider-unavailable' | 'revision-stale' | 'ineligible-risk' | 'ineligible-trust' | 'ineligible-sandbox' | undefined {
    if (this.snapshot.status === 'disabled' || this.snapshot.posture === 'off') return 'reviewer-disabled';
    if (this.snapshot.status !== 'ready' || this.modelSnapshot.capabilities.streaming !== true || this.provider.capabilities.streaming !== true) return 'provider-unavailable';
    if (request.reviewerRevision !== this.snapshot.reviewerRevision || request.policyRevision !== this.snapshot.policyRevision) return 'revision-stale';
    if (request.taskTrust !== 'trusted-workspace') return 'ineligible-trust';
    if (request.tool.risk !== 'read-only' && request.tool.risk !== 'workspace-write') return 'ineligible-risk';
    if (request.tool.operationClass !== 'read' && request.tool.operationClass !== 'write') return 'ineligible-risk';
    if (request.network !== 'restricted') return 'ineligible-risk';
    if (request.sandbox.mode !== 'read-only' && request.sandbox.mode !== 'workspace-write') return 'ineligible-sandbox';
    if (request.sandbox.status !== 'ready' || request.permission.status !== 'ready' || request.permission.effectiveScope === 'none') return 'ineligible-sandbox';
    return undefined;
  }

  private buildModelRequest(request: ApprovalReviewRequest): ModelRequest {
    const safetySummary = {
      reviewId: request.reviewId,
      approvalKeyFingerprint: request.approvalKeyFingerprint,
      workspaceId: request.workspaceId,
      tool: request.tool,
      taskTrust: request.taskTrust,
      permission: request.permission,
      sandbox: request.sandbox,
      network: request.network,
      ...(request.goal === undefined ? {} : { goal: request.goal }),
      policyRevision: request.policyRevision,
      reviewerRevision: request.reviewerRevision,
    };
    const systemContent = 'Return exactly one strict JSON object matching llm-approval/v1 with only these keys: schemaVersion, reviewId, decision, reasonCode, explanation, approvalKeyFingerprint. decision must be allow, ask-user, deny, or unavailable. reasonCode must be exactly one of eligible, reviewer-disabled, ineligible-risk, ineligible-trust, ineligible-sandbox, policy-denied, policy-ask, provider-unavailable, dedicated-profile-missing, timeout, cancelled, request-too-large, response-too-large, malformed-response, schema-mismatch, fingerprint-mismatch, revision-stale, budget-exhausted, review-revoked, invalid-request; use eligible for an eligible allow or ask-user result, policy-denied for deny, and provider-unavailable for unavailable. Copy reviewId and approvalKeyFingerprint exactly from the bounded metadata. Never widen deterministic policy; never request or infer secrets, paths, commands, transcripts or tool output.';
    return {
      model: this.modelSnapshot.model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: canonicalApprovalReviewJson(safetySummary) },
      ],
      tools: [],
      budget: { maxInputTokens: 1_024, maxOutputTokens: 512 },
      metadata: { runId: request.runId, turnId: request.turnId, requestId: request.reviewId },
    };
  }

  private mapModelOutput(request: ApprovalReviewRequest, output: string, startedAt: number): ApprovalReviewDecisionRecord {
    let raw: unknown;
    try {
      raw = JSON.parse(output);
    } catch {
      return this.unavailable(request, 'malformed-response', startedAt);
    }
    const parsed = ApprovalReviewModelOutputSchema.safeParse(raw);
    if (!parsed.success) return this.unavailable(request, 'schema-mismatch', startedAt);
    const value: ApprovalReviewModelOutput = parsed.data;
    if (value.reviewId !== request.reviewId || value.approvalKeyFingerprint !== request.approvalKeyFingerprint) {
      return this.unavailable(request, 'fingerprint-mismatch', startedAt);
    }
    if (value.decision === 'allow' && Date.parse(request.deadlineAt) <= this.now()) return this.unavailable(request, 'timeout', startedAt);
    const decision = value.decision;
    return ApprovalReviewDecisionRecordSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewId: request.reviewId,
      decision,
      reasonCode: value.reasonCode,
      explanation: value.explanation,
      reviewerRevision: this.snapshot.reviewerRevision,
      policyRevision: request.policyRevision,
      latencyMs: boundedLatency(this.now() - startedAt),
      expiresAt: decision === 'allow' ? request.deadlineAt : null,
      approvalKeyFingerprint: request.approvalKeyFingerprint,
      reviewedAt: new Date(this.now()).toISOString(),
    });
  }

  private unavailable(request: ApprovalReviewRequest, reasonCode: Parameters<typeof reasonMessage>[0], startedAt: number): ApprovalReviewDecisionRecord {
    return ApprovalReviewDecisionRecordSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewId: request.reviewId,
      decision: 'unavailable',
      reasonCode,
      explanation: reasonMessage(reasonCode),
      reviewerRevision: this.snapshot.reviewerRevision,
      policyRevision: request.policyRevision,
      latencyMs: boundedLatency(this.now() - startedAt),
      expiresAt: null,
      approvalKeyFingerprint: request.approvalKeyFingerprint,
      reviewedAt: new Date(this.now()).toISOString(),
    });
  }
}

/** Reviewer bound to the provider profile explicitly resolved by the daemon. */
export class DedicatedApprovalReviewer extends ProviderApprovalReviewer {
  constructor(options: DedicatedApprovalReviewerOptions) {
    super({ ...options, expectedSource: 'dedicated', expectedDedicatedProfileId: options.dedicatedProfileId });
  }
}

/** Reviewer bound to the provider snapshot captured by the current run. */
export class SameAsRunApprovalReviewer extends ProviderApprovalReviewer {
  constructor(options: SameAsRunApprovalReviewerOptions) {
    super({ ...options, expectedSource: 'same-as-run' });
  }
}

function mapProviderError(code: string): 'provider-unavailable' | 'timeout' | 'cancelled' | 'malformed-response' | 'schema-mismatch' {
  if (/(?:TIMEOUT|TIMED_OUT)/iu.test(code)) return 'timeout';
  if (/(?:CANCEL|ABORT)/iu.test(code)) return 'cancelled';
  if (/(?:MALFORMED|INVALID_JSON|STREAM_ENDED)/iu.test(code)) return 'malformed-response';
  if (/(?:SCHEMA|UNSUPPORTED)/iu.test(code)) return 'schema-mismatch';
  return 'provider-unavailable';
}

function reasonMessage(reason: 'reviewer-disabled' | 'provider-unavailable' | 'revision-stale' | 'ineligible-risk' | 'ineligible-trust' | 'ineligible-sandbox' | 'request-too-large' | 'response-too-large' | 'timeout' | 'cancelled' | 'malformed-response' | 'schema-mismatch' | 'fingerprint-mismatch'): string {
  const messages: Record<typeof reason, string> = {
    'reviewer-disabled': 'LLM approval review is disabled.',
    'provider-unavailable': 'The run reviewer provider is unavailable.',
    'revision-stale': 'The reviewer or policy snapshot is stale.',
    'ineligible-risk': 'This operation is outside the low-risk reviewer scope.',
    'ineligible-trust': 'Untrusted content is not eligible for reviewer automation.',
    'ineligible-sandbox': 'The required permission or sandbox readiness is not available.',
    'request-too-large': 'The bounded reviewer request exceeded its byte limit.',
    'response-too-large': 'The bounded reviewer response exceeded its byte limit.',
    timeout: 'The bounded reviewer request timed out.',
    cancelled: 'The bounded reviewer request was cancelled.',
    'malformed-response': 'The reviewer returned an incomplete or malformed response.',
    'schema-mismatch': 'The reviewer response did not match the strict contract.',
    'fingerprint-mismatch': 'The reviewer response did not match the exact approval key.',
  };
  return messages[reason];
}

function boundedLatency(value: number): number {
  return Math.max(0, Math.min(120_000, Number.isSafeInteger(value) ? value : 120_000));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
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
