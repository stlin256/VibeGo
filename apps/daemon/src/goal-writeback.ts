import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import {
  GoalEvidenceRefsSchema,
  GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION,
  GOAL_VERIFIER_INPUT_SCHEMA_VERSION,
  GOAL_VERIFIER_RESULT_SCHEMA_VERSION,
  GoalVerifierInputV1Schema,
  GoalVerifierResultV1Schema,
  GoalValidationEvidenceV1Schema,
  GoalObjectiveSnapshotV1Schema,
  GoalRunBindingV1Schema,
  type GoalControlProjectionV1,
  type GoalRecoveryStatusV1,
  type GoalRunBindingV1,
  type TodoTaskClass,
  type GoalValidationEvidenceV1,
  type GoalVerifierInputV1,
  type GoalVerifierResultV1,
  type PermissionProfileRunSnapshot,
  type RunStatus,
  type StoredEvent,
} from '@ready4vibe/contracts';
import {
  GoalControlProjectionBuilder,
  GoalControlV1WriteService,
  type GoalControlEventStoreV1,
} from '@ready4vibe/goal-control';
import type { RunManager, RunSnapshot } from './run-manager.js';
import type { GoalVerifierRegistry, GoalVerifierResolution } from './goal-verifier-registry.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const RUN_ID = /^run_[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;
const TERMINAL_RUN_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.needs_recovery']);
const TERMINAL_STATUSES = new Set<RunStatus>(['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery']);
const GOAL_VERIFIER_TIMEOUT = Symbol('goal-verifier-timeout');
export const DEFAULT_GOAL_VERIFIER_TIMEOUT_MS = 10_000;
export const MIN_GOAL_VERIFIER_TIMEOUT_MS = 100;
export const MAX_GOAL_VERIFIER_TIMEOUT_MS = 30_000;

export interface GoalRunEventDigest {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly at: string;
}

/** Application aliases keep the verifier port versioned at compile time. */
export type GoalRunVerifierInput = GoalVerifierInputV1;
/** Implementations may omit the envelope; writeback canonicalizes it. */
export type GoalRunVerifierResult = Omit<GoalVerifierResultV1, 'schemaVersion'>;

export interface GoalRunVerifier {
  /** Implementations should stop external work when the signal is aborted. */
  verify(input: GoalRunVerifierInput, signal?: AbortSignal): Promise<GoalRunVerifierResult>;
}

/** Default composition is intentionally fail-closed: model self-report is not proof. */
export class FailClosedGoalRunVerifier implements GoalRunVerifier {
  async verify(_input: GoalRunVerifierInput): Promise<GoalRunVerifierResult> {
    return {
      status: 'inconclusive',
      verifierId: 'fail_closed',
      verifierRevision: 1,
      summary: 'No task-specific verifier is configured; terminal result is inconclusive.',
      refs: {},
    };
  }
}

export interface GoalRunWritebackOptions {
  readonly goalStore: GoalControlEventStoreV1;
  readonly runManager: RunManager;
  readonly goalControl?: GoalControlV1WriteService;
  readonly verifier?: GoalRunVerifier;
  /** Optional explicit task-class registry; when supplied, missing lanes fail closed. */
  readonly verifierRegistry?: GoalVerifierRegistry;
  readonly admitGoverned?: (input: unknown, options?: { readonly permissionSnapshot?: PermissionProfileRunSnapshot }) => Promise<unknown>;
  readonly clock?: () => Date;
  readonly producer?: string;
  /** Server-owned verifier deadline; never sourced from Web/Goal payloads. */
  readonly verifierTimeoutMs?: number;
}

export interface GoalRunWritebackReconciliationResult {
  readonly bindings: number;
  readonly terminalRuns: number;
  readonly recovered: number;
  readonly skipped: number;
}

interface Registration {
  readonly binding: GoalRunBindingV1;
  readonly unsubscribe: () => void;
  readonly verifierSnapshot?: Promise<GoalVerifierResolution>;
}

/**
 * Daemon application coordinator for governed terminal validation. It only
 * reads run_events through RunManager and writes bounded Goal events through
 * GoalControlV1WriteService; it never executes a model, tool or scheduler.
 */
export class GoalRunWritebackService {
  private readonly builder = new GoalControlProjectionBuilder();
  private readonly goalControl: GoalControlV1WriteService;
  private readonly verifier: GoalRunVerifier;
  private readonly verifierRegistry: GoalVerifierRegistry | undefined;
  private readonly clock: () => Date;
  private readonly producer: string;
  private readonly verifierTimeoutMs: number;
  private readonly registrations = new Map<string, Registration>();
  private readonly runLocks = new Map<string, Promise<void>>();

  constructor(private readonly options: GoalRunWritebackOptions) {
    this.goalControl = options.goalControl ?? new GoalControlV1WriteService(options.goalStore, {
      producer: options.producer ?? 'daemon-goal-writeback',
      clock: () => this.now(),
    });
    this.verifier = options.verifier ?? new FailClosedGoalRunVerifier();
    this.verifierRegistry = options.verifierRegistry;
    this.clock = options.clock ?? (() => new Date());
    this.producer = options.producer ?? 'daemon-goal-writeback';
    if (!SAFE_ID.test(this.producer)) throw new Error('Goal writeback producer is invalid.');
    this.verifierTimeoutMs = options.verifierTimeoutMs ?? DEFAULT_GOAL_VERIFIER_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.verifierTimeoutMs)
      || this.verifierTimeoutMs < MIN_GOAL_VERIFIER_TIMEOUT_MS
      || this.verifierTimeoutMs > MAX_GOAL_VERIFIER_TIMEOUT_MS) {
      throw new Error(`Goal verifier timeout must be an integer between ${MIN_GOAL_VERIFIER_TIMEOUT_MS} and ${MAX_GOAL_VERIFIER_TIMEOUT_MS} ms.`);
    }
  }

  /** Subscribe before RunManager.start so run.created/terminal races are observable. */
  registerBinding(bindingInput: unknown, taskClass?: TodoTaskClass): () => void {
    const binding = GoalRunBindingV1Schema.parse(bindingInput);
    const existing = this.registrations.get(binding.runId);
    if (existing) {
      if (existing.binding.bindingId !== binding.bindingId) throw new Error('A run id is already registered to another Goal binding.');
      return () => undefined;
    }
    const verifierSnapshot = this.verifierRegistry
      ? Promise.resolve(taskClass === undefined ? this.captureVerifier(binding) : this.verifierRegistry.resolve(taskClass))
      : undefined;
    const unsubscribe = this.options.runManager.subscribe(binding.runId, (event) => {
      if (!isTerminalEvent(event)) return;
      void this.withRunLock(binding.runId, () => this.processTerminal(binding, event, verifierSnapshot)).catch(() => undefined);
    });
    this.registrations.set(binding.runId, { binding, unsubscribe, ...(verifierSnapshot ? { verifierSnapshot } : {}) });
    return () => this.unregister(binding.runId, binding.bindingId);
  }

  unregister(runId: string, bindingId?: string): void {
    const registration = this.registrations.get(runId);
    if (!registration || (bindingId !== undefined && registration.binding.bindingId !== bindingId)) return;
    registration.unsubscribe();
    this.registrations.delete(runId);
  }

  async reconcile(): Promise<GoalRunWritebackReconciliationResult> {
    let bindings = 0;
    let terminalRuns = 0;
    let recovered = 0;
    let skipped = 0;
    for (const goalId of this.options.goalStore.listGoalIds()) {
      let projection: GoalControlProjectionV1;
      try {
        projection = this.builder.build(await this.options.goalStore.read(goalId));
      } catch {
        skipped += 1;
        continue;
      }
      for (const binding of projection.bindings.filter((candidate) => candidate.mode === 'governed')) {
        bindings += 1;
        this.registerBinding(binding);
        const events = await this.options.runManager.readEvents(binding.runId);
        const terminal = findTerminalEvent(events);
        if (!terminal) {
          // A persisted binding without run_events is intentionally not
          // auto-started. The explicit governed admission retry can recover it.
          recovered += 1;
          continue;
        }
        terminalRuns += 1;
        const verifierSnapshot = this.registrations.get(binding.runId)?.verifierSnapshot;
        await this.withRunLock(binding.runId, () => this.processTerminal(binding, terminal, verifierSnapshot));
      }
    }
    return { bindings, terminalRuns, recovered, skipped };
  }

  /** Create a fresh governed attempt; the old run and tool calls are never replayed. */
  async retryGoverned(runId: string, input: { agentId: string }, runOptions: { readonly permissionSnapshot?: PermissionProfileRunSnapshot } = {}): Promise<unknown | 'not-found' | 'not-recoverable' | 'unavailable'> {
    if (!RUN_ID.test(runId) || !SAFE_ID.test(input.agentId)) return 'not-recoverable';
    const snapshot = await this.options.runManager.snapshot(runId);
    if (!snapshot) return 'not-found';
    if (snapshot.status === 'completed' || !TERMINAL_STATUSES.has(snapshot.status)) return 'not-recoverable';
    const binding = this.registrations.get(runId)?.binding ?? await this.findBinding(runId);
    if (!binding || !this.options.admitGoverned) return 'unavailable';
    const events = await this.options.goalStore.read(binding.goalId);
    const projection = this.builder.build(events);
    const requestId = `request_recovery_${uuidv7()}`;
    const turnKey = `turn_recovery_${uuidv7()}`;
    return this.options.admitGoverned({
      ...snapshot.config,
      runMode: 'governed',
      goalId: binding.goalId,
      ...(binding.todoId ? { todoId: binding.todoId } : {}),
      expectedControlRevision: projection.controlRevision,
      agentId: input.agentId,
      turnKey,
      attempt: binding.attempt + 1,
      requestId,
      clientRequestId: `client_${uuidv7()}`,
    }, runOptions);
  }

  close(): void {
    for (const registration of this.registrations.values()) registration.unsubscribe();
    this.registrations.clear();
  }

  private async processTerminal(
    binding: GoalRunBindingV1,
    terminalEvent: StoredEvent | GoalRunEventDigest,
    verifierSnapshot?: Promise<GoalVerifierResolution>,
  ): Promise<void> {
    const events = await this.options.runManager.readEvents(binding.runId);
    const fallbackTerminal = 'version' in terminalEvent ? digestEvent(terminalEvent) : terminalEvent;
    const terminal = findTerminalEvent(events) ?? fallbackTerminal;
    const snapshot = await this.options.runManager.snapshot(binding.runId);
    if (!snapshot) return;
    if (snapshot.status === 'needs-recovery' || terminal.type === 'run.needs_recovery') {
      await this.writeRecovery(binding, terminal, 'needs_recovery', 'Run requires explicit governed recovery after daemon restart.');
      return;
    }
    const existingEvidence = await this.findValidation(binding);
    if (existingEvidence) {
      if (existingEvidence.status !== 'validated') {
        await this.releaseReservation(binding, 'terminal-validation-not-validated');
        return;
      }
      await this.finalize(binding, existingEvidence);
      return;
    }

    let result: GoalRunVerifierResult;
    if (snapshot.status !== 'completed') {
      result = {
        status: snapshot.status === 'timed-out' ? 'inconclusive' : 'failed',
        verifierId: 'terminal_status',
        verifierRevision: 1,
        summary: boundedSummary(`Run ended with status ${snapshot.status}; no Todo completion was attempted.`),
        refs: { runId: binding.runId, eventIds: [terminal.id] },
      };
    } else {
      result = await this.verify(binding, snapshot, terminal, events, verifierSnapshot);
    }
    const evidence = await this.writeValidation(binding, terminal, result);
    if (evidence.status !== 'validated' || snapshot.status !== 'completed') {
      await this.releaseReservation(binding, 'terminal-validation-not-validated');
      return;
    }
    await this.finalize(binding, evidence);
  }

  private async verify(
    binding: GoalRunBindingV1,
    snapshot: RunSnapshot,
    terminal: GoalRunEventDigest,
    events: readonly StoredEvent[],
    verifierSnapshot?: Promise<GoalVerifierResolution>,
  ): Promise<GoalRunVerifierResult> {
    let projection: GoalControlProjectionV1;
    try {
      projection = this.builder.build(await this.options.goalStore.read(binding.goalId));
    } catch {
      return {
        status: 'inconclusive',
        verifierId: 'goal_projection_unavailable',
        verifierRevision: 0,
        summary: 'Validation was inconclusive because the authoritative Goal projection was unavailable.',
        refs: { runId: binding.runId, eventIds: [terminal.id] },
      };
    }
    const taskClass = projection.todos.find((todo) => todo.todoId === binding.todoId)?.taskClass ?? null;
    const todo = projection.todos.find((candidate) => candidate.todoId === binding.todoId);
    const objectiveBase = projection.goal && todo ? {
      schemaVersion: 'ready4vibe_goal_objective_snapshot_v1' as const,
      goalId: projection.goal.goalId,
      todoId: todo.todoId,
      objective: projection.goal.objective,
      todoTitle: todo.title,
      ...(todo.verificationPlan ? { verificationPlan: todo.verificationPlan } : {}),
    } : undefined;
    const objective = objectiveBase ? GoalObjectiveSnapshotV1Schema.parse({
      ...objectiveBase,
      objectiveDigest: hashJson(objectiveBase),
    }) : undefined;
    let input: GoalRunVerifierInput;
    try {
      input = GoalVerifierInputV1Schema.parse({
        schemaVersion: GOAL_VERIFIER_INPUT_SCHEMA_VERSION,
        binding,
        taskClass,
        run: { runId: snapshot.runId, status: snapshot.status, lastEventSeq: snapshot.lastEventSeq, outputBytes: Buffer.byteLength(snapshot.output, 'utf8') },
        terminal: { schemaVersion: GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION, ...terminal },
        events: events.map((event) => ({ schemaVersion: GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION, ...digestEvent(event) })),
        ...(objective ? { objective } : {}),
      });
    } catch {
      return {
        status: 'inconclusive',
        verifierId: 'verifier_input_invalid',
        verifierRevision: 0,
        summary: 'Validation was inconclusive because bounded verifier input was invalid.',
        refs: { runId: binding.runId, eventIds: [terminal.id] },
      };
    }
    let verifier = this.verifier;
    let descriptor: { readonly verifierId: string; readonly verifierRevision: number } | undefined;
    if (this.verifierRegistry) {
      const resolution = await (verifierSnapshot ?? this.captureVerifier(binding));
      if (resolution.status !== 'ready' || !resolution.verifier || !resolution.descriptor) {
        return {
          status: 'inconclusive',
          verifierId: `registry_${resolution.status}`,
          verifierRevision: 0,
          summary: boundedSummary(`Task-specific verifier unavailable: ${resolution.reason}`),
          refs: { runId: binding.runId, eventIds: [terminal.id] },
        };
      }
      verifier = resolution.verifier;
      descriptor = resolution.descriptor;
    }
    try {
      const candidate = normalizeVerifierResult(
        await this.verifyWithDeadline(verifier, input, terminal.id, binding.runId),
        terminal.id,
        binding.runId,
      );
      if (descriptor && (candidate.verifierId !== descriptor.verifierId || candidate.verifierRevision !== descriptor.verifierRevision)) {
        return {
          status: 'inconclusive',
          verifierId: 'verifier_mismatch',
          verifierRevision: 0,
          summary: 'Validation was inconclusive because the verifier identity or revision did not match its descriptor.',
          refs: { runId: binding.runId, eventIds: [terminal.id] },
        };
      }
      return candidate;
    } catch {
      return {
        status: 'inconclusive',
        verifierId: 'verifier_failure',
        verifierRevision: 0,
        summary: 'Validation was inconclusive because the verifier failed.',
        refs: { runId: binding.runId, eventIds: [terminal.id] },
      };
    }
  }

  private async verifyWithDeadline(
    verifier: GoalRunVerifier,
    input: GoalRunVerifierInput,
    terminalEventId: string,
    runId: string,
  ): Promise<GoalRunVerifierResult> {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(GOAL_VERIFIER_TIMEOUT);
      }, this.verifierTimeoutMs);
    });
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => verifier.verify(input, controller.signal)),
        timeout,
      ]);
      return result;
    } catch (error) {
      if (timedOut || error === GOAL_VERIFIER_TIMEOUT) {
        return {
          status: 'inconclusive',
          verifierId: 'verifier_timeout',
          verifierRevision: 0,
          summary: 'Validation timed out; no Todo completion was attempted.',
          refs: { runId, eventIds: [terminalEventId] },
        };
      }
      return {
        status: 'inconclusive',
        verifierId: 'verifier_failure',
        verifierRevision: 0,
        summary: 'Validation was inconclusive because the verifier failed.',
        refs: { runId, eventIds: [terminalEventId] },
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
    }
  }

  private async captureVerifier(binding: GoalRunBindingV1): Promise<GoalVerifierResolution> {
    if (!this.verifierRegistry) {
      return { status: 'missing', reason: 'No task-specific verifier registry is configured.' };
    }
    try {
      const projection = this.builder.build(await this.options.goalStore.read(binding.goalId));
      const taskClass = projection.todos.find((todo) => todo.todoId === binding.todoId)?.taskClass ?? null;
      return this.verifierRegistry.resolve(taskClass);
    } catch {
      return { status: 'blocked', reason: 'The authoritative Goal projection was unavailable during verifier capture.' };
    }
  }

  private async writeValidation(binding: GoalRunBindingV1, terminal: GoalRunEventDigest, result: GoalRunVerifierResult): Promise<GoalValidationEvidenceV1> {
    const evidenceId = stableId('evidence', binding.goalId, binding.bindingId, binding.runId, String(binding.attempt));
    const events = await this.options.goalStore.read(binding.goalId);
    const projection = this.builder.build(events);
    const existing = projection.validationEvidence.find((candidate) => candidate.evidenceId === evidenceId);
    if (existing) return existing;
    const evidenceDraft = {
      evidenceId,
      goalId: binding.goalId,
      ...(binding.todoId ? { todoId: binding.todoId } : {}),
      bindingId: binding.bindingId,
      runId: binding.runId,
      attempt: binding.attempt,
      verifierId: result.verifierId,
      verifierRevision: result.verifierRevision,
      status: result.status,
      summary: boundedSummary(result.summary),
      refs: safeRefs(result.refs, binding.runId, terminal.id),
    };
    try {
      const mutation = await this.goalControl.recordValidation(binding.goalId, {
        eventId: stableEventId(binding.goalId, binding.bindingId, 'validation'),
        expectedRevision: projection.controlRevision,
        evidence: evidenceDraft,
      });
      return mutation.projection.validationEvidence.find((candidate) => candidate.evidenceId === evidenceId)
        ?? GoalValidationEvidenceV1Schema.parse({ schemaVersion: 'ready4vibe_goal_validation_evidence_v1', ...evidenceDraft, checkedAt: this.now(), evidenceChecksum: hashJson(evidenceDraft) });
    } catch {
      const replayed = this.builder.build(await this.options.goalStore.read(binding.goalId));
      return replayed.validationEvidence.find((candidate) => candidate.evidenceId === evidenceId)
        ?? GoalValidationEvidenceV1Schema.parse({ schemaVersion: 'ready4vibe_goal_validation_evidence_v1', ...evidenceDraft, checkedAt: this.now(), evidenceChecksum: hashJson(evidenceDraft) });
    }
  }

  private async findValidation(binding: GoalRunBindingV1): Promise<GoalValidationEvidenceV1 | undefined> {
    const evidenceId = stableId('evidence', binding.goalId, binding.bindingId, binding.runId, String(binding.attempt));
    const projection = this.builder.build(await this.options.goalStore.read(binding.goalId));
    return projection.validationEvidence.find((candidate) => candidate.evidenceId === evidenceId);
  }

  private async finalize(binding: GoalRunBindingV1, evidence: GoalValidationEvidenceV1): Promise<void> {
    if (!binding.todoId) return;
    const projection = this.builder.build(await this.options.goalStore.read(binding.goalId));
    const reservation = projection.quota.reservations.find((candidate) => candidate.bindingId === binding.bindingId && candidate.attempt === binding.attempt);
    if (reservation && reservation.status !== 'reserved' && reservation.status !== 'consumed') return;
    if (reservation) {
      await this.goalControl.completeTodoAndConsumeQuota(binding.goalId, {
        todoEventId: stableEventId(binding.goalId, binding.bindingId, 'todo.complete'),
        quotaEventId: stableEventId(binding.goalId, binding.bindingId, 'quota.consume'),
        expectedRevision: projection.controlRevision,
        todoId: binding.todoId,
        evidenceId: evidence.evidenceId,
        reservationId: reservation.reservationId,
      });
      return;
    }
    const todo = projection.todos.find((candidate) => candidate.todoId === binding.todoId);
    if (!todo || todo.status === 'done') return;
    await this.goalControl.completeTodo(binding.goalId, {
      eventId: stableEventId(binding.goalId, binding.bindingId, 'todo.complete'),
      expectedRevision: projection.controlRevision,
      todoId: binding.todoId,
      evidenceId: evidence.evidenceId,
    });
  }

  private async releaseReservation(binding: GoalRunBindingV1, reason: string): Promise<void> {
    const projection = this.builder.build(await this.options.goalStore.read(binding.goalId));
    const reservation = projection.quota.reservations.find((candidate) => candidate.bindingId === binding.bindingId && candidate.attempt === binding.attempt);
    if (!reservation || reservation.status !== 'reserved') return;
    await this.goalControl.releaseQuota(binding.goalId, reservation.reservationId, {
      eventId: stableEventId(binding.goalId, binding.bindingId, 'quota.release'),
      expectedRevision: projection.controlRevision,
      reason,
    });
  }

  private async writeRecovery(binding: GoalRunBindingV1, terminal: GoalRunEventDigest, status: GoalRecoveryStatusV1, reason: string): Promise<void> {
    const projection = this.builder.build(await this.options.goalStore.read(binding.goalId));
    const recoveryId = stableId('recovery', binding.goalId, binding.bindingId, binding.runId, String(binding.attempt));
    if (projection.recoveries.some((candidate) => candidate.recoveryId === recoveryId)) return;
    await this.goalControl.recordRecovery(binding.goalId, {
      eventId: stableEventId(binding.goalId, binding.bindingId, 'recovery'),
      expectedRevision: projection.controlRevision,
      recovery: {
        recoveryId,
        goalId: binding.goalId,
        bindingId: binding.bindingId,
        runId: binding.runId,
        attempt: binding.attempt,
        status,
        reason: boundedSummary(`${reason} Terminal event ${terminal.id}.`),
        requestId: binding.requestId,
      },
    });
  }

  private async findBinding(runId: string): Promise<GoalRunBindingV1 | undefined> {
    for (const goalId of this.options.goalStore.listGoalIds()) {
      const projection = this.builder.build(await this.options.goalStore.read(goalId));
      const binding = projection.bindings.find((candidate) => candidate.runId === runId && candidate.mode === 'governed');
      if (binding) return binding;
    }
    return undefined;
  }

  private async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.runLocks.set(runId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.runLocks.get(runId) === current) this.runLocks.delete(runId);
    }
  }

  private now(): string {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Goal writeback clock must return a valid Date.');
    return value.toISOString();
  }
}

function isTerminalEvent(event: StoredEvent): boolean {
  // RunManager emits the terminal status transition immediately before the
  // explicit run.completed/run.failed/run.cancelled event. Treating the
  // status transition as terminal lets writeback race the final event and
  // permanently record an inconclusive verifier result. The explicit event
  // is the authoritative validation trigger; restart recovery still emits
  // run.needs_recovery and is handled through the same path.
  return TERMINAL_RUN_TYPES.has(event.type);
}

function findTerminalEvent(events: readonly StoredEvent[]): GoalRunEventDigest | undefined {
  const event = [...events].reverse().find(isTerminalEvent);
  return event ? digestEvent(event) : undefined;
}

function digestEvent(event: StoredEvent): GoalRunEventDigest {
  return { id: event.id, seq: event.seq, type: event.type, at: event.at };
}

function normalizeVerifierResult(value: GoalRunVerifierResult, terminalEventId: string, runId: string): GoalRunVerifierResult {
  let parsed: ReturnType<typeof GoalVerifierResultV1Schema.parse>;
  try {
    const candidate = typeof value === 'object' && value !== null && 'schemaVersion' in value
      ? value
      : { ...value, schemaVersion: GOAL_VERIFIER_RESULT_SCHEMA_VERSION };
    parsed = GoalVerifierResultV1Schema.parse(candidate);
  } catch {
    return {
      status: 'inconclusive',
      verifierId: 'verifier_invalid',
      verifierRevision: 0,
      summary: 'Validation was inconclusive because the verifier returned an invalid result.',
      refs: { runId, eventIds: EVENT_ID.test(terminalEventId) ? [terminalEventId] : [] },
    };
  }
  return {
    status: parsed.status,
    verifierId: parsed.verifierId,
    verifierRevision: parsed.verifierRevision,
    summary: boundedSummary(parsed.summary),
    refs: safeRefs(parsed.refs, runId, terminalEventId),
  };
}

function safeRefs(value: GoalRunVerifierResult['refs'] | undefined, runId: string, terminalEventId: string): NonNullable<GoalRunVerifierResult['refs']> {
  try {
    const parsed = GoalEvidenceRefsSchema.parse(value ?? {});
    const result: NonNullable<GoalRunVerifierResult['refs']> = {
      // The binding/run identity is authoritative; a verifier cannot point
      // evidence at another run by returning a different runId.
      runId,
      eventIds: parsed.eventIds?.filter((eventId) => EVENT_ID.test(eventId)).slice(0, 64) ?? (EVENT_ID.test(terminalEventId) ? [terminalEventId] : []),
    };
    return parsed.artifactIds ? { ...result, artifactIds: parsed.artifactIds } : result;
  } catch {
    return { runId, eventIds: EVENT_ID.test(terminalEventId) ? [terminalEventId] : [] };
  }
}

function boundedSummary(value: string): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F\r\n]/gu, ' ').trim();
  const safe = normalized || 'Terminal validation produced no summary.';
  return safe.length > 2_000 ? `${safe.slice(0, 1_997)}...` : safe;
}

function stableId(prefix: 'evidence' | 'recovery', ...parts: readonly string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex').slice(0, 32)}`;
}

function stableEventId(goalId: string, bindingId: string, phase: 'validation' | 'recovery' | 'todo.complete' | 'quota.consume' | 'quota.release'): string {
  return `gevt_${createHash('sha256').update(`${goalId}\u0000${bindingId}\u0000${phase}`, 'utf8').digest('hex').slice(0, 32)}`;
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
