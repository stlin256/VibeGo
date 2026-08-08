import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore, type SettingsStore } from '@ready4vibe/storage';
import { createModelProvider, InMemoryModelSettingsManager, ModelSettingsError } from './model-config.js';
import { FileSecretStore } from './secret-store.js';

describe('daemon model configuration', () => {
  it('uses a safe unconfigured provider without an API key', async () => {
    const provider = createModelProvider({});
    const events = [];
    for await (const event of provider.stream({
      model: 'unused',
      messages: [],
      tools: [],
      budget: { maxInputTokens: 1, maxOutputTokens: 1 },
      metadata: { runId: 'run_1', turnId: 'turn_1', requestId: 'req_1' },
    }, new AbortController().signal)) events.push(event);
    expect(provider.id).toBe('unconfigured');
    expect(events).toEqual([{ type: 'error', code: 'MODEL_PROVIDER_NOT_CONFIGURED', retryable: false, safeMessage: 'No model provider is configured for this daemon.' }]);
  });

  it('creates an OpenAI-compatible provider from environment values without exposing the key', () => {
    const provider = createModelProvider({
      READY4VIBE_MODEL_API_KEY: 'test-secret',
      READY4VIBE_MODEL_BASE_URL: 'https://api.deepseek.com',
    });
    expect(provider.id).toBe('openai-compatible');
    expect(JSON.stringify({ id: provider.id, capabilities: provider.capabilities })).not.toContain('test-secret');
  });

  it('creates and binds DeepSeek only when the provider choice is explicit', () => {
    const env = {
      READY4VIBE_MODEL_PROVIDER: 'deepseek',
      READY4VIBE_MODEL_API_KEY: 'test-secret',
      READY4VIBE_DEEPSEEK_ENDPOINT: 'https://api.deepseek.com/v1/chat/completions',
      READY4VIBE_MODEL_NAME: 'deepseek-v4-flash',
    };
    const provider = createModelProvider(env);
    expect(provider.id).toBe('deepseek');
    expect(JSON.stringify({ id: provider.id, capabilities: provider.capabilities })).not.toContain('test-secret');
    const manager = new InMemoryModelSettingsManager(env, () => new Date('2026-08-05T10:00:00.000Z'));
    const binding = manager.bindRun({ provider: 'deepseek', name: 'deepseek-v4-flash' });
    expect(binding.deepSeekSnapshot).toMatchObject({
      schemaVersion: 'deepseek-provider-run/v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-chat-completions',
      model: 'deepseek-v4-flash',
      thinkingMode: 'auto',
    });
    expect(JSON.stringify(binding.deepSeekSnapshot)).not.toContain('test-secret');
  });

  it('configures and clears a provider through a secret-free status boundary', () => {
    const manager = new InMemoryModelSettingsManager({});
    expect(manager.status()).toEqual({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured', credentialState: 'none' });
    const status = manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    expect(status).toEqual({ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory', credentialState: 'available' });
    expect(JSON.stringify(status)).not.toContain('test-secret');
    expect(manager.provider.id).toBe('openai-compatible');
    expect(manager.clear()).toEqual({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured', credentialState: 'none' });
    expect(manager.provider.id).toBe('unconfigured');
  });

  it('rejects unsafe input without replacing the active provider', () => {
    const manager = new InMemoryModelSettingsManager({});
    expect(() => manager.configure({ provider: 'openai-compatible', baseUrl: 'http://example.test', apiKey: 'key', model: 'model' })).toThrowError(new ModelSettingsError('INVALID_BASE_URL', 'Provider URL must use HTTPS without credentials or query parameters.'));
    expect(() => manager.configure({ provider: 'openai-compatible', baseUrl: 'https://example.test', apiKey: '', model: 'model' })).toThrowError(new ModelSettingsError('INVALID_API_KEY', 'The provider key is invalid.'));
    expect(manager.status().source).toBe('unconfigured');
  });

  it('provides stable provider snapshots for in-flight runs', () => {
    const manager = new InMemoryModelSettingsManager({});
    const before = manager.provider.snapshot();
    manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    expect(before.id).toBe('unconfigured');
    expect(manager.provider.snapshot().id).toBe('openai-compatible');
  });

  it('binds a requested model to a validated secret-free provider snapshot', () => {
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-04T12:00:00.000Z'));
    manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });

    const binding = manager.bindRun({ provider: 'openai-compatible', name: 'deepseek-v4-flash' });
    expect(binding.provider).toBe(manager.provider.snapshot());
    expect(binding.snapshot).toMatchObject({
      schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
      providerId: 'openai-compatible',
      model: 'deepseek-v4-flash',
      pricingModel: 'deepseek-v4-flash',
      endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com' },
      capturedAt: '2026-08-04T12:00:00.000Z',
    });
    expect(JSON.stringify(binding.snapshot)).not.toContain('test-secret');
  });

  it('fails closed when a configured provider does not match the run selection', () => {
    const manager = new InMemoryModelSettingsManager({});
    manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });

    expect(() => manager.bindRun({ provider: 'anthropic', name: 'claude' })).toThrowError(new ModelSettingsError(
      'INVALID_PROVIDER',
      'The requested model provider is not configured for this daemon.',
    ));
    expect(manager.provider.snapshot().id).toBe('openai-compatible');
  });

  it('rejects secret-shaped or control-character model selections before snapshot creation', () => {
    const manager = new InMemoryModelSettingsManager({});
    expect(() => manager.bindRun({ provider: 'fake', name: 'token=secret-value' })).toThrowError(new ModelSettingsError('INVALID_MODEL', 'The requested model name is invalid.'));
    expect(() => manager.bindRun({ provider: 'fake', name: 'model\nname' })).toThrowError(new ModelSettingsError('INVALID_MODEL', 'The requested model name is invalid.'));
  });

  it('probes only on explicit request, keeps the key out of the result, and does not replace the provider', async () => {
    let calls = 0;
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), async (_input, init) => {
      calls += 1;
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      return new Response(JSON.stringify({ data: [{ id: 'deepseek-v4-flash' }] }), { status: 200 });
    });
    manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    const before = manager.provider.snapshot();
    const result = await manager.probe({ endpoint: 'https://api.deepseek.com/models' });
    expect(result).toMatchObject({ status: 'ready', capabilities: { modelId: 'deepseek-v4-flash' } });
    expect(JSON.stringify(result)).not.toContain('test-secret');
    expect(calls).toBe(1);
    expect(manager.provider.snapshot()).toBe(before);
  });

  it('returns a bounded missing-credential result and rejects unsafe probe input', async () => {
    const manager = new InMemoryModelSettingsManager({});
    await expect(manager.probe({ endpoint: 'https://api.deepseek.com/models' })).resolves.toMatchObject({ status: 'blocked', errorCode: 'credential-store-unavailable' });
    manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    await expect(manager.probe({ endpoint: 'https://api.deepseek.com/models?token=secret' })).rejects.toThrowError(new ModelSettingsError('INVALID_PROBE_ENDPOINT', 'A complete HTTPS model-list endpoint is required.'));
  });

  it('persists only endpoint metadata and restores it as credential-required after restart', () => {
    const settings = new InMemorySettingsStore();
    const first = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings);
    first.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    const stored = settings.get<unknown>('model', 'profile');
    expect(JSON.stringify(stored)).not.toContain('test-secret');
    expect(stored).toMatchObject({ schemaVersion: 'ready4vibe_model_settings_profile_v1', providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash' });

    const restarted = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings);
    expect(restarted.status()).toEqual({ configured: false, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'durable-profile', credentialState: 'required' });
    expect(restarted.provider.id).toBe('unconfigured');
    restarted.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'replacement-secret', model: 'deepseek-v4-flash' });
    expect(settings.get<{ profileRevision: string }>('model', 'profile')?.profileRevision).toBe('settings-2');
  });

  it('does not replace the active provider when durable profile persistence fails', () => {
    const failingSettings: SettingsStore = {
      get: () => undefined,
      set: () => { throw new Error('disk full'); },
      delete: () => undefined,
      close: () => undefined,
    };
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, failingSettings);
    expect(() => manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' })).toThrowError(new ModelSettingsError('PERSISTENCE_FAILED', 'Model endpoint profile could not be saved.'));
    expect(manager.provider.id).toBe('unconfigured');
    expect(manager.status().source).toBe('unconfigured');
  });

  it('clears durable metadata before removing the active provider', () => {
    const settings = new InMemorySettingsStore();
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings);
    manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    expect(manager.clear().credentialState).toBe('none');
    expect(settings.get('model', 'profile')).toBeUndefined();
  });

  it('configures DeepSeek through a separate secret-free settings boundary', () => {
    const settings = new InMemorySettingsStore();
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings);
    const status = manager.configureDeepSeek({
      endpointProfile: 'openai-chat-completions',
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-v4-flash',
      apiKey: 'test-secret',
      thinkingMode: 'auto',
      toolCalling: 'enabled',
      webSearch: 'off',
      reviewer: 'off',
    });
    expect(status).toMatchObject({ schemaVersion: 'ready4vibe_deepseek_settings_status_v1', configured: true, providerId: 'deepseek', credentialState: 'available', profile: { endpointProfile: 'openai-chat-completions', model: 'deepseek-v4-flash' } });
    expect(JSON.stringify(status)).not.toContain('test-secret');
    expect(JSON.stringify(settings.get('deepseek', 'profile'))).not.toContain('test-secret');
    expect(manager.provider.id).toBe('deepseek');
    expect(manager.bindRun({ provider: 'deepseek', name: 'deepseek-v4-flash' }).deepSeekSnapshot).toMatchObject({ providerId: 'deepseek', model: 'deepseek-v4-flash' });
  });

  it('restores DeepSeek metadata as credential-required and fails closed on stale revisions', () => {
    const settings = new InMemorySettingsStore();
    const first = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings);
    const configured = first.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off' });
    expect(() => first.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'replacement', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off', expectedRevision: 'deepseek-settings-0' })).toThrowError(new ModelSettingsError('REVISION_CONFLICT', 'DeepSeek settings changed; refresh before saving again.'));
    const restarted = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings);
    expect(restarted.deepSeekStatus()).toMatchObject({ configured: false, providerId: 'deepseek', source: 'durable-profile', credentialState: 'required', profile: { profileRevision: configured.profile?.profileRevision } });
    expect(restarted.provider.id).toBe('unconfigured');
  });

  it('probes only on explicit request and keeps the provider snapshot unchanged', async () => {
    let calls = 0;
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), async (input, init) => {
      calls += 1;
      expect(input).toBe('https://api.deepseek.com/v1/chat/completions');
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    });
    manager.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off' });
    const provider = manager.provider.snapshot();
    await expect(manager.probeDeepSeek()).resolves.toMatchObject({ status: 'ready', capabilities: { providerId: 'deepseek', model: 'deepseek-v4-flash' } });
    expect(manager.provider.snapshot()).toBe(provider);
    expect(calls).toBe(1);
  });

  it('propagates an explicit ready capability into the immutable run snapshot', async () => {
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      capabilities: {
        schemaVersion: 'deepseek-provider-capabilities/v1',
        reasoning: true,
        toolCalls: true,
        contextLimit: 100_000,
        outputLimit: 4_096,
      },
    })));
    manager.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off' });
    await expect(manager.probeDeepSeek()).resolves.toMatchObject({ capabilities: { reasoning: true, toolCalls: true, descriptorRevision: 'deepseek-settings-1' } });
    const binding = manager.bindRun({ provider: 'deepseek', name: 'deepseek-v4-flash' });
    expect(binding.snapshot).toMatchObject({ capabilities: { streaming: true, toolCalls: true, reasoning: true, structuredOutput: false } });
    expect(binding.deepSeekSnapshot).toMatchObject({ capabilityRevision: 'deepseek-settings-1', thinkingMode: 'auto' });
    expect(JSON.stringify(binding.snapshot)).not.toContain('test-secret');
    expect(JSON.stringify(binding.deepSeekSnapshot)).not.toContain('test-secret');
  });

  it('keeps matching capabilities when enabling high thinking after a probe and clears them on endpoint changes', async () => {
    const manager = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      capabilities: { schemaVersion: 'deepseek-provider-capabilities/v1', reasoning: true },
    })));
    const configured = manager.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off' });
    await manager.probeDeepSeek();
    manager.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'replacement-secret', thinkingMode: 'high', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off', ...(configured.profile?.profileRevision ? { expectedRevision: configured.profile.profileRevision } : {}) });
    expect(manager.deepSeekStatus()).toMatchObject({ capability: { reasoning: true }, lastProbe: { status: 'ready' } });
    expect(manager.bindRun({ provider: 'deepseek', name: 'deepseek-v4-flash' }).snapshot.capabilities.reasoning).toBe(true);
    expect(() => manager.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://other.test/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'third-secret', thinkingMode: 'high', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off' })).toThrowError(new ModelSettingsError('DEEPSEEK_CAPABILITY_REQUIRED', 'Probe must declare reasoning support before high or max thinking can be enabled.'));
  });

  it('fails closed when provider-owned search is enabled without a ready search capability', () => {
    const manager = new InMemoryModelSettingsManager({});
    expect(() => manager.configureDeepSeek({ endpointProfile: 'openai-responses', endpoint: 'https://api.deepseek.com/v1/responses', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'provider-owned', reviewer: 'off' })).toThrowError(new ModelSettingsError('DEEPSEEK_CAPABILITY_REQUIRED', 'Probe must declare provider-owned web search support before it can be enabled.'));
    expect(manager.provider.id).toBe('unconfigured');
  });
});

describe('daemon model credential persistence', () => {
  it('restores a ready DeepSeek provider from the encrypted credential after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-model-secrets-'));
    try {
      const settings = new InMemorySettingsStore();
      const secrets = new FileSecretStore(root);
      const input = { endpointProfile: 'openai-chat-completions' as const, endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto' as const, toolCalling: 'enabled' as const, webSearch: 'off' as const, reviewer: 'off' as const };
      const first = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, secrets);
      first.configureDeepSeek(input);
      expect(JSON.stringify(settings.get('deepseek', 'profile'))).not.toContain('test-secret');

      const restarted = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, new FileSecretStore(root));
      expect(restarted.status()).toEqual({ configured: true, providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1/chat/completions', modelName: 'deepseek-v4-flash', source: 'durable-profile', credentialState: 'available' });
      expect(restarted.provider.id).toBe('deepseek');
      expect(restarted.bindRun({ provider: 'deepseek', name: 'deepseek-v4-flash' }).deepSeekSnapshot).toMatchObject({ providerId: 'deepseek', model: 'deepseek-v4-flash' });

      restarted.clearDeepSeek();
      const cleared = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, new FileSecretStore(root));
      expect(cleared.status()).toMatchObject({ configured: false, providerId: 'unconfigured', credentialState: 'none' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('restores an OpenAI-compatible provider from the encrypted credential after restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-model-secrets-'));
    try {
      const settings = new InMemorySettingsStore();
      const first = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, new FileSecretStore(root));
      first.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });

      const restarted = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, new FileSecretStore(root));
      expect(restarted.status()).toEqual({ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'durable-profile', credentialState: 'available' });
      expect(restarted.provider.id).toBe('openai-compatible');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('degrades to credential-required when the secret is missing and never echoes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-model-secrets-'));
    try {
      const settings = new InMemorySettingsStore();
      const first = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, new FileSecretStore(root));
      first.configureDeepSeek({ endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', apiKey: 'test-secret', thinkingMode: 'auto', toolCalling: 'enabled', webSearch: 'off', reviewer: 'off' });

      // A different secret store (fresh master key) cannot decrypt the credential.
      const otherRoot = await mkdtemp(join(tmpdir(), 'ready4vibe-model-secrets-'));
      try {
        const foreign = new InMemoryModelSettingsManager({}, () => new Date('2026-08-05T00:00:00.000Z'), undefined, settings, new FileSecretStore(otherRoot));
        expect(foreign.status()).toMatchObject({ configured: false, providerId: 'deepseek', source: 'durable-profile', credentialState: 'required' });
        expect(foreign.provider.id).toBe('unconfigured');
      } finally {
        await rm(otherRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
