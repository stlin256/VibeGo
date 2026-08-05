import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
  DEEPSEEK_PROVIDER_SCHEMA_VERSION,
  DeepSeekCapabilityDescriptorSchema,
  DeepSeekCapabilitySnapshotSchema,
  DeepSeekConfigSchema,
  DeepSeekErrorCodeSchema,
  DeepSeekProbeResultSchema,
  DeepSeekReviewRequestSchema,
  DeepSeekRunSnapshotSchema,
  DeepSeekSearchItemSchema,
  DeepSeekSettingsProfileSchema,
  DeepSeekSettingsStatusSchema,
  findDeepSeekPrivacyViolations,
} from './deepseek-provider.js';

const baseConfig = {
  schemaVersion: DEEPSEEK_PROVIDER_SCHEMA_VERSION,
  providerId: 'deepseek',
  endpointProfile: 'openai-chat-completions' as const,
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-v4-flash',
  authRef: 'secret.deepseek.primary',
  thinkingMode: 'auto' as const,
  toolCalling: 'enabled' as const,
  webSearch: 'off' as const,
  reviewer: 'off' as const,
  timeoutMs: 30_000,
  maxRetries: 2,
  maxOutputTokens: 4_096,
  revision: 'deepseek-config-1',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

const baseCapabilities = {
  schemaVersion: 'deepseek-provider-capability/v1' as const,
  providerId: 'deepseek',
  endpointProfile: 'openai-chat-completions' as const,
  model: 'deepseek-v4-flash',
  descriptorRevision: 'probe-1',
  capturedAt: '2026-08-05T10:00:00.000Z',
  status: 'ready' as const,
  streaming: true,
  toolCalls: true,
  structuredOutput: false,
  reasoning: true,
  usage: true,
  webSearch: false,
  contextLimit: 1_000_000,
  outputLimit: 8_192,
  degradedReason: null,
};

describe('DeepSeek provider/v1 contracts', () => {
  it('accepts a strict secret-reference config for each explicit endpoint profile', () => {
    for (const [endpointProfile, endpoint] of [
      ['openai-chat-completions', 'https://api.deepseek.com/v1/chat/completions'],
      ['openai-responses', 'https://api.deepseek.com/v1/responses'],
      ['anthropic-messages', 'https://api.deepseek.com/anthropic/v1/messages'],
    ] as const) {
      expect(DeepSeekConfigSchema.parse({ ...baseConfig, endpointProfile, endpoint })).toMatchObject({ endpointProfile });
    }
  });

  it('rejects unknown fields, raw credentials, malformed endpoints, and absolute paths', () => {
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, unknown: true })).toThrow();
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, apiKey: 'sk-' + 'a'.repeat(32) })).toThrow();
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, endpoint: 'https://user:pass@api.deepseek.com/v1/chat/completions' })).toThrow();
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, endpoint: 'C:\\workspace\\chat-completions' })).toThrow();
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, endpoint: 'https://api.deepseek.com/v1/responses' })).toThrow();
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, authRef: 'sk-' + 'a'.repeat(32) })).toThrow();
  });

  it('keeps web search opt-in and only valid for the Responses profile', () => {
    expect(DeepSeekConfigSchema.parse({ ...baseConfig, webSearch: 'off' }).webSearch).toBe('off');
    expect(DeepSeekConfigSchema.parse({
      ...baseConfig,
      endpointProfile: 'openai-responses',
      endpoint: 'https://api.deepseek.com/v1/responses',
      webSearch: 'provider-owned',
    }).webSearch).toBe('provider-owned');
    expect(() => DeepSeekConfigSchema.parse({ ...baseConfig, webSearch: 'provider-owned' })).toThrow();
  });

  it('requires a safe degraded reason and capability snapshot shape', () => {
    expect(DeepSeekCapabilitySnapshotSchema.parse(baseCapabilities).status).toBe('ready');
    expect(DeepSeekCapabilitySnapshotSchema.parse({
      ...baseCapabilities,
      status: 'degraded',
      degradedReason: 'tool calls were not declared by probe',
      contextLimit: 'unknown',
    }).contextLimit).toBe('unknown');
    expect(() => DeepSeekCapabilitySnapshotSchema.parse({ ...baseCapabilities, status: 'degraded', degradedReason: null })).toThrow();
    expect(() => DeepSeekCapabilitySnapshotSchema.parse({ ...baseCapabilities, status: 'ready', degradedReason: 'not ready' })).toThrow();
  });

  it('accepts only an explicit, bounded capability descriptor', () => {
    const descriptor = DeepSeekCapabilityDescriptorSchema.parse({
      schemaVersion: DEEPSEEK_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
      toolCalls: true,
      reasoning: true,
      webSearch: true,
      contextLimit: 100_000,
      outputLimit: 4_096,
    });
    expect(descriptor.reasoning).toBe(true);
    expect(() => DeepSeekCapabilityDescriptorSchema.parse({
      ...descriptor,
      apiKey: 'sk-' + 'a'.repeat(32),
    })).toThrow();
    expect(() => DeepSeekCapabilityDescriptorSchema.parse({
      ...descriptor,
      extra: true,
    })).toThrow();
  });

  it('validates probe status and stable errors without raw provider data', () => {
    expect(DeepSeekProbeResultSchema.parse({
      schemaVersion: 'deepseek-provider-probe/v1',
      status: 'ready',
      checkedAt: '2026-08-05T10:00:00.000Z',
      latencyMs: 42,
      errorCode: null,
      capabilities: baseCapabilities,
    }).status).toBe('ready');
    expect(() => DeepSeekProbeResultSchema.parse({
      schemaVersion: 'deepseek-provider-probe/v1',
      status: 'blocked',
      checkedAt: '2026-08-05T10:00:00.000Z',
      latencyMs: null,
      errorCode: null,
      capabilities: null,
    })).toThrow();
    expect(DeepSeekErrorCodeSchema.options).toContain('DEEPSEEK_HTTP_429');
    expect(() => DeepSeekProbeResultSchema.parse({
      schemaVersion: 'deepseek-provider-probe/v1',
      status: 'blocked',
      checkedAt: '2026-08-05T10:00:00.000Z',
      latencyMs: null,
      errorCode: 'DEEPSEEK_HTTP_401',
      capabilities: null,
      rawResponse: 'Authorization: Bearer secret',
    })).toThrow();
  });

  it('keeps reviewer input bounded and fingerprinted rather than raw', () => {
    const parsed = DeepSeekReviewRequestSchema.parse({
      schemaVersion: 'deepseek-provider-review/v1',
      requestId: 'review-1',
      approvalKey: 'a'.repeat(64),
      toolId: 'filesystem.read',
      risk: 'read-only',
      taskTrust: 'trusted-workspace',
      sandboxMode: 'workspace-write',
      network: 'restricted',
      summary: 'Read a bounded file from the selected workspace.',
    });
    expect(parsed.summary).not.toContain('C:\\');
    expect(() => DeepSeekReviewRequestSchema.parse({
      ...parsed,
      command: 'type C:\\secret\\.env',
    })).toThrow();
  });

  it('maps retrieval items to untrusted, bounded source metadata', () => {
    expect(DeepSeekSearchItemSchema.parse({
      schemaVersion: 'deepseek-provider-search-item/v1',
      source: 'retrieval',
      trust: 'untrusted',
      referenceId: 'search-1',
      title: 'DeepSeek documentation',
      snippet: 'Bounded result text.',
      url: 'https://api.deepseek.com/docs',
    }).trust).toBe('untrusted');
    expect(() => DeepSeekSearchItemSchema.parse({
      schemaVersion: 'deepseek-provider-search-item/v1',
      source: 'retrieval',
      trust: 'trusted',
      referenceId: 'search-1',
      title: 'bad',
      snippet: 'bad',
      url: 'https://example.com',
    })).toThrow();
  });

  it('reports secret-shaped fields, values, and absolute paths recursively', () => {
    expect(findDeepSeekPrivacyViolations({ apiKey: 'sk-' + 'a'.repeat(32) }).length).toBeGreaterThan(0);
    expect(findDeepSeekPrivacyViolations({ nested: { workspace: 'C:\\Users\\someone\\repo' } }).length).toBeGreaterThan(0);
    expect(findDeepSeekPrivacyViolations({ authRef: 'secret.deepseek.primary' })).toEqual([]);
  });

  it('accepts a secret-free immutable run snapshot and rejects credentials in it', () => {
    expect(DeepSeekRunSnapshotSchema.parse({
      schemaVersion: 'deepseek-provider-run/v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-chat-completions',
      endpoint: baseConfig.endpoint,
      model: baseConfig.model,
      thinkingMode: 'high',
      toolCalling: 'enabled',
      webSearch: 'off',
      reviewer: 'off',
      configRevision: 'config-1',
      capabilityRevision: 'probe-1',
      capturedAt: '2026-08-05T10:00:00.000Z',
    }).model).toBe(baseConfig.model);
    expect(() => DeepSeekRunSnapshotSchema.parse({
      schemaVersion: 'deepseek-provider-run/v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-chat-completions',
      endpoint: baseConfig.endpoint,
      model: baseConfig.model,
      thinkingMode: 'auto',
      toolCalling: 'enabled',
      webSearch: 'off',
      reviewer: 'off',
      configRevision: 'config-1',
      capabilityRevision: 'probe-1',
      capturedAt: '2026-08-05T10:00:00.000Z',
      apiKey: 'sk-' + 'a'.repeat(32),
    })).toThrow();
  });

  it('keeps the Web settings profile/status strict and secret-free', () => {
    const profile = DeepSeekSettingsProfileSchema.parse({
      schemaVersion: 'ready4vibe_deepseek_settings_profile_v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-chat-completions',
      endpoint: baseConfig.endpoint,
      model: baseConfig.model,
      thinkingMode: 'auto',
      toolCalling: 'enabled',
      webSearch: 'off',
      reviewer: 'off',
      timeoutMs: 30_000,
      maxRetries: 2,
      maxOutputTokens: 4_096,
      profileRevision: 'deepseek-settings-1',
      updatedAt: '2026-08-05T10:00:00.000Z',
    });
    expect(DeepSeekSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_deepseek_settings_status_v1',
      configured: true,
      providerId: 'deepseek',
      source: 'web-memory',
      credentialState: 'available',
      profile,
      capability: null,
      lastProbe: null,
    }).profile?.profileRevision).toBe('deepseek-settings-1');
    expect(() => DeepSeekSettingsProfileSchema.parse({ ...profile, apiKey: 'sk-' + 'a'.repeat(32) })).toThrow();
    expect(() => DeepSeekSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_deepseek_settings_status_v1', configured: false, providerId: 'deepseek', source: 'durable-profile', credentialState: 'required', profile, capability: null, lastProbe: null, extra: true,
    })).toThrow();
  });
});
