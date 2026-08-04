import { createHash, randomBytes } from 'node:crypto';
import type {
  GoalEvidence,
  GoalEventType,
  GoalGate,
  GoalHandoff,
  GoalProjection,
  GoalRecord,
  GoalShouldRunDecision,
  GoalTodo,
  NewGoalEvent,
  StoredGoalEvent,
} from '@ready4vibe/contracts';
import {
  GoalEvidenceSchema,
  GoalEventTypeSchema,
  GoalGateSchema,
  GoalHandoffSchema,
  GoalProjectionSchema,
  GoalRecordSchema,
  GoalShouldRunDecisionSchema,
  GoalTodoSchema,
  parseNewGoalEvent,
  parseStoredGoalEvent,
} from '@ready4vibe/contracts';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

export interface GoalEventStore {
  append<TPayload = Record<string, unknown>>(event: NewGoalEvent<TPayload>): Promise<StoredGoalEvent<TPayload>>;
  appendBatch<TPayload = Record<string, unknown>>(events: readonly NewGoalEvent<TPayload>[]): Promise<StoredGoalEvent<TPayload>[]>;
  read<TPayload = Record<string, unknown>>(goalId: string, afterSequence?: number): Promise<StoredGoalEvent<TPayload>[]>;
  lastSequence(goalId: string): number;
  close(): void;
}

export class GoalEventConflictError extends Error {
  readonly code = 'GOAL_EVENT_CONFLICT';

  constructor(readonly eventId: string) {
    super('A goal event id was already used with different content.');
    this.name = 'GoalEventConflictError';
  }
}

export class GoalEventStoreError extends Error {
  readonly code = 'GOAL_EVENT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'GoalEventStoreError';
  }
}

/** Deterministic, transaction-shaped store used by Phase 0 tests and adapters. */
export class InMemoryGoalEventStore implements GoalEventStore {
  private readonly events = new Map<string, StoredGoalEvent[]>();
  private readonly byEventId = new Map<string, { fingerprint: string; stored: StoredGoalEvent }>();
  private closed = false;

  async append<TPayload = Record<string, unknown>>(event: NewGoalEvent<TPayload>): Promise<StoredGoalEvent<TPayload>> {
    this.ensureOpen();
    const parsed = parseNewGoalEvent(event);
    const fingerprint = fingerprintGoalEvent(parsed);
    const existing = this.byEventId.get(parsed.eventId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new GoalEventConflictError(parsed.eventId);
      return existing.stored as StoredGoalEvent<TPayload>;
    }
    const stored = this.toStored(parsed, this.lastSequence(parsed.goalId) + 1);
    this.events.set(parsed.goalId, [...(this.events.get(parsed.goalId) ?? []), stored]);
    this.byEventId.set(parsed.eventId, { fingerprint, stored });
    return stored as StoredGoalEvent<TPayload>;
  }

  async appendBatch<TPayload = Record<string, unknown>>(events: readonly NewGoalEvent<TPayload>[]): Promise<StoredGoalEvent<TPayload>[]> {
    this.ensureOpen();
    if (events.length === 0) return [];
    const parsed = events.map((event) => parseNewGoalEvent(event));
    const goalId = parsed[0]?.goalId;
    if (!goalId || parsed.some((event) => event.goalId !== goalId)) throw new GoalEventStoreError('appendBatch requires one goal id');

    const planned = new Map<string, { fingerprint: string; stored: StoredGoalEvent }>();
    const result: StoredGoalEvent[] = [];
    let nextSequence = this.lastSequence(goalId) + 1;
    for (const event of parsed) {
      const fingerprint = fingerprintGoalEvent(event);
      const existing = this.byEventId.get(event.eventId) ?? planned.get(event.eventId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new GoalEventConflictError(event.eventId);
        result.push(existing.stored);
        continue;
      }
      const stored = this.toStored(event, nextSequence++);
      planned.set(event.eventId, { fingerprint, stored });
      result.push(stored);
    }

    const current = this.events.get(goalId) ?? [];
    const additions = [...planned.values()].map((entry) => entry.stored);
    this.events.set(goalId, [...current, ...additions]);
    for (const [eventId, entry] of planned) this.byEventId.set(eventId, entry);
    return result as StoredGoalEvent<TPayload>[];
  }

  async read<TPayload = Record<string, unknown>>(goalId: string, afterSequence = 0): Promise<StoredGoalEvent<TPayload>[]> {
    this.ensureOpen();
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new GoalEventStoreError('afterSequence must be a non-negative integer');
    return (this.events.get(goalId) ?? []).filter((event) => event.appendSequence > afterSequence).map((event) => ({ ...event })) as StoredGoalEvent<TPayload>[];
  }

  listGoalIds(): readonly string[] {
    this.ensureOpen();
    return Object.freeze([...this.events.keys()].sort((left, right) => left.localeCompare(right)));
  }

  lastSequence(goalId: string): number {
    this.ensureOpen();
    return this.events.get(goalId)?.at(-1)?.appendSequence ?? 0;
  }

  close(): void {
    this.closed = true;
  }

  private toStored(event: NewGoalEvent, appendSequence: number): StoredGoalEvent {
    return { ...event, appendSequence, eventId: event.eventId || `gevt_${uuidv7()}` };
  }

  private ensureOpen(): void {
    if (this.closed) throw new GoalEventStoreError('goal event store is closed');
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new GoalEventStoreError('value is not JSON serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function fingerprintGoalEvent(event: NewGoalEvent | StoredGoalEvent): string {
  const { appendSequence: _appendSequence, ...withoutSequence } = event as StoredGoalEvent;
  return createHash('sha256').update(canonicalJson(withoutSequence)).digest('hex');
}

export class GoalProjectionError extends Error {
  readonly code = 'GOAL_PROJECTION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'GoalProjectionError';
  }
}

interface ProjectionState {
  goal: GoalRecord | null;
  todos: Map<string, GoalTodo>;
  gates: Map<string, GoalGate>;
  evidence: Map<string, GoalEvidence>;
  handoffs: Map<string, GoalHandoff>;
  spentTurnKeys: Set<string>;
}

const goalPayload = z.object({ goal: GoalRecordSchema }).strict();
const todoPayload = z.object({ todo: GoalTodoSchema }).strict();
const evidencePayload = z.object({ evidence: GoalEvidenceSchema }).strict();
const gatePayload = z.object({ gate: GoalGateSchema }).strict();
const handoffPayload = z.object({ handoff: GoalHandoffSchema }).strict();
const todoIdPayload = z.object({ todoId: z.string().regex(/^todo_[A-Za-z0-9_-]{8,128}$/u) }).strict();
const claimPayload = todoIdPayload.extend({
  claimedBy: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u),
  claimTokenHash: z.string().regex(/^[a-f0-9]{64}$/u),
  claimedAt: z.string().datetime({ offset: true }),
  claimExpiresAt: z.string().datetime({ offset: true }),
}).strict();
const releasePayload = todoIdPayload.extend({ claimTokenHash: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const deferredPayload = todoIdPayload.extend({ nextDueAt: z.string().datetime({ offset: true }).optional() }).strict();
const blockedPayload = todoIdPayload.extend({ gateId: z.string().regex(/^gate_[A-Za-z0-9_-]{8,128}$/u).optional() }).strict();
const completedPayload = todoIdPayload.extend({
  /** New write API events cite the validated evidence that unlocked completion. */
  evidenceId: z.string().regex(/^evidence_[A-Za-z0-9_-]{8,128}$/u).optional(),
  completedAt: z.string().datetime({ offset: true }).optional(),
}).strict();
const quotaPayload = z.object({ turnKey: z.string().regex(/^turn_[A-Za-z0-9_.:-]{1,160}$/u) }).strict();

export class GoalProjectionBuilder {
  build(events: readonly StoredGoalEvent[]): GoalProjection {
    const parsed = events.map((event) => parseStoredGoalEvent(event));
    const goalId = parsed[0]?.goalId;
    if (parsed.some((event) => event.goalId !== goalId)) throw new GoalProjectionError('all events must belong to one goal');
    const ordered = [...parsed].sort((left, right) => left.appendSequence - right.appendSequence);
    const state: ProjectionState = { goal: null, todos: new Map(), gates: new Map(), evidence: new Map(), handoffs: new Map(), spentTurnKeys: new Set() };

    for (const event of ordered) this.apply(state, event);
    const last = ordered.at(-1);
    const projectedGoal = state.goal ? { ...state.goal, controlRevision: ordered.length } : null;
    const projection: GoalProjection = {
      projectionVersion: 'goal_control_projection_v0',
      goal: projectedGoal,
      todos: [...state.todos.values()].sort((left, right) => left.todoId.localeCompare(right.todoId)),
      gates: [...state.gates.values()].sort((left, right) => left.gateId.localeCompare(right.gateId)),
      evidence: [...state.evidence.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
      handoffs: [...state.handoffs.values()].sort((left, right) => left.handoffId.localeCompare(right.handoffId)),
      quota: { spentTurnKeys: [...state.spentTurnKeys].sort(), totalSpent: state.spentTurnKeys.size },
      lastEventId: last?.eventId ?? null,
      lastAppendSequence: last?.appendSequence ?? 0,
      sourceEventCount: ordered.length,
      sourceChecksum: createHash('sha256').update(canonicalJson(ordered)).digest('hex'),
      controlRevision: ordered.length,
    };
    return GoalProjectionSchema.parse(projection);
  }

  private apply(state: ProjectionState, event: StoredGoalEvent): void {
    const payload = event.payload;
    switch (event.eventType) {
      case 'goal.created': {
        const value = this.parse(event, goalPayload);
        this.assertGoalId(event.goalId, value.goal.goalId);
        if (state.goal) throw new GoalProjectionError('goal.created may only be applied once');
        state.goal = value.goal;
        return;
      }
      case 'goal.updated': {
        const value = this.parse(event, goalPayload);
        this.assertGoalId(event.goalId, value.goal.goalId);
        if (!state.goal) throw new GoalProjectionError('goal.updated requires goal.created');
        state.goal = value.goal;
        return;
      }
      case 'goal.completed': {
        const value = this.parse(event, goalPayload);
        this.assertGoalId(event.goalId, value.goal.goalId);
        if (!state.goal) throw new GoalProjectionError('goal.completed requires goal.created');
        if (value.goal.status !== 'completed') throw new GoalProjectionError('goal.completed must carry a completed goal');
        state.goal = value.goal;
        return;
      }
      case 'todo.added': {
        const value = this.parse(event, todoPayload);
        this.assertGoalExists(state);
        this.assertGoalId(event.goalId, value.todo.goalId);
        if (state.todos.has(value.todo.todoId)) throw new GoalProjectionError('todo.added duplicated todo id');
        state.todos.set(value.todo.todoId, value.todo);
        return;
      }
      case 'todo.updated': {
        const value = this.parse(event, todoPayload);
        this.assertGoalExists(state);
        this.assertGoalId(event.goalId, value.todo.goalId);
        if (!state.todos.has(value.todo.todoId)) throw new GoalProjectionError('todo.updated references an unknown todo');
        state.todos.set(value.todo.todoId, value.todo);
        return;
      }
      case 'todo.claimed': {
        const value = this.parse(event, claimPayload);
        this.assertGoalExists(state);
        const current = state.todos.get(value.todoId);
        if (!current) throw new GoalProjectionError('todo.claimed references an unknown todo');
        if (current.claimTokenHash && current.claimTokenHash !== value.claimTokenHash) throw new GoalProjectionError('todo is already claimed by another agent');
        state.todos.set(value.todoId, {
          ...current,
          claimedBy: value.claimedBy,
          claimTokenHash: value.claimTokenHash,
          claimedAt: value.claimedAt,
          claimExpiresAt: value.claimExpiresAt,
        });
        return;
      }
      case 'todo.claim_released': {
        const value = this.parse(event, releasePayload);
        this.assertGoalExists(state);
        const current = state.todos.get(value.todoId);
        if (!current) throw new GoalProjectionError('todo.claim_released references an unknown todo');
        if (current.claimTokenHash !== value.claimTokenHash) throw new GoalProjectionError('todo claim token does not match');
        const { claimedBy: _claimedBy, claimTokenHash: _claimTokenHash, claimedAt: _claimedAt, claimExpiresAt: _claimExpiresAt, ...unclaimed } = current;
        state.todos.set(value.todoId, unclaimed);
        return;
      }
      case 'todo.blocked': {
        const value = this.parse(event, blockedPayload);
        this.assertGoalExists(state);
        const current = state.todos.get(value.todoId);
        if (!current) throw new GoalProjectionError('todo.blocked references an unknown todo');
        state.todos.set(value.todoId, { ...current, status: 'blocked', ...(value.gateId ? { blockedByGateId: value.gateId } : {}) });
        return;
      }
      case 'todo.deferred': {
        const value = this.parse(event, deferredPayload);
        this.assertGoalExists(state);
        const current = state.todos.get(value.todoId);
        if (!current) throw new GoalProjectionError('todo.deferred references an unknown todo');
        state.todos.set(value.todoId, { ...current, status: 'deferred', ...(value.nextDueAt ? { nextDueAt: value.nextDueAt } : {}) });
        return;
      }
      case 'todo.completed': {
        const value = this.parse(event, completedPayload);
        this.assertGoalExists(state);
        const current = state.todos.get(value.todoId);
        if (!current) throw new GoalProjectionError('todo.completed references an unknown todo');
        if (value.evidenceId) {
          const evidence = state.evidence.get(value.evidenceId);
          if (!evidence || evidence.status !== 'validated') throw new GoalProjectionError('todo.completed requires validated evidence');
        }
        state.todos.set(value.todoId, { ...current, status: 'done', ...(value.completedAt ? { completedAt: value.completedAt } : {}) });
        return;
      }
      case 'gate.opened': {
        const value = this.parse(event, gatePayload);
        this.assertGoalExists(state);
        this.assertGoalId(event.goalId, value.gate.goalId);
        if (state.gates.has(value.gate.gateId)) throw new GoalProjectionError('gate.opened duplicated gate id');
        state.gates.set(value.gate.gateId, value.gate);
        return;
      }
      case 'gate.resolved': {
        const value = this.parse(event, gatePayload);
        this.assertGoalExists(state);
        this.assertGoalId(event.goalId, value.gate.goalId);
        if (!state.gates.has(value.gate.gateId)) throw new GoalProjectionError('gate.resolved references an unknown gate');
        state.gates.set(value.gate.gateId, value.gate);
        return;
      }
      case 'evidence.attached': {
        const value = this.parse(event, evidencePayload);
        this.assertGoalExists(state);
        this.assertGoalId(event.goalId, value.evidence.goalId);
        if (state.evidence.has(value.evidence.evidenceId)) throw new GoalProjectionError('evidence.attached duplicated evidence id');
        state.evidence.set(value.evidence.evidenceId, value.evidence);
        return;
      }
      case 'handoff.created': {
        const value = this.parse(event, handoffPayload);
        this.assertGoalExists(state);
        this.assertGoalId(event.goalId, value.handoff.goalId);
        if (state.handoffs.has(value.handoff.handoffId)) throw new GoalProjectionError('handoff.created duplicated handoff id');
        state.handoffs.set(value.handoff.handoffId, value.handoff);
        return;
      }
      case 'quota.spent': {
        const value = this.parse(event, quotaPayload);
        this.assertGoalExists(state);
        state.spentTurnKeys.add(value.turnKey);
        return;
      }
      case 'run.recorded':
      case 'writeback.failed':
      case 'projection.refreshed':
        return;
      default: {
        const exhaustive: never = event.eventType;
        throw new GoalProjectionError(`unsupported event type: ${String(exhaustive)}`);
      }
    }
  }

  private parse<T>(event: StoredGoalEvent, schema: z.ZodType<T>): T {
    const parsed = schema.safeParse(event.payload);
    if (!parsed.success) throw new GoalProjectionError(`invalid payload for ${event.eventType}`);
    return parsed.data;
  }

  private assertGoalId(eventGoalId: string, payloadGoalId: string): void {
    if (eventGoalId !== payloadGoalId) throw new GoalProjectionError('payload goal id does not match event goal id');
  }

  private assertGoalExists(state: ProjectionState): void {
    if (!state.goal) throw new GoalProjectionError('goal event requires goal.created');
  }
}

export interface TodoClaimRequest {
  readonly goalId: string;
  readonly todoId: string;
  readonly expectedRevision: number;
  readonly claimant: string;
  readonly requestId: string;
  readonly leaseMs: number;
  readonly now: string;
}

export interface TodoClaimResult {
  readonly event: StoredGoalEvent;
  readonly projection: GoalProjection;
  /** Returned to the caller once; only its hash is persisted in Goal state. */
  readonly claimToken: string;
}

export class GoalControlRevisionError extends Error {
  readonly code = 'GOAL_CONTROL_REVISION_STALE';

  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`goal control revision is stale (expected ${expectedRevision}, actual ${actualRevision})`);
    this.name = 'GoalControlRevisionError';
  }
}

export class TodoClaimConflictError extends Error {
  readonly code = 'GOAL_TODO_CLAIM_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'TodoClaimConflictError';
  }
}

export class TodoCompletionValidationError extends Error {
  readonly code = 'GOAL_TODO_VALIDATION_REQUIRED';

  constructor(message: string) {
    super(message);
    this.name = 'TodoCompletionValidationError';
  }
}

interface CachedClaim {
  fingerprint: string;
  result: TodoClaimResult;
}

/**
 * Application-layer claim helper. It only appends Goal events; it never calls
 * a model, tool, shell, filesystem, Git, MCP, or sandbox runtime.
 */
export class GoalControlService {
  private readonly requestCache = new Map<string, CachedClaim>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly store: GoalEventStore, private readonly builder = new GoalProjectionBuilder()) {}

  async claimTodo(request: TodoClaimRequest): Promise<TodoClaimResult> {
    const fingerprint = canonicalJson(request);
    const cached = this.requestCache.get(request.requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new TodoClaimConflictError('requestId was already used with different claim parameters');
      return cached.result;
    }
    return this.withGoalLock(request.goalId, async () => {
      const repeated = this.requestCache.get(request.requestId);
      if (repeated) {
        if (repeated.fingerprint !== fingerprint) throw new TodoClaimConflictError('requestId was already used with different claim parameters');
        return repeated.result;
      }
      this.validateClaimRequest(request);
      const projection = await this.readProjection(request.goalId);
      if (projection.controlRevision !== request.expectedRevision) throw new GoalControlRevisionError(request.expectedRevision, projection.controlRevision);
      const todo = projection.todos.find((candidate) => candidate.todoId === request.todoId);
      if (!todo) throw new TodoClaimConflictError('todo does not exist');
      if (todo.status !== 'open' && todo.status !== 'deferred') throw new TodoClaimConflictError('todo is not claimable in its current state');
      if (todo.claimTokenHash) throw new TodoClaimConflictError('todo already has an active claim; release it before claiming again');

      const claimToken = randomBytes(32).toString('hex');
      const claimTokenHash = createHash('sha256').update(claimToken).digest('hex');
      const claimedAt = request.now;
      const claimExpiresAt = new Date(Date.parse(request.now) + request.leaseMs).toISOString();
      const event = createGoalEvent({
        goalId: request.goalId,
        eventType: 'todo.claimed',
        recordedAt: request.now,
        producer: request.claimant,
        privacy: 'local_private',
        refs: { todoId: request.todoId },
        payload: { todoId: request.todoId, claimedBy: request.claimant, claimTokenHash, claimedAt, claimExpiresAt },
      });
      const stored = await this.store.append(event);
      const nextProjection = await this.readProjection(request.goalId);
      const result: TodoClaimResult = { event: stored, projection: nextProjection, claimToken };
      this.requestCache.set(request.requestId, { fingerprint, result });
      return result;
    });
  }

  async releaseTodoClaim(input: { goalId: string; todoId: string; expectedRevision: number; claimToken: string; requestId: string; now: string; claimant: string }): Promise<GoalProjection> {
    return this.withGoalLock(input.goalId, async () => {
      if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new GoalEventStoreError('expectedRevision must be a non-negative integer');
      const now = Date.parse(input.now);
      if (!Number.isFinite(now)) throw new GoalEventStoreError('now must be an ISO date');
      if (!input.claimToken || input.claimToken.length < 16) throw new TodoClaimConflictError('claim token is invalid');
      const projection = await this.readProjection(input.goalId);
      if (projection.controlRevision !== input.expectedRevision) throw new GoalControlRevisionError(input.expectedRevision, projection.controlRevision);
      const todo = projection.todos.find((candidate) => candidate.todoId === input.todoId);
      if (!todo?.claimTokenHash) throw new TodoClaimConflictError('todo has no active claim');
      const claimTokenHash = createHash('sha256').update(input.claimToken).digest('hex');
      if (todo.claimTokenHash !== claimTokenHash) throw new TodoClaimConflictError('claim token does not match');
      await this.store.append(createGoalEvent({
        goalId: input.goalId,
        eventType: 'todo.claim_released',
        recordedAt: input.now,
        producer: input.claimant,
        privacy: 'local_private',
        refs: { todoId: input.todoId },
        payload: { todoId: input.todoId, claimTokenHash },
      }));
      return this.readProjection(input.goalId);
    });
  }

  private async readProjection(goalId: string): Promise<GoalProjection> {
    return this.builder.build(await this.store.read(goalId));
  }

  private validateClaimRequest(request: TodoClaimRequest): void {
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) throw new GoalEventStoreError('expectedRevision must be a non-negative integer');
    if (!/^req_[A-Za-z0-9_-]{8,128}$/u.test(request.requestId)) throw new GoalEventStoreError('requestId is invalid');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(request.claimant)) throw new GoalEventStoreError('claimant is invalid');
    if (!Number.isSafeInteger(request.leaseMs) || request.leaseMs <= 0 || request.leaseMs > 24 * 60 * 60 * 1000) throw new GoalEventStoreError('leaseMs is outside the allowed range');
    if (!Number.isFinite(Date.parse(request.now))) throw new GoalEventStoreError('now must be an ISO date');
  }

  private async withGoalLock<T>(goalId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(goalId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.locks.set(goalId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(goalId) === current) this.locks.delete(goalId);
    }
  }
}

export interface TodoValidationOutcome {
  readonly status: 'validated' | 'blocked' | 'stale';
  readonly evidenceStatus?: 'observed' | 'validated' | 'failed' | 'stale';
}

/** Pure writeback guard used before a Todo completion/quota event is created. */
export function assertValidatedTodoCompletion(input: { projection: GoalProjection; todoId: string; validation: TodoValidationOutcome }): void {
  const todo = input.projection.todos.find((candidate) => candidate.todoId === input.todoId);
  if (!todo) throw new TodoCompletionValidationError('todo does not exist');
  if (input.validation.status !== 'validated' || input.validation.evidenceStatus !== 'validated') {
    throw new TodoCompletionValidationError('a validated independent evidence result is required before completing a todo or spending quota');
  }
}

export interface GoalShouldRunInput {
  readonly projection: GoalProjection;
  readonly now: string;
  readonly agentId?: string;
  readonly capabilities?: readonly string[];
  readonly writeScopes?: readonly string[];
  readonly remainingDeliveryQuota?: number;
  readonly turnKey?: string;
}

export function shouldRun(input: GoalShouldRunInput): GoalShouldRunDecision {
  const { projection } = input;
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new GoalEventStoreError('now must be an ISO date');
  const base = { schemaVersion: 'ready4vibe_goal_should_run_v0' as const, goalId: projection.goal?.goalId ?? 'goal_00000000', controlRevision: projection.controlRevision };
  if (!projection.goal) return GoalShouldRunDecisionSchema.parse({ ...base, status: 'waiting', reason: 'No goal has been created.' });
  if (projection.goal.status === 'paused') return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'paused', reason: 'The goal is paused.' });
  if (projection.goal.status === 'blocked') return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'blocked_health', reason: 'The goal is blocked pending operator or health action.' });
  if (projection.goal.status === 'completed' || projection.goal.status === 'archived') return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'waiting', reason: 'The goal is not active.' });
  const blockingGate = projection.gates.find((gate) => gate.blocking && gate.status === 'open');
  if (blockingGate) return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'operator_gate', reason: `Gate ${blockingGate.gateId} requires a decision.` });
  if (input.remainingDeliveryQuota !== undefined && (!Number.isSafeInteger(input.remainingDeliveryQuota) || input.remainingDeliveryQuota <= 0)) return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'throttled', reason: 'Delivery quota is exhausted.' });
  if (input.turnKey && projection.quota.spentTurnKeys.includes(input.turnKey)) return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'throttled', reason: 'This turn key has already been spent.', turnKey: input.turnKey });

  const capabilities = new Set(input.capabilities ?? []);
  const writeScopes = new Set(input.writeScopes ?? []);
  const candidates = projection.todos
    .filter((todo) => (todo.status === 'open' || todo.status === 'deferred') && (todo.nextDueAt === undefined || Date.parse(todo.nextDueAt) <= now))
    .filter((todo) => todo.taskClass !== 'user_action' && todo.taskClass !== 'user_gate')
    .filter((todo) => todo.claimedBy === undefined || todo.claimedBy === input.agentId)
    .sort((left, right) => left.priority - right.priority || left.todoId.localeCompare(right.todoId));
  if (candidates.length === 0) return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'waiting', reason: 'No eligible Todo is due.' });
  const selected = candidates[0]!;
  if ((selected.requiredCapabilities ?? []).some((capability) => !capabilities.has(capability)) || (selected.requiredWriteScopes ?? []).some((scope) => !writeScopes.has(scope))) {
    return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'blocked_health', reason: `Todo ${selected.todoId} requires unavailable capabilities or scopes.`, todoId: selected.todoId });
  }
  return GoalShouldRunDecisionSchema.parse({ ...base, goalId: projection.goal.goalId, status: 'eligible', reason: `Todo ${selected.todoId} is eligible to run.`, todoId: selected.todoId, ...(input.turnKey ? { turnKey: input.turnKey } : {}) });
}

export function createGoalEvent<TPayload extends Record<string, unknown>>(input: Omit<NewGoalEvent<TPayload>, 'schemaVersion' | 'eventId' | 'projectionVersion'> & { eventId?: string }): NewGoalEvent<TPayload> {
  return parseNewGoalEvent({
    schemaVersion: 'ready4vibe_goal_event_v0',
    eventId: input.eventId ?? `gevt_${uuidv7()}`,
    projectionVersion: 'goal_control_projection_v0',
    ...input,
  }) as NewGoalEvent<TPayload>;
}

export { GoalEventTypeSchema };

export * from './write.js';
