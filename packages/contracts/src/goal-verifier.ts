import { z } from 'zod';

export const GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION = 'ready4vibe_goal_verifier_descriptor_v1' as const;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const VERIFIER_ID = /^verifier_[A-Za-z0-9_-]{1,120}$/u;
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const SECRET_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9]{12,})/iu;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer|secret)/iu;

const VerifierIdSchema = z.string().min(10).max(128).regex(VERIFIER_ID).regex(CONTROL_TEXT);
const RevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const TimestampSchema = z.string().datetime({ offset: true }).max(64);

/** Only these Todo classes can ever select an automatic verifier. */
export const GoalVerifierTaskClassSchema = z.enum(['advancement', 'monitor', 'blocker']);
export type GoalVerifierTaskClass = z.infer<typeof GoalVerifierTaskClassSchema>;

export const GoalVerifierDescriptorStatusSchema = z.enum(['ready', 'degraded', 'disabled']);
export type GoalVerifierDescriptorStatus = z.infer<typeof GoalVerifierDescriptorStatusSchema>;

/** Verifier implementation metadata is never public-safe by default. */
export const GoalVerifierPrivacySchema = z.enum(['local_private', 'private_pointer']);
export type GoalVerifierPrivacy = z.infer<typeof GoalVerifierPrivacySchema>;

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
