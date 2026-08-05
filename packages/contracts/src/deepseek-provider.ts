import { z } from 'zod';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer|secret)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

const id = z.string().min(1).max(128).regex(SAFE_ID).regex(CONTROL_TEXT);
const model = z.string().min(1).max(128).regex(SAFE_MODEL).regex(CONTROL_TEXT);
const revision = z.string().min(1).max(128).regex(SAFE_REVISION).regex(CONTROL_TEXT);
const timestamp = z.string().datetime({ offset: true }).max(64);
const boundedText = z.string().min(1).max(4_096).regex(CONTROL_TEXT);
const secretRef = z.string().min(8).max(256).regex(/^secret\.[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u).regex(CONTROL_TEXT);
const unknownOrPositiveInt = z.union([z.literal('unknown'), z.number().int().positive().max(10_000_000)]);
const unknownOrBoolean = z.union([z.literal('unknown'), z.boolean()]);

export const DEEPSEEK_PROVIDER_SCHEMA_VERSION = 'deepseek-provider/v1' as const;
export const DEEPSEEK_CAPABILITY_SCHEMA_VERSION = 'deepseek-provider-capability/v1' as const;
export const DEEPSEEK_PROBE_SCHEMA_VERSION = 'deepseek-provider-probe/v1' as const;
export const DEEPSEEK_REVIEW_SCHEMA_VERSION = 'deepseek-provider-review/v1' as const;
export const DEEPSEEK_SEARCH_ITEM_SCHEMA_VERSION = 'deepseek-provider-search-item/v1' as const;
export const DEEPSEEK_SEARCH_SCHEMA_VERSION = 'deepseek-provider-search/v1' as const;
export const DEEPSEEK_RETRY_SCHEMA_VERSION = 'deepseek-provider-retry/v1' as const;
export const DEEPSEEK_RUN_SCHEMA_VERSION = 'deepseek-provider-run/v1' as const;
export const DEEPSEEK_SETTINGS_PROFILE_SCHEMA_VERSION = 'ready4vibe_deepseek_settings_profile_v1' as const;
export const DEEPSEEK_SETTINGS_STATUS_SCHEMA_VERSION = 'ready4vibe_deepseek_settings_status_v1' as const;

export const DeepSeekEndpointProfileSchema = z.enum([
  'openai-chat-completions',
  'openai-responses',
  'anthropic-messages',
]);
export type DeepSeekEndpointProfile = z.infer<typeof DeepSeekEndpointProfileSchema>;

export const DeepSeekThinkingModeSchema = z.enum(['off', 'auto', 'high', 'max']);
export type DeepSeekThinkingMode = z.infer<typeof DeepSeekThinkingModeSchema>;

export const DeepSeekToolCallingModeSchema = z.enum(['disabled', 'enabled']);
export type DeepSeekToolCallingMode = z.infer<typeof DeepSeekToolCallingModeSchema>;

export const DeepSeekWebSearchModeSchema = z.enum(['off', 'provider-owned']);
export type DeepSeekWebSearchMode = z.infer<typeof DeepSeekWebSearchModeSchema>;

export const DeepSeekReviewerModeSchema = z.enum(['off', 'advisory']);
export type DeepSeekReviewerMode = z.infer<typeof DeepSeekReviewerModeSchema>;

export const DeepSeekStatusSchema = z.enum(['ready', 'degraded', 'blocked']);
export type DeepSeekStatus = z.infer<typeof DeepSeekStatusSchema>;

export const DeepSeekErrorCodeSchema = z.enum([
  'DEEPSEEK_CREDENTIAL_REQUIRED',
  'DEEPSEEK_PROTOCOL_UNSUPPORTED',
  'DEEPSEEK_MODEL_UNAVAILABLE',
  'DEEPSEEK_HTTP_400',
  'DEEPSEEK_HTTP_401',
  'DEEPSEEK_HTTP_402',
  'DEEPSEEK_HTTP_403',
  'DEEPSEEK_HTTP_404',
  'DEEPSEEK_HTTP_429',
  'DEEPSEEK_HTTP_5XX',
  'DEEPSEEK_TOOL_SCHEMA_UNSUPPORTED',
  'DEEPSEEK_THINKING_UNSUPPORTED',
  'DEEPSEEK_TIMEOUT',
  'DEEPSEEK_CANCELLED',
  'DEEPSEEK_STREAM_DISCONNECTED',
  'DEEPSEEK_MALFORMED_EVENT',
  'DEEPSEEK_CONTEXT_LIMIT',
  'DEEPSEEK_REVIEW_DEGRADED',
  'DEEPSEEK_SEARCH_DEGRADED',
]);
export type DeepSeekErrorCode = z.infer<typeof DeepSeekErrorCodeSchema>;

const endpoint = z.string().min(1).max(2_048).regex(CONTROL_TEXT).refine((value) => isSafeEndpoint(value), {
  message: 'DeepSeek endpoint must be an HTTPS URL without credentials, query, or fragment',
});

export const DeepSeekConfigSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_PROVIDER_SCHEMA_VERSION),
  providerId: z.literal('deepseek'),
  endpointProfile: DeepSeekEndpointProfileSchema,
  /** A complete profile-specific endpoint; adapters never append a guessed path. */
  endpoint,
  model,
  /** The credential stays in the daemon secret store; this is only a reference. */
  authRef: secretRef.optional(),
  thinkingMode: DeepSeekThinkingModeSchema,
  toolCalling: DeepSeekToolCallingModeSchema,
  webSearch: DeepSeekWebSearchModeSchema,
  reviewer: DeepSeekReviewerModeSchema,
  timeoutMs: z.number().int().positive().max(120_000),
  maxRetries: z.number().int().nonnegative().max(5),
  contextLimit: unknownOrPositiveInt.optional(),
  maxOutputTokens: z.number().int().positive().max(1_000_000),
  revision,
  updatedAt: timestamp,
}).strict().superRefine((value, context) => {
  if (!endpointMatchesProfile(value.endpoint, value.endpointProfile)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'endpoint path does not match endpointProfile' });
  }
  if (value.webSearch === 'provider-owned' && value.endpointProfile !== 'openai-responses') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['webSearch'], message: 'provider-owned search requires the Responses endpoint profile' });
  }
  addPrivacyIssues(value, context);
});
export type DeepSeekConfig = z.infer<typeof DeepSeekConfigSchema>;

/** Secret-free provider/config snapshot captured once for an in-flight run. */
export const DeepSeekRunSnapshotSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_RUN_SCHEMA_VERSION),
  providerId: z.literal('deepseek'),
  endpointProfile: DeepSeekEndpointProfileSchema,
  endpoint,
  model,
  thinkingMode: DeepSeekThinkingModeSchema,
  toolCalling: DeepSeekToolCallingModeSchema,
  webSearch: DeepSeekWebSearchModeSchema,
  reviewer: DeepSeekReviewerModeSchema,
  configRevision: revision,
  capabilityRevision: revision,
  capturedAt: timestamp,
}).strict().superRefine((value, context) => {
  if (!endpointMatchesProfile(value.endpoint, value.endpointProfile)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'endpoint path does not match endpointProfile' });
  }
  if (value.webSearch === 'provider-owned' && value.endpointProfile !== 'openai-responses') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['webSearch'], message: 'provider-owned search requires the Responses endpoint profile' });
  }
  addPrivacyIssues(value, context);
});
export type DeepSeekRunSnapshot = z.infer<typeof DeepSeekRunSnapshotSchema>;

export const DeepSeekCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_CAPABILITY_SCHEMA_VERSION),
  providerId: z.literal('deepseek'),
  endpointProfile: DeepSeekEndpointProfileSchema,
  model,
  descriptorRevision: revision,
  capturedAt: timestamp,
  status: DeepSeekStatusSchema,
  streaming: z.boolean(),
  toolCalls: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  usage: z.boolean(),
  webSearch: z.boolean(),
  contextLimit: unknownOrPositiveInt,
  outputLimit: unknownOrPositiveInt,
  degradedReason: boundedText.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'ready' && value.degradedReason !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['degradedReason'], message: 'ready capability cannot contain degradedReason' });
  }
  if (value.status !== 'ready' && value.degradedReason === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['degradedReason'], message: 'degraded or blocked capability requires degradedReason' });
  }
  if (value.webSearch && value.endpointProfile !== 'openai-responses') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['webSearch'], message: 'webSearch capability requires the Responses endpoint profile' });
  }
  addPrivacyIssues(value, context);
});
export type DeepSeekCapabilitySnapshot = z.infer<typeof DeepSeekCapabilitySnapshotSchema>;

export const DeepSeekProbeResultSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_PROBE_SCHEMA_VERSION),
  status: DeepSeekStatusSchema,
  checkedAt: timestamp,
  latencyMs: z.number().int().nonnegative().max(120_000).nullable(),
  errorCode: DeepSeekErrorCodeSchema.nullable(),
  capabilities: DeepSeekCapabilitySnapshotSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'ready' && (value.errorCode !== null || value.capabilities === null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'ready probe requires capabilities and no errorCode' });
  }
  if (value.status !== 'ready' && value.errorCode === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['errorCode'], message: 'degraded or blocked probe requires errorCode' });
  }
  if (value.status === 'blocked' && value.capabilities !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'blocked probe cannot expose a ready capability snapshot' });
  }
  addPrivacyIssues(value, context);
});
export type DeepSeekProbeResult = z.infer<typeof DeepSeekProbeResultSchema>;

export const DeepSeekReviewRiskSchema = z.enum(['read-only', 'workspace-write', 'shell', 'network', 'destructive', 'full-host', 'unknown']);
export type DeepSeekReviewRisk = z.infer<typeof DeepSeekReviewRiskSchema>;

export const DeepSeekReviewRequestSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_REVIEW_SCHEMA_VERSION),
  requestId: id,
  approvalKey: z.string().regex(SHA256),
  toolId: id,
  risk: DeepSeekReviewRiskSchema,
  taskTrust: z.enum(['trusted-workspace', 'untrusted-content']),
  sandboxMode: z.enum(['read-only', 'workspace-write', 'external-sandbox', 'danger-full-access']),
  network: z.enum(['restricted', 'enabled']),
  summary: boundedText,
  providerRevision: revision.optional(),
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type DeepSeekReviewRequest = z.infer<typeof DeepSeekReviewRequestSchema>;

export const DeepSeekReviewDecisionSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_REVIEW_SCHEMA_VERSION),
  requestId: id,
  approvalKey: z.string().regex(SHA256),
  decision: z.enum(['allow', 'ask', 'deny', 'unavailable']),
  reason: boundedText,
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type DeepSeekReviewDecision = z.infer<typeof DeepSeekReviewDecisionSchema>;

const safeHttpsUrl = z.string().min(1).max(2_048).regex(CONTROL_TEXT).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}, 'search result URL must be HTTPS without credentials or fragments');

export const DeepSeekSearchItemSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_SEARCH_ITEM_SCHEMA_VERSION),
  source: z.literal('retrieval'),
  trust: z.literal('untrusted'),
  referenceId: id,
  title: boundedText,
  snippet: boundedText,
  url: safeHttpsUrl,
  publishedAt: timestamp.optional(),
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type DeepSeekSearchItem = z.infer<typeof DeepSeekSearchItemSchema>;

export const DeepSeekSearchResponseSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_SEARCH_SCHEMA_VERSION),
  query: boundedText,
  items: z.array(DeepSeekSearchItemSchema).max(32),
  truncated: z.boolean(),
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type DeepSeekSearchResponse = z.infer<typeof DeepSeekSearchResponseSchema>;

export const DeepSeekRetryReasonSchema = z.enum(['rate-limit', 'upstream-5xx', 'timeout', 'transport']);
export type DeepSeekRetryReason = z.infer<typeof DeepSeekRetryReasonSchema>;

export const DeepSeekRetryPlanSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_RETRY_SCHEMA_VERSION),
  attempt: z.number().int().positive().max(5),
  maxAttempts: z.number().int().positive().max(5),
  delayMs: z.number().int().nonnegative().max(30_000),
  reason: DeepSeekRetryReasonSchema,
  retryable: z.literal(true),
}).strict();
export type DeepSeekRetryPlan = z.infer<typeof DeepSeekRetryPlanSchema>;

/**
 * Restart-safe DeepSeek metadata. Runtime credentials intentionally have no
 * representable field in this contract; the daemon accepts them only through
 * a write-only settings command and keeps them process-scoped.
 */
export const DeepSeekSettingsProfileSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_SETTINGS_PROFILE_SCHEMA_VERSION),
  providerId: z.literal('deepseek'),
  endpointProfile: DeepSeekEndpointProfileSchema,
  endpoint,
  model,
  thinkingMode: DeepSeekThinkingModeSchema,
  toolCalling: DeepSeekToolCallingModeSchema,
  webSearch: DeepSeekWebSearchModeSchema,
  reviewer: DeepSeekReviewerModeSchema,
  timeoutMs: z.number().int().positive().max(120_000),
  maxRetries: z.number().int().nonnegative().max(5),
  contextLimit: unknownOrPositiveInt.optional(),
  maxOutputTokens: z.number().int().positive().max(1_000_000),
  profileRevision: revision,
  updatedAt: timestamp,
}).strict().superRefine((value, context) => {
  if (!endpointMatchesProfile(value.endpoint, value.endpointProfile)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endpoint'], message: 'endpoint path does not match endpointProfile' });
  }
  if (value.webSearch === 'provider-owned' && value.endpointProfile !== 'openai-responses') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['webSearch'], message: 'provider-owned search requires the Responses endpoint profile' });
  }
  addPrivacyIssues(value, context);
});
export type DeepSeekSettingsProfile = z.infer<typeof DeepSeekSettingsProfileSchema>;

export const DeepSeekSettingsSourceSchema = z.enum(['environment', 'web-memory', 'durable-profile', 'unconfigured']);
export type DeepSeekSettingsSource = z.infer<typeof DeepSeekSettingsSourceSchema>;
export const DeepSeekCredentialStateSchema = z.enum(['available', 'required', 'none']);
export type DeepSeekCredentialState = z.infer<typeof DeepSeekCredentialStateSchema>;

/** Secret-free response returned by the daemon settings API. */
export const DeepSeekSettingsStatusSchema = z.object({
  schemaVersion: z.literal(DEEPSEEK_SETTINGS_STATUS_SCHEMA_VERSION),
  configured: z.boolean(),
  providerId: z.union([z.literal('deepseek'), z.literal('unconfigured')]),
  source: DeepSeekSettingsSourceSchema,
  credentialState: DeepSeekCredentialStateSchema,
  profile: DeepSeekSettingsProfileSchema.nullable(),
  capability: DeepSeekCapabilitySnapshotSchema.nullable(),
  lastProbe: DeepSeekProbeResultSchema.nullable(),
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type DeepSeekSettingsStatus = z.infer<typeof DeepSeekSettingsStatusSchema>;

export function findDeepSeekPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (isAbsolutePath(value)) violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findDeepSeekPrivacyViolations(entry, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    // These are bounded status/config metadata, not credentials. They are
    // explicitly enumerated because the generic key scanner is intentionally
    // conservative for arbitrary payloads.
    if (SECRET_KEY.test(key) && key !== 'authRef' && key !== 'credentialState') violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findDeepSeekPrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findDeepSeekPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
}

function isSafeEndpoint(value: string): boolean {
  if (isAbsolutePath(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function endpointMatchesProfile(value: string, profile: DeepSeekEndpointProfile): boolean {
  try {
    const pathname = new URL(value).pathname.replace(/\/+$/u, '');
    if (profile === 'openai-chat-completions') return pathname.endsWith('/chat/completions');
    if (profile === 'openai-responses') return pathname.endsWith('/responses');
    return pathname.endsWith('/messages');
  } catch {
    return false;
  }
}

export function parseDeepSeekConfig(value: unknown): DeepSeekConfig {
  return DeepSeekConfigSchema.parse(value);
}

export function parseDeepSeekCapabilitySnapshot(value: unknown): DeepSeekCapabilitySnapshot {
  return DeepSeekCapabilitySnapshotSchema.parse(value);
}

export function parseDeepSeekProbeResult(value: unknown): DeepSeekProbeResult {
  return DeepSeekProbeResultSchema.parse(value);
}
