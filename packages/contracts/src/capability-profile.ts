import { z } from 'zod';

export const CAPABILITY_PROFILE_SCHEMA_VERSION = 'ready4vibe_capability_profile_v1' as const;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/]|$))/u;
const SECRET_SHAPED_VALUE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|bearer|password|secret|credential)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9]{12,})/iu;

const OpaqueIdSchema = z.string().min(1).max(128).regex(OPAQUE_ID).regex(CONTROL_TEXT)
  .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute paths are not allowed')
  .refine((value) => !SECRET_SHAPED_VALUE.test(value), 'secret-shaped values are not allowed');

const TimestampSchema = z.string().datetime({ offset: true }).max(64)
  .refine((value) => Number.isFinite(Date.parse(value)), 'updatedAt must be an ISO timestamp');

export const CapabilityProfileIdSchema = z.enum([
  'preview',
  'workspace-coding',
  'advanced-local',
  'custom',
]);
export type CapabilityProfileId = z.infer<typeof CapabilityProfileIdSchema>;

/** Transport selects a connection path only; it never grants capability. */
export const CapabilityTransportModeSchema = z.enum(['loopback', 'lan-tls', 'tailscale', 'ssh']);
export type CapabilityTransportMode = z.infer<typeof CapabilityTransportModeSchema>;

export const CapabilityModelModeSchema = z.enum(['off', 'fake', 'configured']);
export type CapabilityModelMode = z.infer<typeof CapabilityModelModeSchema>;

export const CapabilityFilesystemModeSchema = z.enum(['off', 'workspace-read', 'workspace-write']);
export type CapabilityFilesystemMode = z.infer<typeof CapabilityFilesystemModeSchema>;

export const CapabilityShellModeSchema = z.enum(['off', 'external-sandbox', 'host-restricted']);
export type CapabilityShellMode = z.infer<typeof CapabilityShellModeSchema>;

export const CapabilityNetworkModeSchema = z.enum(['off', 'restricted', 'enabled']);
export type CapabilityNetworkMode = z.infer<typeof CapabilityNetworkModeSchema>;

export const CapabilityMcpSkillModeSchema = z.enum(['off', 'configured']);
export type CapabilityMcpSkillMode = z.infer<typeof CapabilityMcpSkillModeSchema>;

export const CapabilityApprovalModeSchema = z.enum(['none', 'on-request', 'bounded-auto', 'explicit']);
export type CapabilityApprovalMode = z.infer<typeof CapabilityApprovalModeSchema>;

export const CapabilityProfileSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_PROFILE_SCHEMA_VERSION),
  profileId: CapabilityProfileIdSchema,
  transportMode: CapabilityTransportModeSchema,
  workspaceId: OpaqueIdSchema.optional(),
  modelMode: CapabilityModelModeSchema,
  filesystemMode: CapabilityFilesystemModeSchema,
  shellMode: CapabilityShellModeSchema,
  networkMode: CapabilityNetworkModeSchema,
  mcpSkillMode: CapabilityMcpSkillModeSchema,
  approvalMode: CapabilityApprovalModeSchema,
  sandboxRef: OpaqueIdSchema.optional(),
  policyRevision: OpaqueIdSchema,
  requiresAcknowledgement: z.boolean(),
  updatedAt: TimestampSchema,
}).strict().superRefine((value, context) => {
  if (value.networkMode === 'enabled' && !value.requiresAcknowledgement) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requiresAcknowledgement'], message: 'enabled network requires acknowledgement' });
  }
  if (value.shellMode === 'host-restricted' && !value.requiresAcknowledgement) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requiresAcknowledgement'], message: 'host-restricted shell requires acknowledgement' });
  }
  if (value.shellMode === 'external-sandbox' && !value.sandboxRef) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sandboxRef'], message: 'external-sandbox requires a sandboxRef' });
  }
  if (value.profileId === 'preview' && value.shellMode !== 'off') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['shellMode'], message: 'preview cannot enable shell' });
  }
  if (value.profileId === 'preview' && value.networkMode !== 'off') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['networkMode'], message: 'preview cannot enable network' });
  }
  if (value.profileId === 'preview' && value.mcpSkillMode !== 'off') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mcpSkillMode'], message: 'preview cannot enable MCP or Skill' });
  }
});
export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

export function parseCapabilityProfile(input: unknown): CapabilityProfile {
  return CapabilityProfileSchema.parse(input);
}
