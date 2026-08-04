import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  MODEL_USAGE_SCHEMA_VERSION,
  RESOURCE_SAMPLE_SCHEMA_VERSION,
  TOOL_USAGE_SCHEMA_VERSION,
  USAGE_ROLLUP_SCHEMA_VERSION,
  USAGE_PROJECTION_SCHEMA_VERSION,
  AuditEventSchema,
  ModelUsageRecordSchema,
  ResourceSampleSchema,
  ToolUsageRecordSchema,
  UsageRollupSchema,
  UsageProjectionSchema,
} from './observability.js';

const at = '2026-08-04T00:00:00.000Z';

const resourceSample = {
  schemaVersion: RESOURCE_SAMPLE_SCHEMA_VERSION,
  sampleId: 'sample_01',
  sampledAt: at,
  scope: 'daemon',
  source: 'node',
  accuracy: 'measured',
  cpu: { milliPercent: 1250, cpuTimeMs: 42 },
  memory: { rssBytes: '1048576', heapUsedBytes: '524288' },
  disk: { volumeClass: 'system-volume', volumeId: 'vol_01', freeBytes: '987654321' },
  samplingIntervalMs: 5000,
  droppedSampleCount: 0,
};

const modelUsage = {
  schemaVersion: MODEL_USAGE_SCHEMA_VERSION,
  usageId: 'usage_01',
  runId: 'run_01',
  turnId: 'turn_01',
  requestId: 'request_01',
  providerId: 'deepseek',
  model: 'deepseek-v4-flash',
  attempt: 1,
  startedAt: at,
  completedAt: '2026-08-04T00:00:01.000Z',
  latencyMs: 1000,
  timeToFirstByteMs: 100,
  status: 'completed',
  tokens: { input: 10, output: 3 },
  tokenAccuracy: 'reported',
};

const toolUsage = {
  schemaVersion: TOOL_USAGE_SCHEMA_VERSION,
  usageId: 'tool_usage_01',
  runId: 'run_01',
  turnId: 'turn_01',
  callId: 'call_01',
  toolId: 'fs.read',
  toolVersion: '1.0.0',
  attempt: 1,
  startedAt: at,
  completedAt: '2026-08-04T00:00:00.100Z',
  durationMs: 100,
  status: 'completed',
  risk: 'read',
  runtime: 'host-restricted',
  outputBytes: 128,
  accuracy: 'measured',
};

const auditEvent = {
  schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
  eventId: 'audit_01',
  appendSequence: 1,
  at,
  actor: 'user-session',
  transport: 'loopback',
  action: 'settings.updated',
  targetKind: 'settings',
  targetId: 'settings_01',
  outcome: 'succeeded',
  correlationId: 'corr_01',
  safeDetails: { field: 'workspaceId', changed: true },
  previousHash: null,
  eventHash: 'a'.repeat(64),
};

describe('observability contracts', () => {
  it('accepts bounded resource, usage, tool, audit and projection records', () => {
    expect(ResourceSampleSchema.parse(resourceSample)).toEqual(resourceSample);
    expect(ModelUsageRecordSchema.parse(modelUsage)).toEqual(modelUsage);
    expect(ToolUsageRecordSchema.parse(toolUsage)).toEqual(toolUsage);
    expect(AuditEventSchema.parse(auditEvent)).toEqual(auditEvent);
    expect(UsageProjectionSchema.parse({
      schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
      runId: 'run_01',
      records: [modelUsage],
      totals: {
        input: { total: 10, knownRecords: 1, unknownRecords: 0 },
        output: { total: 3, knownRecords: 1, unknownRecords: 0 },
        cachedInput: { total: null, knownRecords: 0, unknownRecords: 1 },
        reasoning: { total: null, knownRecords: 0, unknownRecords: 1 },
      },
      sourceEventCount: 4,
      sourceChecksum: 'b'.repeat(64),
    })).toBeTruthy();
    expect(UsageRollupSchema.parse({
      schemaVersion: USAGE_ROLLUP_SCHEMA_VERSION,
      rollupId: 'rollup_01',
      period: 'hour',
      periodStart: at,
      periodEnd: '2026-08-04T01:00:00.000Z',
      modelAttempts: 1,
      modelRequests: 1,
      input: { total: 10, knownRecords: 1, unknownRecords: 0 },
      output: { total: 3, knownRecords: 1, unknownRecords: 0 },
      cachedInput: { total: null, knownRecords: 0, unknownRecords: 1 },
      reasoning: { total: null, knownRecords: 0, unknownRecords: 1 },
      sampleCount: 1,
      droppedSampleCount: 0,
      auditEventCount: 1,
      sourceChecksum: 'c'.repeat(64),
    })).toBeTruthy();
  });

  it('rejects unknown fields, secret-shaped values and absolute paths', () => {
    expect(() => ResourceSampleSchema.parse({ ...resourceSample, unknown: true })).toThrow();
    expect(() => ResourceSampleSchema.parse({ ...resourceSample, sampleId: 'C:\\private\\sample' })).toThrow(/absolute path/iu);
    expect(() => ModelUsageRecordSchema.parse({ ...modelUsage, providerId: 'apiKey=sk-' + 'x'.repeat(24) })).toThrow(/secret/iu);
    expect(() => ToolUsageRecordSchema.parse({ ...toolUsage, toolId: 'C:\\tools\\runner' })).toThrow(/absolute path/iu);
    expect(() => AuditEventSchema.parse({ ...auditEvent, action: 'shell.exec' })).toThrow();
    expect(() => AuditEventSchema.parse({ ...auditEvent, safeDetails: { authorization: 'Bearer secret' } })).toThrow(/secret/iu);
  });

  it('rejects invalid units and malformed hashes instead of coercing them', () => {
    expect(() => ResourceSampleSchema.parse({ ...resourceSample, cpu: { milliPercent: -1 } })).toThrow();
    expect(() => ResourceSampleSchema.parse({ ...resourceSample, memory: { rssBytes: '1.5' } })).toThrow();
    expect(() => ModelUsageRecordSchema.parse({ ...modelUsage, tokens: { input: -1 } })).toThrow();
    expect(() => AuditEventSchema.parse({ ...auditEvent, eventHash: 'not-a-hash' })).toThrow();
    expect(() => UsageProjectionSchema.parse({
      schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
      runId: 'run_01', records: [],
      totals: {
        input: { total: null, knownRecords: 0, unknownRecords: 0 },
        output: { total: null, knownRecords: 0, unknownRecords: 0 },
        cachedInput: { total: null, knownRecords: 0, unknownRecords: 0 },
        reasoning: { total: null, knownRecords: 0, unknownRecords: 0 },
      },
      sourceEventCount: 0, sourceChecksum: 'z'.repeat(64),
    })).toThrow();
    expect(() => UsageRollupSchema.parse({
      schemaVersion: USAGE_ROLLUP_SCHEMA_VERSION,
      rollupId: 'rollup_01', period: 'minute', periodStart: at,
      periodEnd: '2026-08-04T01:00:00.000Z', modelAttempts: 0, modelRequests: 0,
      input: { total: null, knownRecords: 0, unknownRecords: 0 },
      output: { total: null, knownRecords: 0, unknownRecords: 0 },
      cachedInput: { total: null, knownRecords: 0, unknownRecords: 0 },
      reasoning: { total: null, knownRecords: 0, unknownRecords: 0 },
      sampleCount: 0, droppedSampleCount: 0, auditEventCount: 0, sourceChecksum: 'c'.repeat(64),
    })).toThrow();
  });
});
