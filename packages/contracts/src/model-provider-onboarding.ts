import { z } from 'zod';
import { ProviderCapabilitySchema, ProviderEndpointPolicySchema, ProviderProtocolSchema } from './provider-usage.js';

export const MODEL_PROVIDER_ONBOARDING_SCHEMA_VERSION = 'ready4vibe_model_provider_onboarding_v1' as const;
export const MODEL_SETTINGS_PROFILE_SCHEMA_VERSION = 'ready4vibe_model_settings_profile_v1' as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;

const IdSchema = z.string().min(1).max(128).regex(SAFE_ID).regex(CONTROL_TEXT);
const LabelSchema = z.string().min(1).max(256).regex(SAFE_LABEL).regex(CONTROL_TEXT);
const RevisionSchema = z.string().min(1).max(128).regex(SAFE_REVISION).regex(CONTROL_TEXT);
const TimestampSchema = z.string().datetime({ offset: true }).max(64);
const UnknownOrPositiveIntSchema = z.union([z.literal('unknown'), z.number().int().positive().max(10_000_000)]);
const UnknownOrBooleanSchema = z.union([z.literal('unknown'), z.boolean()]);
const DurableEndpointSchema = z.string().min(1).max(2_048).regex(CONTROL_TEXT)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
    } catch {
      return false;
    }
  }, 'durable model endpoint must be HTTPS without credentials, query parameters or fragments');

export const ModelProviderKindSchema = z.enum(['local', 'cloud', 'custom']);
export type ModelProviderKind = z.infer<typeof ModelProviderKindSchema>;

export const ModelCredentialRefSchema = z.object({
  schemaVersion: z.literal('ready4vibe_model_credential_ref_v1'),
  store: z.enum(['os-keychain', 'secret-store', 'environment', 'process']),
  ref: z.string().min(8).max(256).regex(/^(?:secret|env|process)\.[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u).regex(CONTROL_TEXT),
}).strict();
export type ModelCredentialRef = z.infer<typeof ModelCredentialRefSchema>;

export const ModelProviderDescriptorSchema = z.object({
  schemaVersion: z.literal('ready4vibe_model_provider_descriptor_v1'),
  providerId: IdSchema,
  displayName: LabelSchema,
  kind: ModelProviderKindSchema,
  protocol: ProviderProtocolSchema,
  endpointPolicy: ProviderEndpointPolicySchema,
  credentialModes: z.array(z.enum(['none', 'credential-ref', 'environment-ref'])).max(3),
  capabilities: ProviderCapabilitySchema,
  maintenance: z.enum(['maintained', 'community', 'experimental']),
  revision: RevisionSchema,
}).strict();
export type ModelProviderDescriptor = z.infer<typeof ModelProviderDescriptorSchema>;

export const ModelEndpointProfileSchema = z.object({
  schemaVersion: z.literal('ready4vibe_model_endpoint_profile_v1'),
  providerId: IdSchema,
  kind: ModelProviderKindSchema,
  protocol: ProviderProtocolSchema,
  endpointPolicy: ProviderEndpointPolicySchema,
  modelHint: LabelSchema,
  credentialRef: ModelCredentialRefSchema.optional(),
}).strict();
export type ModelEndpointProfile = z.infer<typeof ModelEndpointProfileSchema>;

/** Restart-safe model metadata; credentials are deliberately not representable. */
export const ModelSettingsProfileSchema = z.object({
  schemaVersion: z.literal(MODEL_SETTINGS_PROFILE_SCHEMA_VERSION),
  providerId: IdSchema,
  baseUrl: DurableEndpointSchema,
  modelName: LabelSchema,
  profileRevision: RevisionSchema,
  updatedAt: TimestampSchema,
}).strict();
export type ModelSettingsProfile = z.infer<typeof ModelSettingsProfileSchema>;

export const ModelCapabilitySnapshotSchema = z.object({
  schemaVersion: z.literal('ready4vibe_model_capability_snapshot_v1'),
  providerId: IdSchema,
  modelId: LabelSchema,
  descriptorRevision: RevisionSchema,
  capturedAt: TimestampSchema,
  streaming: UnknownOrBooleanSchema,
  toolCalls: UnknownOrBooleanSchema,
  vision: UnknownOrBooleanSchema,
  embeddings: UnknownOrBooleanSchema,
  contextLimit: UnknownOrPositiveIntSchema,
  outputLimit: UnknownOrPositiveIntSchema,
}).strict();
export type ModelCapabilitySnapshot = z.infer<typeof ModelCapabilitySnapshotSchema>;

export const ModelProbeErrorCodeSchema = z.enum([
  'provider-unreachable',
  'tls-invalid',
  'auth-rejected',
  'model-not-found',
  'protocol-mismatch',
  'streaming-unsupported',
  'tool-call-unsupported',
  'context-limit-unknown',
  'rate-limited',
  'quota-unknown',
  'local-runtime-missing',
  'model-download-required',
  'credential-store-unavailable',
]);
export type ModelProbeErrorCode = z.infer<typeof ModelProbeErrorCodeSchema>;

export const ModelProbeResultSchema = z.object({
  schemaVersion: z.literal('ready4vibe_model_probe_result_v1'),
  status: z.enum(['ready', 'degraded', 'blocked']),
  checkedAt: TimestampSchema,
  latencyMs: z.number().int().nonnegative().max(120_000).nullable(),
  revision: RevisionSchema.nullable(),
  errorCode: ModelProbeErrorCodeSchema.nullable(),
  capabilities: ModelCapabilitySnapshotSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.status === 'ready' && value.errorCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['errorCode'], message: 'ready probe cannot contain an errorCode' });
  if (value.status === 'blocked' && !value.errorCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['errorCode'], message: 'blocked probe requires an errorCode' });
  if (value.status === 'ready' && !value.capabilities) context.addIssue({ code: z.ZodIssueCode.custom, path: ['capabilities'], message: 'ready probe requires capabilities' });
});
export type ModelProbeResult = z.infer<typeof ModelProbeResultSchema>;

export const ModelSetupStepSchema = z.enum(['source', 'provider', 'endpoint', 'credential', 'probe', 'model', 'test', 'complete']);
export type ModelSetupStep = z.infer<typeof ModelSetupStepSchema>;

export const ModelSetupSessionSchema = z.object({
  schemaVersion: z.literal('ready4vibe_model_setup_session_v1'),
  sessionId: IdSchema,
  step: ModelSetupStepSchema,
  providerId: IdSchema.optional(),
  csrfNonceHash: z.string().regex(SHA256),
  expiresAt: TimestampSchema,
}).strict();
export type ModelSetupSession = z.infer<typeof ModelSetupSessionSchema>;

export function parseModelProviderDescriptor(input: unknown): ModelProviderDescriptor {
  return ModelProviderDescriptorSchema.parse(input);
}

export function parseModelEndpointProfile(input: unknown): ModelEndpointProfile {
  return ModelEndpointProfileSchema.parse(input);
}

export function parseModelSettingsProfile(input: unknown): ModelSettingsProfile {
  return ModelSettingsProfileSchema.parse(input);
}

export function parseModelCapabilitySnapshot(input: unknown): ModelCapabilitySnapshot {
  return ModelCapabilitySnapshotSchema.parse(input);
}

export function parseModelProbeResult(input: unknown): ModelProbeResult {
  return ModelProbeResultSchema.parse(input);
}

export function parseModelSetupSession(input: unknown): ModelSetupSession {
  return ModelSetupSessionSchema.parse(input);
}
