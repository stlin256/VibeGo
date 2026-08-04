import { z } from 'zod';
import {
  AgentMemoryKnowledgeErrorCodeSchema,
  AgentMemoryKnowledgeResourceTypeSchema,
  AgentMemoryKnowledgeToolNameSchema,
  type AgentMemoryKnowledgeErrorCode,
  type AgentMemoryKnowledgeResourceType,
} from './agent-memory-knowledge.js';
import { findAgentMemoryPrivacyViolations } from './agent-memory.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;

export const AGENT_MEMORY_KNOWLEDGE_SETTINGS_SCHEMA_VERSION = 'ready4vibe_agent_memory_knowledge_settings_v1' as const;
export const AGENT_MEMORY_KNOWLEDGE_SETTINGS_STATUS_SCHEMA_VERSION = 'ready4vibe_agent_memory_knowledge_settings_status_v0' as const;

const AgentMemoryKnowledgeSettingsFieldsSchema = z.object({
  enabled: z.boolean(),
  knowledgeId: z.string().min(1).max(128).regex(SAFE_ID),
  autoRetrieve: z.boolean(),
  maxItems: z.number().int().min(1).max(64),
  maxBytes: z.number().int().min(256).max(128 * 1024),
  timeoutMs: z.number().int().min(50).max(10_000),
}).strict();

export const AgentMemoryKnowledgeSettingsSchema = AgentMemoryKnowledgeSettingsFieldsSchema.extend({
  schemaVersion: z.literal(AGENT_MEMORY_KNOWLEDGE_SETTINGS_SCHEMA_VERSION),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeSettings = z.infer<typeof AgentMemoryKnowledgeSettingsSchema>;

export const AgentMemoryKnowledgeSettingsPatchSchema = AgentMemoryKnowledgeSettingsFieldsSchema.partial().strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one knowledge setting is required' });
  addPrivacyIssues(value, context);
});
export type AgentMemoryKnowledgeSettingsPatch = z.infer<typeof AgentMemoryKnowledgeSettingsPatchSchema>;

export const AgentMemoryKnowledgeSettingsToolSchema = z.object({
  name: AgentMemoryKnowledgeToolNameSchema,
  description: z.string().min(1).max(4_096).regex(CONTROL_TEXT),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeSettingsTool = z.infer<typeof AgentMemoryKnowledgeSettingsToolSchema>;

export const AgentMemoryKnowledgeSettingsStatusSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_KNOWLEDGE_SETTINGS_STATUS_SCHEMA_VERSION),
  settings: AgentMemoryKnowledgeSettingsSchema,
  available: z.boolean(),
  degraded: z.boolean(),
  resourceType: AgentMemoryKnowledgeResourceTypeSchema.nullable(),
  resourceName: z.string().min(1).max(256).regex(CONTROL_TEXT).nullable(),
  sourceRevision: z.string().min(1).max(128).regex(SAFE_ID).nullable(),
  tools: z.array(AgentMemoryKnowledgeSettingsToolSchema).max(32),
  lastHealthAt: z.string().datetime({ offset: true }).nullable(),
  lastErrorCode: AgentMemoryKnowledgeErrorCodeSchema.nullable(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryKnowledgeSettingsStatus = z.infer<typeof AgentMemoryKnowledgeSettingsStatusSchema>;

export interface AgentMemoryKnowledgeRunSnapshot {
  readonly provider: import('./agent-memory-knowledge.js').AgentMemoryKnowledgeProvider;
  readonly knowledgeId: string;
  readonly maxItems: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly sourceRevision: string | null;
  readonly dispose: () => Promise<void>;
}

export function parseAgentMemoryKnowledgeSettings(value: unknown): AgentMemoryKnowledgeSettings {
  return AgentMemoryKnowledgeSettingsSchema.parse(value);
}

export function parseAgentMemoryKnowledgeSettingsPatch(value: unknown): AgentMemoryKnowledgeSettingsPatch {
  return AgentMemoryKnowledgeSettingsPatchSchema.parse(value);
}

export function parseAgentMemoryKnowledgeSettingsStatus(value: unknown): AgentMemoryKnowledgeSettingsStatus {
  return AgentMemoryKnowledgeSettingsStatusSchema.parse(value);
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findAgentMemoryPrivacyViolations(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
}

export type AgentMemoryKnowledgeSettingsResource = {
  readonly resourceType: AgentMemoryKnowledgeResourceType | null;
  readonly resourceName: string | null;
  readonly sourceRevision: string | null;
  readonly tools: readonly AgentMemoryKnowledgeSettingsTool[];
};

export type AgentMemoryKnowledgeSettingsErrorCode = AgentMemoryKnowledgeErrorCode;
