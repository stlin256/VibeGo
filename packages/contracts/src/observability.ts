import { z } from 'zod';

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const HEX_64 = /^[a-f0-9]{64}$/u;
const DECIMAL_UINT = /^(?:0|[1-9][0-9]{0,29})$/u;
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

export const RESOURCE_SAMPLE_SCHEMA_VERSION = 'ready4vibe_resource_sample_v1' as const;
export const MODEL_USAGE_SCHEMA_VERSION = 'ready4vibe_model_usage_v1' as const;
export const TOOL_USAGE_SCHEMA_VERSION = 'ready4vibe_tool_usage_v1' as const;
export const AUDIT_EVENT_SCHEMA_VERSION = 'ready4vibe_audit_event_v1' as const;
export const PRICING_RULE_SCHEMA_VERSION = 'ready4vibe_pricing_rule_v1' as const;
export const USAGE_PROJECTION_SCHEMA_VERSION = 'ready4vibe_usage_projection_v1' as const;

export const ObservabilityAccuracySchema = z.enum(['reported', 'measured', 'estimated', 'unknown', 'not-applicable']);
export type ObservabilityAccuracy = z.infer<typeof ObservabilityAccuracySchema>;

const id = z.string().min(1).max(128).regex(SAFE_ID);
const label = z.string().min(1).max(256).regex(SAFE_LABEL).regex(CONTROL_TEXT);
const revision = z.string().min(1).max(128).regex(SAFE_ID);
const uint = z.number().int().nonnegative().max(1_000_000_000_000);
const uint64 = z.string().regex(UINT64);
const decimalUint = z.string().regex(DECIMAL_UINT);

const CpuSampleSchema = z.object({
  milliPercent: z.number().int().nonnegative().max(100_000),
  cpuTimeMs: uint.optional(),
}).strict();

const MemorySampleSchema = z.object({
  rssBytes: uint64.optional(),
  heapUsedBytes: uint64.optional(),
  externalBytes: uint64.optional(),
  hostAvailableBytes: uint64.optional(),
}).strict();

const DiskSampleSchema = z.object({
  volumeClass: z.enum(['system-volume', 'workspace-volume', 'sandbox-volume']),
  volumeId: id.optional(),
  capacityBytes: uint64.optional(),
  freeBytes: uint64.optional(),
  readBytes: uint64.optional(),
  writeBytes: uint64.optional(),
}).strict();

export const ResourceSampleSchema = z.object({
  schemaVersion: z.literal(RESOURCE_SAMPLE_SCHEMA_VERSION),
  sampleId: id,
  sampledAt: ISO_TIMESTAMP,
  scope: z.enum(['host', 'daemon', 'run', 'tool-process', 'sandbox']),
  runId: id.optional(),
  turnId: id.optional(),
  source: z.enum(['node', 'os-adapter', 'sandbox-adapter']),
  accuracy: ObservabilityAccuracySchema,
  cpu: CpuSampleSchema.optional(),
  memory: MemorySampleSchema.optional(),
  disk: DiskSampleSchema.optional(),
  samplingIntervalMs: z.number().int().positive().max(3_600_000),
  droppedSampleCount: uint,
}).strict().superRefine(addPrivacyIssues);
export type ResourceSample = z.infer<typeof ResourceSampleSchema>;

export const ModelUsageStatusSchema = z.enum(['completed', 'failed', 'cancelled', 'timed-out', 'unknown']);
export type ModelUsageStatus = z.infer<typeof ModelUsageStatusSchema>;

const ModelTokenCountsSchema = z.object({
  input: uint.optional(),
  output: uint.optional(),
  cachedInput: uint.optional(),
  reasoning: uint.optional(),
  toolInput: uint.optional(),
  toolOutput: uint.optional(),
}).strict();

const CostSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3,8}$/u),
  amountMicros: decimalUint,
  accuracy: z.enum(['exact', 'estimated', 'unknown']),
  pricingRevision: revision,
}).strict();

export const ModelUsageRecordSchema = z.object({
  schemaVersion: z.literal(MODEL_USAGE_SCHEMA_VERSION),
  usageId: id,
  runId: id,
  turnId: id,
  requestId: id,
  providerId: label,
  model: label,
  attempt: z.number().int().positive().max(128),
  startedAt: ISO_TIMESTAMP,
  completedAt: ISO_TIMESTAMP.optional(),
  latencyMs: uint.optional(),
  timeToFirstByteMs: uint.optional(),
  status: ModelUsageStatusSchema,
  tokens: ModelTokenCountsSchema,
  tokenAccuracy: z.enum(['reported', 'estimated', 'unknown']),
  cost: CostSchema.optional(),
  sourceRevision: revision.optional(),
}).strict().superRefine(addPrivacyIssues);
export type ModelUsageRecord = z.infer<typeof ModelUsageRecordSchema>;

export const ToolUsageStatusSchema = ModelUsageStatusSchema;
export type ToolUsageStatus = z.infer<typeof ToolUsageStatusSchema>;

export const ToolUsageRecordSchema = z.object({
  schemaVersion: z.literal(TOOL_USAGE_SCHEMA_VERSION),
  usageId: id,
  runId: id,
  turnId: id,
  callId: id,
  toolId: label,
  toolVersion: label.optional(),
  attempt: z.number().int().positive().max(128),
  startedAt: ISO_TIMESTAMP,
  completedAt: ISO_TIMESTAMP.optional(),
  durationMs: uint.optional(),
  status: ToolUsageStatusSchema,
  risk: z.enum(['read', 'write', 'destructive', 'network', 'unknown']),
  runtime: z.enum(['host-restricted', 'external-sandbox', 'unknown']),
  outputBytes: uint.optional(),
  peakCpuMilliPercent: z.number().int().nonnegative().max(100_000).optional(),
  peakMemoryBytes: uint64.optional(),
  accuracy: ObservabilityAccuracySchema,
}).strict().superRefine(addPrivacyIssues);
export type ToolUsageRecord = z.infer<typeof ToolUsageRecordSchema>;

export const AuditActorSchema = z.enum(['system', 'user-session', 'remote-session']);
export const AuditTransportSchema = z.enum(['loopback', 'lan', 'tailscale', 'ssh']);
export const AuditOutcomeSchema = z.enum(['allowed', 'denied', 'succeeded', 'failed', 'degraded']);
export const AuditTargetKindSchema = z.enum(['run', 'model', 'tool', 'sandbox', 'workspace', 'settings', 'pairing', 'export', 'audit']);
const AuditActionSchema = z.enum([
  'pairing.created', 'pairing.revoked', 'settings.updated', 'settings.probed',
  'approval.requested', 'approval.decided', 'run.created', 'run.completed', 'run.failed',
  'run.cancelled', 'run.retry', 'provider.degraded', 'workspace.updated', 'model.configured',
  'sandbox.configured', 'usage.exported', 'audit.verified',
]);

const SafeDetailValueSchema = z.union([
  z.string().max(256).regex(CONTROL_TEXT),
  z.boolean(),
  z.number().finite().int().nonnegative().max(1_000_000_000_000),
]);

export const AuditEventSchema = z.object({
  schemaVersion: z.literal(AUDIT_EVENT_SCHEMA_VERSION),
  eventId: id,
  appendSequence: z.number().int().positive().max(1_000_000_000_000),
  at: ISO_TIMESTAMP,
  actor: AuditActorSchema,
  transport: AuditTransportSchema,
  action: AuditActionSchema,
  targetKind: AuditTargetKindSchema,
  targetId: id.optional(),
  outcome: AuditOutcomeSchema,
  reasonCode: id.optional(),
  correlationId: id,
  safeDetails: z.record(z.string().min(1).max(64).regex(SAFE_ID), SafeDetailValueSchema).optional(),
  previousHash: z.string().regex(HEX_64).nullable(),
  eventHash: z.string().regex(HEX_64),
}).strict().superRefine(addPrivacyIssues);
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const PricingRuleSchema = z.object({
  schemaVersion: z.literal(PRICING_RULE_SCHEMA_VERSION),
  pricingRevision: revision,
  providerId: label,
  modelPattern: label,
  effectiveFrom: ISO_TIMESTAMP,
  currency: z.string().regex(/^[A-Z]{3,8}$/u),
  inputMicrosPerMillionTokens: decimalUint.optional(),
  outputMicrosPerMillionTokens: decimalUint.optional(),
  cachedInputMicrosPerMillionTokens: decimalUint.optional(),
  reasoningMicrosPerMillionTokens: decimalUint.optional(),
  source: z.enum(['builtin', 'user-configured', 'imported']),
}).strict().superRefine(addPrivacyIssues);
export type PricingRule = z.infer<typeof PricingRuleSchema>;

const UsageDimensionSummarySchema = z.object({
  total: uint.nullable(),
  knownRecords: uint,
  unknownRecords: uint,
}).strict();
export type UsageDimensionSummary = z.infer<typeof UsageDimensionSummarySchema>;

export const UsageProjectionSchema = z.object({
  schemaVersion: z.literal(USAGE_PROJECTION_SCHEMA_VERSION),
  runId: id,
  records: z.array(ModelUsageRecordSchema).max(256),
  totals: z.object({
    input: UsageDimensionSummarySchema,
    output: UsageDimensionSummarySchema,
    cachedInput: UsageDimensionSummarySchema,
    reasoning: UsageDimensionSummarySchema,
  }).strict(),
  sourceEventCount: uint,
  sourceChecksum: z.string().regex(HEX_64),
}).strict().superRefine(addPrivacyIssues);
export type UsageProjection = z.infer<typeof UsageProjectionSchema>;

/**
 * Observability contracts share a stricter privacy scanner than generic JSON:
 * dimensions such as `inputTokens` are safe counters, while credentials and
 * paths are rejected even when nested inside audit details.
 */
export function findObservabilityPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) {
      violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    }
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...findObservabilityPrivacyViolations(item, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const safeCounterKey = /^(?:tokens?|input|output|cachedInput|reasoning|toolInput|toolOutput|tokenAccuracy|knownRecords|unknownRecords)$/u.test(key);
    const nextPath = [...path, key];
    if (!safeCounterKey && SECRET_KEY.test(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findObservabilityPrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findObservabilityPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

export function parseResourceSample(value: unknown): ResourceSample {
  return ResourceSampleSchema.parse(value);
}

export function parseModelUsageRecord(value: unknown): ModelUsageRecord {
  return ModelUsageRecordSchema.parse(value);
}

export function parseToolUsageRecord(value: unknown): ToolUsageRecord {
  return ToolUsageRecordSchema.parse(value);
}

export function parseAuditEvent(value: unknown): AuditEvent {
  return AuditEventSchema.parse(value);
}

export function parsePricingRule(value: unknown): PricingRule {
  return PricingRuleSchema.parse(value);
}

export function parseUsageProjection(value: unknown): UsageProjection {
  return UsageProjectionSchema.parse(value);
}
