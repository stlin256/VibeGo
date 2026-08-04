import { z } from 'zod';

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const CAPABILITY_REFERENCE = /^[a-z0-9][a-z0-9._-]{0,63}\/(?:tool|resource|prompt)\/[a-z0-9][a-z0-9._-]{0,63}@\d+\.\d+\.\d+$/u;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token|environment|env|command|argv)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const URL_VALUE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;

export const MCP_SETTINGS_SCHEMA_VERSION = 'ready4vibe_mcp_settings_v1' as const;
export const MCP_SETTINGS_STATUS_SCHEMA_VERSION = 'ready4vibe_mcp_settings_status_v0' as const;
export const MCP_SETTINGS_PROBE_RESULT_SCHEMA_VERSION = 'ready4vibe_mcp_probe_result_v0' as const;

const McpSettingsFieldsSchema = z.object({
  enabled: z.boolean(),
  serverId: z.string().min(1).max(64).regex(SAFE_ID),
  serverVersion: z.string().min(1).max(32).regex(VERSION),
  transport: z.enum(['stdio', 'streamable-http']),
  endpointLabel: z.string().min(1).max(256).regex(CONTROL_TEXT),
  manifestRevision: z.string().min(1).max(128).regex(REVISION),
  capabilityAllowlist: z.array(z.string().regex(CAPABILITY_REFERENCE)).max(128),
}).strict();

export const McpSettingsSchema = McpSettingsFieldsSchema
  .extend({ schemaVersion: z.literal(MCP_SETTINGS_SCHEMA_VERSION) })
  .strict()
  .superRefine(addPrivacyIssues);
export type McpSettings = z.infer<typeof McpSettingsSchema>;

export const McpSettingsPatchSchema = McpSettingsFieldsSchema.partial().strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'at least one MCP setting is required' });
  addPrivacyIssues(value, context);
});
export type McpSettingsPatch = z.infer<typeof McpSettingsPatchSchema>;

export const McpSettingsHealthSchema = z.enum(['failed', 'healthy-connectivity-only', 'healthy-verified']);
export type McpSettingsHealth = z.infer<typeof McpSettingsHealthSchema>;

export const McpSettingsStatusKindSchema = z.enum(['disabled', 'starting', 'ready', 'degraded']);
export type McpSettingsStatusKind = z.infer<typeof McpSettingsStatusKindSchema>;

export const McpSettingsErrorCodeSchema = z.enum(['disabled', 'unavailable', 'timeout', 'protocol', 'schema', 'not-allowed', 'auth', 'config']);
export type McpSettingsErrorCode = z.infer<typeof McpSettingsErrorCodeSchema>;

export const McpSettingsNextActionSchema = z.enum(['enable', 'probe', 'review-capabilities', 'none']);
export type McpSettingsNextAction = z.infer<typeof McpSettingsNextActionSchema>;

export const McpSettingsStatusSchema = z.object({
  schemaVersion: z.literal(MCP_SETTINGS_STATUS_SCHEMA_VERSION),
  settings: McpSettingsSchema,
  status: McpSettingsStatusKindSchema,
  health: McpSettingsHealthSchema.nullable(),
  available: z.boolean(),
  degraded: z.boolean(),
  currentRevision: z.string().min(1).max(128).regex(REVISION).nullable(),
  previousRevision: z.string().min(1).max(128).regex(REVISION).nullable(),
  capabilityCount: z.number().int().nonnegative().max(128),
  lastHealthAt: z.string().datetime({ offset: true }).nullable(),
  lastErrorCode: McpSettingsErrorCodeSchema.nullable(),
  nextAction: McpSettingsNextActionSchema,
}).strict().superRefine(addPrivacyIssues);
export type McpSettingsStatus = z.infer<typeof McpSettingsStatusSchema>;

export const McpSettingsProbeResultSchema = z.object({
  schemaVersion: z.literal(MCP_SETTINGS_PROBE_RESULT_SCHEMA_VERSION),
  serverId: z.string().min(1).max(64).regex(SAFE_ID),
  manifestRevision: z.string().min(1).max(128).regex(REVISION),
  health: McpSettingsHealthSchema,
  currentRevision: z.string().min(1).max(128).regex(REVISION).nullable(),
  previousRevision: z.string().min(1).max(128).regex(REVISION).nullable(),
  capabilityCount: z.number().int().nonnegative().max(128),
}).strict().superRefine(addPrivacyIssues);
export type McpSettingsProbeResult = z.infer<typeof McpSettingsProbeResultSchema>;

export function parseMcpSettings(value: unknown): McpSettings {
  return McpSettingsSchema.parse(value);
}

export function parseMcpSettingsPatch(value: unknown): McpSettingsPatch {
  return McpSettingsPatchSchema.parse(value);
}

export function parseMcpSettingsStatus(value: unknown): McpSettingsStatus {
  return McpSettingsStatusSchema.parse(value);
}

export function parseMcpSettingsProbeResult(value: unknown): McpSettingsProbeResult {
  return McpSettingsProbeResultSchema.parse(value);
}

function addPrivacyIssues(value: unknown, context: z.RefinementCtx): void {
  for (const violation of findMcpSettingsPrivacyViolations(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: violation });
}

function findMcpSettingsPrivacyViolations(value: unknown, path: readonly string[] = []): string[] {
  const violations: string[] = [];
  if (typeof value === 'string') {
    if (URL_VALUE.test(value)) violations.push(`${path.join('.')} must not contain a URL`);
    if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value)) violations.push(`${path.join('.')} must not contain an absolute path`);
    if (SECRET_VALUE.test(value)) violations.push(`${path.join('.')} must not contain a secret-shaped value`);
    return violations;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) => violations.push(...findMcpSettingsPrivacyViolations(child, [...path, String(index)])));
    return violations;
  }
  if (typeof value !== 'object' || value === null) return violations;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) violations.push(`${[...path, key].join('.')} is not allowed`);
    violations.push(...findMcpSettingsPrivacyViolations(child, [...path, key]));
  }
  return violations;
}
