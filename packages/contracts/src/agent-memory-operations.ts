import { z } from 'zod';
import {
  AgentMemoryErrorCodeSchema,
  findAgentMemoryPrivacyViolations,
} from './agent-memory.js';

const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const revision = z.string().min(1).max(128).regex(REVISION);
const timestamp = z.string().datetime({ offset: true });
const boundedCounter = z.number().int().nonnegative().max(1_000_000_000);

export const AgentMemoryUpdateOperationSchema = z.enum(['start', 'probe', 'update', 'rollback']);
export type AgentMemoryUpdateOperation = z.infer<typeof AgentMemoryUpdateOperationSchema>;

export const AgentMemoryUpdateOutcomeSchema = z.enum(['succeeded', 'failed', 'skipped']);
export type AgentMemoryUpdateOutcome = z.infer<typeof AgentMemoryUpdateOutcomeSchema>;

export const AgentMemoryUpdateRecordSchema = z.object({
  at: timestamp,
  operation: AgentMemoryUpdateOperationSchema,
  outcome: AgentMemoryUpdateOutcomeSchema,
  fromRevision: revision.nullable(),
  toRevision: revision.nullable(),
  elapsedMs: z.number().int().nonnegative().max(60_000),
  errorCode: AgentMemoryErrorCodeSchema.nullable(),
  message: z.string().max(256).regex(CONTROL_TEXT).nullable().optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryUpdateRecord = z.infer<typeof AgentMemoryUpdateRecordSchema>;

export const AgentMemoryRecallMetricsSchema = z.object({
  hits: boundedCounter,
  misses: boundedCounter,
  lastAt: timestamp.nullable(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryRecallMetrics = z.infer<typeof AgentMemoryRecallMetricsSchema>;

export const AgentMemoryWriteQueueStatusSchema = z.object({
  pending: z.number().int().nonnegative().max(256),
  inFlight: z.boolean(),
  accepted: boundedCounter,
  failed: boundedCounter,
  lastAttemptAt: timestamp.nullable(),
  lastErrorCode: AgentMemoryErrorCodeSchema.nullable(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryWriteQueueStatus = z.infer<typeof AgentMemoryWriteQueueStatusSchema>;

export const AGENT_MEMORY_OPERATIONS_SCHEMA_VERSION = 'ready4vibe_agent_memory_operations_v1' as const;
export const AgentMemoryOperationsSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_OPERATIONS_SCHEMA_VERSION),
  currentRevision: revision.nullable(),
  previousRevision: revision.nullable(),
  healthLatencyMs: z.number().int().nonnegative().max(60_000).nullable(),
  recall: AgentMemoryRecallMetricsSchema,
  writeQueue: AgentMemoryWriteQueueStatusSchema,
  updates: z.array(AgentMemoryUpdateRecordSchema).max(32),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryOperations = z.infer<typeof AgentMemoryOperationsSchema>;

/** Optional diagnostics port; it is never required for a memory provider. */
export interface AgentMemoryOperationsProvider {
  operations(): AgentMemoryOperations;
}
function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findAgentMemoryPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}
