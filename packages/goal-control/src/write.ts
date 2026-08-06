import { createHash } from 'node:crypto';
import type {
  GoalEvidence,
  GoalGate,
  GoalProjection,
  GoalRecord,
  GoalTodo,
  NewGoalEvent,
  StoredGoalEvent,
} from '@ready4vibe/contracts';
import {
  GoalEvidenceRefsSchema,
  GoalProjectionSchema,
  GoalRecordSchema,
  GoalTodoSchema,
} from '@ready4vibe/contracts';
import { z } from 'zod';
import {
  GoalControlRevisionError,
  GoalEventConflictError,
  GoalEventStoreError,
  GoalProjectionBuilder,
  TodoCompletionValidationError,
  assertValidatedTodoCompletion,
  createGoalEvent,
  fingerprintGoalEvent,
} from './index.js';
import type { GoalEventStore } from './index.js';

const EVENT_ID = /^gevt_[A-Za-z0-9_-]{8,128}$/u;
const GOAL_ID = /^goal_[A-Za-z0-9_-]{8,128}$/u;
const TODO_ID = /^todo_[A-Za-z0-9_-]{8,128}$/u;
const GATE_ID = /^gate_[A-Za-z0-9_-]{8,128}$/u;
const EVIDENCE_ID = /^evidence_[A-Za-z0-9_-]{8,128}$/u;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SAFE_PRODUCER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;

const boundedText = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT);
const eventId = z.string().regex(EVENT_ID);
const expectedRevision = z.number().int().nonnegative();
const optionalEntityId = (pattern: RegExp) => z.string().regex(pattern).optional();

export const CreateGoalInputSchema = z.object({
  eventId,
  goalId: optionalEntityId(GOAL_ID),
  title: boundedText(200),
  objective: boundedText(4_000),
  workspaceId: z.string().regex(WORKSPACE_ID).optional(),
}).strict();
export type CreateGoalInput = z.infer<typeof CreateGoalInputSchema>;

export const AddTodoInputSchema = z.object({
  eventId,
  expectedRevision,
  todoId: optionalEntityId(TODO_ID),
  role: z.enum(['user', 'agent']).default('agent'),
  taskClass: z.enum(['advancement', 'monitor', 'user_gate', 'user_action', 'blocker']).default('advancement'),
  title: boundedText(400),
  priority: z.number().int().min(0).max(4).default(1),
  requiredCapabilities: z.array(boundedText(128)).max(32).optional(),
  requiredWriteScopes: z.array(boundedText(256)).max(32).optional(),
  blockedByGateId: z.string().regex(GATE_ID).optional(),
  nextDueAt: z.string().datetime({ offset: true }).optional(),
  verificationPlan: GoalTodoSchema.shape.verificationPlan,
}).strict();
export type AddTodoInput = z.infer<typeof AddTodoInputSchema>;

export const OpenGateInputSchema = z.object({
  eventId,
  expectedRevision,
  gateId: optionalEntityId(GATE_ID),
  kind: z.enum(['user_decision', 'owner_review', 'external_evidence', 'health']),
  question: boundedText(1_000),
  blocking: z.boolean().default(true),
}).strict();
export type OpenGateInput = z.infer<typeof OpenGateInputSchema>;

export const ResolveGateInputSchema = z.object({
  eventId,
  expectedRevision,
  status: z.enum(['approved', 'rejected', 'deferred', 'expired']),
  resolvedBy: z.enum(['user', 'owner', 'system']).default('user'),
}).strict();
export type ResolveGateInput = z.infer<typeof ResolveGateInputSchema>;

export const AttachEvidenceInputSchema = z.object({
  eventId,
  expectedRevision,
  evidenceId: optionalEntityId(EVIDENCE_ID),
  kind: z.enum(['validation', 'artifact', 'run', 'blocker', 'decision']),
  summary: boundedText(2_000),
  status: z.enum(['observed', 'validated', 'failed', 'stale']),
  refs: GoalEvidenceRefsSchema,
}).strict();
export type AttachEvidenceInput = z.infer<typeof AttachEvidenceInputSchema>;

export const CompleteTodoInputSchema = z.object({
  eventId,
  expectedRevision,
  evidenceId: z.string().regex(EVIDENCE_ID),
}).strict();
export type CompleteTodoInput = z.infer<typeof CompleteTodoInputSchema>;

export const GOAL_WRITE_API_SCHEMA_VERSION = 'ready4vibe_goal_write_api_v0' as const;

export interface GoalMutationResult {
  readonly schemaVersion: typeof GOAL_WRITE_API_SCHEMA_VERSION;
  readonly eventId: string;
  readonly controlRevision: number;
  readonly projection: GoalProjection;
}

export interface GoalWriteServiceOptions {
  readonly producer?: string;
  readonly clock?: () => string;
  readonly builder?: GoalProjectionBuilder;
}

export class GoalWriteError extends Error {
  constructor(readonly code: string, readonly safeMessage: string, readonly statusCode: number) {
    super(safeMessage);
    this.name = 'GoalWriteError';
  }
}

export class GoalWriteInputError extends GoalWriteError {
  constructor() {
    super('GOAL_WRITE_INVALID', 'Goal mutation input is invalid.', 400);
    this.name = 'GoalWriteInputError';
  }
}

export class GoalNotFoundError extends GoalWriteError {
  constructor() {
    super('GOAL_NOT_FOUND', 'Goal was not found.', 404);
    this.name = 'GoalNotFoundError';
  }
}

export class GoalAlreadyExistsError extends GoalWriteError {
  constructor() {
    super('GOAL_ALREADY_EXISTS', 'Goal already exists.', 409);
    this.name = 'GoalAlreadyExistsError';
  }
}

export class GoalEntityNotFoundError extends GoalWriteError {
  constructor(code: 'GOAL_TODO_NOT_FOUND' | 'GOAL_GATE_NOT_FOUND' | 'GOAL_EVIDENCE_NOT_FOUND', message: string) {
    super(code, message, 404);
    this.name = 'GoalEntityNotFoundError';
  }
}

export class GoalMutationStateError extends GoalWriteError {
  constructor(message: string) {
    super('GOAL_MUTATION_INVALID_STATE', message, 409);
    this.name = 'GoalMutationStateError';
  }
}

interface GoalWriteStore extends GoalEventStore {
  readonly listGoalIds?: () => readonly string[];
}

/**
 * Bounded application-service write boundary for Goal Control. It accepts
 * mutation DTOs only and never executes models, tools, shell, Git, MCP, or
 * sandbox work.
 */
export class GoalWriteService {
  private readonly producer: string;
  private readonly clock: () => string;
  private readonly builder: GoalProjectionBuilder;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly store: GoalWriteStore, options: GoalWriteServiceOptions = {}) {
    this.producer = options.producer ?? 'goal-write-api';
    if (!SAFE_PRODUCER.test(this.producer)) throw new Error('producer is invalid');
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.builder = options.builder ?? new GoalProjectionBuilder();
  }

  async createGoal(input: unknown): Promise<GoalMutationResult> {
    const parsed = this.parse(CreateGoalInputSchema, input);
    const goalId = parsed.goalId ?? stableEntityId('goal', parsed.eventId);
    return this.withGoalLock(goalId, async () => {
      const existing = await this.findEvent(parsed.eventId);
      const recordedAt = existing?.recordedAt ?? this.now();
      const goal: GoalRecord = GoalRecordSchema.parse({
        goalId,
        title: parsed.title,
        objective: parsed.objective,
        ...(parsed.workspaceId ? { workspaceId: parsed.workspaceId } : {}),
        status: 'active',
        controlRevision: 0,
        createdAt: recordedAt,
        updatedAt: recordedAt,
        schemaVersion: 1,
      });
      const candidate = createGoalEvent({
        eventId: parsed.eventId,
        goalId,
        eventType: 'goal.created',
        recordedAt,
        producer: this.producer,
        privacy: 'local_private',
        refs: {},
        payload: { goal },
      });
      if (existing) return this.resolveRetry(existing, candidate);
      if (await this.readProjection(goalId)) throw new GoalAlreadyExistsError();
      return this.append(candidate);
    });
  }

  async addTodo(goalId: string, input: unknown): Promise<GoalMutationResult> {
    const parsed = this.parse(AddTodoInputSchema, input);
    assertEntityId(goalId, GOAL_ID);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const existing = await this.findEvent(parsed.eventId);
      const recordedAt = existing?.recordedAt ?? this.now();
      const todo: GoalTodo = GoalTodoSchema.parse({
        todoId: parsed.todoId ?? stableEntityId('todo', parsed.eventId),
        goalId,
        role: parsed.role,
        status: 'open',
        taskClass: parsed.taskClass,
        title: parsed.title,
        priority: parsed.priority,
        ...(parsed.requiredCapabilities ? { requiredCapabilities: parsed.requiredCapabilities } : {}),
        ...(parsed.requiredWriteScopes ? { requiredWriteScopes: parsed.requiredWriteScopes } : {}),
        ...(parsed.blockedByGateId ? { blockedByGateId: parsed.blockedByGateId } : {}),
        ...(parsed.nextDueAt ? { nextDueAt: parsed.nextDueAt } : {}),
        ...(parsed.verificationPlan ? { verificationPlan: parsed.verificationPlan } : {}),
      });
      const candidate = createGoalEvent({
        eventId: parsed.eventId,
        goalId,
        eventType: 'todo.added',
        recordedAt,
        producer: this.producer,
        privacy: 'local_private',
        refs: { todoId: todo.todoId },
        payload: { todo },
      });
      if (existing) return this.resolveRetry(existing, candidate);
      this.assertRevision(projection, parsed.expectedRevision);
      this.assertGoalMutable(projection);
      if (projection.todos.some((item) => item.todoId === todo.todoId)) throw new GoalMutationStateError('Todo already exists.');
      return this.append(candidate);
    });
  }

  async openGate(goalId: string, input: unknown): Promise<GoalMutationResult> {
    const parsed = this.parse(OpenGateInputSchema, input);
    assertEntityId(goalId, GOAL_ID);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const existing = await this.findEvent(parsed.eventId);
      const recordedAt = existing?.recordedAt ?? this.now();
      const gate: GoalGate = {
        gateId: parsed.gateId ?? stableEntityId('gate', parsed.eventId),
        goalId,
        kind: parsed.kind,
        status: 'open',
        question: parsed.question,
        blocking: parsed.blocking ?? true,
        openedAt: recordedAt,
      };
      const candidate = createGoalEvent({
        eventId: parsed.eventId,
        goalId,
        eventType: 'gate.opened',
        recordedAt,
        producer: this.producer,
        privacy: 'local_private',
        refs: { gateId: gate.gateId },
        payload: { gate },
      });
      if (existing) return this.resolveRetry(existing, candidate);
      this.assertRevision(projection, parsed.expectedRevision);
      this.assertGoalMutable(projection);
      if (projection.gates.some((item) => item.gateId === gate.gateId)) throw new GoalMutationStateError('Gate already exists.');
      return this.append(candidate);
    });
  }

  async resolveGate(goalId: string, gateId: string, input: unknown): Promise<GoalMutationResult> {
    const parsed = this.parse(ResolveGateInputSchema, input);
    assertEntityId(goalId, GOAL_ID);
    assertEntityId(gateId, GATE_ID);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const current = projection.gates.find((gate) => gate.gateId === gateId);
      if (!current) throw new GoalEntityNotFoundError('GOAL_GATE_NOT_FOUND', 'Gate was not found.');
      const existing = await this.findEvent(parsed.eventId);
      const recordedAt = existing?.recordedAt ?? this.now();
      const gate: GoalGate = {
        ...current,
        status: parsed.status,
        resolvedAt: recordedAt,
        resolvedBy: parsed.resolvedBy,
      };
      const candidate = createGoalEvent({
        eventId: parsed.eventId,
        goalId,
        eventType: 'gate.resolved',
        recordedAt,
        producer: this.producer,
        privacy: 'local_private',
        refs: { gateId },
        payload: { gate },
      });
      if (existing) return this.resolveRetry(existing, candidate);
      this.assertRevision(projection, parsed.expectedRevision);
      this.assertGoalMutable(projection);
      if (current.status !== 'open') throw new GoalMutationStateError('Gate is already resolved.');
      return this.append(candidate);
    });
  }

  async attachEvidence(goalId: string, input: unknown): Promise<GoalMutationResult> {
    const parsed = this.parse(AttachEvidenceInputSchema, input);
    assertEntityId(goalId, GOAL_ID);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const existing = await this.findEvent(parsed.eventId);
      const recordedAt = existing?.recordedAt ?? this.now();
      const evidence: GoalEvidence = {
        evidenceId: parsed.evidenceId ?? stableEntityId('evidence', parsed.eventId),
        goalId,
        kind: parsed.kind,
        summary: parsed.summary,
        status: parsed.status,
        refs: parsed.refs,
        recordedAt,
      };
      const candidate = createGoalEvent({
        eventId: parsed.eventId,
        goalId,
        eventType: 'evidence.attached',
        recordedAt,
        producer: this.producer,
        privacy: 'local_private',
        refs: { evidenceId: evidence.evidenceId },
        payload: { evidence },
      });
      if (existing) return this.resolveRetry(existing, candidate);
      this.assertRevision(projection, parsed.expectedRevision);
      this.assertGoalMutable(projection);
      if (projection.evidence.some((item) => item.evidenceId === evidence.evidenceId)) throw new GoalMutationStateError('Evidence already exists.');
      return this.append(candidate);
    });
  }

  async completeTodo(goalId: string, todoId: string, input: unknown): Promise<GoalMutationResult> {
    const parsed = this.parse(CompleteTodoInputSchema, input);
    assertEntityId(goalId, GOAL_ID);
    assertEntityId(todoId, TODO_ID);
    return this.withGoalLock(goalId, async () => {
      const projection = await this.requireGoal(goalId);
      const todo = projection.todos.find((item) => item.todoId === todoId);
      if (!todo) throw new GoalEntityNotFoundError('GOAL_TODO_NOT_FOUND', 'Todo was not found.');
      const evidence = projection.evidence.find((item) => item.evidenceId === parsed.evidenceId);
      if (!evidence) throw new GoalEntityNotFoundError('GOAL_EVIDENCE_NOT_FOUND', 'Evidence was not found.');
      const existing = await this.findEvent(parsed.eventId);
      const recordedAt = existing?.recordedAt ?? this.now();
      const candidate = createGoalEvent({
        eventId: parsed.eventId,
        goalId,
        eventType: 'todo.completed',
        recordedAt,
        producer: this.producer,
        privacy: 'local_private',
        refs: { todoId, evidenceId: parsed.evidenceId },
        payload: { todoId, evidenceId: parsed.evidenceId, completedAt: recordedAt },
      });
      if (existing) return this.resolveRetry(existing, candidate);
      this.assertRevision(projection, parsed.expectedRevision);
      this.assertGoalMutable(projection);
      assertValidatedTodoCompletion({ projection, todoId, validation: { status: 'validated', evidenceStatus: evidence.status } });
      if (evidence.status !== 'validated') throw new TodoCompletionValidationError('A validated Evidence result is required.');
      if (todo.status === 'done' || todo.status === 'superseded') throw new GoalMutationStateError('Todo is already terminal.');
      return this.append(candidate);
    });
  }

  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new GoalWriteInputError();
    return result.data;
  }

  private async append(event: NewGoalEvent): Promise<GoalMutationResult> {
    const stored = await this.store.append(event);
    return this.result(stored);
  }

  private async resolveRetry(existing: StoredGoalEvent, candidate: NewGoalEvent): Promise<GoalMutationResult> {
    if (fingerprintGoalEvent(existing) !== fingerprintGoalEvent(candidate)) throw new GoalEventConflictError(candidate.eventId);
    return this.result(existing);
  }

  private async result(event: StoredGoalEvent): Promise<GoalMutationResult> {
    const projection = await this.readProjection(event.goalId);
    if (!projection) throw new GoalWriteError('GOAL_PROJECTION_UNAVAILABLE', 'Goal projection is unavailable.', 503);
    return {
      schemaVersion: GOAL_WRITE_API_SCHEMA_VERSION,
      eventId: event.eventId,
      controlRevision: projection.controlRevision,
      projection: GoalProjectionSchema.parse(projection),
    };
  }

  private async readProjection(goalId: string): Promise<GoalProjection | undefined> {
    const events = await this.store.read(goalId);
    if (events.length === 0) return undefined;
    const projection = this.builder.build(events);
    return projection.goal ? projection : undefined;
  }

  private async requireGoal(goalId: string): Promise<GoalProjection> {
    const projection = await this.readProjection(goalId);
    if (!projection) throw new GoalNotFoundError();
    return projection;
  }

  private async findEvent(eventIdValue: string): Promise<StoredGoalEvent | undefined> {
    const goalIds = this.store.listGoalIds ? [...this.store.listGoalIds()] : [];
    for (const goalId of goalIds) {
      const event = (await this.store.read(goalId)).find((candidate) => candidate.eventId === eventIdValue);
      if (event) return event;
    }
    return undefined;
  }

  private assertRevision(projection: GoalProjection, expected: number): void {
    if (projection.controlRevision !== expected) throw new GoalControlRevisionError(expected, projection.controlRevision);
  }

  private assertGoalMutable(projection: GoalProjection): void {
    const status = projection.goal?.status;
    if (!status) throw new GoalNotFoundError();
    if (status === 'completed' || status === 'archived') throw new GoalMutationStateError('Goal is not mutable in its current state.');
  }

  private now(): string {
    const value = this.clock();
    if (!Number.isFinite(Date.parse(value))) throw new GoalEventStoreError('clock must return an ISO date');
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

function stableEntityId(prefix: 'goal' | 'todo' | 'gate' | 'evidence', eventIdValue: string): string {
  return `${prefix}_${createHash('sha256').update(`${prefix}:${eventIdValue}`).digest('hex').slice(0, 16)}`;
}

function assertEntityId(value: string, pattern: RegExp): void {
  if (!pattern.test(value)) throw new GoalWriteInputError();
}
