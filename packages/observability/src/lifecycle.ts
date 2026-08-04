import { createHash } from 'node:crypto';
import {
  AuditEventSchema,
  ModelUsageRecordSchema,
  ResourceSampleSchema,
  ToolUsageRecordSchema,
  findObservabilityPrivacyViolations,
  type AuditEvent,
  type ModelUsageRecord,
  type ResourceSample,
  type ToolUsageRecord,
} from '@ready4vibe/contracts';
import { canonicalObservabilityJson } from './index.js';
import type { AuditEventDraft } from './index.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

export type ObservabilityLifecyclePhase = 'create' | 'retry' | 'pause' | 'cancel' | 'recover' | 'terminal';
export type ObservabilityLifecycleSampling = 'enabled' | 'disabled';
export type ObservabilityTerminalStatus = 'completed' | 'failed' | 'cancelled' | 'timed-out' | 'needs-recovery';

/**
 * The only write shape accepted by the lifecycle adapter. It deliberately
 * mirrors the existing ledger batch without importing the storage package, so
 * the application boundary remains dependency-direction safe.
 */
export interface ObservabilityLifecycleBatch {
  readonly resourceSamples?: readonly ResourceSample[];
  readonly modelUsages?: readonly ModelUsageRecord[];
  readonly toolUsages?: readonly ToolUsageRecord[];
  readonly auditEvents?: readonly AuditEventDraft[];
}

export interface ObservabilityLifecycleWriter {
  readonly appendBatch: (batch: ObservabilityLifecycleBatch) => Promise<unknown>;
}

export interface ObservabilityAttemptObservation {
  readonly modelUsage?: ModelUsageRecord;
  readonly toolUsage?: ToolUsageRecord;
  readonly resourceSample?: ResourceSample;
  readonly audit?: AuditEventDraft;
}

export interface ObservabilityLifecycleAttempt {
  readonly runId: string;
  readonly logicalAttemptId: string;
  readonly attempt: number;
  readonly phase: ObservabilityLifecyclePhase;
  readonly at: string;
  readonly sampling?: ObservabilityLifecycleSampling;
  readonly terminalStatus?: ObservabilityTerminalStatus;
  readonly observation: ObservabilityAttemptObservation;
}

export interface ObservabilityLifecycleTransition extends ObservabilityLifecycleAttempt {
  /** Stable delivery key for a transition. It is not persisted in the ledger. */
  readonly transitionId?: string;
}

export type ObservabilityLifecycleResultStatus = 'recorded' | 'noop' | 'ignored' | 'conflict' | 'rejected' | 'degraded';

export interface ObservabilityLifecycleResult {
  readonly status: ObservabilityLifecycleResultStatus;
  readonly logicalAttemptId: string;
  readonly fingerprint?: string;
  readonly errorCode?:
    | 'OBSERVABILITY_LIFECYCLE_CONFLICT'
    | 'OBSERVABILITY_LIFECYCLE_PRIVACY'
    | 'OBSERVABILITY_LIFECYCLE_INVALID'
    | 'OBSERVABILITY_LIFECYCLE_WRITE_FAILED'
    | 'OBSERVABILITY_LIFECYCLE_TRANSITION_INVALID';
  readonly batch?: ObservabilityLifecycleBatch;
}

export class ObservabilityLifecycleConflictError extends Error {
  readonly code = 'OBSERVABILITY_LIFECYCLE_CONFLICT';

  constructor(readonly logicalAttemptId: string) {
    super('A logical attempt was already recorded with different lifecycle facts.');
    this.name = 'ObservabilityLifecycleConflictError';
  }
}

/**
 * Application-only lifecycle recorder for 50-R1. It never executes a run or
 * reconstructs one from events. Callers provide bounded usage/resource/audit
 * facts and this class performs validation, one-attempt idempotency and
 * fail-soft delivery to the existing observability writer.
 */
export class ObservabilityLifecycleRecorder {
  private readonly writer: ObservabilityLifecycleWriter;
  private readonly recorded = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<ObservabilityLifecycleResult>>();
  private readonly inFlightFingerprints = new Map<string, string>();
  private readonly transitions = new Map<string, Map<string, string>>();
  private readonly terminalAttempts = new Set<string>();

  constructor(writer: ObservabilityLifecycleWriter) {
    this.writer = writer;
  }

  /**
   * Records the final bounded facts for one logical attempt. Repeating the
   * same canonical payload is a no-op; changing it is a conflict. A writer
   * failure does not mark the attempt as recorded, allowing a later append
   * retry without ever re-running a model/tool/shell operation.
   */
  async record(input: ObservabilityLifecycleAttempt): Promise<ObservabilityLifecycleResult> {
    const validated = validateAttempt(input);
    if (!validated.ok) return validated.result;
    const { attempt, batch, fingerprint } = validated;
    const existing = this.recorded.get(attempt.logicalAttemptId);
    if (existing !== undefined) {
      if (existing !== fingerprint) return conflictResult(attempt.logicalAttemptId);
      return { status: 'noop', logicalAttemptId: attempt.logicalAttemptId, fingerprint };
    }
    const active = this.inFlight.get(attempt.logicalAttemptId);
    if (active) {
      if (this.inFlightFingerprints.get(attempt.logicalAttemptId) !== fingerprint) return conflictResult(attempt.logicalAttemptId);
      // A different payload must fail closed even while the first write is in
      // flight. The same payload shares the one writer call.
      const activeResult = await active;
      if (activeResult.status === 'recorded' && activeResult.fingerprint === fingerprint) {
        return { status: 'noop', logicalAttemptId: attempt.logicalAttemptId, fingerprint };
      }
      if (activeResult.status === 'degraded') return activeResult;
      return conflictResult(attempt.logicalAttemptId);
    }

    const pending = this.writeOnce(attempt.logicalAttemptId, batch, fingerprint);
    this.inFlight.set(attempt.logicalAttemptId, pending);
    this.inFlightFingerprints.set(attempt.logicalAttemptId, fingerprint);
    try {
      return await pending;
    } finally {
      if (this.inFlight.get(attempt.logicalAttemptId) === pending) {
        this.inFlight.delete(attempt.logicalAttemptId);
        this.inFlightFingerprints.delete(attempt.logicalAttemptId);
      }
    }
  }

  /**
   * Replays a lifecycle transition without touching a writer until `terminal`.
   * This is the fake RunManager/application fixture seam: create/retry/pause/
   * cancel/recover are metadata-only and terminal emits exactly one batch.
   */
  async transition(input: ObservabilityLifecycleTransition): Promise<ObservabilityLifecycleResult> {
    const validated = validateAttempt(input);
    if (!validated.ok) return validated.result;
    const { attempt, batch } = validated;
    const transitionId = input.transitionId ?? `${attempt.phase}:${attempt.at}`;
    const transitionFingerprint = fingerprintValue({
      runId: attempt.runId,
      logicalAttemptId: attempt.logicalAttemptId,
      attempt: attempt.attempt,
      phase: attempt.phase,
      at: attempt.at,
      sampling: attempt.sampling ?? 'enabled',
      ...(attempt.terminalStatus === undefined ? {} : { terminalStatus: attempt.terminalStatus }),
      batch,
    });
    const transitions = this.transitions.get(attempt.logicalAttemptId) ?? new Map<string, string>();
    const previous = transitions.get(transitionId);
    if (previous !== undefined) {
      if (previous !== transitionFingerprint) return conflictResult(attempt.logicalAttemptId);
      if (attempt.phase === 'terminal') {
        const recordedFingerprint = this.recorded.get(attempt.logicalAttemptId);
        if (recordedFingerprint !== undefined) {
          return { status: 'noop', logicalAttemptId: attempt.logicalAttemptId, fingerprint: recordedFingerprint };
        }
        this.terminalAttempts.add(attempt.logicalAttemptId);
        const retryResult = await this.record(attempt);
        if (retryResult.status !== 'recorded' && retryResult.status !== 'noop') this.terminalAttempts.delete(attempt.logicalAttemptId);
        return retryResult;
      }
      return { status: 'noop', logicalAttemptId: attempt.logicalAttemptId, fingerprint: transitionFingerprint };
    }
    if (this.terminalAttempts.has(attempt.logicalAttemptId)) return conflictResult(attempt.logicalAttemptId);
    if (!isAllowedTransition(transitions, attempt.phase)) {
      return {
        status: 'rejected',
        logicalAttemptId: attempt.logicalAttemptId,
        errorCode: 'OBSERVABILITY_LIFECYCLE_TRANSITION_INVALID',
      };
    }
    transitions.set(transitionId, transitionFingerprint);
    this.transitions.set(attempt.logicalAttemptId, transitions);
    if (attempt.phase !== 'terminal') {
      return { status: 'ignored', logicalAttemptId: attempt.logicalAttemptId, fingerprint: transitionFingerprint };
    }
    this.terminalAttempts.add(attempt.logicalAttemptId);
    const result = await this.record(attempt);
    if (result.status === 'degraded' || result.status === 'rejected' || result.status === 'conflict') {
      // A failed terminal delivery may be retried with the same transition;
      // retain the transition fingerprint but allow record() to retry.
      this.terminalAttempts.delete(attempt.logicalAttemptId);
    }
    return result;
  }

  private async writeOnce(logicalAttemptId: string, batch: ObservabilityLifecycleBatch, fingerprint: string): Promise<ObservabilityLifecycleResult> {
    try {
      await this.writer.appendBatch(batch);
      this.recorded.set(logicalAttemptId, fingerprint);
      return { status: 'recorded', logicalAttemptId, fingerprint, batch };
    } catch {
      return {
        status: 'degraded',
        logicalAttemptId,
        fingerprint,
        errorCode: 'OBSERVABILITY_LIFECYCLE_WRITE_FAILED',
        batch,
      };
    }
  }
}

/**
 * Tiny deterministic fixture that resembles the RunManager lifecycle without
 * constructing AgentLoop or invoking any external runtime. Tests can use it
 * to make the transition order explicit and then inspect the writer batches.
 */
export class FakeRunManagerLifecycleFixture {
  constructor(private readonly recorder: ObservabilityLifecycleRecorder) {}

  create(input: Omit<ObservabilityLifecycleTransition, 'phase'>): Promise<ObservabilityLifecycleResult> {
    return this.recorder.transition({ ...input, phase: 'create' });
  }

  retry(input: Omit<ObservabilityLifecycleTransition, 'phase'>): Promise<ObservabilityLifecycleResult> {
    return this.recorder.transition({ ...input, phase: 'retry' });
  }

  pause(input: Omit<ObservabilityLifecycleTransition, 'phase'>): Promise<ObservabilityLifecycleResult> {
    return this.recorder.transition({ ...input, phase: 'pause' });
  }

  cancel(input: Omit<ObservabilityLifecycleTransition, 'phase'>): Promise<ObservabilityLifecycleResult> {
    return this.recorder.transition({ ...input, phase: 'cancel' });
  }

  recover(input: Omit<ObservabilityLifecycleTransition, 'phase'>): Promise<ObservabilityLifecycleResult> {
    return this.recorder.transition({ ...input, phase: 'recover' });
  }

  terminal(input: Omit<ObservabilityLifecycleTransition, 'phase'>): Promise<ObservabilityLifecycleResult> {
    return this.recorder.transition({ ...input, phase: 'terminal' });
  }
}

function validateAttempt(input: ObservabilityLifecycleAttempt):
  | { readonly ok: true; readonly attempt: ObservabilityLifecycleAttempt; readonly batch: ObservabilityLifecycleBatch; readonly fingerprint: string }
  | { readonly ok: false; readonly result: ObservabilityLifecycleResult } {
  const logicalAttemptId = input && typeof input.logicalAttemptId === 'string' ? input.logicalAttemptId : 'invalid';
  const base = { logicalAttemptId };
  try {
    if (!isSafeId(input.runId) || !isSafeId(input.logicalAttemptId) || !isSafeId(String(input.attempt))) throw new Error('id');
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 128) throw new Error('attempt');
    if (!isIsoTimestamp(input.at)) throw new Error('timestamp');
    if (!['create', 'retry', 'pause', 'cancel', 'recover', 'terminal'].includes(input.phase)) throw new Error('phase');
    if (input.sampling !== undefined && input.sampling !== 'enabled' && input.sampling !== 'disabled') throw new Error('sampling');
    if (input.phase === 'terminal' && input.terminalStatus === undefined) throw new Error('terminal status');
    if (input.terminalStatus !== undefined && !['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(input.terminalStatus)) throw new Error('terminal status');
    const observation = input.observation;
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('observation');
    const modelUsage = observation.modelUsage === undefined ? undefined : ModelUsageRecordSchema.parse(observation.modelUsage);
    const toolUsage = observation.toolUsage === undefined ? undefined : ToolUsageRecordSchema.parse(observation.toolUsage);
    const resourceSample = observation.resourceSample === undefined ? undefined : ResourceSampleSchema.parse(observation.resourceSample);
    const audit = observation.audit === undefined ? undefined : parseAuditDraft(observation.audit);
    if (modelUsage && modelUsage.runId !== input.runId) throw new Error('model run id');
    if (toolUsage && toolUsage.runId !== input.runId) throw new Error('tool run id');
    if (resourceSample && resourceSample.runId !== input.runId) throw new Error('resource run id');
    if (modelUsage && modelUsage.attempt !== input.attempt) throw new Error('model attempt');
    if (toolUsage && toolUsage.attempt !== input.attempt) throw new Error('tool attempt');
    const batch: ObservabilityLifecycleBatch = {
      ...(modelUsage === undefined ? {} : { modelUsages: [modelUsage] }),
      ...(toolUsage === undefined ? {} : { toolUsages: [toolUsage] }),
      ...(input.sampling === 'disabled' || resourceSample === undefined ? {} : { resourceSamples: [resourceSample] }),
      ...(audit === undefined ? {} : { auditEvents: [audit] }),
    };
    const fingerprint = fingerprintValue({
      runId: input.runId,
      logicalAttemptId: input.logicalAttemptId,
      attempt: input.attempt,
      phase: input.phase,
      at: input.at,
      sampling: input.sampling ?? 'enabled',
      ...(input.terminalStatus === undefined ? {} : { terminalStatus: input.terminalStatus }),
      batch,
    });
    return { ok: true, attempt: input, batch, fingerprint };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const privacy = hasPrivacyViolation(input);
    return {
      ok: false,
      result: {
        status: 'rejected',
        ...base,
        errorCode: privacy ? 'OBSERVABILITY_LIFECYCLE_PRIVACY' : 'OBSERVABILITY_LIFECYCLE_INVALID',
        ...(message ? {} : {}),
      },
    };
  }
}

function parseAuditDraft(value: AuditEventDraft): AuditEventDraft {
  const candidate = AuditEventSchema.parse({
    ...value,
    appendSequence: 1,
    previousHash: null,
    eventHash: '0'.repeat(64),
  });
  const { appendSequence: _appendSequence, previousHash: _previousHash, eventHash: _eventHash, ...draft } = candidate;
  return draft;
}

function isAllowedTransition(transitions: ReadonlyMap<string, string>, phase: ObservabilityLifecyclePhase): boolean {
  if (transitions.size === 0) return phase === 'create' || phase === 'retry' || phase === 'recover' || phase === 'terminal';
  if (phase === 'terminal') return true;
  if (phase === 'pause' || phase === 'cancel' || phase === 'recover') return true;
  if (phase === 'retry') return true;
  return false;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !SECRET_VALUE.test(value) && !isAbsolutePath(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
}

function containsAbsolutePath(value: unknown): boolean {
  if (typeof value === 'string') return isAbsolutePath(value);
  if (Array.isArray(value)) return value.some((item) => containsAbsolutePath(item));
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some((item) => containsAbsolutePath(item));
}

function hasPrivacyViolation(value: unknown): boolean {
  try {
    return findObservabilityPrivacyViolations(value).length > 0 || containsAbsolutePath(value);
  } catch {
    // A cyclic/uninspectable object is not safe to classify as a valid
    // lifecycle fact. Treat it as privacy-invalid rather than serializing it.
    return true;
  }
}

function conflictResult(logicalAttemptId: string): ObservabilityLifecycleResult {
  return { status: 'conflict', logicalAttemptId, errorCode: 'OBSERVABILITY_LIFECYCLE_CONFLICT' };
}

function fingerprintValue(value: unknown): string {
  return createHash('sha256').update(canonicalObservabilityJson(value), 'utf8').digest('hex');
}

export function readLifecycleAudit(result: unknown): AuditEvent | undefined {
  if (!result || typeof result !== 'object' || !('auditEvents' in result)) return undefined;
  const events = (result as { auditEvents?: unknown }).auditEvents;
  if (!Array.isArray(events) || events.length === 0) return undefined;
  try {
    return AuditEventSchema.parse(events[0]);
  } catch {
    return undefined;
  }
}
