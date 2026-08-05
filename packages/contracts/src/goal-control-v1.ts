import { z } from 'zod';
import {
  GoalEvidenceRefsSchema,
  GoalEvidenceSchema,
  GoalGateSchema,
  GoalHandoffSchema,
  GoalRecordSchema,
  GoalTodoSchema,
  GoalEventRefsSchema,
  StoredGoalEventSchema,
  findGoalPrivacyViolations,
} from './goal.js';
import type {
  GoalEvidence,
  GoalGate,
  GoalHandoff,
  GoalProjection,
  GoalRecord,
  GoalTodo,
  NewGoalEvent,
  StoredGoalEvent,
} from './goal.js';

export const GOAL_CONTROL_V1_SCHEMA_VERSION = 'ready4vibe_goal_control_v1' as const;
export const GOAL_CONTROL_EVENT_V1_SCHEMA_VERSION = 'ready4vibe_goal_event_v1' as const;
export const GOAL_CONTROL_PROJECTION_V1_VERSION = 'goal_control_projection_v1' as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const RUN_ID = /^run_[A-Za-z0-9_-]{8,128}$/u;
const BINDING_ID = /^binding_[A-Za-z0-9_-]{8,128}$/u;
const ADMISSION_ID = /^admission_[A-Za-z0-9_-]{8,128}$/u;
const RESERVATION_ID = /^reservation_[A-Za-z0-9_-]{8,128}$/u;
const RECOVERY_ID = /^recovery_[A-Za-z0-9_-]{8,128}$/u;
const GOAL_ID = /^goal_[A-Za-z0-9_-]{8,128}$/u;
const TODO_ID = /^todo_[A-Za-z0-9_-]{8,128}$/u;
const EVENT_ID = /^gevt_[A-Za-z0-9_-]{8,128}$/u;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const TURN_KEY = /^turn_[A-Za-z0-9_.:-]{1,160}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;

const boundedText = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT);
const safeId = z.string().regex(SAFE_ID);
const runId = z.string().regex(RUN_ID);
const bindingId = z.string().regex(BINDING_ID);
const admissionId = z.string().regex(ADMISSION_ID);
const reservationId = z.string().regex(RESERVATION_ID);
const recoveryId = z.string().regex(RECOVERY_ID);
const goalId = z.string().regex(GOAL_ID);
const todoId = z.string().regex(TODO_ID);
const eventId = z.string().regex(EVENT_ID);
const workspaceId = z.string().regex(WORKSPACE_ID);
const turnKey = z.string().regex(TURN_KEY);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Settings/profile revisions are opaque bounded tokens at the application boundary. */
export const GoalRevisionTokenSchema = z.union([
  revision,
  z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
]);
export type GoalRevisionToken = z.infer<typeof GoalRevisionTokenSchema>;
const revisionToken = GoalRevisionTokenSchema;
const attempt = z.number().int().positive().max(10_000);
const dateTime = z.string().datetime({ offset: true });
const checksum = z.string().regex(SHA256);

function boundedPayloadSchema(maxBytes = 128 * 1024) {
  return z.record(z.string().min(1).max(64), z.unknown()).superRefine((value, context) => {
    if (Object.keys(value).length > 64) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'goal control payload has too many fields' });
    }
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined || encoded.length > maxBytes) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'goal control payload is too large' });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'goal control payload must be JSON serializable' });
    }
    for (const violation of findGoalPrivacyViolations(value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
    }
  });
}

export const GoalRunBindingV1Schema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_binding_v1'),
  bindingId,
  runId,
  goalId,
  todoId: todoId.optional(),
  mode: z.enum(['interactive', 'governed']),
  goalControlRevision: revision,
  policyRevision: revisionToken,
  capabilityProfileRevision: revisionToken,
  approvalPolicyRevision: revisionToken,
  sandboxSnapshotRevision: revisionToken,
  workspaceId,
  admissionId,
  createdAt: dateTime,
  expiresAt: dateTime,
  attempt,
  requestId: safeId,
}).strict();
export type GoalRunBindingV1 = z.infer<typeof GoalRunBindingV1Schema>;

export const GoalAdmissionReasonCodeV1Schema = z.enum([
  'GATE_OPEN',
  'GOAL_PAUSED',
  'GOAL_BLOCKED',
  'STALE_REVISION',
  'TODO_ALREADY_CLAIMED',
  'TODO_CLAIM_REQUIRED',
  'TODO_CLAIM_EXPIRED',
  'TODO_NOT_ELIGIBLE',
  'QUOTA_EXHAUSTED',
  'QUOTA_RESERVED',
  'SCHEDULER_UNAVAILABLE',
  'CAPABILITY_MISMATCH',
  'APPROVAL_REQUIRED',
  'SANDBOX_UNAVAILABLE',
  'WORKSPACE_UNAVAILABLE',
  'PROJECTION_UNAVAILABLE',
  'ELIGIBLE',
  'DEGRADED',
]);
export type GoalAdmissionReasonCodeV1 = z.infer<typeof GoalAdmissionReasonCodeV1Schema>;

export const GoalAdmissionDecisionV1Schema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_admission_v1'),
  admissionId,
  goalId,
  todoId: todoId.optional(),
  status: z.enum(['eligible', 'blocked', 'waiting', 'throttled', 'degraded']),
  reasonCode: GoalAdmissionReasonCodeV1Schema,
  reason: boundedText(500),
  projectionChecksum: checksum,
  controlRevision: revision,
  schedulerDecisionRef: safeId.optional(),
  nextStep: z.enum(['claim_todo', 'resolve_gate', 'wait_scheduler', 'retry', 'create_run', 'none']),
  createdAt: dateTime,
  requestId: safeId,
}).strict();
export type GoalAdmissionDecisionV1 = z.infer<typeof GoalAdmissionDecisionV1Schema>;

export const GoalQuotaReservationStatusV1Schema = z.enum(['reserved', 'consumed', 'released', 'expired']);
export type GoalQuotaReservationStatusV1 = z.infer<typeof GoalQuotaReservationStatusV1Schema>;

export const GoalQuotaReservationV1Schema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_quota_reservation_v1'),
  reservationId,
  bindingId,
  goalId,
  todoId: todoId.optional(),
  attempt,
  turnKey,
  units: z.number().int().positive().max(1_000),
  status: GoalQuotaReservationStatusV1Schema,
  createdAt: dateTime,
  expiresAt: dateTime,
  updatedAt: dateTime,
  reason: boundedText(500).optional(),
}).strict();
export type GoalQuotaReservationV1 = z.infer<typeof GoalQuotaReservationV1Schema>;

export const GoalValidationStatusV1Schema = z.enum(['validated', 'failed', 'inconclusive', 'stale']);
export type GoalValidationStatusV1 = z.infer<typeof GoalValidationStatusV1Schema>;

export const GoalValidationEvidenceV1Schema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_validation_evidence_v1'),
  evidenceId: z.string().regex(/^evidence_[A-Za-z0-9_-]{8,128}$/u),
  goalId,
  todoId: todoId.optional(),
  bindingId,
  runId,
  attempt,
  verifierId: safeId,
  verifierRevision: revision,
  status: GoalValidationStatusV1Schema,
  checkedAt: dateTime,
  summary: boundedText(2_000),
  refs: GoalEvidenceRefsSchema,
  evidenceChecksum: checksum,
}).strict();
export type GoalValidationEvidenceV1 = z.infer<typeof GoalValidationEvidenceV1Schema>;

export const GoalRecoveryStatusV1Schema = z.enum(['requested', 'needs_recovery', 'reconciled', 'retry_created']);
export type GoalRecoveryStatusV1 = z.infer<typeof GoalRecoveryStatusV1Schema>;

export const GoalRecoveryRecordV1Schema = z.object({
  schemaVersion: z.literal('ready4vibe_goal_recovery_v1'),
  recoveryId,
  goalId,
  bindingId: bindingId.optional(),
  runId,
  previousRunId: runId.optional(),
  attempt,
  status: GoalRecoveryStatusV1Schema,
  reason: boundedText(500),
  createdAt: dateTime,
  requestId: safeId,
}).strict();
export type GoalRecoveryRecordV1 = z.infer<typeof GoalRecoveryRecordV1Schema>;

export const GoalControlEventTypeV1Schema = z.enum([
  'binding.created',
  'admission.recorded',
  'quota.reserved',
  'quota.released',
  'quota.consumed',
  'quota.expired',
  'validation.recorded',
  'recovery.recorded',
  'handoff.recorded',
  'todo.completed',
]);
export type GoalControlEventTypeV1 = z.infer<typeof GoalControlEventTypeV1Schema>;

export const GoalControlEventRefsV1Schema = GoalEventRefsSchema.extend({
  admissionId: admissionId.optional(),
  reservationId: reservationId.optional(),
  recoveryId: recoveryId.optional(),
}).strict();
export type GoalControlEventRefsV1 = z.infer<typeof GoalControlEventRefsV1Schema>;

const GoalControlEventV1BaseSchema = z.object({
  schemaVersion: z.literal(GOAL_CONTROL_EVENT_V1_SCHEMA_VERSION),
  eventId,
  goalId,
  eventType: GoalControlEventTypeV1Schema,
  controlRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recordedAt: dateTime,
  producer: safeId,
  privacy: z.enum(['public_safe', 'local_private', 'private_pointer']),
  projectionVersion: z.literal(GOAL_CONTROL_PROJECTION_V1_VERSION),
  refs: GoalControlEventRefsV1Schema,
  payload: boundedPayloadSchema(),
}).strict();

export const NewGoalControlEventV1Schema = GoalControlEventV1BaseSchema;
export type NewGoalControlEventV1<TPayload = Record<string, unknown>> = Omit<
  z.infer<typeof GoalControlEventV1BaseSchema>,
  'payload'
> & { payload: TPayload };

export const StoredGoalControlEventV1Schema = GoalControlEventV1BaseSchema.extend({
  appendSequence: z.number().int().positive(),
}).strict();
export type StoredGoalControlEventV1<TPayload = Record<string, unknown>> = Omit<
  z.infer<typeof StoredGoalControlEventV1Schema>,
  'payload'
> & { payload: TPayload };

export const GoalControlEventEnvelopeSchema = z.union([
  // The order keeps the legacy parser first for v0 data and is intentionally
  // explicit: unknown event types must not be accepted by a broad record.
  StoredGoalEventSchema,
  StoredGoalControlEventV1Schema,
]);
export type GoalControlEventEnvelope = StoredGoalEvent | StoredGoalControlEventV1;

export const GoalControlQuotaProjectionV1Schema = z.object({
  spentTurnKeys: z.array(turnKey).max(10_000),
  totalSpent: z.number().int().nonnegative().max(10_000),
  reservations: z.array(GoalQuotaReservationV1Schema).max(10_000),
}).strict();
export type GoalControlQuotaProjectionV1 = z.infer<typeof GoalControlQuotaProjectionV1Schema>;

export const GoalControlProjectionV1Schema = z.object({
  projectionVersion: z.literal(GOAL_CONTROL_PROJECTION_V1_VERSION),
  goal: GoalRecordSchema.nullable(),
  todos: z.array(GoalTodoSchema).max(10_000),
  gates: z.array(GoalGateSchema).max(10_000),
  evidence: z.array(GoalEvidenceSchema).max(10_000),
  handoffs: z.array(GoalHandoffSchema).max(10_000),
  bindings: z.array(GoalRunBindingV1Schema).max(10_000),
  admissions: z.array(GoalAdmissionDecisionV1Schema).max(10_000),
  validationEvidence: z.array(GoalValidationEvidenceV1Schema).max(10_000),
  recoveries: z.array(GoalRecoveryRecordV1Schema).max(10_000),
  quota: GoalControlQuotaProjectionV1Schema,
  lastEventId: eventId.nullable(),
  lastAppendSequence: z.number().int().nonnegative(),
  sourceEventCount: z.number().int().nonnegative(),
  sourceChecksum: checksum,
  controlRevision: revision,
}).strict();
export type GoalControlProjectionV1 = z.infer<typeof GoalControlProjectionV1Schema>;

export interface GoalControlProjectionBase {
  readonly goal: GoalRecord | null;
  readonly todos: readonly GoalTodo[];
  readonly gates: readonly GoalGate[];
  readonly evidence: readonly GoalEvidence[];
  readonly handoffs: readonly GoalHandoff[];
  readonly projection: GoalProjection;
}

export type GoalControlEventPayload =
  | { binding: GoalRunBindingV1 }
  | { decision: GoalAdmissionDecisionV1 }
  | { reservation: GoalQuotaReservationV1 }
  | { evidence: GoalValidationEvidenceV1 }
  | { recovery: GoalRecoveryRecordV1 }
  | { handoff: z.infer<typeof GoalHandoffSchema> };

// Keep these imports in the generated declaration surface so consumers can
// build typed migration fixtures without importing implementation modules.
export type { GoalEvidence, GoalGate, GoalHandoff, GoalProjection, GoalRecord, GoalTodo, NewGoalEvent, StoredGoalEvent };
