import { z } from 'zod';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const GOAL_ID = /^goal_[A-Za-z0-9_-]{8,128}$/u;
const TODO_ID = /^todo_[A-Za-z0-9_-]{8,128}$/u;
const GATE_ID = /^gate_[A-Za-z0-9_-]{8,128}$/u;
const EVIDENCE_ID = /^evidence_[A-Za-z0-9_-]{8,128}$/u;
const HANDOFF_ID = /^handoff_[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID = /^gevt_[A-Za-z0-9_-]{8,128}$/u;
const TURN_KEY = /^turn_[A-Za-z0-9_.:-]{1,160}$/u;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;

const boundedText = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT);
const safeId = z.string().min(1).max(128).regex(SAFE_ID);
const goalId = z.string().regex(GOAL_ID);
const todoId = z.string().regex(TODO_ID);
const gateId = z.string().regex(GATE_ID);
const evidenceId = z.string().regex(EVIDENCE_ID);
const handoffId = z.string().regex(HANDOFF_ID);
const eventId = z.string().regex(EVENT_ID);
const dateTime = z.string().datetime({ offset: true });

export const GoalStatusSchema = z.enum(['active', 'paused', 'blocked', 'completed', 'archived']);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const GoalRecordSchema = z.object({
  goalId,
  title: boundedText(200),
  objective: boundedText(4_000),
  workspaceId: z.string().regex(WORKSPACE_ID).optional(),
  status: GoalStatusSchema,
  controlRevision: z.number().int().nonnegative(),
  createdAt: dateTime,
  updatedAt: dateTime,
  schemaVersion: z.literal(1),
}).strict();
export type GoalRecord = z.infer<typeof GoalRecordSchema>;

export const TodoRoleSchema = z.enum(['user', 'agent']);
export type TodoRole = z.infer<typeof TodoRoleSchema>;
export const TodoStatusSchema = z.enum(['open', 'blocked', 'deferred', 'done', 'superseded']);
export type TodoStatus = z.infer<typeof TodoStatusSchema>;
export const TodoTaskClassSchema = z.enum(['advancement', 'monitor', 'user_gate', 'user_action', 'blocker']);
export type TodoTaskClass = z.infer<typeof TodoTaskClassSchema>;

export const GoalTodoSchema = z.object({
  todoId,
  goalId,
  role: TodoRoleSchema,
  status: TodoStatusSchema,
  taskClass: TodoTaskClassSchema,
  title: boundedText(400),
  priority: z.number().int().min(0).max(4),
  claimedBy: safeId.optional(),
  /** Hash only; the one-time claim token is never persisted in Goal state. */
  claimTokenHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  claimedAt: dateTime.optional(),
  claimExpiresAt: dateTime.optional(),
  boundAgentId: safeId.optional(),
  requiredCapabilities: z.array(boundedText(128)).max(32).optional(),
  requiredWriteScopes: z.array(boundedText(256)).max(32).optional(),
  successorTodoIds: z.array(todoId).max(32).optional(),
  blockedByGateId: gateId.optional(),
  nextDueAt: dateTime.optional(),
  completedAt: dateTime.optional(),
}).strict();
export type GoalTodo = z.infer<typeof GoalTodoSchema>;

export const GoalGateKindSchema = z.enum(['user_decision', 'owner_review', 'external_evidence', 'health']);
export type GoalGateKind = z.infer<typeof GoalGateKindSchema>;
export const GoalGateStatusSchema = z.enum(['open', 'approved', 'rejected', 'deferred', 'expired']);
export type GoalGateStatus = z.infer<typeof GoalGateStatusSchema>;

export const GoalGateSchema = z.object({
  gateId,
  goalId,
  kind: GoalGateKindSchema,
  status: GoalGateStatusSchema,
  question: boundedText(1_000),
  blocking: z.boolean(),
  openedAt: dateTime,
  resolvedAt: dateTime.optional(),
  resolvedBy: z.enum(['user', 'owner', 'system']).optional(),
}).strict();
export type GoalGate = z.infer<typeof GoalGateSchema>;

export const GoalEvidenceKindSchema = z.enum(['validation', 'artifact', 'run', 'blocker', 'decision']);
export type GoalEvidenceKind = z.infer<typeof GoalEvidenceKindSchema>;
export const GoalEvidenceStatusSchema = z.enum(['observed', 'validated', 'failed', 'stale']);
export type GoalEvidenceStatus = z.infer<typeof GoalEvidenceStatusSchema>;

export const GoalEvidenceRefsSchema = z.object({
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{8,128}$/u).optional(),
  eventIds: z.array(z.string().regex(/^evt_[A-Za-z0-9_-]{8,128}$/u)).max(64).optional(),
  artifactIds: z.array(safeId).max(64).optional(),
}).strict();

export const GoalEvidenceSchema = z.object({
  evidenceId,
  goalId,
  kind: GoalEvidenceKindSchema,
  summary: boundedText(2_000),
  status: GoalEvidenceStatusSchema,
  refs: GoalEvidenceRefsSchema,
  recordedAt: dateTime,
}).strict();
export type GoalEvidence = z.infer<typeof GoalEvidenceSchema>;

export const GoalHandoffSchema = z.object({
  handoffId,
  goalId,
  fromTodoId: todoId.optional(),
  fromEvidenceId: evidenceId.optional(),
  toTodoId: todoId,
  summary: boundedText(1_000),
  createdAt: dateTime,
}).strict().refine((value) => value.fromTodoId !== undefined || value.fromEvidenceId !== undefined, {
  message: 'handoff must reference a todo or evidence source',
  path: ['fromTodoId'],
});
export type GoalHandoff = z.infer<typeof GoalHandoffSchema>;

const GoalRunBindingLegacySchema = z.object({
  bindingId: safeId,
  goalId,
  todoId: todoId.optional(),
  agentId: safeId.optional(),
  mode: z.enum(['interactive', 'governed']),
  controlRevision: z.number().int().nonnegative().optional(),
}).strict();

/**
 * The original v0 shape remains accepted for replay and existing callers.
 * Spec 58-1 adds the strict run-snapshot shape in the additive v1 module; the
 * union keeps this public parser backwards compatible while allowing callers
 * that only know the original name to validate a v1 binding as well.
 */
const GoalRunBindingV1CompatSchema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_binding_v1'),
  bindingId: z.string().regex(/^binding_[A-Za-z0-9_-]{8,128}$/u),
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{8,128}$/u),
  goalId: goalId,
  todoId: todoId.optional(),
  mode: z.enum(['interactive', 'governed']),
  goalControlRevision: z.number().int().nonnegative(),
  policyRevision: z.number().int().nonnegative(),
  capabilityProfileRevision: z.number().int().nonnegative(),
  approvalPolicyRevision: z.number().int().nonnegative(),
  sandboxSnapshotRevision: z.number().int().nonnegative(),
  workspaceId: z.string().regex(WORKSPACE_ID),
  admissionId: z.string().regex(/^admission_[A-Za-z0-9_-]{8,128}$/u),
  createdAt: dateTime,
  expiresAt: dateTime,
  attempt: z.number().int().positive(),
  requestId: safeId,
}).strict();

export const GoalRunBindingSchema = z.union([GoalRunBindingLegacySchema, GoalRunBindingV1CompatSchema]);
export type GoalRunBinding = z.infer<typeof GoalRunBindingSchema>;

export const GoalEventTypeSchema = z.enum([
  'goal.created',
  'goal.updated',
  'goal.completed',
  'todo.added',
  'todo.claimed',
  'todo.claim_released',
  'todo.updated',
  'todo.blocked',
  'todo.deferred',
  'todo.completed',
  'gate.opened',
  'gate.resolved',
  'run.recorded',
  'evidence.attached',
  'handoff.created',
  'writeback.failed',
  'quota.spent',
  'projection.refreshed',
]);
export type GoalEventType = z.infer<typeof GoalEventTypeSchema>;

export const GoalEventPrivacySchema = z.enum(['public_safe', 'local_private', 'private_pointer']);
export type GoalEventPrivacy = z.infer<typeof GoalEventPrivacySchema>;

export const GoalEventRefsSchema = z.object({
  todoId: todoId.optional(),
  gateId: gateId.optional(),
  evidenceId: evidenceId.optional(),
  handoffId: handoffId.optional(),
  runId: z.string().regex(/^run_[A-Za-z0-9_-]{8,128}$/u).optional(),
  bindingId: safeId.optional(),
  turnKey: z.string().regex(TURN_KEY).optional(),
  parentEventId: eventId.optional(),
}).strict();
export type GoalEventRefs = z.infer<typeof GoalEventRefsSchema>;

export const GoalEventPayloadSchema = z.record(z.string().min(1).max(64), z.unknown()).superRefine((value, context) => {
  if (Object.keys(value).length > 64) context.addIssue({ code: z.ZodIssueCode.custom, message: 'goal event payload has too many top-level fields' });
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoded.length > 128 * 1024) context.addIssue({ code: z.ZodIssueCode.custom, message: 'goal event payload is too large' });
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'goal event payload must be JSON serializable' });
  }
  const violations = findGoalPrivacyViolations(value);
  for (const violation of violations) context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
});

const GoalEventBaseSchema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_event_v0'),
  eventId,
  goalId,
  eventType: GoalEventTypeSchema,
  recordedAt: dateTime,
  producer: safeId,
  privacy: GoalEventPrivacySchema,
  projectionVersion: z.literal('goal_control_projection_v0'),
  refs: GoalEventRefsSchema,
  payload: GoalEventPayloadSchema,
}).strict();

export const NewGoalEventSchema = GoalEventBaseSchema;
export type NewGoalEvent<TPayload = Record<string, unknown>> = Omit<z.infer<typeof GoalEventBaseSchema>, 'payload'> & { payload: TPayload };

export const StoredGoalEventSchema = GoalEventBaseSchema.extend({ appendSequence: z.number().int().positive() }).strict();
export type StoredGoalEvent<TPayload = Record<string, unknown>> = Omit<z.infer<typeof StoredGoalEventSchema>, 'payload'> & { payload: TPayload };

export const GoalQuotaProjectionSchema = z.object({
  spentTurnKeys: z.array(z.string().regex(TURN_KEY)).max(10_000),
  totalSpent: z.number().int().nonnegative(),
}).strict();
export type GoalQuotaProjection = z.infer<typeof GoalQuotaProjectionSchema>;

export const GoalProjectionSchema = z.object({
  projectionVersion: z.literal('goal_control_projection_v0'),
  goal: GoalRecordSchema.nullable(),
  todos: z.array(GoalTodoSchema).max(10_000),
  gates: z.array(GoalGateSchema).max(10_000),
  evidence: z.array(GoalEvidenceSchema).max(10_000),
  handoffs: z.array(GoalHandoffSchema).max(10_000),
  quota: GoalQuotaProjectionSchema,
  lastEventId: eventId.nullable(),
  lastAppendSequence: z.number().int().nonnegative(),
  sourceEventCount: z.number().int().nonnegative(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  controlRevision: z.number().int().nonnegative(),
}).strict();
export type GoalProjection = z.infer<typeof GoalProjectionSchema>;

export const GoalShouldRunStatusSchema = z.enum(['blocked_health', 'operator_gate', 'eligible', 'waiting', 'throttled', 'paused']);
export type GoalShouldRunStatus = z.infer<typeof GoalShouldRunStatusSchema>;

export const GoalShouldRunDecisionSchema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_should_run_v0'),
  goalId,
  status: GoalShouldRunStatusSchema,
  reason: boundedText(500),
  controlRevision: z.number().int().nonnegative(),
  todoId: todoId.optional(),
  turnKey: z.string().regex(TURN_KEY).optional(),
}).strict();
export type GoalShouldRunDecision = z.infer<typeof GoalShouldRunDecisionSchema>;

const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|secret|password|authorization|cookie|credential|environment|env|token(?:hash)?)$/iu;
const PATH_KEY = /(?:^|[_-])(path|root|cwd|directory|filename|file)$/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

/** Returns stable, user-safe privacy violations for event payload validation. */
export function findGoalPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (path.some((key) => PATH_KEY.test(key)) && (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value))) {
      violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    }
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...findGoalPrivacyViolations(item, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_KEY.test(key) && key !== 'claimTokenHash') violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findGoalPrivacyViolations(child, nextPath));
  }
  return violations;
}

export function parseNewGoalEvent(value: unknown): NewGoalEvent {
  return NewGoalEventSchema.parse(value) as NewGoalEvent;
}

export function parseStoredGoalEvent(value: unknown): StoredGoalEvent {
  return StoredGoalEventSchema.parse(value) as StoredGoalEvent;
}
