import { z } from 'zod';

export const PERMISSION_PROFILE_SCHEMA_VERSION = 'ready4vibe_permission_profile_v1' as const;
export const PERMISSION_PROFILE_RESOLUTION_SCHEMA_VERSION = 'ready4vibe_permission_profile_resolution_v1' as const;
export const PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION = 'ready4vibe_permission_profile_settings_v1' as const;
export const PERMISSION_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION = 'ready4vibe_permission_profile_settings_status_v1' as const;
export const PERMISSION_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION = 'ready4vibe_permission_profile_run_snapshot_v1' as const;
export const PERMISSION_SESSION_GRANT_SCHEMA_VERSION = 'ready4vibe_permission_session_grant_v1' as const;
export const PERMISSION_CONFIRMATION_SCHEMA_VERSION = 'ready4vibe_permission_confirmation_v1' as const;
export const PERMISSION_CONFIRMATION_REQUEST_SCHEMA_VERSION = 'ready4vibe_permission_confirmation_request_v1' as const;
export const PERMISSION_REVOKE_REQUEST_SCHEMA_VERSION = 'ready4vibe_permission_revoke_request_v1' as const;
export const PERMISSION_REVOKE_RESULT_SCHEMA_VERSION = 'ready4vibe_permission_revoke_result_v1' as const;
export const PERMISSION_STATUS_SCHEMA_VERSION = 'ready4vibe_permission_status_v1' as const;
export const PERMISSION_APPROVAL_KEY_SCHEMA_VERSION = 'ready4vibe_permission_approval_key_v1' as const;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/]|$))/u;
const SECRET_SHAPED_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|password|secret|credential|token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9]{12,})/iu;

const OpaqueIdSchema = z.string().min(1).max(128).regex(OPAQUE_ID).regex(CONTROL_TEXT)
  .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute paths are not allowed')
  .refine((value) => !SECRET_SHAPED_VALUE.test(value), 'secret-shaped values are not allowed');

const FingerprintSchema = z.string().min(1).max(256).regex(FINGERPRINT).regex(CONTROL_TEXT)
  .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute paths are not allowed')
  .refine((value) => !SECRET_SHAPED_VALUE.test(value), 'secret-shaped values are not allowed');

function boundedText(maximum: number): z.ZodType<string> {
  return z.string().min(1).max(maximum).regex(CONTROL_TEXT)
    .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute paths are not allowed')
    .refine((value) => !SECRET_SHAPED_VALUE.test(value), 'secret-shaped values are not allowed');
}

const TimestampSchema = z.string().datetime({ offset: true }).max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), 'timestamp must be an ISO timestamp');

const RevisionSchema = OpaqueIdSchema;

export const PermissionProfileIdSchema = z.enum(['workspace-coding', 'full-host', 'custom']);
export type PermissionProfileId = z.infer<typeof PermissionProfileIdSchema>;

export const PermissionFilesystemScopeSchema = z.enum(['workspace-only', 'host']);
export type PermissionFilesystemScope = z.infer<typeof PermissionFilesystemScopeSchema>;

export const PermissionProcessScopeSchema = z.enum(['none', 'external-sandbox', 'host']);
export type PermissionProcessScope = z.infer<typeof PermissionProcessScopeSchema>;

export const PermissionNetworkModeSchema = z.enum(['off', 'restricted', 'enabled']);
export type PermissionNetworkMode = z.infer<typeof PermissionNetworkModeSchema>;

export const PermissionMcpSkillModeSchema = z.enum(['off', 'configured']);
export type PermissionMcpSkillMode = z.infer<typeof PermissionMcpSkillModeSchema>;

export const ApprovalPostureSchema = z.enum(['bounded-auto', 'session-auto', 'explicit', 'none']);
export const PermissionApprovalPostureSchema = ApprovalPostureSchema;
export type ApprovalPosture = z.infer<typeof ApprovalPostureSchema>;

export const PermissionTaskTrustSchema = z.enum(['trusted-user', 'trusted-workspace', 'untrusted-content']);
export type PermissionTaskTrust = z.infer<typeof PermissionTaskTrustSchema>;

export const PermissionResolutionStatusSchema = z.enum(['ready', 'degraded', 'blocked']);
export type PermissionResolutionStatus = z.infer<typeof PermissionResolutionStatusSchema>;

export const PermissionReasonCodeSchema = z.enum([
  'PROFILE_READY',
  'PROFILE_NARROWED',
  'FULL_HOST_CONFIRMATION_REQUIRED',
  'UNTRUSTED_CONTENT',
  'POLICY_DENIED',
  'STALE_POLICY_REVISION',
  'STALE_PROFILE_REVISION',
  'WORKSPACE_REQUIRED',
  'WORKSPACE_UNAVAILABLE',
  'SANDBOX_REQUIRED',
  'SANDBOX_UNAVAILABLE',
  'CAPABILITY_UNAVAILABLE',
  'SESSION_GRANT_REQUIRED',
  'SESSION_GRANT_EXPIRED',
  'SESSION_GRANT_REVOKED',
  'SESSION_GRANT_EXHAUSTED',
  'TRANSPORT_UNAVAILABLE',
  'INVALID_REQUEST',
]);
export type PermissionReasonCode = z.infer<typeof PermissionReasonCodeSchema>;

/** Exact approval identity; it never carries raw arguments or commands. */
export const PermissionApprovalKeySchema = z.object({
  schemaVersion: z.literal(PERMISSION_APPROVAL_KEY_SCHEMA_VERSION),
  toolId: OpaqueIdSchema,
  toolVersion: OpaqueIdSchema,
  argumentFingerprint: FingerprintSchema,
  workspaceId: OpaqueIdSchema.optional(),
  permissionRevision: RevisionSchema,
  sandboxRevision: RevisionSchema.optional(),
  networkMode: PermissionNetworkModeSchema,
}).strict();
export type PermissionApprovalKey = z.infer<typeof PermissionApprovalKeySchema>;

/**
 * Secret-free requested permission intent. This is descriptive metadata only;
 * it does not grant a tool, shell, network or host capability.
 */
export const PermissionProfileSchema = z.object({
  schemaVersion: z.literal(PERMISSION_PROFILE_SCHEMA_VERSION),
  profileId: PermissionProfileIdSchema,
  filesystemScope: PermissionFilesystemScopeSchema,
  processScope: PermissionProcessScopeSchema,
  networkMode: PermissionNetworkModeSchema,
  mcpSkillMode: PermissionMcpSkillModeSchema,
  approvalPosture: ApprovalPostureSchema,
  taskTrust: PermissionTaskTrustSchema,
  workspaceId: OpaqueIdSchema.optional(),
  policyRevision: RevisionSchema,
  capabilityRevision: RevisionSchema.optional(),
  sandboxRevision: RevisionSchema.optional(),
  profileRevision: RevisionSchema,
  requiresConfirmation: z.boolean(),
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const hostCapable = value.filesystemScope === 'host' || value.processScope === 'host';
  if (value.processScope === 'external-sandbox' && !value.sandboxRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sandboxRevision'], message: 'external-sandbox requires a sandboxRevision' });
  }
  if (value.processScope === 'host' && value.filesystemScope !== 'host') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['filesystemScope'], message: 'host process scope requires host filesystem scope' });
  }
  if (value.profileId === 'workspace-coding' && hostCapable) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileId'], message: 'workspace-coding cannot request host capability' });
  }
  if (value.profileId === 'full-host' && !hostCapable) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['processScope'], message: 'full-host requires host capability' });
  }
  if (hostCapable && !value.requiresConfirmation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requiresConfirmation'], message: 'host capability requires explicit confirmation' });
  }
  if (hostCapable && value.taskTrust === 'untrusted-content') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['taskTrust'], message: 'untrusted content cannot request host capability' });
  }
  if (value.networkMode === 'enabled' && !value.requiresConfirmation) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requiresConfirmation'], message: 'enabled network requires explicit confirmation' });
  }
  if (value.approvalPosture === 'session-auto' && (!hostCapable || !value.requiresConfirmation || value.taskTrust === 'untrusted-content')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['approvalPosture'], message: 'session-auto requires confirmed trusted host scope' });
  }
});
export type PermissionProfile = z.infer<typeof PermissionProfileSchema>;
export type PermissionProfileIntent = PermissionProfile;

/** Effective permission projection after server policy narrows a request. */
export const PermissionProfileResolutionSchema = z.object({
  schemaVersion: z.literal(PERMISSION_PROFILE_RESOLUTION_SCHEMA_VERSION),
  status: PermissionResolutionStatusSchema,
  reasonCode: PermissionReasonCodeSchema,
  requestedProfile: PermissionProfileSchema,
  effectiveProfile: PermissionProfileSchema.nullable(),
  policyRevision: RevisionSchema,
  capabilityRevision: RevisionSchema.optional(),
  evaluatedAt: TimestampSchema,
  nextStep: boundedText(256),
}).strict().superRefine((value, context) => {
  if (value.status === 'blocked' && value.effectiveProfile !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'blocked resolution cannot contain an effective profile' });
  }
  if (value.status !== 'blocked' && value.effectiveProfile === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'ready or degraded resolution requires an effective profile' });
  }
  if (value.requestedProfile.policyRevision !== value.policyRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policyRevision'], message: 'policyRevision must match requestedProfile.policyRevision' });
  }
  if (value.effectiveProfile && value.effectiveProfile.policyRevision !== value.policyRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile', 'policyRevision'], message: 'effective policy revision must match resolution policy revision' });
  }
  if (value.capabilityRevision && value.effectiveProfile?.capabilityRevision && value.effectiveProfile.capabilityRevision !== value.capabilityRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilityRevision'], message: 'capability revision must match effective profile' });
  }
});
export type PermissionProfileResolution = z.infer<typeof PermissionProfileResolutionSchema>;

export const PermissionProfileSettingsSchema = z.object({
  schemaVersion: z.literal(PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION),
  profile: PermissionProfileSchema,
  currentRevision: RevisionSchema,
  previousRevision: RevisionSchema.nullable(),
  updatedAt: TimestampSchema,
}).strict();
export type PermissionProfileSettings = z.infer<typeof PermissionProfileSettingsSchema>;

export const PermissionProfileSettingsPatchSchema = z.object({
  profile: PermissionProfileSchema,
  expectedRevision: RevisionSchema.optional(),
}).strict();
export type PermissionProfileSettingsPatch = z.infer<typeof PermissionProfileSettingsPatchSchema>;

export const PermissionProfileSettingsStatusSchema = z.object({
  schemaVersion: z.literal(PERMISSION_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION),
  settings: PermissionProfileSettingsSchema,
  resolution: PermissionProfileResolutionSchema,
  currentRevision: RevisionSchema,
  previousRevision: RevisionSchema.nullable(),
}).strict();
export type PermissionProfileSettingsStatus = z.infer<typeof PermissionProfileSettingsStatusSchema>;

/** Bounded scope captured by a grant; no raw command or argument is allowed. */
export const PermissionGrantScopeSchema = z.object({
  kind: z.enum(['run', 'session']),
  profileId: PermissionProfileIdSchema,
  filesystemScope: PermissionFilesystemScopeSchema,
  processScope: PermissionProcessScopeSchema,
  networkMode: PermissionNetworkModeSchema,
  mcpSkillMode: PermissionMcpSkillModeSchema,
  approvalPosture: ApprovalPostureSchema,
  taskTrust: PermissionTaskTrustSchema,
  workspaceId: OpaqueIdSchema.optional(),
  sandboxRevision: RevisionSchema.optional(),
  confirmationRef: OpaqueIdSchema.optional(),
  approvalKey: PermissionApprovalKeySchema.optional(),
  approvalKeyFingerprint: FingerprintSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.filesystemScope === 'workspace-only' && !value.workspaceId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaceId'], message: 'workspace grant requires a workspaceId' });
  }
  if (value.processScope === 'host' && value.filesystemScope !== 'host') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['filesystemScope'], message: 'host process grant requires host filesystem scope' });
  }
  if (value.processScope === 'external-sandbox' && !value.sandboxRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sandboxRevision'], message: 'external-sandbox grants require a sandboxRevision' });
  }
  if ((value.filesystemScope === 'host' || value.processScope === 'host') && !value.confirmationRef) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmationRef'], message: 'host grants require a confirmation reference' });
  }
  if ((value.filesystemScope === 'host' || value.processScope === 'host') && value.taskTrust === 'untrusted-content') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['taskTrust'], message: 'untrusted content cannot receive a host grant' });
  }
  if (value.approvalPosture === 'session-auto' && value.kind !== 'session') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: 'session-auto grants must be session scoped' });
  }
  if (value.approvalPosture === 'session-auto' && value.profileId === 'workspace-coding') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileId'], message: 'workspace-coding cannot use session-auto' });
  }
  // A session grant must carry the exact key it authorizes. A run snapshot
  // records only the bounded posture; the existing compiler still computes
  // and checks the per-call exact key when kind is `run`.
  if (value.approvalPosture === 'bounded-auto' && value.kind === 'session' && !value.approvalKey && !value.approvalKeyFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['approvalKey'], message: 'bounded-auto requires an exact approval key' });
  }
  if (value.approvalKey && value.approvalKeyFingerprint && value.approvalKey.argumentFingerprint !== value.approvalKeyFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['approvalKeyFingerprint'], message: 'approval key fingerprint mismatch' });
  }
});
export type PermissionGrantScope = z.infer<typeof PermissionGrantScopeSchema>;

/** Run-bound scope metadata. Unlike a session grant it does not itself grant
 * session-auto or bounded-auto; the existing compiler performs per-call
 * approval-key checks against this captured posture. */
export const PermissionRunScopeSchema = z.object({
  kind: z.literal('run'),
  profileId: PermissionProfileIdSchema,
  filesystemScope: PermissionFilesystemScopeSchema,
  processScope: PermissionProcessScopeSchema,
  networkMode: PermissionNetworkModeSchema,
  mcpSkillMode: PermissionMcpSkillModeSchema,
  approvalPosture: ApprovalPostureSchema,
  taskTrust: PermissionTaskTrustSchema,
  workspaceId: OpaqueIdSchema.optional(),
  sandboxRevision: RevisionSchema.optional(),
  confirmationRef: OpaqueIdSchema.optional(),
  approvalKey: PermissionApprovalKeySchema.optional(),
  approvalKeyFingerprint: FingerprintSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.filesystemScope === 'workspace-only' && !value.workspaceId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['workspaceId'], message: 'workspace run scope requires a workspaceId' });
  }
  if (value.processScope === 'host' && value.filesystemScope !== 'host') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['filesystemScope'], message: 'host process scope requires host filesystem scope' });
  }
  if (value.processScope === 'external-sandbox' && !value.sandboxRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sandboxRevision'], message: 'external-sandbox run scopes require a sandboxRevision' });
  }
  if ((value.filesystemScope === 'host' || value.processScope === 'host') && !value.confirmationRef) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmationRef'], message: 'host run scopes require a confirmation reference' });
  }
  if ((value.filesystemScope === 'host' || value.processScope === 'host') && value.taskTrust === 'untrusted-content') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['taskTrust'], message: 'untrusted content cannot receive a host run scope' });
  }
  if (value.approvalKey && value.approvalKeyFingerprint && value.approvalKey.argumentFingerprint !== value.approvalKeyFingerprint) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['approvalKeyFingerprint'], message: 'approval key fingerprint mismatch' });
  }
});
export type PermissionRunScope = z.infer<typeof PermissionRunScopeSchema>;

/**
 * Secret-free, immutable permission decision captured at the daemon run
 * boundary. It is metadata only; the existing runtime/approval/sandbox
 * authorities remain responsible for the actual call.
 */
export const PermissionProfileRunSnapshotSchema = z.object({
  schemaVersion: z.literal(PERMISSION_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION),
  status: PermissionResolutionStatusSchema,
  reasonCode: PermissionReasonCodeSchema,
  profileRevision: RevisionSchema,
  policyRevision: RevisionSchema,
  requestedProfile: PermissionProfileSchema,
  effectiveProfile: PermissionProfileSchema.nullable(),
  effectiveScope: PermissionRunScopeSchema.nullable(),
  grantId: OpaqueIdSchema.nullable(),
  grantExpiresAt: TimestampSchema.nullable(),
  capturedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const active = value.status === 'ready' || value.status === 'degraded';
  if (active && value.effectiveProfile === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'ready or degraded snapshots require an effective profile' });
  }
  if (!active && value.effectiveProfile !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'blocked snapshots cannot contain an effective profile' });
  }
  if (active && value.effectiveScope === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveScope'], message: 'ready or degraded snapshots require an effective scope' });
  }
  if (!active && value.effectiveScope !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveScope'], message: 'blocked snapshots cannot contain an effective scope' });
  }
  if (value.requestedProfile.profileRevision !== value.profileRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileRevision'], message: 'profileRevision must match requestedProfile' });
  }
  if (value.requestedProfile.policyRevision !== value.policyRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policyRevision'], message: 'policyRevision must match requestedProfile' });
  }
  if (value.effectiveProfile && value.effectiveProfile.profileRevision !== value.profileRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile', 'profileRevision'], message: 'effective profile revision must match snapshot' });
  }
  if (value.effectiveProfile && value.effectiveProfile.policyRevision !== value.policyRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile', 'policyRevision'], message: 'effective profile policy revision must match snapshot' });
  }
  if (value.effectiveScope && value.effectiveScope.kind !== 'run') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveScope', 'kind'], message: 'run snapshots require a run-scoped effective scope' });
  }
  if ((value.grantId === null) !== (value.grantExpiresAt === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['grantExpiresAt'], message: 'grant expiry must be paired with grantId' });
  }
});
export type PermissionProfileRunSnapshot = z.infer<typeof PermissionProfileRunSnapshotSchema>;

export const PermissionGrantStatusSchema = z.enum(['active', 'expired', 'revoked', 'exhausted']);
export type PermissionGrantStatus = z.infer<typeof PermissionGrantStatusSchema>;

export const PermissionSessionGrantSchema = z.object({
  schemaVersion: z.literal(PERMISSION_SESSION_GRANT_SCHEMA_VERSION),
  grantId: OpaqueIdSchema,
  sessionId: OpaqueIdSchema,
  userId: OpaqueIdSchema,
  scope: PermissionGrantScopeSchema,
  policyRevision: RevisionSchema,
  profileRevision: RevisionSchema,
  capabilityRevision: RevisionSchema.optional(),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  maxUses: z.number().int().positive().max(10_000),
  usedUses: z.number().int().nonnegative().max(10_000),
  status: PermissionGrantStatusSchema,
  revokedAt: TimestampSchema.nullable(),
  auditRef: OpaqueIdSchema,
}).strict().superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expiresAt must be after issuedAt' });
  }
  if (value.usedUses > value.maxUses) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['usedUses'], message: 'usedUses cannot exceed maxUses' });
  }
  if (value.status === 'active' && value.revokedAt !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['revokedAt'], message: 'active grants cannot be revoked' });
  }
  if (value.status === 'revoked' && value.revokedAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['revokedAt'], message: 'revoked grants require revokedAt' });
  }
  if (value.status === 'exhausted' && value.usedUses !== value.maxUses) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['usedUses'], message: 'exhausted grants must use their full allowance' });
  }
  if (value.scope.approvalPosture === 'session-auto' && value.scope.kind !== 'session') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['scope', 'kind'], message: 'session-auto requires a session grant' });
  }
});
export type PermissionSessionGrant = z.infer<typeof PermissionSessionGrantSchema>;

export const PermissionConfirmationSchema = z.object({
  schemaVersion: z.literal(PERMISSION_CONFIRMATION_SCHEMA_VERSION),
  confirmationId: OpaqueIdSchema,
  requestId: OpaqueIdSchema,
  sessionId: OpaqueIdSchema,
  userId: OpaqueIdSchema,
  profileId: PermissionProfileIdSchema,
  profileRevision: RevisionSchema,
  policyRevision: RevisionSchema,
  scopeFingerprint: FingerprintSchema,
  acknowledged: z.literal(true),
  confirmedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  auditRef: OpaqueIdSchema,
}).strict().superRefine((value, context) => {
  if (value.profileId === 'workspace-coding') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['profileId'], message: 'workspace-coding does not require full-host confirmation' });
  }
  if (Date.parse(value.expiresAt) <= Date.parse(value.confirmedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'expiresAt must be after confirmedAt' });
  }
});
export type PermissionConfirmation = z.infer<typeof PermissionConfirmationSchema>;

export const PermissionConfirmationRequestSchema = z.object({
  schemaVersion: z.literal(PERMISSION_CONFIRMATION_REQUEST_SCHEMA_VERSION),
  requestId: OpaqueIdSchema,
  sessionId: OpaqueIdSchema,
  userId: OpaqueIdSchema,
  requestedProfile: PermissionProfileSchema,
  expectedProfileRevision: RevisionSchema,
  acknowledged: z.literal(true),
  requestedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  const hostCapable = value.requestedProfile.filesystemScope === 'host' || value.requestedProfile.processScope === 'host';
  if (!hostCapable) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedProfile'], message: 'confirmation is only valid for host-capable profiles' });
  }
  if (value.requestedProfile.profileRevision !== value.expectedProfileRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedProfileRevision'], message: 'expected revision must match requested profile' });
  }
});
export type PermissionConfirmationRequest = z.infer<typeof PermissionConfirmationRequestSchema>;

export const PermissionRevokeReasonSchema = z.enum(['user-requested', 'session-ended', 'policy-change', 'security-event', 'daemon-restart']);
export type PermissionRevokeReason = z.infer<typeof PermissionRevokeReasonSchema>;

export const PermissionRevokeRequestSchema = z.object({
  schemaVersion: z.literal(PERMISSION_REVOKE_REQUEST_SCHEMA_VERSION),
  requestId: OpaqueIdSchema,
  sessionId: OpaqueIdSchema,
  userId: OpaqueIdSchema,
  grantId: OpaqueIdSchema.optional(),
  expectedRevision: RevisionSchema.optional(),
  reason: PermissionRevokeReasonSchema,
  requestedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (!value.grantId && !value.expectedRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['grantId'], message: 'revoke must target a grant or current revision' });
  }
});
export type PermissionRevokeRequest = z.infer<typeof PermissionRevokeRequestSchema>;

export const PermissionRevokeResultSchema = z.object({
  schemaVersion: z.literal(PERMISSION_REVOKE_RESULT_SCHEMA_VERSION),
  requestId: OpaqueIdSchema,
  grantId: OpaqueIdSchema,
  status: z.enum(['revoked', 'already-revoked', 'not-found']),
  currentRevision: RevisionSchema,
  revokedAt: TimestampSchema.nullable(),
  auditRef: OpaqueIdSchema,
}).strict().superRefine((value, context) => {
  if (value.status === 'revoked' && value.revokedAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['revokedAt'], message: 'revoked result requires revokedAt' });
  }
});
export type PermissionRevokeResult = z.infer<typeof PermissionRevokeResultSchema>;

export const PermissionStatusSchema = z.object({
  schemaVersion: z.literal(PERMISSION_STATUS_SCHEMA_VERSION),
  status: z.enum(['ready', 'degraded', 'blocked', 'revoked', 'expired']),
  reasonCode: PermissionReasonCodeSchema,
  currentRevision: RevisionSchema,
  requestedProfile: PermissionProfileSchema,
  effectiveProfile: PermissionProfileSchema.nullable(),
  effectiveScope: PermissionRunScopeSchema.nullable(),
  grant: PermissionSessionGrantSchema.nullable(),
  grantExpiresAt: TimestampSchema.nullable(),
  evaluatedAt: TimestampSchema,
  nextStep: boundedText(256),
}).strict().superRefine((value, context) => {
  const active = value.status === 'ready' || value.status === 'degraded';
  if (!active && value.effectiveProfile !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'blocked, revoked or expired status cannot expose effective profile' });
  }
  if (active && value.effectiveProfile === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'ready or degraded status requires effective profile' });
  }
  if (value.grant && value.grantExpiresAt !== value.grant.expiresAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['grantExpiresAt'], message: 'grantExpiresAt must match grant' });
  }
  if (!value.grant && value.grantExpiresAt !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['grantExpiresAt'], message: 'grantExpiresAt requires a grant' });
  }
});
export type PermissionStatus = z.infer<typeof PermissionStatusSchema>;
export type PermissionStatusResponse = PermissionStatus;

export function parsePermissionProfile(value: unknown): PermissionProfile {
  return PermissionProfileSchema.parse(value);
}

export function parsePermissionApprovalKey(value: unknown): PermissionApprovalKey {
  return PermissionApprovalKeySchema.parse(value);
}

export function parsePermissionProfileResolution(value: unknown): PermissionProfileResolution {
  return PermissionProfileResolutionSchema.parse(value);
}

export function parsePermissionProfileSettings(value: unknown): PermissionProfileSettings {
  return PermissionProfileSettingsSchema.parse(value);
}

export function parsePermissionProfileSettingsPatch(value: unknown): PermissionProfileSettingsPatch {
  return PermissionProfileSettingsPatchSchema.parse(value);
}

export function parsePermissionProfileSettingsStatus(value: unknown): PermissionProfileSettingsStatus {
  return PermissionProfileSettingsStatusSchema.parse(value);
}

export function parsePermissionProfileRunSnapshot(value: unknown): PermissionProfileRunSnapshot {
  return PermissionProfileRunSnapshotSchema.parse(value);
}

export function parsePermissionSessionGrant(value: unknown): PermissionSessionGrant {
  return PermissionSessionGrantSchema.parse(value);
}

export function parsePermissionConfirmation(value: unknown): PermissionConfirmation {
  return PermissionConfirmationSchema.parse(value);
}

export function parsePermissionConfirmationRequest(value: unknown): PermissionConfirmationRequest {
  return PermissionConfirmationRequestSchema.parse(value);
}

export function parsePermissionRevokeRequest(value: unknown): PermissionRevokeRequest {
  return PermissionRevokeRequestSchema.parse(value);
}

export function parsePermissionRevokeResult(value: unknown): PermissionRevokeResult {
  return PermissionRevokeResultSchema.parse(value);
}

export function parsePermissionStatus(value: unknown): PermissionStatus {
  return PermissionStatusSchema.parse(value);
}

export interface SafeDefaultPermissionProfileInput {
  profileRevision: string;
  policyRevision: string;
  updatedAt: string;
  workspaceId?: string;
  capabilityRevision?: string;
}

/**
 * Safe migration target for absent or legacy permission settings. The factory
 * intentionally has no host process, network, MCP/Skill or confirmation grant.
 */
export function createSafeDefaultPermissionProfile(input: SafeDefaultPermissionProfileInput): PermissionProfile {
  return PermissionProfileSchema.parse({
    schemaVersion: PERMISSION_PROFILE_SCHEMA_VERSION,
    profileId: 'workspace-coding',
    filesystemScope: 'workspace-only',
    processScope: 'none',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalPosture: 'bounded-auto',
    taskTrust: 'untrusted-content',
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    policyRevision: input.policyRevision,
    ...(input.capabilityRevision === undefined ? {} : { capabilityRevision: input.capabilityRevision }),
    profileRevision: input.profileRevision,
    requiresConfirmation: false,
    updatedAt: input.updatedAt,
  });
}

export const safeDefaultPermissionProfile = createSafeDefaultPermissionProfile;
