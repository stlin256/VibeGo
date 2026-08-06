import { z } from 'zod';
import { GoalEvidenceRefsSchema, GoalVerificationFactSchema, GoalVerificationPlanSchema, TodoTaskClassSchema } from './goal.js';
import { GoalRunBindingV1Schema, GoalValidationStatusV1Schema } from './goal-control-v1.js';

export const GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION = 'ready4vibe_goal_verifier_descriptor_v1' as const;
export const GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION = 'ready4vibe_goal_verifier_event_digest_v1' as const;
export const GOAL_VERIFIER_INPUT_SCHEMA_VERSION = 'ready4vibe_goal_verifier_input_v1' as const;
export const GOAL_VERIFIER_RESULT_SCHEMA_VERSION = 'ready4vibe_goal_verifier_result_v1' as const;
export const GOAL_OBJECTIVE_SNAPSHOT_SCHEMA_VERSION = 'ready4vibe_goal_objective_snapshot_v1' as const;
export const GOAL_VERIFIER_OBSERVATION_SCHEMA_VERSION = 'ready4vibe_goal_verifier_observation_v1' as const;

/** Server-owned limits; Web/Goal payloads cannot enlarge verifier input. */
export const GOAL_VERIFIER_MAX_EVENT_DIGESTS = 512;
export const GOAL_VERIFIER_MAX_EVENT_SEQ = 1_000_000;
export const GOAL_VERIFIER_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const VERIFIER_ID = /^verifier_[A-Za-z0-9_-]{1,120}$/u;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9]{12,})/iu;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer|secret)/iu;

const VerifierIdSchema = z.string().min(10).max(128).regex(VERIFIER_ID).regex(CONTROL_TEXT);
const RevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z.string().datetime({ offset: true }).max(64);
const NonNegativeRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const RunIdSchema = z.string().regex(/^run_[A-Za-z0-9_-]{8,128}$/u);
const EventIdSchema = z.string().regex(/^evt_[A-Za-z0-9_-]{8,128}$/u);
const EventTypeSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u).regex(CONTROL_TEXT);
const VerifierRunStatusSchema = z.enum([
  'created',
  'queued',
  'planning',
  'executing',
  'waiting-approval',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'timed-out',
  'needs-recovery',
]);
const BoundedSummarySchema = z.string().min(1).max(2_000).regex(CONTROL_TEXT);
const ObjectiveDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const GoalIdSchema = z.string().regex(/^goal_[A-Za-z0-9_-]{8,128}$/u);
const TodoIdSchema = z.string().regex(/^todo_[A-Za-z0-9_-]{8,128}$/u);
const ObservationSelectorSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
const ObservationValueSchema = z.union([
  z.string().max(256).regex(CONTROL_TEXT),
  z.number().int().nonnegative().max(GOAL_VERIFIER_MAX_OUTPUT_BYTES),
  z.boolean(),
]);

/** Only these Todo classes can ever select an automatic verifier. */
export const GoalVerifierTaskClassSchema = z.enum(['advancement', 'monitor', 'blocker']);
export type GoalVerifierTaskClass = z.infer<typeof GoalVerifierTaskClassSchema>;

export const GoalVerifierDescriptorStatusSchema = z.enum(['ready', 'degraded', 'disabled']);
export type GoalVerifierDescriptorStatus = z.infer<typeof GoalVerifierDescriptorStatusSchema>;

/** Verifier implementation metadata is never public-safe by default. */
export const GoalVerifierPrivacySchema = z.enum(['local_private', 'private_pointer']);
export type GoalVerifierPrivacy = z.infer<typeof GoalVerifierPrivacySchema>;

/** Frozen objective context derived from the authoritative Goal projection. */
export const GoalObjectiveSnapshotV1Schema = z.object({
  schemaVersion: z.literal(GOAL_OBJECTIVE_SNAPSHOT_SCHEMA_VERSION),
  goalId: GoalIdSchema,
  todoId: TodoIdSchema,
  objective: z.string().min(4).max(4_000).regex(CONTROL_TEXT),
  todoTitle: z.string().min(1).max(400).regex(CONTROL_TEXT),
  objectiveDigest: ObjectiveDigestSchema,
  verificationPlan: GoalVerificationPlanSchema.optional(),
}).strict();
export type GoalObjectiveSnapshotV1 = z.infer<typeof GoalObjectiveSnapshotV1Schema>;

/** Safe, server-derived facts used by structured semantic verifiers. */
export const GoalVerifierObservationV1Schema = z.object({
  schemaVersion: z.literal(GOAL_VERIFIER_OBSERVATION_SCHEMA_VERSION),
  eventId: EventIdSchema,
  fact: GoalVerificationFactSchema,
  value: ObservationValueSchema,
  selector: ObservationSelectorSchema.optional(),
}).strict().superRefine((value, context) => {
  for (const violation of findGoalVerifierPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
});
export type GoalVerifierObservationV1 = z.infer<typeof GoalVerifierObservationV1Schema>;

const GoalVerifierDescriptorObjectSchema = z.object({
  schemaVersion: z.literal(GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION),
  verifierId: VerifierIdSchema,
  taskClass: GoalVerifierTaskClassSchema,
  verifierRevision: RevisionSchema,
  status: GoalVerifierDescriptorStatusSchema,
  privacy: GoalVerifierPrivacySchema,
  updatedAt: TimestampSchema,
}).strict();

/**
 * Versioned, metadata-only descriptor. It deliberately has no executable
 * path, endpoint, credential, prompt or arbitrary configuration field.
 */
export const GoalVerifierDescriptorV1Schema = GoalVerifierDescriptorObjectSchema.superRefine((value, context) => {
  for (const violation of findGoalVerifierPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
  if (value.status === 'ready' && value.privacy !== 'local_private') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['privacy'], message: 'ready verifier descriptors must be local_private' });
  }
});
export type GoalVerifierDescriptorV1 = z.infer<typeof GoalVerifierDescriptorV1Schema>;

export const GoalVerifierEventDigestV1Schema = z.object({
  schemaVersion: z.literal(GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION),
  id: EventIdSchema,
  seq: z.number().int().positive().max(GOAL_VERIFIER_MAX_EVENT_SEQ),
  type: EventTypeSchema,
  at: TimestampSchema,
}).strict().superRefine((value, context) => {
  for (const violation of findGoalVerifierPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
});
export type GoalVerifierEventDigestV1 = z.infer<typeof GoalVerifierEventDigestV1Schema>;

const GoalVerifierRunMetadataV1Schema = z.object({
  runId: RunIdSchema,
  status: VerifierRunStatusSchema,
  lastEventSeq: z.number().int().nonnegative().max(GOAL_VERIFIER_MAX_EVENT_SEQ),
  outputBytes: z.number().int().nonnegative().max(GOAL_VERIFIER_MAX_OUTPUT_BYTES),
}).strict();

export const GoalVerifierInputV1Schema = z.object({
  schemaVersion: z.literal(GOAL_VERIFIER_INPUT_SCHEMA_VERSION),
  binding: GoalRunBindingV1Schema,
  taskClass: TodoTaskClassSchema.nullable(),
  run: GoalVerifierRunMetadataV1Schema,
  terminal: GoalVerifierEventDigestV1Schema,
  events: z.array(GoalVerifierEventDigestV1Schema).max(GOAL_VERIFIER_MAX_EVENT_DIGESTS),
  observations: z.array(GoalVerifierObservationV1Schema).max(GOAL_VERIFIER_MAX_EVENT_DIGESTS).optional(),
  objective: GoalObjectiveSnapshotV1Schema.optional(),
}).strict().superRefine((value, context) => {
  if (value.binding.runId !== value.run.runId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['run', 'runId'], message: 'verifier run id must match its binding' });
  }
  for (const violation of findGoalVerifierPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
});
export type GoalVerifierInputV1 = z.infer<typeof GoalVerifierInputV1Schema>;

export const GoalVerifierResultV1Schema = z.object({
  schemaVersion: z.literal(GOAL_VERIFIER_RESULT_SCHEMA_VERSION),
  status: GoalValidationStatusV1Schema,
  verifierId: z.string().min(1).max(128).regex(SAFE_ID).regex(CONTROL_TEXT),
  verifierRevision: NonNegativeRevisionSchema,
  summary: BoundedSummarySchema,
  refs: GoalEvidenceRefsSchema,
}).strict().superRefine((value, context) => {
  for (const violation of findGoalVerifierPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
});
export type GoalVerifierResultV1 = z.infer<typeof GoalVerifierResultV1Schema>;

/** Stable resolution states used by the daemon registry. */
export const GoalVerifierResolutionStatusV1Schema = z.enum(['ready', 'missing', 'blocked', 'stale', 'conflict']);
export type GoalVerifierResolutionStatusV1 = z.infer<typeof GoalVerifierResolutionStatusV1Schema>;

export function findGoalVerifierPrivacyViolations(value: unknown, path: readonly string[] = [], allowedKeys = new Set<string>()): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (WINDOWS_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findGoalVerifierPrivacyViolations(entry, [...path, String(index)], allowedKeys)));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_KEY.test(key) && !allowedKeys.has(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findGoalVerifierPrivacyViolations(child, nextPath, allowedKeys));
  }
  return violations;
}

export function parseGoalVerifierDescriptorV1(input: unknown): GoalVerifierDescriptorV1 {
  return GoalVerifierDescriptorV1Schema.parse(input);
}

export function parseGoalVerifierInputV1(input: unknown): GoalVerifierInputV1 {
  return GoalVerifierInputV1Schema.parse(input);
}

export function parseGoalVerifierResultV1(input: unknown): GoalVerifierResultV1 {
  return GoalVerifierResultV1Schema.parse(input);
}
