import { z } from 'zod';
import {
  MODEL_USAGE_SCHEMA_VERSION,
  ModelUsageRecordSchema,
  ModelUsageStatusSchema,
  ModelTokenCountsSchema,
  type ModelUsageRecord,
} from './observability.js';

export { MODEL_USAGE_SCHEMA_VERSION, ModelUsageRecordSchema } from './observability.js';

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

const id = z.string().min(1).max(128).regex(SAFE_ID).regex(CONTROL_TEXT);
const label = z.string().min(1).max(256).regex(SAFE_LABEL).regex(CONTROL_TEXT);
const revision = z.string().min(1).max(128).regex(REVISION).regex(CONTROL_TEXT);
const timestamp = z.string().datetime({ offset: true });

export const PROVIDER_DESCRIPTOR_SCHEMA_VERSION = 'ready4vibe_provider_descriptor_v1' as const;
export const PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 'ready4vibe_provider_capability_snapshot_v1' as const;
export const PROVIDER_USAGE_OBSERVATION_SCHEMA_VERSION = 'ready4vibe_provider_usage_observation_v1' as const;

export const ProviderProtocolSchema = z.enum([
  'openai-compatible',
  'anthropic',
  'anthropic-messages',
  'ollama',
  'local-http',
]);
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;

const EndpointUrlSchema = z.string().min(1).max(2_048).regex(CONTROL_TEXT)
  .refine((value) => !isAbsolutePath(value), { message: 'absolute path is not allowed for provider endpoint' })
  .refine((value) => isSafeEndpointUrl(value), { message: 'endpoint URL must use HTTPS, omit credentials/query parameters, and target a supported host' });

export const ProviderEndpointPolicySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('explicit-url'), baseUrl: EndpointUrlSchema }).strict(),
  z.object({ kind: z.literal('provider-default') }).strict(),
  z.object({ kind: z.literal('local-managed'), serviceId: id }).strict(),
]);
export type ProviderEndpointPolicy = z.infer<typeof ProviderEndpointPolicySchema>;

const AuthRefSchema = z.string().min(8).max(256).regex(/^secret\.[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u)
  .regex(CONTROL_TEXT);

export const ProviderCapabilitySchema = z.object({
  streaming: z.boolean(),
  toolCalls: z.boolean(),
  structuredOutput: z.boolean(),
  reasoning: z.boolean(),
  promptCaching: z.boolean(),
  audioInput: z.boolean(),
  audioOutput: z.boolean(),
  vision: z.boolean().optional(),
  embeddings: z.boolean().optional(),
  batch: z.boolean().optional(),
  maxContextTokens: z.number().int().positive().max(10_000_000).optional(),
  maxOutputTokens: z.number().int().positive().max(1_000_000).optional(),
}).strict();
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderDescriptorSchema = z.object({
  schemaVersion: z.literal(PROVIDER_DESCRIPTOR_SCHEMA_VERSION),
  providerId: id,
  displayName: label,
  protocol: ProviderProtocolSchema,
  endpointPolicy: ProviderEndpointPolicySchema,
  /** A reference into the daemon secret store; the secret itself never crosses this contract. */
  authRef: AuthRefSchema.optional(),
  capabilities: ProviderCapabilitySchema,
  models: z.array(label).min(1).max(128),
  source: z.enum(['builtin', 'user-configured', 'sidecar', 'imported']),
  revision: revision.optional(),
}).strict().superRefine(addPrivacyIssues);
export type ProviderDescriptor = z.infer<typeof ProviderDescriptorSchema>;

export const ProviderCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal(PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION),
  providerId: id,
  capturedAt: timestamp,
  descriptorRevision: revision,
  capabilities: ProviderCapabilitySchema,
}).strict().superRefine(addPrivacyIssues);
export type ProviderCapabilitySnapshot = z.infer<typeof ProviderCapabilitySnapshotSchema>;

export const ProviderUsageDataSourceSchema = z.enum(['provider-usage', 'run-event', 'session-import', 'reconciled']);
export type ProviderUsageDataSource = z.infer<typeof ProviderUsageDataSourceSchema>;
export const ProviderInputTokenSemanticsSchema = z.enum(['fresh', 'cache-inclusive', 'unknown']);
export type ProviderInputTokenSemantics = z.infer<typeof ProviderInputTokenSemanticsSchema>;

export const ProviderUsageObservationSchema = z.object({
  schemaVersion: z.literal(PROVIDER_USAGE_OBSERVATION_SCHEMA_VERSION),
  usageId: id,
  runId: id,
  turnId: id,
  requestId: id,
  providerId: id,
  model: label,
  requestModel: label,
  pricingModel: label,
  attempt: z.number().int().positive().max(128),
  startedAt: timestamp,
  completedAt: timestamp.optional(),
  latencyMs: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  timeToFirstByteMs: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  status: ModelUsageStatusSchema,
  tokens: ModelTokenCountsSchema,
  tokenAccuracy: z.enum(['reported', 'estimated', 'unknown']),
  inputTokenSemantics: ProviderInputTokenSemanticsSchema,
  dataSource: ProviderUsageDataSourceSchema,
  reconciledFrom: z.array(id).min(2).max(8).optional(),
  sourceRevision: revision.optional(),
}).strict().superRefine((value, context) => {
  addPrivacyIssues(value, context);
  if (value.dataSource === 'reconciled' && !value.reconciledFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reconciledFrom'], message: 'reconciled usage requires reconciledFrom' });
  }
  if (value.dataSource !== 'reconciled' && value.reconciledFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reconciledFrom'], message: 'reconciledFrom is only valid for reconciled usage' });
  }
  if (value.reconciledFrom && new Set(value.reconciledFrom).size !== value.reconciledFrom.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['reconciledFrom'], message: 'reconciledFrom must contain unique sources' });
  }
});
export type ProviderUsageObservation = z.infer<typeof ProviderUsageObservationSchema>;

/** Returns stable privacy violations for provider metadata and extracted usage only. */
export function findProviderUsagePrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (isAbsolutePath(value)) violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findProviderUsagePrivacyViolations(entry, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const safeField = /^(?:tokens?|input|output|cachedInput|cacheCreation|reasoning|toolInput|toolOutput|audioInput|audioOutput|acceptedPrediction|rejectedPrediction|tokenAccuracy|inputTokenSemantics|dataSource|reconciledFrom)$/u.test(key);
    const nextPath = [...path, key];
    if (!safeField && SECRET_KEY.test(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findProviderUsagePrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findProviderUsagePrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
}

function isSafeEndpointUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

export function parseProviderDescriptor(value: unknown): ProviderDescriptor {
  return ProviderDescriptorSchema.parse(value);
}

export function parseProviderCapabilitySnapshot(value: unknown): ProviderCapabilitySnapshot {
  return ProviderCapabilitySnapshotSchema.parse(value);
}

export function parseProviderUsageObservation(value: unknown): ProviderUsageObservation {
  return ProviderUsageObservationSchema.parse(value);
}
