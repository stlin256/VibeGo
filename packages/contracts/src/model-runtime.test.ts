import { describe, expect, it } from 'vitest';
import {
  MODEL_EVENT_SCHEMA_VERSION,
  MODEL_PROVIDER_SNAPSHOT_SCHEMA_VERSION,
  ModelEventSchema,
  ModelProviderSnapshotSchema,
  ModelRequestSchema,
  ModelReplayResultSchema,
  ModelRetryPlanSchema,
} from './model-runtime.js';

const capabilities = {
  streaming: true,
  toolCalls: true,
  structuredOutput: false,
  reasoning: false,
  promptCaching: false,
  audioInput: false,
  audioOutput: false,
};

describe('model runtime contracts', () => {
  it('accepts a secret-free provider snapshot and versioned events', () => {
    expect(ModelProviderSnapshotSchema.parse({
      schemaVersion: MODEL_PROVIDER_SNAPSHOT_SCHEMA_VERSION,
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      pricingModel: 'deepseek-v4-flash',
      descriptorRevision: 'rev-1',
      endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com' },
      capabilities,
      authRef: 'secret.deepseek',
      capturedAt: '2026-08-04T12:00:00.000Z',
    }).providerId).toBe('deepseek');
    expect(ModelEventSchema.parse({ schemaVersion: MODEL_EVENT_SCHEMA_VERSION, type: 'text-delta', text: 'hello' })).toMatchObject({ type: 'text-delta' });
  });

  it('rejects secrets, paths, unknown event types and oversized deltas', () => {
    expect(() => ModelProviderSnapshotSchema.parse({
      schemaVersion: MODEL_PROVIDER_SNAPSHOT_SCHEMA_VERSION,
      providerId: 'deepseek', model: 'model', pricingModel: 'model', descriptorRevision: 'rev-1',
      endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com' }, capabilities,
      authRef: 'api_key=sk-' + 'x'.repeat(24), capturedAt: '2026-08-04T12:00:00.000Z',
    })).toThrow(/secret/iu);
    expect(() => ModelProviderSnapshotSchema.parse({
      schemaVersion: MODEL_PROVIDER_SNAPSHOT_SCHEMA_VERSION,
      providerId: 'deepseek', model: 'C:\\workspace', pricingModel: 'model', descriptorRevision: 'rev-1',
      endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com' }, capabilities,
      capturedAt: '2026-08-04T12:00:00.000Z',
    })).toThrow(/absolute path/iu);
    expect(() => ModelEventSchema.parse({ type: 'unknown', value: true })).toThrow();
    expect(() => ModelEventSchema.parse({ type: 'text-delta', text: 'x'.repeat(512 * 1024 + 1) })).toThrow();
  });

  it('keeps replay and retry DTOs bounded and strict', () => {
    expect(ModelRetryPlanSchema.parse({ schemaVersion: 'ready4vibe_model_retry_plan_v1', attempt: 1, maxAttempts: 3, delayMs: 25, reason: 'rate-limit', retryable: true })).toMatchObject({ delayMs: 25 });
    expect(() => ModelReplayResultSchema.parse({ schemaVersion: MODEL_EVENT_SCHEMA_VERSION, text: '', toolCalls: [], eventCount: 0, fingerprint: 'not-a-hash' })).toThrow();
    expect(ModelRequestSchema.parse({
      schemaVersion: 'ready4vibe_model_request_v1', model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hello', source: 'user', trust: 'trusted' }], tools: [],
      budget: { maxInputTokens: 10, maxOutputTokens: 10 }, metadata: { runId: 'run-1', turnId: 'turn-1', requestId: 'request-1' },
    }).messages[0]?.content).toBe('hello');
    expect(() => ModelRequestSchema.parse({
      schemaVersion: 'ready4vibe_model_request_v1', model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'C:\\workspace\\secret.txt' }], tools: [],
      budget: { maxInputTokens: 10, maxOutputTokens: 10 }, metadata: { runId: 'run-1', turnId: 'turn-1', requestId: 'request-1' },
    })).toThrow(/absolute path/iu);
  });
});
