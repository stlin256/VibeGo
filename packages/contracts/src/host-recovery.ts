import { z } from 'zod';

export const BACKUP_MANIFEST_SCHEMA_VERSION = 'ready4vibe_backup_manifest_v1' as const;
export const RESTORE_PLAN_SCHEMA_VERSION = 'ready4vibe_restore_plan_v1' as const;
export const RESTORE_APPLY_CONFIRMATION_SCHEMA_VERSION = 'ready4vibe_restore_apply_confirmation_v1' as const;
export const RESTORE_RESULT_SCHEMA_VERSION = 'ready4vibe_restore_result_v1' as const;
export const RECOVERY_STATUS_SCHEMA_VERSION = 'ready4vibe_recovery_status_v1' as const;
export const DIAGNOSTIC_BUNDLE_SCHEMA_VERSION = 'ready4vibe_diagnostic_bundle_v1' as const;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const BACKUP_ID = /^backup_[A-Za-z0-9_-]{8,128}$/u;
const RESTORE_PLAN_ID = /^restore_[A-Za-z0-9_-]{8,128}$/u;
const RESTORE_CONFIRMATION_ID = /^confirm_[A-Za-z0-9_-]{8,128}$/u;
const DIAGNOSTIC_ID = /^diag_[A-Za-z0-9_-]{8,128}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REASON_CODE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token|environment|env)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const SAFE_POLICY_KEYS = new Set(['includesCredentials', 'includesWorkspaceFiles', 'includesRawEnvironment', 'importCredentials', 'importWorkspaceFiles']);

const boundedText = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT, 'text contains control characters');
const safeToken = z.string().min(1).max(128).regex(SAFE_TOKEN, 'value is not a bounded token');
const revision = safeToken.nullable();
const semver = z.string().min(5).max(64).regex(SEMVER, 'version must be bounded semver');
const timestamp = z.string().datetime({ offset: true }).max(64);
const digest = z.string().regex(DIGEST, 'digest must be a lowercase SHA-256 reference');
const reasonCode = z.string().regex(REASON_CODE, 'reasonCode is not bounded');

const BACKUP_DATA_CLASSES = [
  'sqlite-database',
  'daemon-settings',
  'profile-settings',
  'workspace-registry',
  'run-events',
  'goal-events',
  'usage-ledger',
  'audit-ledger',
] as const;

export const BackupDataClassSchema = z.enum(BACKUP_DATA_CLASSES);
export type BackupDataClass = z.infer<typeof BackupDataClassSchema>;

const BackupEntrySchema = z.object({
  dataClass: BackupDataClassSchema,
  logicalId: safeToken.nullable(),
  digest,
  sizeBytes: z.number().int().nonnegative().max(5_000_000_000),
  recordCount: z.number().int().nonnegative().max(100_000_000).nullable(),
}).strict().superRefine(addPrivacyIssues);
export type BackupEntry = z.infer<typeof BackupEntrySchema>;

export const BackupManifestSchema = z.object({
  schemaVersion: z.literal(BACKUP_MANIFEST_SCHEMA_VERSION),
  backupId: z.string().regex(BACKUP_ID, 'backupId is not bounded'),
  productVersion: semver,
  hostRevision: safeToken,
  databaseSchemaVersion: z.number().int().nonnegative().max(1_000_000),
  createdAt: timestamp,
  entries: z.array(BackupEntrySchema).min(1).max(32),
  encryption: z.enum(['none', 'envelope-v1']),
  includesCredentials: z.literal(false),
  includesWorkspaceFiles: z.literal(false),
  includesRawEnvironment: z.literal(false),
}).strict().superRefine((value, context) => {
  const dataClasses = value.entries.map((entry) => entry.dataClass);
  if (new Set(dataClasses).size !== dataClasses.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries'], message: 'dataClass entries must be unique' });
  }
  addPrivacyIssues(value, context);
});
export type BackupManifest = z.infer<typeof BackupManifestSchema>;

export const RestoreCompatibilitySchema = z.enum(['compatible', 'requires-migration', 'blocked']);
export type RestoreCompatibility = z.infer<typeof RestoreCompatibilitySchema>;

const WorkspaceBindingSchema = z.object({
  sourceWorkspaceId: z.string().regex(WORKSPACE_ID),
  targetWorkspaceId: z.string().regex(WORKSPACE_ID).nullable(),
  status: z.enum(['mapped', 'requires-selection', 'excluded']),
}).strict().superRefine(addPrivacyIssues);
export type WorkspaceBinding = z.infer<typeof WorkspaceBindingSchema>;

export const RestorePlanSchema = z.object({
  schemaVersion: z.literal(RESTORE_PLAN_SCHEMA_VERSION),
  planId: z.string().regex(RESTORE_PLAN_ID, 'planId is not bounded'),
  sourceBackupId: z.string().regex(BACKUP_ID, 'sourceBackupId is not bounded'),
  sourceProductVersion: semver,
  targetProductVersion: semver,
  sourceDatabaseSchemaVersion: z.number().int().nonnegative().max(1_000_000),
  targetDatabaseSchemaVersion: z.number().int().nonnegative().max(1_000_000),
  compatibility: RestoreCompatibilitySchema,
  confirmationRequired: z.literal(true),
  preserveCurrent: z.literal(true),
  importCredentials: z.literal(false),
  importWorkspaceFiles: z.literal(false),
  workspaceBindings: z.array(WorkspaceBindingSchema).max(128),
  excludedDataClasses: z.array(BackupDataClassSchema).max(BACKUP_DATA_CLASSES.length),
  warnings: z.array(boundedText(512)).max(16),
  createdAt: timestamp,
}).strict().superRefine((value, context) => {
  const sourceIds = value.workspaceBindings.map((binding) => binding.sourceWorkspaceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaceBindings'], message: 'sourceWorkspaceId values must be unique' });
  }
  const excluded = value.excludedDataClasses;
  if (new Set(excluded).size !== excluded.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['excludedDataClasses'], message: 'excludedDataClasses must be unique' });
  }
  if (value.compatibility === 'blocked' && value.warnings.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['warnings'], message: 'blocked restore requires a bounded warning' });
  }
  addPrivacyIssues(value, context);
});
export type RestorePlan = z.infer<typeof RestorePlanSchema>;

export const RestoreApplyConfirmationSchema = z.object({
  schemaVersion: z.literal(RESTORE_APPLY_CONFIRMATION_SCHEMA_VERSION),
  confirmationId: z.string().regex(RESTORE_CONFIRMATION_ID, 'confirmationId is not bounded'),
  planId: z.string().regex(RESTORE_PLAN_ID, 'planId is not bounded'),
  approved: z.literal(true),
  confirmedAt: timestamp,
}).strict().superRefine((value, context) => {
  addPrivacyIssues(value, context);
});
export type RestoreApplyConfirmation = z.infer<typeof RestoreApplyConfirmationSchema>;

export const RestoreResultStatusSchema = z.enum(['staged', 'applied', 'rejected', 'failed', 'manual-recovery-required']);
export type RestoreResultStatus = z.infer<typeof RestoreResultStatusSchema>;

export const RestoreResultSchema = z.object({
  schemaVersion: z.literal(RESTORE_RESULT_SCHEMA_VERSION),
  planId: z.string().regex(RESTORE_PLAN_ID, 'planId is not bounded'),
  status: RestoreResultStatusSchema,
  completedAt: timestamp.nullable(),
  previousRevision: revision,
  restoredEntryCount: z.number().int().nonnegative().max(32),
  diagnosticId: z.string().regex(DIAGNOSTIC_ID, 'diagnosticId is not bounded').nullable(),
  reasonCode: reasonCode.nullable(),
}).strict().superRefine((value, context) => {
  const failure = value.status === 'rejected' || value.status === 'failed' || value.status === 'manual-recovery-required';
  if (failure && !value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'failure result requires reasonCode' });
  if (!failure && value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'reasonCode is only allowed for failure results' });
  if (value.status === 'applied' && (!value.completedAt || !value.previousRevision)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['previousRevision'], message: 'applied restore must retain previousRevision and completedAt' });
  }
  if (value.status === 'staged' && value.restoredEntryCount !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['restoredEntryCount'], message: 'staged restore cannot report applied entries' });
  }
  addPrivacyIssues(value, context);
});
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

export const RecoveryStateSchema = z.enum([
  'healthy',
  'needs-recovery',
  'rollback-available',
  'migration-blocked',
  'database-corrupt',
  'certificate-invalid',
  'optional-degraded',
  'manual-recovery-required',
]);
export type RecoveryState = z.infer<typeof RecoveryStateSchema>;

export const RecoveryOperationSchema = z.enum([
  'health',
  'settings',
  'backup',
  'restore',
  'diagnostic',
  'read-only-events',
  'interactive-run',
]);
export type RecoveryOperation = z.infer<typeof RecoveryOperationSchema>;

const SAFE_MODE_OPERATIONS: readonly RecoveryOperation[] = ['health', 'settings', 'backup', 'restore', 'diagnostic', 'read-only-events'];

export const RecoveryStatusSchema = z.object({
  schemaVersion: z.literal(RECOVERY_STATUS_SCHEMA_VERSION),
  state: RecoveryStateSchema,
  safeMode: z.boolean(),
  currentRevision: revision,
  previousRevision: revision,
  reasonCode: reasonCode.nullable(),
  allowedOperations: z.array(RecoveryOperationSchema).min(1).max(RecoveryOperationSchema.options.length),
  diagnosticId: z.string().regex(DIAGNOSTIC_ID, 'diagnosticId is not bounded').nullable(),
  updatedAt: timestamp,
}).strict().superRefine((value, context) => {
  const failure = value.state !== 'healthy' && value.state !== 'optional-degraded';
  if (failure && !value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'recovery failure requires reasonCode' });
  if (value.state === 'healthy' && value.safeMode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['safeMode'], message: 'healthy recovery status cannot be safe mode' });
  if ((value.state === 'database-corrupt' || value.state === 'migration-blocked' || value.state === 'manual-recovery-required') && !value.safeMode) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['safeMode'], message: 'critical recovery state requires safe mode' });
  }
  if (value.state === 'rollback-available' && !value.previousRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['previousRevision'], message: 'rollback-available requires previousRevision' });
  }
  if (new Set(value.allowedOperations).size !== value.allowedOperations.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowedOperations'], message: 'allowedOperations must be unique' });
  }
  if (value.safeMode && value.allowedOperations.some((operation) => !SAFE_MODE_OPERATIONS.includes(operation))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowedOperations'], message: 'safe mode operation is not allowed' });
  }
  addPrivacyIssues(value, context);
});
export type RecoveryStatus = z.infer<typeof RecoveryStatusSchema>;

export const DiagnosticSectionSchema = z.enum([
  'runtime-health',
  'database-integrity',
  'host-update-state',
  'recovery-state',
  'settings-metadata',
  'event-summary',
]);
export type DiagnosticSection = z.infer<typeof DiagnosticSectionSchema>;

export const DiagnosticBundleDescriptorSchema = z.object({
  schemaVersion: z.literal(DIAGNOSTIC_BUNDLE_SCHEMA_VERSION),
  diagnosticId: z.string().regex(DIAGNOSTIC_ID, 'diagnosticId is not bounded'),
  createdAt: timestamp,
  expiresAt: timestamp.nullable(),
  status: z.enum(['ready', 'expired', 'failed']),
  sections: z.array(DiagnosticSectionSchema).min(1).max(DiagnosticSectionSchema.options.length),
  sizeBytes: z.number().int().nonnegative().max(100_000_000),
  digest,
  redacted: z.literal(true),
  retention: z.enum(['session', 'until-expiry', 'user-deleted']),
  reasonCode: reasonCode.nullable(),
}).strict().superRefine((value, context) => {
  if (new Set(value.sections).size !== value.sections.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sections'], message: 'sections must be unique' });
  }
  if (value.status === 'failed' && !value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'failed diagnostic requires reasonCode' });
  if (value.status !== 'failed' && value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'reasonCode is only allowed for failed diagnostic' });
  if (value.status === 'expired' && !value.expiresAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expired diagnostic requires expiresAt' });
  addPrivacyIssues(value, context);
});
export type DiagnosticBundleDescriptor = z.infer<typeof DiagnosticBundleDescriptorSchema>;

export function findHostRecoveryPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) {
      violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    }
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...findHostRecoveryPrivacyViolations(item, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_KEY.test(key) && !SAFE_POLICY_KEYS.has(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findHostRecoveryPrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findHostRecoveryPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

export function parseBackupManifest(input: unknown): BackupManifest {
  return BackupManifestSchema.parse(input);
}

export function parseRestorePlan(input: unknown): RestorePlan {
  return RestorePlanSchema.parse(input);
}

export function parseRestoreApplyConfirmation(input: unknown): RestoreApplyConfirmation {
  return RestoreApplyConfirmationSchema.parse(input);
}

export function parseRestoreResult(input: unknown): RestoreResult {
  return RestoreResultSchema.parse(input);
}

export function parseRecoveryStatus(input: unknown): RecoveryStatus {
  return RecoveryStatusSchema.parse(input);
}

export function parseDiagnosticBundleDescriptor(input: unknown): DiagnosticBundleDescriptor {
  return DiagnosticBundleDescriptorSchema.parse(input);
}
