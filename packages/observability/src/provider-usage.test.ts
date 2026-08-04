import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@ready4vibe/contracts';
import {
  ProviderRegistry,
  normalizeProviderUsageObservation,
} from './provider-usage.js';

const at = '2026-08-04T00:00:00.000Z';

const descriptor: ProviderDescriptor = {
  schemaVersion: 'ready4vibe_provider_descriptor_v1',
  providerId: 'deepseek',
  displayName: 'DeepSeek',
  protocol: 'openai-compatible',
  endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com' },
  authRef: 'secret.deepseek',
  capabilities: {
    streaming: true,
    toolCalls: true,
    structuredOutput: true,
    reasoning: true,
    promptCaching: true,
    audioInput: false,
    audioOutput: false,
  },
  models: ['deepseek-v4-flash'],
  source: 'user-configured',
};

const observation = {
  schemaVersion: 'ready4vibe_provider_usage_observation_v1',
  usageId: 'usage_01',
  runId: 'run_01',
  turnId: 'turn_01',
  requestId: 'request_01',
  providerId: 'deepseek',
  model: 'deepseek-v4-flash',
  requestModel: 'deepseek-v4-flash',
  pricingModel: 'deepseek-v4-flash',
  attempt: 1,
  startedAt: at,
  completedAt: '2026-08-04T00:00:01.000Z',
  status: 'completed',
  tokens: { input: 10, output: 3, cachedInput: 2, cacheCreation: 1, reasoning: 1 },
  tokenAccuracy: 'reported',
  inputTokenSemantics: 'cache-inclusive',
  dataSource: 'provider-usage',
  sourceRevision: 'rev_01',
};

describe('provider registry and usage normalizer', () => {
  it('registers bounded descriptors and returns an immutable capability snapshot', () => {
    const registry = new ProviderRegistry();
    registry.register(descriptor);

    const first = registry.snapshot('deepseek', at, 'rev_01');
    expect(first).toMatchObject({ providerId: 'deepseek', descriptorRevision: 'rev_01' });
    expect(first.capabilities.streaming).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.capabilities)).toBe(true);

    const listed = registry.get('deepseek');
    expect(listed).not.toBe(descriptor);
    expect(listed?.capabilities).toEqual(descriptor.capabilities);
    expect(() => registry.snapshot('missing', at, 'rev_01')).toThrow(/unknown provider/iu);
  });

  it('keeps an existing snapshot stable after a later descriptor registration', () => {
    const registry = new ProviderRegistry();
    registry.register(descriptor);
    const snapshot = registry.snapshot('deepseek', at, 'rev_01');
    registry.register({ ...descriptor, capabilities: { ...descriptor.capabilities, streaming: false }, source: 'builtin' });
    expect(snapshot.capabilities.streaming).toBe(true);
    expect(registry.snapshot('deepseek', at, 'rev_02').capabilities.streaming).toBe(false);
  });

  it('normalizes the same bounded observation deterministically and preserves token semantics', () => {
    const first = normalizeProviderUsageObservation(observation);
    const second = normalizeProviderUsageObservation({ ...observation });
    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe('ready4vibe_model_usage_v1');
    expect(first.inputTokenSemantics).toBe('cache-inclusive');
    expect(first.dataSource).toBe('provider-usage');
    expect(first.tokens).toMatchObject({ cachedInput: 2, cacheCreation: 1, reasoning: 1 });
  });

  it('fails closed for malformed observations and never returns raw provider payload', () => {
    expect(() => normalizeProviderUsageObservation({ ...observation, rawResponse: { content: 'secret=sk-' + 'x'.repeat(24) } })).toThrow();
    expect(() => normalizeProviderUsageObservation({ ...observation, providerId: 'C:\\private\\provider' })).toThrow(/absolute path/iu);
    expect(() => normalizeProviderUsageObservation({ ...observation, dataSource: 'reconciled', reconciledFrom: ['provider-usage', 'run-event'] })).not.toThrow();
    const record = normalizeProviderUsageObservation({ ...observation, dataSource: 'reconciled', reconciledFrom: ['provider-usage', 'run-event'] });
    expect(JSON.stringify(record)).not.toContain('rawResponse');
    expect(JSON.stringify(record)).not.toContain('secret=');
  });
});
