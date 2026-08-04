import { describe, expect, it } from 'vitest';
import {
  MODEL_USAGE_SCHEMA_VERSION,
  PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
  PROVIDER_DESCRIPTOR_SCHEMA_VERSION,
  PROVIDER_USAGE_OBSERVATION_SCHEMA_VERSION,
  ModelUsageRecordSchema,
  ProviderCapabilitySnapshotSchema,
  ProviderDescriptorSchema,
  ProviderUsageObservationSchema,
} from './provider-usage.js';

const at = '2026-08-04T00:00:00.000Z';

const descriptor = {
  schemaVersion: PROVIDER_DESCRIPTOR_SCHEMA_VERSION,
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
  schemaVersion: PROVIDER_USAGE_OBSERVATION_SCHEMA_VERSION,
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
  tokens: {
    input: 10,
    output: 3,
    cachedInput: 2,
    cacheCreation: 1,
    reasoning: 1,
    audioInput: 0,
  },
  tokenAccuracy: 'reported',
  inputTokenSemantics: 'cache-inclusive',
  dataSource: 'provider-usage',
  sourceRevision: 'rev_01',
};

describe('provider usage contracts', () => {
  it('accepts strict descriptor, frozen capability snapshot shape and normalized observation', () => {
    expect(ProviderDescriptorSchema.parse(descriptor)).toEqual(descriptor);
    expect(ProviderCapabilitySnapshotSchema.parse({
      schemaVersion: PROVIDER_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
      providerId: 'deepseek',
      capturedAt: at,
      descriptorRevision: 'rev_01',
      capabilities: descriptor.capabilities,
    })).toMatchObject({ providerId: 'deepseek', descriptorRevision: 'rev_01' });
    expect(ProviderUsageObservationSchema.parse(observation)).toEqual(observation);
  });

  it('maps the observation version back to the existing ModelUsageRecord contract', () => {
    const record = ModelUsageRecordSchema.parse({
      ...observation,
      schemaVersion: MODEL_USAGE_SCHEMA_VERSION,
    });
    expect(record.tokens).toMatchObject({ cacheCreation: 1, audioInput: 0 });
    expect(record.inputTokenSemantics).toBe('cache-inclusive');
    expect(record.dataSource).toBe('provider-usage');
  });

  it('rejects unknown fields, secrets, absolute paths and unsafe endpoint credentials', () => {
    expect(() => ProviderDescriptorSchema.parse({ ...descriptor, unknown: true })).toThrow();
    expect(() => ProviderDescriptorSchema.parse({ ...descriptor, authRef: 'apiKey=sk-' + 'x'.repeat(24) })).toThrow(/secret/iu);
    expect(() => ProviderDescriptorSchema.parse({ ...descriptor, endpointPolicy: { kind: 'explicit-url', baseUrl: 'C:\\workspace\\provider' } })).toThrow(/absolute path/iu);
    expect(() => ProviderDescriptorSchema.parse({ ...descriptor, endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://user:password@example.com' } })).toThrow(/secret|credential|url/iu);
    expect(() => ProviderUsageObservationSchema.parse({ ...observation, tokens: { input: -1 } })).toThrow();
    expect(() => ProviderUsageObservationSchema.parse({ ...observation, dataSource: 'reconciled' })).toThrow(/reconciledFrom/iu);
  });

  it('keeps unknown token dimensions explicit instead of inventing zero', () => {
    const parsed = ProviderUsageObservationSchema.parse({
      ...observation,
      tokens: { output: 4 },
      tokenAccuracy: 'unknown',
      inputTokenSemantics: 'unknown',
    });
    expect(parsed.tokens).toEqual({ output: 4 });
    expect(parsed.tokens).not.toHaveProperty('input');
  });
});
