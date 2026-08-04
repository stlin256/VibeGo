import { z } from 'zod';

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u;
const RUN_ID = /^run_[A-Za-z0-9_-]{8,128}$/u;
const GOAL_ID = /^goal_[A-Za-z0-9_-]{8,128}$/u;
const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token|environment|env)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

const boundedText = (max: number) => z.string().min(1).max(max).regex(CONTROL_TEXT);
const safeId = z.string().min(1).max(128).regex(SAFE_ID);
const optionalDateTime = z.string().datetime({ offset: true }).nullable();
const revision = z.string().min(1).max(128).regex(REVISION);
const UPSTREAM_REPOSITORY = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u;
const UPSTREAM_REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/u;

export const AgentMemoryModeSchema = z.enum(['off', 'memory-core', 'proxy', 'full-stack']);
export type AgentMemoryMode = z.infer<typeof AgentMemoryModeSchema>;

export const AgentMemoryProviderIdSchema = z.enum(['none', 'tencentdb-agent-memory']);
export type AgentMemoryProviderId = z.infer<typeof AgentMemoryProviderIdSchema>;

export const AgentMemoryIdentitySchema = z.object({
  teamId: safeId,
  agentId: safeId,
  userId: safeId,
  sessionId: safeId.optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryIdentity = z.infer<typeof AgentMemoryIdentitySchema>;

export const AgentMemoryRecallRequestSchema = z.object({
  identity: AgentMemoryIdentitySchema,
  goalId: z.string().regex(GOAL_ID).optional(),
  runId: z.string().regex(RUN_ID),
  workspaceId: z.string().regex(WORKSPACE_ID).optional(),
  query: boundedText(16_384),
  maxItems: z.number().int().positive().max(64),
  maxBytes: z.number().int().positive().max(128 * 1024),
  /** AbortSignal is an in-process control value and is never serialized. */
  signal: z.custom<AbortSignal>().optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryRecallRequest = z.infer<typeof AgentMemoryRecallRequestSchema>;

export const AgentMemoryItemKindSchema = z.enum(['fact', 'preference', 'decision', 'skill', 'summary', 'knowledge']);
export type AgentMemoryItemKind = z.infer<typeof AgentMemoryItemKindSchema>;
export const AgentMemoryItemSourceSchema = z.enum(['tencentdb-memory-core', 'tencentdb-memory-knowledge']);
export type AgentMemoryItemSource = z.infer<typeof AgentMemoryItemSourceSchema>;
export const AgentMemoryTrustSchema = z.enum(['trusted', 'untrusted']);
export type AgentMemoryTrust = z.infer<typeof AgentMemoryTrustSchema>;

export const AgentMemoryItemSchema = z.object({
  id: safeId,
  content: boundedText(64 * 1024),
  kind: AgentMemoryItemKindSchema,
  score: z.number().finite().min(0).max(1).optional(),
  source: AgentMemoryItemSourceSchema,
  trust: AgentMemoryTrustSchema,
  revision: revision.optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryItem = z.infer<typeof AgentMemoryItemSchema>;

export const AgentMemoryRecallResultSchema = z.object({
  items: z.array(AgentMemoryItemSchema).max(64),
  sourceRevision: revision.nullable(),
  elapsedMs: z.number().int().nonnegative().max(60_000),
  degraded: z.boolean(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryRecallResult = z.infer<typeof AgentMemoryRecallResultSchema>;

export const AgentMemoryOutcomeSchema = z.enum(['completed', 'failed', 'cancelled', 'needs-recovery']);
export type AgentMemoryOutcome = z.infer<typeof AgentMemoryOutcomeSchema>;

const boundedList = (maxItems: number, maxItemBytes: number) => z.array(boundedText(maxItemBytes)).max(maxItems);

export const AgentMemoryWriteRequestSchema = z.object({
  identity: AgentMemoryIdentitySchema,
  goalId: z.string().regex(GOAL_ID).optional(),
  runId: z.string().regex(RUN_ID),
  workspaceId: z.string().regex(WORKSPACE_ID).optional(),
  summary: boundedText(32 * 1024),
  facts: boundedList(64, 2_000).optional(),
  decisions: boundedList(64, 2_000).optional(),
  evidenceRefs: boundedList(64, 512).optional(),
  outcome: AgentMemoryOutcomeSchema,
  sourceRevision: revision.optional(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryWriteRequest = z.infer<typeof AgentMemoryWriteRequestSchema>;

export const AgentMemoryCapabilitySchema = z.enum(['recall', 'write-back', 'proxy', 'knowledge']);
export type AgentMemoryCapability = z.infer<typeof AgentMemoryCapabilitySchema>;

export const AgentMemoryUpdateStateSchema = z.enum(['disabled', 'starting', 'ready', 'degraded', 'updating', 'rollback']);
export type AgentMemoryUpdateState = z.infer<typeof AgentMemoryUpdateStateSchema>;

export const AgentMemoryErrorCodeSchema = z.enum(['disabled', 'unavailable', 'timeout', 'protocol', 'schema', 'build', 'health', 'update', 'rollback']);
export type AgentMemoryErrorCode = z.infer<typeof AgentMemoryErrorCodeSchema>;

export const AgentMemoryStatusSchema = z.object({
  schemaVersion: z.literal('ready4vibe_agent_memory_status_v0'),
  enabled: z.boolean(),
  mode: AgentMemoryModeSchema,
  available: z.boolean(),
  degraded: z.boolean(),
  revision: revision.nullable(),
  previousRevision: revision.nullable(),
  lastHealthAt: optionalDateTime,
  lastUpdateAt: optionalDateTime,
  updateState: AgentMemoryUpdateStateSchema,
  lastErrorCode: AgentMemoryErrorCodeSchema.nullable(),
  capabilities: z.array(AgentMemoryCapabilitySchema).max(16),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemoryStatus = z.infer<typeof AgentMemoryStatusSchema>;

export const AGENT_MEMORY_SETTINGS_SCHEMA_VERSION = 'ready4vibe_agent_memory_settings_v1' as const;
const AgentMemorySettingsFieldsSchema = z.object({
  enabled: z.boolean(),
  mode: AgentMemoryModeSchema,
  teamId: safeId,
  agentId: safeId,
  userId: safeId,
  upstreamRepo: z.string().min(1).max(2_048).regex(UPSTREAM_REPOSITORY),
  upstreamRef: z.string().min(1).max(128).regex(UPSTREAM_REF),
  autoUpdate: z.boolean(),
  updateIntervalMinutes: z.number().int().min(5).max(24 * 60),
  fallbackToDirectProvider: z.boolean(),
}).strict();
export const AgentMemorySettingsSchema = AgentMemorySettingsFieldsSchema.extend({
  schemaVersion: z.literal(AGENT_MEMORY_SETTINGS_SCHEMA_VERSION),
}).strict().superRefine((value, context) => {
  if (value.enabled && value.mode === 'off') context.addIssue({ code: z.ZodIssueCode.custom, message: 'enabled memory must select a non-off mode' });
  addPrivacyIssues(value, context);
});
export type AgentMemorySettings = z.infer<typeof AgentMemorySettingsSchema>;

export const AgentMemorySettingsPatchSchema = AgentMemorySettingsFieldsSchema.partial().strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one agent memory setting is required' });
  addPrivacyIssues(value, context);
});
export type AgentMemorySettingsPatch = z.infer<typeof AgentMemorySettingsPatchSchema>;

export const AGENT_MEMORY_SETTINGS_STATUS_SCHEMA_VERSION = 'ready4vibe_agent_memory_settings_status_v0' as const;
export const AgentMemorySettingsStatusSchema = z.object({
  schemaVersion: z.literal(AGENT_MEMORY_SETTINGS_STATUS_SCHEMA_VERSION),
  settings: AgentMemorySettingsSchema,
  status: AgentMemoryStatusSchema,
  currentRevision: revision.nullable(),
  previousRevision: revision.nullable(),
}).strict().superRefine(addPrivacyIssues);
export type AgentMemorySettingsStatus = z.infer<typeof AgentMemorySettingsStatusSchema>;

export const AgentMemoryWriteResultSchema = z.object({
  accepted: z.boolean(),
  queued: z.boolean(),
}).strict();
export type AgentMemoryWriteResult = z.infer<typeof AgentMemoryWriteResultSchema>;

export interface AgentMemoryProvider {
  readonly id: AgentMemoryProviderId;
  readonly mode: AgentMemoryMode;
  status(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  recall(request: AgentMemoryRecallRequest): Promise<AgentMemoryRecallResult>;
  enqueueWrite(request: AgentMemoryWriteRequest): Promise<AgentMemoryWriteResult>;
  close(): Promise<void>;
}

/** Returns stable, safe privacy violations for memory requests and results. */
export function findAgentMemoryPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) violations.push(`secret-shaped content is not allowed at ${path.join('.') || '<root>'}`);
    if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) {
      violations.push(`absolute path is not allowed at ${path.join('.') || '<root>'}`);
    }
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => violations.push(...findAgentMemoryPrivacyViolations(item, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (SECRET_KEY.test(key)) violations.push(`secret-shaped field is not allowed at ${nextPath.join('.')}`);
    violations.push(...findAgentMemoryPrivacyViolations(child, nextPath));
  }
  return violations;
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findAgentMemoryPrivacyViolations(value)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
  }
}

export function parseAgentMemoryIdentity(value: unknown): AgentMemoryIdentity {
  return AgentMemoryIdentitySchema.parse(value);
}

export function parseAgentMemoryRecallRequest(value: unknown): AgentMemoryRecallRequest {
  return AgentMemoryRecallRequestSchema.parse(value);
}

export function parseAgentMemoryItem(value: unknown): AgentMemoryItem {
  return AgentMemoryItemSchema.parse(value);
}

export function parseAgentMemoryRecallResult(value: unknown): AgentMemoryRecallResult {
  return AgentMemoryRecallResultSchema.parse(value);
}

export function parseAgentMemoryWriteRequest(value: unknown): AgentMemoryWriteRequest {
  return AgentMemoryWriteRequestSchema.parse(value);
}

export function parseAgentMemoryStatus(value: unknown): AgentMemoryStatus {
  return AgentMemoryStatusSchema.parse(value);
}

export function parseAgentMemorySettings(value: unknown): AgentMemorySettings {
  return AgentMemorySettingsSchema.parse(value);
}

export function parseAgentMemorySettingsPatch(value: unknown): AgentMemorySettingsPatch {
  return AgentMemorySettingsPatchSchema.parse(value);
}

export function parseAgentMemorySettingsStatus(value: unknown): AgentMemorySettingsStatus {
  return AgentMemorySettingsStatusSchema.parse(value);
}
