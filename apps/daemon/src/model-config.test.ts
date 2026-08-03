import { describe, expect, it } from 'vitest';
import { createModelProvider, InMemoryModelSettingsManager, ModelSettingsError } from './model-config.js';

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

  it('configures and clears a provider through a secret-free status boundary', () => {
    const manager = new InMemoryModelSettingsManager({});
    expect(manager.status()).toEqual({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured' });
    const status = manager.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    expect(status).toEqual({ configured: true, providerId: 'openai-compatible', baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-v4-flash', source: 'web-memory' });
    expect(JSON.stringify(status)).not.toContain('test-secret');
    expect(manager.provider.id).toBe('openai-compatible');
    expect(manager.clear()).toEqual({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured' });
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
});
