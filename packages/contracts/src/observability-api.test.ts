import { describe, expect, it } from 'vitest';
import {
  OBSERVABILITY_API_SCHEMA_VERSION,
  ObservabilityAuditResponseSchema,
  ObservabilityTimeseriesSchema,
  ObservabilityUsageSummarySchema,
} from './observability-api.js';

const at = '2026-08-04T00:00:00.000Z';

describe('observability API contracts', () => {
  it('accepts bounded summary and timeseries projections', () => {
    const summary = ObservabilityUsageSummarySchema.parse({
      schemaVersion: OBSERVABILITY_API_SCHEMA_VERSION, status: 'ready', generatedAt: at,
      range: '24h', from: at, to: at, modelAttempts: 1, modelRequests: 1, toolCalls: 0,
      tokens: {
        input: { total: 10, knownRecords: 1, unknownRecords: 0 },
        output: { total: 3, knownRecords: 1, unknownRecords: 0 },
        cachedInput: { total: null, knownRecords: 0, unknownRecords: 1 },
        reasoning: { total: null, knownRecords: 0, unknownRecords: 1 },
      },
      resources: { sampleCount: 1, droppedSampleCount: 0, latest: { sampledAt: at, accuracy: 'measured', rssBytes: '100' } },
      cost: { currency: 'USD', amountMicros: '10', accuracy: 'exact' },
    });
    const timeseries = ObservabilityTimeseriesSchema.parse({
      schemaVersion: OBSERVABILITY_API_SCHEMA_VERSION, status: 'ready', generatedAt: at,
      range: '24h', metric: 'cpu', droppedSampleCount: 0,
      points: [{ bucketStart: at, bucketEnd: '2026-08-04T01:00:00.000Z', sampleCount: 1, accuracy: 'measured', cpuMilliPercent: 100 }],
    });
    expect(summary.schemaVersion).toBe(OBSERVABILITY_API_SCHEMA_VERSION);
    expect(timeseries.points).toHaveLength(1);
  });

  it('rejects raw secrets, absolute paths and unbounded event lists', () => {
    expect(() => ObservabilityUsageSummarySchema.parse({
      schemaVersion: OBSERVABILITY_API_SCHEMA_VERSION, status: 'ready', generatedAt: at,
      range: '24h', from: at, to: at, modelAttempts: 0, modelRequests: 0, toolCalls: 0,
      tokens: { input: { total: null, knownRecords: 0, unknownRecords: 0 }, output: { total: null, knownRecords: 0, unknownRecords: 0 }, cachedInput: { total: null, knownRecords: 0, unknownRecords: 0 }, reasoning: { total: null, knownRecords: 0, unknownRecords: 0 } },
      resources: { sampleCount: 0, droppedSampleCount: 0 }, cost: { currency: null, amountMicros: null, accuracy: 'unknown' },
      leak: 'apiKey=sk-' + 'x'.repeat(24),
    })).toThrow();
    expect(() => ObservabilityTimeseriesSchema.parse({
      schemaVersion: OBSERVABILITY_API_SCHEMA_VERSION, status: 'ready', generatedAt: at, range: '24h', metric: 'disk', droppedSampleCount: 0,
      points: [{ bucketStart: at, bucketEnd: at, sampleCount: 1, accuracy: 'measured', diskFreeBytes: 'C:\\private' }],
    })).toThrow(/absolute path/iu);
    expect(() => ObservabilityAuditResponseSchema.parse({
      schemaVersion: OBSERVABILITY_API_SCHEMA_VERSION, status: 'ready', generatedAt: at, after: 0, nextAfter: null, events: Array.from({ length: 101 }, () => ({})),
    })).toThrow();
  });
});
