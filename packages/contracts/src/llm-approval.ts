import { z } from 'zod';

/** Versioned contracts for the advisory LLM approval reviewer boundary. */
export const LLM_APPROVAL_SCHEMA_VERSION = 'llm-approval/v1' as const;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const APPROVAL_KEY = /^approval\.v1\.[a-f0-9]{64}$/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer|secret|header|command|prompt|transcript|raw|absolute[_-]?path|file[_-]?path)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;

const IdSchema = z.string().min(1).max(128).regex(SAFE_ID).regex(CONTROL_TEXT);
const LabelSchema = z.string().min(1).max(256).regex(SAFE_LABEL).regex(CONTROL_TEXT);
const RevisionSchema = z.string().min(1).max(128).regex(SAFE_REVISION).regex(CONTROL_TEXT);
const TimestampSchema = z.string().datetime({ offset: true }).max(64);
const FingerprintSchema = z.string().regex(SHA256);
const ApprovalKeySchema = z.string().regex(APPROVAL_KEY);
const BoundedTextSchema = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT);

export const ApprovalReviewerSourceSchema = z.enum(['same-as-run', 'dedicated']);
export type ApprovalReviewerSource = z.infer<typeof ApprovalReviewerSourceSchema>;

export const ApprovalReviewPostureSchema = z.enum(['off', 'advisory-low-risk', 'bounded-auto-low-risk']);
export type ApprovalReviewPosture = z.infer<typeof ApprovalReviewPostureSchema>;

export const ApprovalReviewerStatusSchema = z.enum(['disabled', 'ready', 'degraded', 'blocked']);
export type ApprovalReviewerStatus = z.infer<typeof ApprovalReviewerStatusSchema>;

export const ApprovalReviewDecisionSchema = z.enum(['allow', 'ask-user', 'deny', 'unavailable']);
export type ApprovalReviewDecision = z.infer<typeof ApprovalReviewDecisionSchema>;

export const ApprovalReviewRiskSchema = z.enum(['read-only', 'workspace-write', 'shell', 'network', 'destructive', 'full-host', 'unknown']);
export type ApprovalReviewRisk = z.infer<typeof ApprovalReviewRiskSchema>;

export const ApprovalReviewOperationClassSchema = z.enum(['read', 'write', 'shell', 'network', 'destructive', 'privilege', 'unknown']);
export type ApprovalReviewOperationClass = z.infer<typeof ApprovalReviewOperationClassSchema>;

export const ApprovalReviewReasonCodeSchema = z.enum([
  'eligible',
  'reviewer-disabled',
  'ineligible-risk',
  'ineligible-trust',
  'ineligible-sandbox',
  'policy-denied',
  'policy-ask',
  'provider-unavailable',
  'dedicated-profile-missing',
  'timeout',
  'cancelled',
  'request-too-large',
  'response-too-large',
  'malformed-response',
  'schema-mismatch',
  'fingerprint-mismatch',
  'revision-stale',
  'budget-exhausted',
  'review-revoked',
  'invalid-request',
]);
export type ApprovalReviewReasonCode = z.infer<typeof ApprovalReviewReasonCodeSchema>;

export const ApprovalReviewLimitsSchema = z.object({
  maxLatencyMs: z.number().int().positive().max(120_000),
  maxRequestBytes: z.number().int().positive().max(256 * 1024),
  maxResponseBytes: z.number().int().positive().max(64 * 1024),
  cacheTtlMs: z.number().int().nonnegative().max(5 * 60 * 1_000),
}).strict();
export type ApprovalReviewLimits = z.infer<typeof ApprovalReviewLimitsSchema>;

const SnapshotIdentitySchema = z.object({
  providerId: IdSchema.nullable(),
  modelId: LabelSchema.nullable(),
  descriptorRevision: RevisionSchema.nullable(),
}).strict();

export const ApprovalReviewerSnapshotSchema = z.object({
  schemaVersion: z.literal(LLM_APPROVAL_SCHEMA_VERSION),
  reviewerSource: ApprovalReviewerSourceSchema,
  dedicatedProfileId: IdSchema.nullable(),
  providerId: SnapshotIdentitySchema.shape.providerId,
  modelId: SnapshotIdentitySchema.shape.modelId,
  descriptorRevision: SnapshotIdentitySchema.shape.descriptorRevision,
  policyRevision: RevisionSchema,
  reviewerRevision: RevisionSchema,
  posture: ApprovalReviewPostureSchema,
  limits: ApprovalReviewLimitsSchema,
  status: ApprovalReviewerStatusSchema,
  capturedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.reviewerSource === 'same-as-run' && value.dedicatedProfileId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dedicatedProfileId'], message: 'same-as-run snapshots cannot contain a dedicated profile' });
  }
  if (value.reviewerSource === 'dedicated' && value.dedicatedProfileId === null && value.status !== 'disabled') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dedicatedProfileId'], message: 'dedicated snapshots require a profile id unless disabled' });
  }
  if (value.status === 'disabled') {
    if (value.posture !== 'off') context.addIssue({ code: z.ZodIssueCode.custom, path: ['posture'], message: 'disabled snapshots must use the off posture' });
    if (value.providerId !== null || value.modelId !== null || value.descriptorRevision !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['providerId'], message: 'disabled snapshots cannot expose provider identity' });
    }
  } else if (value.posture === 'off') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['posture'], message: 'active snapshots require an enabled posture' });
  }
  addPrivacyIssues(value, context);
});
export type ApprovalReviewerSnapshot = z.infer<typeof ApprovalReviewerSnapshotSchema>;

export const ApprovalPermissionSummarySchema = z.object({
  profileId: IdSchema,
  profileRevision: RevisionSchema,
  status: z.enum(['ready', 'degraded', 'blocked', 'revoked', 'expired']),
  approvalPosture: z.enum(['bounded-auto', 'explicit', 'session-auto', 'none']),
  effectiveScope: z.enum(['run', 'session', 'none']),
}).strict();
export type ApprovalPermissionSummary = z.infer<typeof ApprovalPermissionSummarySchema>;

export const ApprovalSandboxSummarySchema = z.object({
  mode: z.enum(['read-only', 'workspace-write', 'external-sandbox', 'danger-full-access']),
  provider: z.enum(['docker', 'podman', 'vm']).nullable(),
  status: z.enum(['ready', 'degraded', 'blocked']),
  network: z.enum(['restricted', 'enabled']),
}).strict().superRefine((value, context) => {
  if (value.mode === 'external-sandbox' && value.provider === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'external sandbox summaries require a provider' });
  }
  if (value.mode !== 'external-sandbox' && value.provider !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['provider'], message: 'non-external sandbox summaries cannot contain a provider' });
  }
});
export type ApprovalSandboxSummary = z.infer<typeof ApprovalSandboxSummarySchema>;

export const ApprovalGoalSummarySchema = z.object({
  mode: z.enum(['interactive', 'governed']),
  gate: z.enum(['ready', 'blocked', 'unknown']),
  controlRevision: z.number().int().nonnegative().max(10_000_000).nullable(),
}).strict();
export type ApprovalGoalSummary = z.infer<typeof ApprovalGoalSummarySchema>;

export const ApprovalReviewToolDescriptorSchema = z.object({
  toolId: IdSchema,
  toolVersion: RevisionSchema,
  operationClass: ApprovalReviewOperationClassSchema,
  risk: ApprovalReviewRiskSchema,
  summary: BoundedTextSchema(512),
  argumentFingerprint: FingerprintSchema,
  argumentLabels: z.array(LabelSchema).max(16),
}).strict();
export type ApprovalReviewToolDescriptor = z.infer<typeof ApprovalReviewToolDescriptorSchema>;

export const ApprovalReviewRequestSchema = z.object({
  schemaVersion: z.literal(LLM_APPROVAL_SCHEMA_VERSION),
  reviewId: IdSchema,
  runId: IdSchema,
  turnId: IdSchema,
  correlationId: IdSchema,
  approvalKey: ApprovalKeySchema,
  approvalKeyFingerprint: FingerprintSchema,
  workspaceId: IdSchema,
  tool: ApprovalReviewToolDescriptorSchema,
  taskTrust: z.enum(['trusted-workspace', 'untrusted-content']),
  permission: ApprovalPermissionSummarySchema,
  sandbox: ApprovalSandboxSummarySchema,
  network: z.enum(['restricted', 'enabled']),
  goal: ApprovalGoalSummarySchema.optional(),
  policyRevision: RevisionSchema,
  reviewerRevision: RevisionSchema,
  deadlineAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.network !== value.sandbox.network) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['network'], message: 'network summary must match sandbox network' });
  }
  addPrivacyIssues(value, context);
});
export type ApprovalReviewRequest = z.infer<typeof ApprovalReviewRequestSchema>;

/** Strict model-facing response; runtime metadata is filled by the adapter. */
export const ApprovalReviewModelOutputSchema = z.object({
  schemaVersion: z.literal(LLM_APPROVAL_SCHEMA_VERSION),
  reviewId: IdSchema,
  decision: ApprovalReviewDecisionSchema,
  reasonCode: ApprovalReviewReasonCodeSchema,
  explanation: BoundedTextSchema(1_024),
  approvalKeyFingerprint: FingerprintSchema,
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type ApprovalReviewModelOutput = z.infer<typeof ApprovalReviewModelOutputSchema>;

export const ApprovalReviewDecisionRecordSchema = z.object({
  schemaVersion: z.literal(LLM_APPROVAL_SCHEMA_VERSION),
  reviewId: IdSchema,
  decision: ApprovalReviewDecisionSchema,
  reasonCode: ApprovalReviewReasonCodeSchema,
  explanation: BoundedTextSchema(1_024),
  reviewerRevision: RevisionSchema,
  policyRevision: RevisionSchema,
  latencyMs: z.number().int().nonnegative().max(120_000),
  expiresAt: TimestampSchema.nullable(),
  approvalKeyFingerprint: FingerprintSchema,
  reviewedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.decision === 'allow' && value.expiresAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'allow decisions require an expiry' });
  }
  if (value.decision !== 'allow' && value.expiresAt !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'only allow decisions may carry an expiry' });
  }
  addPrivacyIssues(value, context);
});
export type ApprovalReviewDecisionRecord = z.infer<typeof ApprovalReviewDecisionRecordSchema>;

export const LlmApprovalSettingsProjectionSchema = z.object({
  schemaVersion: z.literal(LLM_APPROVAL_SCHEMA_VERSION),
  enabled: z.boolean(),
  reviewerSource: ApprovalReviewerSourceSchema,
  dedicatedProfileId: IdSchema.nullable(),
  posture: ApprovalReviewPostureSchema,
  status: ApprovalReviewerStatusSchema,
  reviewerRevision: RevisionSchema,
  policyRevision: RevisionSchema,
  limits: ApprovalReviewLimitsSchema,
  lastLatencyMs: z.number().int().nonnegative().max(120_000).nullable(),
  lastErrorCode: ApprovalReviewReasonCodeSchema.nullable(),
  lastHealthAt: TimestampSchema.nullable(),
  nextStep: BoundedTextSchema(256),
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (!value.enabled && (value.status !== 'disabled' || value.posture !== 'off')) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['enabled'], message: 'disabled settings must use disabled status and off posture' });
  }
  if (value.reviewerSource === 'same-as-run' && value.dedicatedProfileId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dedicatedProfileId'], message: 'same-as-run settings cannot contain a dedicated profile' });
  }
  if (value.reviewerSource === 'dedicated' && value.enabled && value.dedicatedProfileId === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dedicatedProfileId'], message: 'dedicated settings require a profile id' });
  }
  addPrivacyIssues(value, context);
});
export type LlmApprovalSettingsProjection = z.infer<typeof LlmApprovalSettingsProjectionSchema>;

export const ApprovalReviewEventTypeSchema = z.enum(['review.requested', 'review.completed', 'review.unavailable', 'review.revoked']);
export type ApprovalReviewEventType = z.infer<typeof ApprovalReviewEventTypeSchema>;

export const ApprovalReviewEventSchema = z.object({
  schemaVersion: z.literal(LLM_APPROVAL_SCHEMA_VERSION),
  eventId: IdSchema,
  idempotencyKey: IdSchema,
  appendSequence: z.number().int().positive().max(10_000_000),
  eventType: ApprovalReviewEventTypeSchema,
  reviewId: IdSchema,
  runId: IdSchema,
  turnId: IdSchema,
  correlationId: IdSchema,
  approvalKeyFingerprint: FingerprintSchema,
  reviewerRevision: RevisionSchema,
  policyRevision: RevisionSchema,
  decision: ApprovalReviewDecisionSchema.nullable(),
  reasonCode: ApprovalReviewReasonCodeSchema,
  latencyMs: z.number().int().nonnegative().max(120_000).nullable(),
  expiresAt: TimestampSchema.nullable(),
  at: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.eventType === 'review.requested' && value.decision !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'requested events cannot contain a decision' });
  }
  if (value.eventType !== 'review.requested' && value.decision === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['decision'], message: 'terminal review events require a decision' });
  }
  if (value.decision === 'allow' && value.expiresAt === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expiresAt'], message: 'allow events require an expiry' });
  }
  addPrivacyIssues(value, context);
});
export type ApprovalReviewEvent = z.infer<typeof ApprovalReviewEventSchema>;

export function findLlmApprovalPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (isAbsolutePath(value)) violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    if (/^(?:https?|ftp):\/\//iu.test(value)) violations.push(`arbitrary URL is not allowed at ${path.join('.') || '<root>'}`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findLlmApprovalPrivacyViolations(entry, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_KEY.test(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findLlmApprovalPrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findLlmApprovalPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
}

export function parseApprovalReviewerSnapshot(value: unknown): ApprovalReviewerSnapshot {
  return ApprovalReviewerSnapshotSchema.parse(value);
}

export function parseApprovalReviewRequest(value: unknown): ApprovalReviewRequest {
  return ApprovalReviewRequestSchema.parse(value);
}

export function parseApprovalReviewDecision(value: unknown): ApprovalReviewDecisionRecord {
  return ApprovalReviewDecisionRecordSchema.parse(value);
}

export function parseApprovalReviewModelOutput(value: unknown): ApprovalReviewModelOutput {
  return ApprovalReviewModelOutputSchema.parse(value);
}

export function parseLlmApprovalSettingsProjection(value: unknown): LlmApprovalSettingsProjection {
  return LlmApprovalSettingsProjectionSchema.parse(value);
}

export function parseApprovalReviewEvent(value: unknown): ApprovalReviewEvent {
  return ApprovalReviewEventSchema.parse(value);
}
