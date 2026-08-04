import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '@ready4vibe/contracts';
import { canonicalObservabilityJson, fingerprintAuditEvent, fingerprintUsageRecord, replayModelUsage } from './index.js';

const runId = 'run_01';
const at = '2026-08-04T00:00:00.000Z';

function event<T>(seq: number, id: string, type: string, payload: T, eventAt = at): StoredEvent<T> {
  return { version: 1, id, seq, at: eventAt, runId, type, source: type.startsWith('model.') ? 'model' : 'orchestrator', correlationId: 'corr_01', payload };
}

const fixture: StoredEvent[] = [
  event(1, 'evt_created', 'run.created', {
    config: { model: { provider: 'deepseek', name: 'deepseek-v4-flash' }, userMessage: 'do not copy this transcript' },
  }),
  event(2, 'evt_turn', 'turn.started', { turnId: 'turn_01', index: 1 }, '2026-08-04T00:00:00.010Z'),
  event(3, 'evt_requested', 'model.requested', { turnId: 'turn_01', model: 'deepseek-v4-flash' }, '2026-08-04T00:00:00.020Z'),
  event(4, 'evt_usage', 'model.usage', { turnId: 'turn_01', inputTokens: 10, outputTokens: 3 }, '2026-08-04T00:00:00.900Z'),
  event(5, 'evt_completed', 'model.completed', { turnId: 'turn_01', finishReason: 'stop' }, '2026-08-04T00:00:01.000Z'),
  event(6, 'evt_run_completed', 'run.completed', { summary: 'secret=sk-' + 'x'.repeat(24), exitReason: 'model-completed' }, '2026-08-04T00:00:01.100Z'),
];

describe('model usage replay projection', () => {
  it('replays by sequence and produces a stable bounded record/checksum', () => {
    const projection = replayModelUsage(fixture);
    expect(projection.runId).toBe(runId);
    expect(projection.records).toHaveLength(1);
    expect(projection.records[0]).toMatchObject({
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      status: 'completed',
      tokens: { input: 10, output: 3 },
      tokenAccuracy: 'reported',
    });
    expect(projection.records[0]?.usageId).toMatch(/^usage_[a-f0-9]{32}$/u);
    expect(projection.totals.input).toEqual({ total: 10, knownRecords: 1, unknownRecords: 0 });
    expect(projection.totals.output).toEqual({ total: 3, knownRecords: 1, unknownRecords: 0 });
    expect(projection.sourceChecksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(projection)).not.toContain('secret=');
    expect(JSON.stringify(projection)).not.toContain('do not copy');
  });

  it('is invariant to input order and duplicate delivery of the same stored event', () => {
    const first = replayModelUsage(fixture);
    const replayed = replayModelUsage([fixture[5]!, fixture[3]!, fixture[0]!, fixture[4]!, fixture[2]!, fixture[1]!, fixture[3]!]);
    expect(replayed).toEqual(first);
  });

  it('keeps missing token dimensions unknown and does not invent cost', () => {
    const projection = replayModelUsage([
      event(1, 'created', 'run.created', { config: { model: { provider: 'local', name: 'unknown-model' } } }),
      event(2, 'turn', 'turn.started', { turnId: 'turn_02', index: 1 }),
      event(3, 'request', 'model.requested', { turnId: 'turn_02' }),
      event(4, 'usage', 'model.usage', { turnId: 'turn_02', outputTokens: 4 }),
      event(5, 'failed', 'run.failed', { code: 'MODEL_PROVIDER_ERROR', safeMessage: 'safe' }),
    ]);
    expect(projection.records[0]).toMatchObject({ status: 'failed', tokens: { output: 4 }, tokenAccuracy: 'reported' });
    expect(projection.records[0]?.tokens).not.toHaveProperty('input');
    expect(projection.records[0]).not.toHaveProperty('cost');
    expect(projection.totals.input).toEqual({ total: null, knownRecords: 0, unknownRecords: 1 });
    expect(projection.totals.output).toEqual({ total: 4, knownRecords: 1, unknownRecords: 0 });
  });

  it('rejects mixed runs and unsafe event metadata', () => {
    expect(() => replayModelUsage([fixture[0]!, { ...fixture[1]!, runId: 'run_02' }])).toThrow(/same run/iu);
    expect(() => replayModelUsage([{ ...fixture[0]!, at: 'C:\\private\\event' }])).toThrow(/contract|timestamp/iu);
  });
});

describe('observability canonicalization', () => {
  it('sorts object keys and fingerprints equivalent usage/audit records deterministically', () => {
    expect(canonicalObservabilityJson({ b: 2, a: { d: true, c: null } })).toBe('{"a":{"c":null,"d":true},"b":2}');
    const usage = fixture[3] ? replayModelUsage(fixture).records[0]! : undefined;
    expect(usage).toBeDefined();
    expect(fingerprintUsageRecord(usage!)).toBe(fingerprintUsageRecord({ ...usage! }));
    expect(fingerprintAuditEvent({
      schemaVersion: 'ready4vibe_audit_event_v1', eventId: 'audit', appendSequence: 1, at,
      actor: 'system', transport: 'loopback', action: 'run.completed', targetKind: 'run',
      outcome: 'succeeded', correlationId: 'corr', previousHash: null, eventHash: 'a'.repeat(64),
    })).toMatch(/^[a-f0-9]{64}$/u);
  });
});
