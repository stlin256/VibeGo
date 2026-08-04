import { describe, expect, it } from 'vitest';
import type { AuditEvent, ModelUsageRecord, ResourceSample, ToolUsageRecord } from '@ready4vibe/contracts';
import { buildAuditResponse, buildRunUsage, buildUsageSummary, buildUsageTimeseries } from './api.js';

const at = '2026-08-04T12:00:00.000Z';
const model: ModelUsageRecord = {
  schemaVersion: 'ready4vibe_model_usage_v1', usageId: 'usage_api_01', runId: 'run_api_01', turnId: 'turn_api_01', requestId: 'request_api_01',
  providerId: 'deepseek', model: 'deepseek-v4-flash', attempt: 1, startedAt: at, status: 'completed', tokens: { input: 10, output: 3 }, tokenAccuracy: 'reported', cost: { currency: 'USD', amountMicros: '10', accuracy: 'exact', pricingRevision: 'price_api_01' },
};
const tool: ToolUsageRecord = { schemaVersion: 'ready4vibe_tool_usage_v1', usageId: 'tool_api_01', runId: 'run_api_01', turnId: 'turn_api_01', callId: 'call_api_01', toolId: 'filesystem.read', attempt: 1, startedAt: at, status: 'completed', risk: 'read', runtime: 'host-restricted', accuracy: 'measured' };
const sample: ResourceSample = { schemaVersion: 'ready4vibe_resource_sample_v1', sampleId: 'sample_api_01', sampledAt: at, scope: 'daemon', source: 'node', accuracy: 'measured', cpu: { milliPercent: 100 }, memory: { rssBytes: '1000' }, samplingIntervalMs: 5000, droppedSampleCount: 1 };
const audit: AuditEvent = { schemaVersion: 'ready4vibe_audit_event_v1', eventId: 'audit_api_01', appendSequence: 1, at, actor: 'system', transport: 'loopback', action: 'run.completed', targetKind: 'run', targetId: 'run_api_01', outcome: 'succeeded', correlationId: 'corr_api_01', previousHash: null, eventHash: 'a'.repeat(64) };

describe('observability projections', () => {
  it('builds bounded summary, timeseries, and run usage without raw payloads', () => {
    const clock = { now: () => new Date(at) };
    expect(buildUsageSummary([model], [tool], [sample], '24h', clock)).toMatchObject({ modelAttempts: 1, toolCalls: 1, resources: { sampleCount: 1, droppedSampleCount: 1 }, cost: { amountMicros: '10' } });
    expect(buildUsageTimeseries([model], [sample], 'tokens', '24h', clock).points[0]).toMatchObject({ inputTokens: 10, outputTokens: 3 });
    expect(buildRunUsage('run_api_01', [model], [tool], clock).modelUsages).toHaveLength(1);
  });

  it('uses descending bounded audit cursor pages', () => {
    const response = buildAuditResponse([audit], 0, {}, { now: () => new Date(at) });
    expect(response.events[0]?.eventId).toBe('audit_api_01');
    expect(response.nextAfter).toBeNull();
  });
});
