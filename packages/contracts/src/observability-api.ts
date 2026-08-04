import { z } from 'zod';
import { AuditEventSchema, ModelUsageRecordSchema, PricingRuleSchema, ToolUsageRecordSchema, findObservabilityPrivacyViolations } from './observability.js';

export const OBSERVABILITY_API_SCHEMA_VERSION = 'ready4vibe_observability_api_v1' as const;
export const ObservabilityApiStatusSchema = z.enum(['ready', 'degraded', 'unknown']);
export type ObservabilityApiStatus = z.infer<typeof ObservabilityApiStatusSchema>;
export const ObservabilityRangeSchema = z.enum(['24h', '7d', '30d']);
export type ObservabilityRange = z.infer<typeof ObservabilityRangeSchema>;
export const ObservabilityMetricSchema = z.enum(['cpu', 'memory', 'disk', 'tokens', 'cost']);
export type ObservabilityMetric = z.infer<typeof ObservabilityMetricSchema>;

const ISO_TIMESTAMP = z.string().datetime({ offset: true });
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const UINT = z.number().int().nonnegative().max(1_000_000_000_000);
const UINT64 = /^(?:0|[1-9][0-9]{0,19})$/u;
const DECIMAL_UINT = /^(?:0|[1-9][0-9]{0,29})$/u;
const id = z.string().min(1).max(128).regex(SAFE_ID);
const safeBytes = z.string().regex(UINT64);
const safeDecimal = z.string().regex(DECIMAL_UINT);

export const ObservabilityDimensionSummarySchema = z.object({
  total: UINT.nullable(),
  knownRecords: UINT,
  unknownRecords: UINT,
}).strict();
export type ObservabilityDimensionSummary = z.infer<typeof ObservabilityDimensionSummarySchema>;

const ObservabilityLatestResourceSchema = z.object({
  sampledAt: ISO_TIMESTAMP,
  accuracy: z.enum(['reported', 'measured', 'estimated', 'unknown', 'not-applicable']),
  cpuMilliPercent: UINT.optional(),
  rssBytes: safeBytes.optional(),
  hostAvailableBytes: safeBytes.optional(),
  diskFreeBytes: safeBytes.optional(),
}).strict();

export const ObservabilityUsageSummarySchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_API_SCHEMA_VERSION),
  status: ObservabilityApiStatusSchema,
  generatedAt: ISO_TIMESTAMP,
  range: ObservabilityRangeSchema,
  from: ISO_TIMESTAMP,
  to: ISO_TIMESTAMP,
  modelAttempts: UINT,
  modelRequests: UINT,
  toolCalls: UINT,
  tokens: z.object({
    input: ObservabilityDimensionSummarySchema,
    output: ObservabilityDimensionSummarySchema,
    cachedInput: ObservabilityDimensionSummarySchema,
    reasoning: ObservabilityDimensionSummarySchema,
  }).strict(),
  resources: z.object({
    sampleCount: UINT,
    droppedSampleCount: UINT,
    latest: ObservabilityLatestResourceSchema.optional(),
  }).strict(),
  cost: z.object({
    currency: z.string().regex(/^[A-Z]{3,8}$/u).nullable(),
    amountMicros: safeDecimal.nullable(),
    accuracy: z.enum(['exact', 'estimated', 'unknown', 'not-applicable']),
  }).strict(),
}).strict().superRefine(addPrivacyIssues);
export type ObservabilityUsageSummary = z.infer<typeof ObservabilityUsageSummarySchema>;

export const ObservabilityTimeseriesPointSchema = z.object({
  bucketStart: ISO_TIMESTAMP,
  bucketEnd: ISO_TIMESTAMP,
  sampleCount: UINT,
  accuracy: z.enum(['reported', 'measured', 'estimated', 'unknown', 'not-applicable']),
  cpuMilliPercent: UINT.optional(),
  rssBytes: safeBytes.optional(),
  diskFreeBytes: safeBytes.optional(),
  inputTokens: UINT.optional(),
  outputTokens: UINT.optional(),
  costMicros: safeDecimal.optional(),
}).strict();
export type ObservabilityTimeseriesPoint = z.infer<typeof ObservabilityTimeseriesPointSchema>;

export const ObservabilityTimeseriesSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_API_SCHEMA_VERSION),
  status: ObservabilityApiStatusSchema,
  generatedAt: ISO_TIMESTAMP,
  range: ObservabilityRangeSchema,
  metric: ObservabilityMetricSchema,
  points: z.array(ObservabilityTimeseriesPointSchema).max(744),
  droppedSampleCount: UINT,
}).strict().superRefine(addPrivacyIssues);
export type ObservabilityTimeseries = z.infer<typeof ObservabilityTimeseriesSchema>;

export const ObservabilityRunUsageSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_API_SCHEMA_VERSION),
  status: ObservabilityApiStatusSchema,
  generatedAt: ISO_TIMESTAMP,
  runId: id,
  modelUsages: z.array(ModelUsageRecordSchema).max(256),
  toolUsages: z.array(ToolUsageRecordSchema).max(256),
  tokens: z.object({
    input: ObservabilityDimensionSummarySchema,
    output: ObservabilityDimensionSummarySchema,
    cachedInput: ObservabilityDimensionSummarySchema,
    reasoning: ObservabilityDimensionSummarySchema,
  }).strict(),
}).strict().superRefine(addPrivacyIssues);
export type ObservabilityRunUsage = z.infer<typeof ObservabilityRunUsageSchema>;

export const ObservabilityAuditResponseSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_API_SCHEMA_VERSION),
  status: ObservabilityApiStatusSchema,
  generatedAt: ISO_TIMESTAMP,
  after: UINT,
  nextAfter: UINT.nullable(),
  events: z.array(AuditEventSchema).max(100),
}).strict().superRefine(addPrivacyIssues);
export type ObservabilityAuditResponse = z.infer<typeof ObservabilityAuditResponseSchema>;

export const ObservabilityPricingResponseSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_API_SCHEMA_VERSION),
  status: ObservabilityApiStatusSchema,
  generatedAt: ISO_TIMESTAMP,
  rules: z.array(PricingRuleSchema).max(256),
}).strict().superRefine(addPrivacyIssues);
export type ObservabilityPricingResponse = z.infer<typeof ObservabilityPricingResponseSchema>;

export const ObservabilityOperationResponseSchema = z.object({
  schemaVersion: z.literal(OBSERVABILITY_API_SCHEMA_VERSION),
  status: ObservabilityApiStatusSchema,
  generatedAt: ISO_TIMESTAMP,
  verified: z.boolean().optional(),
  rollupsRebuilt: UINT.optional(),
  errorCode: id.optional(),
}).strict().superRefine(addPrivacyIssues);
export type ObservabilityOperationResponse = z.infer<typeof ObservabilityOperationResponseSchema>;

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findObservabilityPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}
