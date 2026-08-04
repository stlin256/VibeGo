import { describe, expect, it } from 'vitest';
import { MODEL_SETTINGS_PROFILE_SCHEMA_VERSION, ModelCapabilitySnapshotSchema, ModelEndpointProfileSchema, ModelProbeResultSchema, ModelProviderDescriptorSchema, ModelSettingsProfileSchema, ModelSetupSessionSchema, parseModelEndpointProfile, parseModelProbeResult, parseModelSettingsProfile } from './model-provider-onboarding.js';

const endpoint = {
  schemaVersion: 'ready4vibe_model_endpoint_profile_v1',
  providerId: 'deepseek',
  kind: 'cloud' as const,
  protocol: 'openai-compatible' as const,
  endpointPolicy: { kind: 'explicit-url' as const, baseUrl: 'https://api.deepseek.com' },
  modelHint: 'deepseek-v4-flash',
  credentialRef: { schemaVersion: 'ready4vibe_model_credential_ref_v1' as const, store: 'process' as const, ref: 'process.deepseek_primary' },
};

const capabilities = {
  schemaVersion: 'ready4vibe_model_capability_snapshot_v1' as const,
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  descriptorRevision: 'deepseek-20260805',
  capturedAt: '2026-08-05T00:00:00.000Z',
  streaming: true,
  toolCalls: 'unknown' as const,
  vision: false,
  embeddings: 'unknown' as const,
  contextLimit: 'unknown' as const,
  outputLimit: 4096,
};

describe('model provider onboarding contracts', () => {
  it('accepts a secret-free DeepSeek endpoint profile and unknown capabilities', () => {
    expect(parseModelEndpointProfile(endpoint)).toMatchObject({ providerId: 'deepseek', modelHint: 'deepseek-v4-flash' });
    expect(ModelCapabilitySnapshotSchema.parse(capabilities)).toMatchObject({ toolCalls: 'unknown', contextLimit: 'unknown' });
    expect(JSON.stringify(endpoint)).not.toContain('sk-');
  });

  it('rejects API keys, query-token endpoints and unknown fields', () => {
    expect(() => ModelEndpointProfileSchema.parse({ ...endpoint, apiKey: 'sk-secret' })).toThrow();
    expect(() => ModelEndpointProfileSchema.parse({ ...endpoint, endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com?token=secret' } })).toThrow();
    expect(() => ModelProviderDescriptorSchema.parse({
      schemaVersion: 'ready4vibe_model_provider_descriptor_v1', providerId: 'deepseek', displayName: 'DeepSeek', kind: 'cloud', protocol: 'openai-compatible', endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com' }, credentialModes: ['credential-ref'], capabilities: { streaming: true, toolCalls: true, structuredOutput: false, reasoning: false, promptCaching: false, audioInput: false, audioOutput: false }, maintenance: 'maintained', revision: 'r1', extra: true,
    })).toThrow();
  });

  it('accepts only restart-safe endpoint metadata and rejects secret-shaped additions', () => {
    const profile = {
      schemaVersion: MODEL_SETTINGS_PROFILE_SCHEMA_VERSION,
      providerId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      modelName: 'deepseek-v4-flash',
      profileRevision: 'settings-1',
      updatedAt: '2026-08-05T00:00:00.000Z',
    };
    expect(parseModelSettingsProfile(profile)).toEqual(profile);
    expect(() => ModelSettingsProfileSchema.parse({ ...profile, apiKey: 'sk-never-store' })).toThrow();
    expect(() => ModelSettingsProfileSchema.parse({ ...profile, baseUrl: 'https://api.deepseek.com?token=secret' })).toThrow();
    expect(() => ModelSettingsProfileSchema.parse({ ...profile, baseUrl: 'C:\\models\\endpoint' })).toThrow();
  });

  it('keeps probe status bounded and distinguishes ready, degraded and blocked', () => {
    expect(parseModelProbeResult({ schemaVersion: 'ready4vibe_model_probe_result_v1', status: 'ready', checkedAt: '2026-08-05T00:00:00.000Z', latencyMs: 42, revision: 'r1', errorCode: null, capabilities })).toMatchObject({ status: 'ready', latencyMs: 42 });
    expect(() => ModelProbeResultSchema.parse({ schemaVersion: 'ready4vibe_model_probe_result_v1', status: 'ready', checkedAt: '2026-08-05T00:00:00.000Z', latencyMs: 42, revision: 'r1', errorCode: 'auth-rejected', capabilities })).toThrow(/errorCode/iu);
    expect(() => ModelProbeResultSchema.parse({ schemaVersion: 'ready4vibe_model_probe_result_v1', status: 'blocked', checkedAt: '2026-08-05T00:00:00.000Z', latencyMs: null, revision: null, errorCode: null, capabilities: null })).toThrow(/errorCode/iu);
  });

  it('requires a hashed setup nonce and rejects absolute paths in setup metadata', () => {
    expect(ModelSetupSessionSchema.parse({ schemaVersion: 'ready4vibe_model_setup_session_v1', sessionId: 'setup_1', step: 'probe', providerId: 'deepseek', csrfNonceHash: `sha256:${'a'.repeat(64)}`, expiresAt: '2026-08-05T00:00:00.000Z' })).toMatchObject({ step: 'probe' });
    expect(() => ModelSetupSessionSchema.parse({ schemaVersion: 'ready4vibe_model_setup_session_v1', sessionId: 'C:\\private\\setup', step: 'probe', csrfNonceHash: `sha256:${'a'.repeat(64)}`, expiresAt: '2026-08-05T00:00:00.000Z' })).toThrow();
    expect(() => ModelSetupSessionSchema.parse({ schemaVersion: 'ready4vibe_model_setup_session_v1', sessionId: 'setup_1', step: 'probe', csrfNonceHash: 'raw-token', expiresAt: '2026-08-05T00:00:00.000Z' })).toThrow();
  });
});
