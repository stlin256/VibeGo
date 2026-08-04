import { describe, expect, it } from 'vitest';
import type { ModelUsageRecord, ProviderDescriptor } from '@ready4vibe/contracts';
import {
  ProviderRegistry,
  ProviderUsageConflictError,
  normalizeProviderUsageObservation,
  reconcileProviderUsageRecords,
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

function usageRecord(overrides: Partial<ModelUsageRecord> = {}): ModelUsageRecord {
  return {
    schemaVersion: 'ready4vibe_model_usage_v1',
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
    tokens: { input: 10, output: 3 },
    tokenAccuracy: 'reported',
    inputTokenSemantics: 'fresh',
    dataSource: 'provider-usage',
    ...overrides,
  };
}

describe('provider usage reconciliation', () => {
  it('deduplicates same usage IDs and fails closed on different content', () => {
    const first = usageRecord();
    const result = reconcileProviderUsageRecords([first, { ...first }]);
    expect(result.records).toEqual([first]);
    expect(result.duplicateUsageIds).toEqual(['usage_01']);
    expect(() => reconcileProviderUsageRecords([first, { ...first, tokens: { input: 11, output: 3 } }])).toThrow(ProviderUsageConflictError);
  });

  it('merges complementary sources into one deterministic reconciled record', () => {
    const provider = usageRecord({ tokens: { input: 10 }, dataSource: 'provider-usage' });
    const replay = usageRecord({ usageId: 'usage_02', tokens: { output: 3 }, dataSource: 'run-event' });
    const first = reconcileProviderUsageRecords([provider, replay]);
    const second = reconcileProviderUsageRecords([replay, provider]);
    expect(first).toEqual(second);
    expect(first.records).toHaveLength(1);
    expect(first.records[0]).toMatchObject({
      dataSource: 'reconciled',
      tokens: { input: 10, output: 3 },
      reconciledFrom: ['usage_01', 'usage_02'],
    });
    expect(first.records[0]?.usageId).toMatch(/^reconciled_[a-f0-9]{32}$/u);
  });

  it('rejects conflicting token facts and keeps retry attempts separate', () => {
    const provider = usageRecord({ tokens: { input: 10 }, dataSource: 'provider-usage' });
    const conflictingReplay = usageRecord({ usageId: 'usage_02', tokens: { input: 12 }, dataSource: 'run-event' });
    expect(() => reconcileProviderUsageRecords([provider, conflictingReplay])).toThrow(ProviderUsageConflictError);

    const retry = usageRecord({ usageId: 'usage_03', attempt: 2, requestId: 'request_02', tokens: { output: 4 }, dataSource: 'provider-usage' });
    const retries = reconcileProviderUsageRecords([retry, provider]);
    expect(retries.records).toHaveLength(2);
    expect(retries.records.map((record) => record.attempt)).toEqual([1, 2]);
  });

  it('does not accept raw provider payloads or absolute paths', () => {
    expect(() => reconcileProviderUsageRecords([{ ...usageRecord(), rawResponse: { body: 'secret=sk-' + 'x'.repeat(24) } }])).toThrow();
    expect(() => reconcileProviderUsageRecords([{ ...usageRecord(), runId: 'C:\\private\\run' }])).toThrow(/absolute path|bounded/iu);
  });
});
