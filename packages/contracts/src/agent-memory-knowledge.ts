import { z } from 'zod';
import { AgentMemoryItemSchema, findAgentMemoryPrivacyViolations, type AgentMemoryStatus } from './agent-memory.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u;
const SAFE_TOOL_NAME = /^[a-z][a-z0-9_-]{0,63}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const boundedText = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT);

export const AgentMemoryKnowledgeResourceTypeSchema = z.enum(['wiki', 'code-graph']);
export type AgentMemoryKnowledgeResourceType = z.infer<typeof AgentMemoryKnowledgeResourceTypeSchema>;

export const AgentMemoryKnowledgeToolNameSchema = z.string().min(1).max(64).regex(SAFE_TOOL_NAME);
export type AgentMemoryKnowledgeToolName = z.infer<typeof AgentMemoryKnowledgeToolNameSchema>;

export const AgentMemoryKnowledgeParamTypeSchema = z.enum(['string', 'integer', 'boolean', 'array']);
export type AgentMemoryKnowledgeParamType = z.infer<typeof AgentMemoryKnowledgeParamTypeSchema>;

const knowledgeDefaultSchema = z.union([
  z.string().max(512).regex(CONTROL_TEXT),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(512).regex(CONTROL_TEXT)).max(32),
]);

export const AgentMemoryKnowledgeToolParamSchema = z.object({
  type: AgentMemoryKnowledgeParamTypeSchema,
  required: z.boolean().optional(),
  description: boundedText(2_048).optional(),
  default: knowledgeDefaultSchema.optional(),
  enum: z.array(boundedText(256)).max(32).optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeToolParam = z.infer<typeof AgentMemoryKnowledgeToolParamSchema>;

export const AgentMemoryKnowledgeToolDescriptorSchema = z.object({
  name: AgentMemoryKnowledgeToolNameSchema,
  description: boundedText(4_096),
  params: z.record(AgentMemoryKnowledgeToolNameSchema, AgentMemoryKnowledgeToolParamSchema).refine((value) => Object.keys(value).length <= 32, 'too many tool params'),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeToolDescriptor = z.infer<typeof AgentMemoryKnowledgeToolDescriptorSchema>;

export const AGENT_MEMORY_KNOWLEDGE_TOOLS_SCHEMA_VERSION = 'ready4vibe_agent_memory_knowledge_tools_v1' as const;
export const AgentMemoryKnowledgeListRequestSchema = z.object({
  knowledgeId: z.string().min(1).max(128).regex(SAFE_ID),
  signal: z.custom<AbortSignal>().optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeListRequest = z.infer<typeof AgentMemoryKnowledgeListRequestSchema>;

const knowledgeParamValueSchema = z.union([
  z.string().max(16_384).regex(CONTROL_TEXT),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(2_048).regex(CONTROL_TEXT)).max(64),
]);

export const AgentMemoryKnowledgeCallRequestSchema = z.object({
  knowledgeId: z.string().min(1).max(128).regex(SAFE_ID),
  toolName: AgentMemoryKnowledgeToolNameSchema,
  params: z.record(AgentMemoryKnowledgeToolNameSchema, knowledgeParamValueSchema).refine((value) => Object.keys(value).length <= 32, 'too many tool params'),
  maxItems: z.number().int().positive().max(64),
  maxBytes: z.number().int().positive().max(128 * 1024),
  signal: z.custom<AbortSignal>().optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeCallRequest = z.infer<typeof AgentMemoryKnowledgeCallRequestSchema>;

export const AgentMemoryKnowledgeErrorCodeSchema = z.enum(['disabled', 'unavailable', 'timeout', 'aborted', 'protocol', 'schema', 'forbidden', 'too-large', 'privacy']);
export type AgentMemoryKnowledgeErrorCode = z.infer<typeof AgentMemoryKnowledgeErrorCodeSchema>;

export const AgentMemoryKnowledgeToolListSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_KNOWLEDGE_TOOLS_SCHEMA_VERSION),
  knowledgeId: z.string().min(1).max(128).regex(SAFE_ID),
  resourceType: AgentMemoryKnowledgeResourceTypeSchema,
  name: boundedText(256),
  summary: z.string().max(4_096).regex(CONTROL_TEXT).nullable(),
  status: boundedText(128),
  tools: z.array(AgentMemoryKnowledgeToolDescriptorSchema).max(32),
  sourceRevision: z.string().min(1).max(128).regex(SAFE_ID).nullable(),
  elapsedMs: z.number().int().nonnegative().max(60_000),
  degraded: z.boolean(),
  errorCode: AgentMemoryKnowledgeErrorCodeSchema.nullable(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeToolList = z.infer<typeof AgentMemoryKnowledgeToolListSchema>;

export const AGENT_MEMORY_KNOWLEDGE_RESULT_SCHEMA_VERSION = 'ready4vibe_agent_memory_knowledge_result_v1' as const;
export const AgentMemoryKnowledgeResultSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_KNOWLEDGE_RESULT_SCHEMA_VERSION),
  knowledgeId: z.string().min(1).max(128).regex(SAFE_ID),
  toolName: AgentMemoryKnowledgeToolNameSchema,
  items: z.array(AgentMemoryItemSchema).max(64),
  sourceRevision: z.string().min(1).max(128).regex(SAFE_ID).nullable(),
  elapsedMs: z.number().int().nonnegative().max(60_000),
  degraded: z.boolean(),
  errorCode: AgentMemoryKnowledgeErrorCodeSchema.nullable(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeResult = z.infer<typeof AgentMemoryKnowledgeResultSchema>;

export interface AgentMemoryKnowledgeProvider {
  readonly id: 'tencentdb-memory-knowledge';
  status(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  listTools(request: AgentMemoryKnowledgeListRequest): Promise<AgentMemoryKnowledgeToolList>;
  call(request: AgentMemoryKnowledgeCallRequest): Promise<AgentMemoryKnowledgeResult>;
  retrieve(request: AgentMemoryKnowledgeCallRequest): Promise<AgentMemoryKnowledgeResult>;
  close(): Promise<void>;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findAgentMemoryPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}
