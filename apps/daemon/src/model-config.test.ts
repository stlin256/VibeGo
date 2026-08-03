import { describe, expect, it } from 'vitest';
import { createModelProvider } from './model-config.js';

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
});
