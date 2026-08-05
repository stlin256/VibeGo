import { z } from 'zod';

const PROFILE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,63}$/u;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer|secret)/iu;

const ProfileIdSchema = z.string().min(1).max(64).regex(PROFILE_ID).regex(CONTROL_TEXT);
const ProviderIdSchema = z.string().min(1).max(128).regex(PROVIDER_ID).regex(CONTROL_TEXT);
const ModelNameSchema = z.string().min(1).max(256).regex(MODEL_NAME).regex(CONTROL_TEXT);
const RevisionSchema = z.string().min(1).max(128).regex(REVISION).regex(CONTROL_TEXT);
const TimestampSchema = z.string().datetime({ offset: true }).max(64);
const EndpointSchema = z.string().min(1).max(2_048).regex(CONTROL_TEXT).refine((value) => {
  if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.length > 0
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}, 'dedicated reviewer endpoint must be HTTPS without credentials, query, fragment or absolute path');

export const DEDICATED_REVIEWER_PROFILE_SCHEMA_VERSION = 'ready4vibe_dedicated_reviewer_profile_v1' as const;
export const DEDICATED_REVIEWER_PROFILES_STATUS_SCHEMA_VERSION = 'ready4vibe_dedicated_reviewer_profiles_status_v1' as const;

/** Durable metadata only. Runtime credentials intentionally have no field. */
const DedicatedReviewerProfileObjectSchema = z.object({
  schemaVersion: z.literal(DEDICATED_REVIEWER_PROFILE_SCHEMA_VERSION),
  profileId: ProfileIdSchema,
  providerId: ProviderIdSchema,
  endpoint: EndpointSchema,
  modelName: ModelNameSchema,
  profileRevision: RevisionSchema,
  updatedAt: TimestampSchema,
}).strict();
export const DedicatedReviewerProfileSchema = DedicatedReviewerProfileObjectSchema.superRefine((value, context) => addPrivacyIssues(value, context));
export type DedicatedReviewerProfile = z.infer<typeof DedicatedReviewerProfileSchema>;

export const DedicatedReviewerCredentialStateSchema = z.enum(['available', 'required']);
export type DedicatedReviewerCredentialState = z.infer<typeof DedicatedReviewerCredentialStateSchema>;

/** Runtime status projection; it is never written to durable settings. */
export const DedicatedReviewerProfileProjectionSchema = DedicatedReviewerProfileObjectSchema.extend({
  credentialState: DedicatedReviewerCredentialStateSchema,
}).strict().superRefine((value, context) => addPrivacyIssues(value, context, new Set(['credentialState'])));
export type DedicatedReviewerProfileProjection = z.infer<typeof DedicatedReviewerProfileProjectionSchema>;

export const DedicatedReviewerProfilesStatusSchema = z.object({
  schemaVersion: z.literal(DEDICATED_REVIEWER_PROFILES_STATUS_SCHEMA_VERSION),
  currentRevision: RevisionSchema,
  profiles: z.array(DedicatedReviewerProfileProjectionSchema).max(8),
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => addPrivacyIssues(value, context, new Set(['credentialState'])));
export type DedicatedReviewerProfilesStatus = z.infer<typeof DedicatedReviewerProfilesStatusSchema>;

export function findDedicatedReviewerProfilePrivacyViolations(value: unknown, path: readonly string[] = [], allowedKeys = new Set<string>()): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findDedicatedReviewerProfilePrivacyViolations(entry, [...path, String(index)], allowedKeys)));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_KEY.test(key) && !allowedKeys.has(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findDedicatedReviewerProfilePrivacyViolations(child, nextPath, allowedKeys));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx, allowedKeys = new Set<string>()): void {
  for (const violation of findDedicatedReviewerProfilePrivacyViolations(value, [], allowedKeys)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}
