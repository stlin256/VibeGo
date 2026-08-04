import { z } from 'zod';
import { ProviderCapabilitySchema, ProviderEndpointPolicySchema } from './provider-usage.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SECRET_SHAPED = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

const id = z.string().min(1).max(128).regex(SAFE_ID).regex(CONTROL_TEXT);
const label = z.string().min(1).max(256).regex(SAFE_LABEL).regex(CONTROL_TEXT);
const boundedText = z.string().max(512 * 1024).regex(CONTROL_TEXT);
const revision = z.string().min(1).max(128).regex(REVISION).regex(CONTROL_TEXT);
const timestamp = z.string().datetime({ offset: true });
const tokenCount = z.number().int().nonnegative().max(10_000_000_000);

export const MODEL_PROVIDER_SNAPSHOT_SCHEMA_VERSION = 'ready4vibe_model_provider_snapshot_v1' as const;
export const MODEL_EVENT_SCHEMA_VERSION = 'ready4vibe_model_event_v1' as const;
export const MODEL_RETRY_PLAN_SCHEMA_VERSION = 'ready4vibe_model_retry_plan_v1' as const;
export const MODEL_REQUEST_SCHEMA_VERSION = 'ready4vibe_model_request_v1' as const;

export const ModelProviderSnapshotSchema = z.object({
  schemaVersion: z.literal(MODEL_PROVIDER_SNAPSHOT_SCHEMA_VERSION),
  providerId: id,
  model: label,
  pricingModel: label,
  descriptorRevision: revision,
  endpointPolicy: ProviderEndpointPolicySchema,
  capabilities: ProviderCapabilitySchema,
  /** A secret-store reference only; the credential itself never enters this DTO. */
  authRef: z.string().min(8).max(256).regex(/^secret\.[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u).optional(),
  capturedAt: timestamp,
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type ModelProviderSnapshot = z.infer<typeof ModelProviderSnapshotSchema>;

export const ModelRequestMessageSchema = z.object({
  role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
  content: boundedText,
  source: z.enum(['system', 'developer', 'user', 'assistant', 'tool', 'workspace', 'retrieval', 'skill', 'mcp']).optional(),
  trust: z.enum(['trusted', 'untrusted']).optional(),
  toolCallId: id.optional(),
}).strict();
export type ModelRequestMessage = z.infer<typeof ModelRequestMessageSchema>;

export const ModelRequestSchema = z.object({
  schemaVersion: z.literal(MODEL_REQUEST_SCHEMA_VERSION),
  model: label,
  messages: z.array(ModelRequestMessageSchema).max(512),
  tools: z.array(z.unknown()).max(64),
  budget: z.object({ maxInputTokens: tokenCount, maxOutputTokens: tokenCount }).strict(),
  metadata: z.object({ runId: id, turnId: id, requestId: id, attempt: z.number().int().positive().max(8).optional() }).strict(),
}).strict().superRefine((value, context) => addPrivacyIssues(value, context));
export type VersionedModelRequest = z.infer<typeof ModelRequestSchema>;

const ModelEventBaseSchema = z.object({
  schemaVersion: z.literal(MODEL_EVENT_SCHEMA_VERSION).optional(),
}).strict();

export const ModelEventSchema = z.union([
  ModelEventBaseSchema.extend({ type: z.literal('text-delta'), text: boundedText }),
  ModelEventBaseSchema.extend({
    type: z.literal('tool-call-delta'),
    callId: id,
    name: label.optional(),
    argumentsChunk: boundedText,
  }),
  ModelEventBaseSchema.extend({
    type: z.literal('usage'),
    inputTokens: tokenCount.optional(),
    outputTokens: tokenCount.optional(),
  }).refine((value) => value.inputTokens !== undefined || value.outputTokens !== undefined, {
    message: 'usage must contain at least one token count',
  }),
  ModelEventBaseSchema.extend({
    type: z.literal('completed'),
    finishReason: z.enum(['stop', 'tool-calls', 'length', 'content-filter']),
  }),
  ModelEventBaseSchema.extend({
    type: z.literal('error'),
    code: id,
    retryable: z.boolean(),
    safeMessage: label,
    retryAfterMs: z.number().int().nonnegative().max(30_000).optional(),
  }),
]);
export type VersionedModelEvent = z.infer<typeof ModelEventSchema>;

export const ModelReplayToolCallSchema = z.object({
  callId: id,
  name: label,
  arguments: boundedText,
}).strict();
export type ModelReplayToolCall = z.infer<typeof ModelReplayToolCallSchema>;

export const ModelReplayUsageSchema = z.object({
  inputTokens: tokenCount.optional(),
  outputTokens: tokenCount.optional(),
}).strict();
export type ModelReplayUsage = z.infer<typeof ModelReplayUsageSchema>;

export const ModelReplayResultSchema = z.object({
  schemaVersion: z.literal(MODEL_EVENT_SCHEMA_VERSION),
  text: boundedText,
  toolCalls: z.array(ModelReplayToolCallSchema).max(64),
  usage: ModelReplayUsageSchema.optional(),
  finishReason: z.enum(['stop', 'tool-calls', 'length', 'content-filter']).optional(),
  eventCount: z.number().int().nonnegative().max(4096),
  fingerprint: z.string().regex(SHA256),
}).strict();
export type ModelReplayResult = z.infer<typeof ModelReplayResultSchema>;

export const ModelRetryReasonSchema = z.enum([
  'transport',
  'timeout',
  'rate-limit',
  'upstream-5xx',
]);
export type ModelRetryReason = z.infer<typeof ModelRetryReasonSchema>;

export const ModelRetryPlanSchema = z.object({
  schemaVersion: z.literal(MODEL_RETRY_PLAN_SCHEMA_VERSION),
  attempt: z.number().int().positive().max(8),
  maxAttempts: z.number().int().positive().max(8),
  delayMs: z.number().int().nonnegative().max(30_000),
  reason: ModelRetryReasonSchema,
  retryable: z.literal(true),
}).strict();
export type ModelRetryPlan = z.infer<typeof ModelRetryPlanSchema>;

export function findModelRuntimePrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (isAbsolutePath(value)) violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => violations.push(...findModelRuntimePrivacyViolations(entry, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_SHAPED.test(key) && key !== 'authRef') violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findModelRuntimePrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findModelRuntimePrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
}
