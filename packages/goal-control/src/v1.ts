import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type {
  GoalAdmissionDecisionV1,
  GoalControlEventPayload,
  GoalControlEventTypeV1,
  GoalControlProjectionV1,
  GoalHandoff,
  GoalQuotaReservationV1,
  GoalRecoveryRecordV1,
  GoalRunBindingV1,
  GoalValidationEvidenceV1,
  NewGoalControlEventV1,
  StoredGoalControlEventV1,
  StoredGoalEvent,
  GoalProjection,
} from '@ready4vibe/contracts';
import {
  GoalAdmissionDecisionV1Schema,
  GoalControlEventTypeV1Schema,
  GoalControlProjectionV1Schema,
  GoalHandoffSchema,
  GoalQuotaReservationV1Schema,
  GoalRecoveryRecordV1Schema,
  GoalRunBindingV1Schema,
  GoalValidationEvidenceV1Schema,
  NewGoalControlEventV1Schema,
  StoredGoalControlEventV1Schema,
  StoredGoalEventSchema,
} from '@ready4vibe/contracts';
import { GoalProjectionBuilder, canonicalJson } from './index.js';

export type GoalControlReplayEvent = StoredGoalEvent | StoredGoalControlEventV1;

export interface GoalControlEventStoreV1 {
  append(event: NewGoalControlEventV1): Promise<StoredGoalControlEventV1>;
  appendBatch(events: readonly NewGoalControlEventV1[]): Promise<StoredGoalControlEventV1[]>;
  read(goalId: string, afterSequence?: number): Promise<GoalControlReplayEvent[]>;
  listGoalIds(): readonly string[];
  lastSequence(goalId: string): number;
}

export class GoalControlV1Error extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'GoalControlV1Error';
  }
}

export class GoalControlV1EventConflictError extends GoalControlV1Error {
  constructor(readonly eventId: string) {
    super('GOAL_V1_EVENT_CONFLICT', 'A Goal Control v1 event id was already used with different content.');
    this.name = 'GoalControlV1EventConflictError';
  }
}

export class GoalControlV1RevisionError extends GoalControlV1Error {
  constructor(readonly expected: number, readonly actual: number) {
    super('GOAL_V1_STALE_REVISION', `Expected Goal control revision ${expected}, but the current revision is ${actual}.`);
    this.name = 'GoalControlV1RevisionError';
  }
}

export class GoalControlV1TransitionError extends GoalControlV1Error {
  constructor(message: string) {
    super('GOAL_V1_INVALID_TRANSITION', message);
    this.name = 'GoalControlV1TransitionError';
  }
}

export function fingerprintGoalControlEvent(event: NewGoalControlEventV1 | StoredGoalControlEventV1): string {
  const { appendSequence: _appendSequence, ...withoutSequence } = event as StoredGoalControlEventV1;
  return createHash('sha256').update(canonicalJson(withoutSequence)).digest('hex');
}

function parseReplayEvent(value: unknown): GoalControlReplayEvent {
  const v1 = StoredGoalControlEventV1Schema.safeParse(value);
  if (v1.success) return v1.data as StoredGoalControlEventV1;
  return StoredGoalEventSchema.parse(value) as StoredGoalEvent;
}

function isV1Event(event: GoalControlReplayEvent): event is StoredGoalControlEventV1 {
  return event.schemaVersion === 'ready4vibe_goal_event_v1';
}

/**
 * In-memory v1 store used by pure reducer and application-service fixtures.
 * Legacy v0 events can be seeded explicitly for forward-replay tests; no
 * migration or raw-event ingestion is performed implicitly.
 */
export class InMemoryGoalControlEventStore implements GoalControlEventStoreV1 {
  private readonly events = new Map<string, GoalControlReplayEvent[]>();
  private readonly byEventId = new Map<string, { fingerprint: string; event: GoalControlReplayEvent }>();

  async append(event: NewGoalControlEventV1): Promise<StoredGoalControlEventV1> {
    const parsed = NewGoalControlEventV1Schema.parse(event) as NewGoalControlEventV1;
    const existing = this.byEventId.get(parsed.eventId);
    if (existing) {
      if (isV1Event(existing.event) && existing.fingerprint === fingerprintGoalControlEvent(parsed)) return existing.event;
      throw new GoalControlV1EventConflictError(parsed.eventId);
    }
    const stored: StoredGoalControlEventV1 = {
      ...parsed,
      appendSequence: this.lastSequence(parsed.goalId) + 1,
    };
    const list = this.events.get(parsed.goalId) ?? [];
    list.push(stored);
    this.events.set(parsed.goalId, list);
    this.byEventId.set(parsed.eventId, { fingerprint: fingerprintGoalControlEvent(stored), event: stored });
    return stored;
  }

  async appendBatch(events: readonly NewGoalControlEventV1[]): Promise<StoredGoalControlEventV1[]> {
    if (events.length === 0) return [];
    const parsed = events.map((event) => NewGoalControlEventV1Schema.parse(event) as NewGoalControlEventV1);
    const goalId = parsed[0]!.goalId;
    if (parsed.some((event) => event.goalId !== goalId)) {
      throw new GoalControlV1Error('GOAL_V1_BATCH_INVALID', 'appendBatch requires one goal id.');
    }
    const planned = new Map<string, StoredGoalControlEventV1>();
    const result: StoredGoalControlEventV1[] = [];
    let nextSequence = this.lastSequence(goalId) + 1;
    for (const event of parsed) {
      const existing = this.byEventId.get(event.eventId);
      const plannedEvent = planned.get(event.eventId);
      if (existing || plannedEvent) {
        const existingEvent = existing?.event ?? plannedEvent!;
        const existingFingerprint = existing?.fingerprint ?? fingerprintGoalControlEvent(plannedEvent!);
        if (!isV1Event(existingEvent) || existingFingerprint !== fingerprintGoalControlEvent(event)) {
          throw new GoalControlV1EventConflictError(event.eventId);
        }
        result.push(existingEvent);
        continue;
      }
      const stored: StoredGoalControlEventV1 = { ...event, appendSequence: nextSequence++ };
      planned.set(event.eventId, stored);
      result.push(stored);
    }
    const list = this.events.get(goalId) ?? [];
    for (const stored of planned.values()) {
      list.push(stored);
      this.byEventId.set(stored.eventId, { fingerprint: fingerprintGoalControlEvent(stored), event: stored });
    }
    this.events.set(goalId, list);
    return result;
  }

  /** Seed only already-validated v0 events for a migration/replay fixture. */
  seedLegacy(event: StoredGoalEvent): void {
    const parsed = StoredGoalEventSchema.parse(event) as StoredGoalEvent;
    const existing = this.byEventId.get(parsed.eventId);
    if (existing) throw new GoalControlV1EventConflictError(parsed.eventId);
    const list = this.events.get(parsed.goalId) ?? [];
    if (list.some((candidate) => candidate.appendSequence === parsed.appendSequence)) {
      throw new GoalControlV1Error('GOAL_V1_SEQUENCE_CONFLICT', 'Legacy append sequence is already occupied.');
    }
    list.push(parsed);
    list.sort((left, right) => left.appendSequence - right.appendSequence);
    this.events.set(parsed.goalId, list);
    this.byEventId.set(parsed.eventId, { fingerprint: fingerprintLegacyEvent(parsed), event: parsed });
  }

  async read(goalId: string, afterSequence = 0): Promise<GoalControlReplayEvent[]> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new GoalControlV1Error('GOAL_V1_CURSOR_INVALID', 'afterSequence must be a non-negative integer.');
    }
    return [...(this.events.get(goalId) ?? [])]
      .filter((event) => event.appendSequence > afterSequence)
      .sort((left, right) => left.appendSequence - right.appendSequence);
  }

  listGoalIds(): readonly string[] {
    return Object.freeze([...this.events.keys()].sort((left, right) => left.localeCompare(right)));
  }

  lastSequence(goalId: string): number {
    return Math.max(0, ...(this.events.get(goalId) ?? []).map((event) => event.appendSequence));
  }
}

function fingerprintLegacyEvent(event: StoredGoalEvent): string {
  const { appendSequence: _appendSequence, ...withoutSequence } = event;
  return createHash('sha256').update(canonicalJson(withoutSequence)).digest('hex');
}

interface ProjectionState {
  goal: GoalProjection['goal'];
  todos: Map<string, GoalProjection['todos'][number]>;
  gates: Map<string, GoalProjection['gates'][number]>;
  evidence: Map<string, GoalProjection['evidence'][number]>;
  handoffs: Map<string, GoalHandoff>;
  bindings: Map<string, GoalRunBindingV1>;
  admissions: Map<string, GoalAdmissionDecisionV1>;
  validationEvidence: Map<string, GoalValidationEvidenceV1>;
  recoveries: Map<string, GoalRecoveryRecordV1>;
  reservations: Map<string, GoalQuotaReservationV1>;
  spentTurnKeys: Set<string>;
}

const bindingPayload = z.object({ binding: GoalRunBindingV1Schema }).strict();
const admissionPayload = z.object({ decision: GoalAdmissionDecisionV1Schema }).strict();
const reservationPayload = z.object({ reservation: GoalQuotaReservationV1Schema }).strict();
const validationPayload = z.object({ evidence: GoalValidationEvidenceV1Schema }).strict();
const recoveryPayload = z.object({ recovery: GoalRecoveryRecordV1Schema }).strict();
const handoffPayload = z.object({ handoff: GoalHandoffSchema }).strict();
const todoCompletedPayload = z.object({
  todoId: z.string().regex(/^todo_[A-Za-z0-9_-]{8,128}$/u),
  evidenceId: z.string().regex(/^evidence_[A-Za-z0-9_-]{8,128}$/u),
  completedAt: z.string().datetime({ offset: true }),
}).strict();

export class GoalControlProjectionBuilder {
  constructor(private readonly legacyBuilder = new GoalProjectionBuilder()) {}

  build(events: readonly GoalControlReplayEvent[]): GoalControlProjectionV1 {
    const parsed = events.map((event) => parseReplayEvent(event));
    const goalId = parsed[0]?.goalId;
    if (parsed.some((event) => event.goalId !== goalId)) {
      throw new GoalControlV1Error('GOAL_V1_GOAL_MISMATCH', 'All Goal Control events must belong to one goal.');
    }
    const ordered = [...parsed].sort((left, right) => left.appendSequence - right.appendSequence);
    const firstV1 = ordered.findIndex(isV1Event);
    if (firstV1 >= 0 && ordered.slice(firstV1).some((event) => !isV1Event(event))) {
      throw new GoalControlV1Error('GOAL_V1_REPLAY_ORDER', 'Legacy v0 events must precede additive v1 events.');
    }
    const legacyEvents = ordered.filter((event): event is StoredGoalEvent => !isV1Event(event));
    const base = this.legacyBuilder.build(legacyEvents);
    const state: ProjectionState = {
      goal: base.goal,
      todos: new Map(base.todos.map((todo) => [todo.todoId, todo])),
      gates: new Map(base.gates.map((gate) => [gate.gateId, gate])),
      evidence: new Map(base.evidence.map((evidence) => [evidence.evidenceId, evidence])),
      handoffs: new Map(base.handoffs.map((handoff) => [handoff.handoffId, handoff])),
      bindings: new Map(),
      admissions: new Map(),
      validationEvidence: new Map(),
      recoveries: new Map(),
      reservations: new Map(),
      spentTurnKeys: new Set(base.quota.spentTurnKeys),
    };

    for (const [index, event] of ordered.entries()) {
      if (!isV1Event(event)) continue;
      const expectedRevision = index + 1;
      if (event.controlRevision !== expectedRevision) {
        throw new GoalControlV1RevisionError(expectedRevision, event.controlRevision);
      }
      this.applyV1(state, event);
    }

    const controlRevision = ordered.length;
    const projection = {
      projectionVersion: 'goal_control_projection_v1' as const,
      goal: state.goal ? { ...state.goal, controlRevision } : null,
      todos: [...state.todos.values()].sort((left, right) => left.todoId.localeCompare(right.todoId)),
      gates: [...state.gates.values()].sort((left, right) => left.gateId.localeCompare(right.gateId)),
      evidence: [...state.evidence.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
      handoffs: [...state.handoffs.values()].sort((left, right) => left.handoffId.localeCompare(right.handoffId)),
      bindings: [...state.bindings.values()].sort((left, right) => left.bindingId.localeCompare(right.bindingId)),
      admissions: [...state.admissions.values()].sort((left, right) => left.admissionId.localeCompare(right.admissionId)),
      validationEvidence: [...state.validationEvidence.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
      recoveries: [...state.recoveries.values()].sort((left, right) => left.recoveryId.localeCompare(right.recoveryId)),
      quota: {
        spentTurnKeys: [...state.spentTurnKeys].sort(),
        totalSpent: state.spentTurnKeys.size,
        reservations: [...state.reservations.values()].sort((left, right) => left.reservationId.localeCompare(right.reservationId)),
      },
      lastEventId: ordered.at(-1)?.eventId ?? null,
      lastAppendSequence: ordered.at(-1)?.appendSequence ?? 0,
      sourceEventCount: ordered.length,
      sourceChecksum: createHash('sha256').update(canonicalJson(ordered)).digest('hex'),
      controlRevision,
    };
    return GoalControlProjectionV1Schema.parse(projection);
  }

  private applyV1(state: ProjectionState, event: StoredGoalControlEventV1): void {
    this.assertGoalExists(state, event);
    switch (event.eventType) {
      case 'binding.created': {
        const value = this.parsePayload(event, bindingPayload).binding;
        this.assertGoalId(event.goalId, value.goalId);
        this.assertRef(event.refs.bindingId, value.bindingId);
        if (state.bindings.has(value.bindingId)) throw new GoalControlV1TransitionError('binding already exists');
        state.bindings.set(value.bindingId, value);
        return;
      }
      case 'admission.recorded': {
        const value = this.parsePayload(event, admissionPayload).decision;
        this.assertGoalId(event.goalId, value.goalId);
        this.assertRef(event.refs.admissionId, value.admissionId);
        if (state.admissions.has(value.admissionId)) throw new GoalControlV1TransitionError('admission already exists');
        state.admissions.set(value.admissionId, value);
        return;
      }
      case 'quota.reserved':
      case 'quota.released':
      case 'quota.consumed':
      case 'quota.expired': {
        const value = this.parsePayload(event, reservationPayload).reservation;
        this.assertGoalId(event.goalId, value.goalId);
        this.assertRef(event.refs.reservationId, value.reservationId);
        const expectedStatus = event.eventType.slice('quota.'.length) as GoalQuotaReservationV1['status'];
        if (value.status !== expectedStatus) throw new GoalControlV1TransitionError('quota event status does not match event type');
        const current = state.reservations.get(value.reservationId);
        if (expectedStatus === 'reserved') {
          if (current) throw new GoalControlV1TransitionError('quota reservation already exists');
          const duplicateIdentity = [...state.reservations.values()].find((candidate) => candidate.status === 'reserved'
            && candidate.bindingId === value.bindingId && candidate.attempt === value.attempt && candidate.turnKey === value.turnKey);
          if (duplicateIdentity) throw new GoalControlV1TransitionError('quota reservation identity is already reserved');
        } else {
          if (!current) throw new GoalControlV1TransitionError('quota transition references an unknown reservation');
          if (current.status !== 'reserved') throw new GoalControlV1TransitionError('only a reserved quota may transition');
          if (current.bindingId !== value.bindingId || current.attempt !== value.attempt || current.turnKey !== value.turnKey || current.units !== value.units) {
            throw new GoalControlV1TransitionError('quota transition changed reservation identity');
          }
        }
        if (expectedStatus === 'consumed' && state.spentTurnKeys.has(value.turnKey)) {
          throw new GoalControlV1TransitionError('quota turn key was already consumed');
        }
        state.reservations.set(value.reservationId, value);
        if (expectedStatus === 'consumed') state.spentTurnKeys.add(value.turnKey);
        return;
      }
      case 'validation.recorded': {
        const value = this.parsePayload(event, validationPayload).evidence;
        this.assertGoalId(event.goalId, value.goalId);
        this.assertRef(event.refs.evidenceId, value.evidenceId);
        if (state.validationEvidence.has(value.evidenceId)) throw new GoalControlV1TransitionError('validation evidence already exists');
        if (!state.bindings.has(value.bindingId)) throw new GoalControlV1TransitionError('validation evidence references an unknown binding');
        state.validationEvidence.set(value.evidenceId, value);
        return;
      }
      case 'recovery.recorded': {
        const value = this.parsePayload(event, recoveryPayload).recovery;
        this.assertGoalId(event.goalId, value.goalId);
        this.assertRef(event.refs.recoveryId, value.recoveryId);
        if (state.recoveries.has(value.recoveryId)) throw new GoalControlV1TransitionError('recovery record already exists');
        state.recoveries.set(value.recoveryId, value);
        return;
      }
      case 'handoff.recorded': {
        const value = this.parsePayload(event, handoffPayload).handoff;
        this.assertGoalId(event.goalId, value.goalId);
        this.assertRef(event.refs.handoffId, value.handoffId);
        if (state.handoffs.has(value.handoffId)) throw new GoalControlV1TransitionError('handoff already exists');
        state.handoffs.set(value.handoffId, value);
        return;
      }
      case 'todo.completed': {
        const value = this.parsePayload(event, todoCompletedPayload);
        const todo = state.todos.get(value.todoId);
        const evidence = state.validationEvidence.get(value.evidenceId);
        if (!todo) throw new GoalControlV1TransitionError('todo completion references an unknown todo');
        if (!evidence || evidence.status !== 'validated') throw new GoalControlV1TransitionError('todo completion requires validated evidence');
        if (todo.status === 'done' || todo.status === 'superseded') throw new GoalControlV1TransitionError('todo is already terminal');
        state.todos.set(value.todoId, { ...todo, status: 'done', completedAt: value.completedAt });
        return;
      }
      default: {
        const exhaustive: never = event.eventType;
        throw new GoalControlV1Error('GOAL_V1_EVENT_UNKNOWN', `Unsupported Goal Control v1 event: ${String(exhaustive)}`);
      }
    }
  }

  private parsePayload<T>(event: StoredGoalControlEventV1, schema: z.ZodType<T>): T {
    const parsed = schema.safeParse(event.payload);
    if (!parsed.success) throw new GoalControlV1Error('GOAL_V1_PAYLOAD_INVALID', `Invalid payload for ${event.eventType}.`);
    return parsed.data;
  }

  private assertGoalExists(state: ProjectionState, event: StoredGoalControlEventV1): void {
    if (!state.goal) throw new GoalControlV1TransitionError(`event ${event.eventType} requires goal.created`);
  }

  private assertGoalId(eventGoalId: string, payloadGoalId: string): void {
    if (eventGoalId !== payloadGoalId) throw new GoalControlV1TransitionError('payload goal id does not match event goal id');
  }

  private assertRef(actual: string | undefined, expected: string): void {
    if (actual !== undefined && actual !== expected) throw new GoalControlV1TransitionError('event reference does not match payload');
  }
}

export const GOAL_CONTROL_WRITE_V1_SCHEMA_VERSION = 'ready4vibe_goal_control_write_v1' as const;

export interface GoalControlV1MutationResult {
  readonly schemaVersion: typeof GOAL_CONTROL_WRITE_V1_SCHEMA_VERSION;
  readonly eventId: string;
  readonly controlRevision: number;
  readonly projection: GoalControlProjectionV1;
}

const eventIdSchema = z.string().regex(/^gevt_[A-Za-z0-9_-]{8,128}$/u);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const requestSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u);
const bindingDraftSchema = GoalRunBindingV1Schema.omit({ schemaVersion: true });
const admissionDraftSchema = GoalAdmissionDecisionV1Schema.omit({ schemaVersion: true });
const reservationDraftSchema = GoalQuotaReservationV1Schema.omit({ schemaVersion: true, status: true, createdAt: true, updatedAt: true });
const validationDraftSchema = GoalValidationEvidenceV1Schema.omit({ schemaVersion: true, evidenceChecksum: true, checkedAt: true });
const recoveryDraftSchema = GoalRecoveryRecordV1Schema.omit({ schemaVersion: true, createdAt: true });
const handoffDraftSchema = GoalHandoffSchema;

export const CreateGoalBindingV1InputSchema = z.object({
  eventId: eventIdSchema,
  expectedRevision: revisionSchema,
  binding: bindingDraftSchema,
}).strict();
export type CreateGoalBindingV1Input = z.infer<typeof CreateGoalBindingV1InputSchema>;

export const RecordGoalAdmissionV1InputSchema = z.object({
  eventId: eventIdSchema,
  expectedRevision: revisionSchema,
  decision: admissionDraftSchema,
}).strict();
export type RecordGoalAdmissionV1Input = z.infer<typeof RecordGoalAdmissionV1InputSchema>;

export const ReserveGoalQuotaV1InputSchema = z.object({
  eventId: eventIdSchema,
  expectedRevision: revisionSchema,
  requestId: requestSchema,
  reservation: reservationDraftSchema,
}).strict();
export type ReserveGoalQuotaV1Input = z.infer<typeof ReserveGoalQuotaV1InputSchema>;

export const RecordGoalValidationV1InputSchema = z.object({
  eventId: eventIdSchema,
  expectedRevision: revisionSchema,
  evidence: validationDraftSchema,
}).strict();
export type RecordGoalValidationV1Input = z.infer<typeof RecordGoalValidationV1InputSchema>;

export const RecordGoalRecoveryV1InputSchema = z.object({
  eventId: eventIdSchema,
  expectedRevision: revisionSchema,
  recovery: recoveryDraftSchema,
}).strict();
export type RecordGoalRecoveryV1Input = z.infer<typeof RecordGoalRecoveryV1InputSchema>;

export const RecordGoalHandoffV1InputSchema = z.object({
  eventId: eventIdSchema,
  expectedRevision: revisionSchema,
  handoff: handoffDraftSchema,
}).strict();
export type RecordGoalHandoffV1Input = z.infer<typeof RecordGoalHandoffV1InputSchema>;

export class GoalControlV1WriteService {
  private readonly producer: string;
  private readonly clock: () => string;
  private readonly builder: GoalControlProjectionBuilder;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly store: GoalControlEventStoreV1, options: { producer?: string; clock?: () => string; builder?: GoalControlProjectionBuilder } = {}) {
    this.producer = options.producer ?? 'goal-control-v1';
    if (!requestSchema.safeParse(this.producer).success) throw new Error('producer is invalid');
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.builder = options.builder ?? new GoalControlProjectionBuilder();
  }

  async createBinding(goalId: string, input: unknown): Promise<GoalControlV1MutationResult> {
    const parsed = CreateGoalBindingV1InputSchema.parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      if (parsed.binding.goalId !== goalId) throw new GoalControlV1TransitionError('binding goal id does not match route goal id');
      const candidate = this.event(parsed.eventId, goalId, 'binding.created', { bindingId: parsed.binding.bindingId }, { binding: GoalRunBindingV1Schema.parse({ schemaVersion: 'ready4vibe_goal_binding_v1', ...parsed.binding }) }, parsed.expectedRevision);
      return this.appendWithRevision(projection, parsed.expectedRevision, candidate);
    });
  }

  async recordAdmission(goalId: string, input: unknown): Promise<GoalControlV1MutationResult> {
    const parsed = RecordGoalAdmissionV1InputSchema.parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      if (parsed.decision.goalId !== goalId) throw new GoalControlV1TransitionError('admission goal id does not match route goal id');
      const decision = GoalAdmissionDecisionV1Schema.parse({ schemaVersion: 'ready4vibe_goal_admission_v1', ...parsed.decision });
      const candidate = this.event(parsed.eventId, goalId, 'admission.recorded', { admissionId: decision.admissionId }, { decision }, parsed.expectedRevision);
      return this.appendWithRevision(projection, parsed.expectedRevision, candidate);
    });
  }

  async reserveQuota(goalId: string, input: unknown): Promise<GoalControlV1MutationResult> {
    const parsed = ReserveGoalQuotaV1InputSchema.parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const binding = projection.bindings.find((candidate) => candidate.bindingId === parsed.reservation.bindingId);
      if (!binding) throw new GoalControlV1TransitionError('quota reservation references an unknown binding');
      if (parsed.reservation.goalId !== goalId || binding.goalId !== goalId) throw new GoalControlV1TransitionError('quota reservation goal id does not match');
      if (binding.attempt !== parsed.reservation.attempt || binding.mode !== 'governed') throw new GoalControlV1TransitionError('quota reservation binding does not match attempt or mode');
      const now = this.now();
      const reservation = GoalQuotaReservationV1Schema.parse({
        schemaVersion: 'ready4vibe_goal_quota_reservation_v1',
        ...parsed.reservation,
        status: 'reserved',
        createdAt: now,
        updatedAt: now,
      });
      const candidate = this.event(parsed.eventId, goalId, 'quota.reserved', { reservationId: reservation.reservationId, bindingId: reservation.bindingId }, { reservation }, parsed.expectedRevision);
      return this.appendWithRevision(projection, parsed.expectedRevision, candidate);
    });
  }

  async releaseQuota(goalId: string, reservationIdValue: string, input: { eventId: string; expectedRevision: number; reason?: string }): Promise<GoalControlV1MutationResult> {
    return this.transitionQuota(goalId, reservationIdValue, input, 'released');
  }

  async expireQuota(goalId: string, reservationIdValue: string, input: { eventId: string; expectedRevision: number; reason?: string }): Promise<GoalControlV1MutationResult> {
    return this.transitionQuota(goalId, reservationIdValue, input, 'expired');
  }

  async consumeQuota(goalId: string, reservationIdValue: string, input: { eventId: string; expectedRevision: number; evidenceId: string; reason?: string }): Promise<GoalControlV1MutationResult> {
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const reservation = projection.quota.reservations.find((candidate) => candidate.reservationId === reservationIdValue);
      if (!reservation) throw new GoalControlV1TransitionError('quota reservation was not found');
      if (reservation.status !== 'reserved') throw new GoalControlV1TransitionError('only a reserved quota may be consumed');
      const evidence = projection.validationEvidence.find((candidate) => candidate.evidenceId === input.evidenceId);
      if (!evidence || evidence.status !== 'validated') throw new GoalControlV1TransitionError('quota consumption requires validated evidence');
      if (evidence.bindingId !== reservation.bindingId || evidence.attempt !== reservation.attempt) throw new GoalControlV1TransitionError('validation evidence does not match quota reservation');
      const now = this.now();
      const next = GoalQuotaReservationV1Schema.parse({
        ...reservation,
        status: 'consumed',
        updatedAt: now,
        ...(input.reason ? { reason: input.reason } : {}),
      });
      const candidate = this.event(input.eventId, goalId, 'quota.consumed', { reservationId: next.reservationId, bindingId: next.bindingId }, { reservation: next }, input.expectedRevision);
      return this.appendWithRevision(projection, input.expectedRevision, candidate);
    });
  }

  async recordValidation(goalId: string, input: unknown): Promise<GoalControlV1MutationResult> {
    const parsed = RecordGoalValidationV1InputSchema.parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const binding = projection.bindings.find((candidate) => candidate.bindingId === parsed.evidence.bindingId);
      if (!binding || binding.goalId !== goalId) throw new GoalControlV1TransitionError('validation evidence references an unknown binding');
      if (parsed.evidence.goalId !== goalId || parsed.evidence.runId !== binding.runId || parsed.evidence.attempt !== binding.attempt) throw new GoalControlV1TransitionError('validation evidence binding does not match run');
      const evidence = GoalValidationEvidenceV1Schema.parse({
        schemaVersion: 'ready4vibe_goal_validation_evidence_v1',
        ...parsed.evidence,
        checkedAt: this.now(),
        evidenceChecksum: createHash('sha256').update(canonicalJson(parsed.evidence)).digest('hex'),
      });
      const candidate = this.event(parsed.eventId, goalId, 'validation.recorded', { evidenceId: evidence.evidenceId, bindingId: evidence.bindingId, runId: evidence.runId }, { evidence }, parsed.expectedRevision);
      return this.appendWithRevision(projection, parsed.expectedRevision, candidate);
    });
  }

  async completeTodo(goalId: string, input: { eventId: string; expectedRevision: number; todoId: string; evidenceId: string }): Promise<GoalControlV1MutationResult> {
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const todo = projection.todos.find((candidate) => candidate.todoId === input.todoId);
      const evidence = projection.validationEvidence.find((candidate) => candidate.evidenceId === input.evidenceId);
      if (!todo) throw new GoalControlV1TransitionError('todo was not found');
      if (!evidence || evidence.status !== 'validated') throw new GoalControlV1TransitionError('todo completion requires validated evidence');
      const completedAt = this.now();
      const candidate = this.event(input.eventId, goalId, 'todo.completed', { todoId: input.todoId, evidenceId: input.evidenceId }, { todoId: input.todoId, evidenceId: input.evidenceId, completedAt }, input.expectedRevision);
      return this.appendWithRevision(projection, input.expectedRevision, candidate);
    });
  }

  async recordRecovery(goalId: string, input: unknown): Promise<GoalControlV1MutationResult> {
    const parsed = RecordGoalRecoveryV1InputSchema.parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      if (parsed.recovery.goalId !== goalId) throw new GoalControlV1TransitionError('recovery goal id does not match route goal id');
      const recovery = GoalRecoveryRecordV1Schema.parse({ schemaVersion: 'ready4vibe_goal_recovery_v1', ...parsed.recovery, createdAt: this.now() });
      const candidate = this.event(parsed.eventId, goalId, 'recovery.recorded', { recoveryId: recovery.recoveryId, bindingId: recovery.bindingId }, { recovery }, parsed.expectedRevision);
      return this.appendWithRevision(projection, parsed.expectedRevision, candidate);
    });
  }

  async recordHandoff(goalId: string, input: unknown): Promise<GoalControlV1MutationResult> {
    const parsed = RecordGoalHandoffV1InputSchema.parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      if (parsed.handoff.goalId !== goalId) throw new GoalControlV1TransitionError('handoff goal id does not match route goal id');
      const handoff = GoalHandoffSchema.parse(parsed.handoff);
      const candidate = this.event(parsed.eventId, goalId, 'handoff.recorded', { handoffId: handoff.handoffId, todoId: handoff.toTodoId, parentEventId: undefined }, { handoff }, parsed.expectedRevision);
      return this.appendWithRevision(projection, parsed.expectedRevision, candidate);
    });
  }

  private async transitionQuota(goalId: string, reservationIdValue: string, input: { eventId: string; expectedRevision: number; reason?: string }, status: 'released' | 'expired'): Promise<GoalControlV1MutationResult> {
    const parsedInput = z.object({ eventId: eventIdSchema, expectedRevision: revisionSchema, reason: z.string().min(1).max(500).regex(/^[^\u0000-\u001F\u007F\r\n]*$/u).optional() }).strict().parse(input);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const reservation = projection.quota.reservations.find((candidate) => candidate.reservationId === reservationIdValue);
      if (!reservation) throw new GoalControlV1TransitionError('quota reservation was not found');
      if (reservation.status !== 'reserved') throw new GoalControlV1TransitionError('only a reserved quota may transition');
      const next = GoalQuotaReservationV1Schema.parse({ ...reservation, status, updatedAt: this.now(), ...(parsedInput.reason ? { reason: parsedInput.reason } : {}) });
      const candidate = this.event(parsedInput.eventId, goalId, `quota.${status}`, { reservationId: next.reservationId, bindingId: next.bindingId }, { reservation: next }, parsedInput.expectedRevision);
      return this.appendWithRevision(projection, parsedInput.expectedRevision, candidate);
    });
  }

  private event<TPayload extends Record<string, unknown>>(eventIdValue: string, goalId: string, eventType: GoalControlEventTypeV1, refs: Record<string, string | undefined>, payload: TPayload, expectedRevision: number): NewGoalControlEventV1<TPayload> {
    const filteredRefs = Object.fromEntries(Object.entries(refs).filter(([, value]) => value !== undefined)) as Record<string, string>;
    return NewGoalControlEventV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_event_v1',
      eventId: eventIdValue,
      goalId,
      eventType,
      controlRevision: expectedRevision + 1,
      recordedAt: this.now(),
      producer: this.producer,
      privacy: 'local_private',
      projectionVersion: 'goal_control_projection_v1',
      refs: filteredRefs,
      payload,
    }) as NewGoalControlEventV1<TPayload>;
  }

  private async appendWithRevision(projection: GoalControlProjectionV1, expectedRevision: number, candidate: NewGoalControlEventV1): Promise<GoalControlV1MutationResult> {
    const existing = await this.findEvent(candidate.eventId);
    if (existing) {
      if (isV1Event(existing) && fingerprintGoalControlEvent(existing) === fingerprintGoalControlEvent(candidate)) return this.result(existing.goalId, existing.eventId);
      throw new GoalControlV1EventConflictError(candidate.eventId);
    }
    if (projection.controlRevision !== expectedRevision) throw new GoalControlV1RevisionError(expectedRevision, projection.controlRevision);
    const stored = await this.store.append(candidate);
    return this.result(stored.goalId, stored.eventId);
  }

  private async result(goalId: string, eventIdValue: string): Promise<GoalControlV1MutationResult> {
    const projection = await this.readProjection(goalId);
    const event = (await this.store.read(goalId)).find((candidate) => candidate.eventId === eventIdValue);
    if (!event) throw new GoalControlV1Error('GOAL_V1_EVENT_UNAVAILABLE', 'Goal Control event could not be read after append.');
    return {
      schemaVersion: GOAL_CONTROL_WRITE_V1_SCHEMA_VERSION,
      eventId: eventIdValue,
      controlRevision: projection.controlRevision,
      projection,
    };
  }

  private async requireGoal(goalId: string): Promise<GoalControlProjectionV1> {
    const projection = await this.readProjection(goalId);
    if (!projection.goal) throw new GoalControlV1Error('GOAL_V1_NOT_FOUND', 'Goal was not found.');
    return projection;
  }

  private async readProjection(goalId: string): Promise<GoalControlProjectionV1> {
    return this.builder.build(await this.store.read(goalId));
  }

  private async findEvent(eventIdValue: string): Promise<GoalControlReplayEvent | undefined> {
    for (const goalId of this.store.listGoalIds()) {
      const event = (await this.store.read(goalId)).find((candidate) => candidate.eventId === eventIdValue);
      if (event) return event;
    }
    return undefined;
  }

  private now(): string {
    const value = this.clock();
    if (!Number.isFinite(Date.parse(value))) throw new GoalControlV1Error('GOAL_V1_CLOCK_INVALID', 'clock must return an ISO date');
    return new Date(value).toISOString();
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

export function createGoalControlEventV1<TPayload extends Record<string, unknown>>(input: Omit<NewGoalControlEventV1<TPayload>, 'schemaVersion' | 'eventId' | 'projectionVersion' | 'controlRevision'> & { eventId?: string; controlRevision: number }): NewGoalControlEventV1<TPayload> {
  return NewGoalControlEventV1Schema.parse({
    schemaVersion: 'ready4vibe_goal_event_v1',
    eventId: input.eventId ?? `gevt_${uuidv7()}`,
    projectionVersion: 'goal_control_projection_v1',
    ...input,
  }) as NewGoalControlEventV1<TPayload>;
}

/** Semantic aliases for callers that refer to the v1 service/store directly. */
export { GoalControlV1WriteService as GoalWriteServiceV1, InMemoryGoalControlEventStore as InMemoryGoalEventStoreV1 };
