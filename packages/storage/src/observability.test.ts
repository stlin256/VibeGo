import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuditEvent, ModelUsageRecord, ResourceSample, ToolUsageRecord } from '@ready4vibe/contracts';
import { AuditApplicationAdapter, ResourceCollector, verifyAuditChain, type AuditEventDraft, type ResourceRuntime } from '@ready4vibe/observability';
import {
  InMemoryObservabilityLedger,
  ObservabilityLedgerConflictError,
  SqliteObservabilityLedger,
  type ObservabilityLedger,
} from './observability.js';
import { SqliteEventStore } from './index.js';

const at = '2026-08-04T00:12:00.000Z';
const runId = 'run_43b00001';

const sample: ResourceSample = {
  schemaVersion: 'ready4vibe_resource_sample_v1',
  sampleId: 'sample_43b00001',
  sampledAt: at,
  scope: 'daemon',
  source: 'node',
  accuracy: 'measured',
  cpu: { milliPercent: 1500, cpuTimeMs: 20 },
  memory: { rssBytes: '1000' },
  disk: { volumeClass: 'system-volume', freeBytes: '9000' },
  samplingIntervalMs: 5000,
  droppedSampleCount: 2,
};

const model: ModelUsageRecord = {
  schemaVersion: 'ready4vibe_model_usage_v1',
  usageId: 'usage_43b00001',
  runId,
  turnId: 'turn_43b00001',
  requestId: 'request_43b00001',
  providerId: 'deepseek',
  model: 'deepseek-v4-flash',
  attempt: 1,
  startedAt: at,
  completedAt: '2026-08-04T00:12:01.000Z',
  latencyMs: 1000,
  status: 'completed',
  tokens: { input: 10, output: 4 },
  tokenAccuracy: 'reported',
};

const tool: ToolUsageRecord = {
  schemaVersion: 'ready4vibe_tool_usage_v1',
  usageId: 'tool_usage_43b00001',
  runId,
  turnId: 'turn_43b00001',
  callId: 'call_43b00001',
  toolId: 'filesystem.read',
  toolVersion: '1.0.0',
  attempt: 1,
  startedAt: at,
  completedAt: '2026-08-04T00:12:00.100Z',
  durationMs: 100,
  status: 'completed',
  risk: 'read',
  runtime: 'host-restricted',
  outputBytes: 32,
  accuracy: 'measured',
};

const auditDraft: AuditEventDraft = {
  schemaVersion: 'ready4vibe_audit_event_v1',
  eventId: 'audit_43b00001',
  at,
  actor: 'system',
  transport: 'loopback',
  action: 'run.completed',
  targetKind: 'run',
  targetId: runId,
  outcome: 'succeeded',
  correlationId: 'corr_43b00001',
  safeDetails: { status: 'completed' },
};

function databasePath(): string {
  return join(tmpdir(), `ready4vibe-observability-${randomUUID()}.sqlite`);
}

function cleanup(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

async function appendFixture(ledger: ObservabilityLedger) {
  return ledger.appendBatch({ resourceSamples: [sample], modelUsages: [model], toolUsages: [tool], auditEvents: [auditDraft] });
}

describe.each([
  ['memory', () => new InMemoryObservabilityLedger()],
  ['sqlite-memory', () => new SqliteObservabilityLedger(':memory:')],
] as const)('%s observability ledger', (_name, create) => {
  it('appends bounded records, seals an audit chain, and rebuilds an hourly rollup', async () => {
    const ledger = create();
    const first = await appendFixture(ledger);
    expect(first.resourceSamples).toEqual([sample]);
    expect(first.modelUsages).toEqual([model]);
    expect(first.toolUsages).toEqual([tool]);
    expect(first.auditEvents[0]).toMatchObject({ appendSequence: 1, previousHash: null });
    expect(first.auditEvents[0]?.eventHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyAuditChain(await ledger.listAuditEvents())).toBe(true);

    const rollups = await ledger.rebuildRollups();
    expect(rollups).toHaveLength(1);
    expect(rollups[0]).toMatchObject({
      period: 'hour',
      modelAttempts: 1,
      modelRequests: 1,
      input: { total: 10, knownRecords: 1, unknownRecords: 0 },
      output: { total: 4, knownRecords: 1, unknownRecords: 0 },
      sampleCount: 1,
      droppedSampleCount: 2,
      auditEventCount: 1,
    });
    expect((await ledger.listRollups()).map((item) => item.rollupId)).toEqual([rollups[0]!.rollupId]);
    await ledger.close();
  });

  it('treats same IDs/content as no-op and different content as a conflict', async () => {
    const ledger = create();
    const first = await appendFixture(ledger);
    const repeated = await appendFixture(ledger);
    expect(repeated).toEqual(first);
    await expect(ledger.appendBatch({ modelUsages: [{ ...model, tokens: { input: 11, output: 4 } }] })).rejects.toBeInstanceOf(ObservabilityLedgerConflictError);
    expect(await ledger.listModelUsage()).toEqual([model]);
    expect(await ledger.listAuditEvents()).toHaveLength(1);
    await ledger.close();
  });

  it('rolls back a mixed batch when one entry conflicts', async () => {
    const ledger = create();
    await ledger.appendBatch({ modelUsages: [model] });
    await expect(ledger.appendBatch({
      resourceSamples: [{ ...sample, sampleId: 'sample_new_43b' }],
      modelUsages: [{ ...model, tokens: { input: 99, output: 4 } }],
    })).rejects.toBeInstanceOf(ObservabilityLedgerConflictError);
    expect(await ledger.listResourceSamples()).toHaveLength(0);
    expect(await ledger.listModelUsage()).toEqual([model]);
    await ledger.close();
  });

  it('serializes concurrent appends and keeps audit appendSequence monotonic', async () => {
    const ledger = create();
    const [first, second] = await Promise.all([
      ledger.appendBatch({ auditEvents: [auditDraft] }),
      ledger.appendBatch({ auditEvents: [{ ...auditDraft, eventId: 'audit_43b00002', correlationId: 'corr_43b00002' }] }),
    ]);
    expect([first.auditEvents[0]!.appendSequence, second.auditEvents[0]!.appendSequence].sort()).toEqual([1, 2]);
    expect(verifyAuditChain(await ledger.listAuditEvents())).toBe(true);
    await ledger.close();
  });

  it('fails closed when the stored audit chain is tampered', async () => {
    const ledger = create();
    await ledger.appendBatch({ auditEvents: [auditDraft] });
    const events = await ledger.listAuditEvents();
    const tampered: AuditEvent = { ...events[0]!, outcome: 'failed' };
    expect(verifyAuditChain([tampered])).toBe(false);
    await ledger.close();
  });
});

describe('observability application adapters', () => {
  it('writes collector samples and audit drafts through the existing ledger without a second table', async () => {
    const ledger = new InMemoryObservabilityLedger();
    const audit = new AuditApplicationAdapter(ledger, { now: () => new Date(at) });
    const auditResult = await audit.record({
      actor: 'system', transport: 'loopback', action: 'audit.verified', targetKind: 'audit',
      outcome: 'succeeded', correlationId: 'corr_adapter_01',
    });
    const runtime: ResourceRuntime = {
      cpuUsage: () => ({ user: 0, system: 0 }),
      memoryUsage: () => ({ rss: 1, heapTotal: 1, heapUsed: 1, external: 0, arrayBuffers: 0 }),
      totalmem: () => 10,
      freemem: () => 5,
      cpuCount: () => 1,
      monotonicMs: () => 0,
      now: () => new Date(at),
    };
    const collector = new ResourceCollector({ writer: ledger, runtime });
    await collector.sampleOnce();
    await collector.flush();

    expect(auditResult.status).toBe('recorded');
    expect(await ledger.listAuditEvents()).toHaveLength(1);
    expect(await ledger.listResourceSamples()).toHaveLength(1);
    expect(verifyAuditChain(await ledger.listAuditEvents())).toBe(true);
  });
});

describe('SqliteObservabilityLedger', () => {
  it('persists all four bounded tables across restart without touching run_events', async () => {
    const path = databasePath();
    const runStore = new SqliteEventStore(path);
    await runStore.append({ runId, type: 'run.created', source: 'system', correlationId: 'corr_run', payload: { ok: true } });
    const first = new SqliteObservabilityLedger(path);
    await appendFixture(first);
    await first.rebuildRollups();
    first.close();

    const reopened = new SqliteObservabilityLedger(path);
    expect(await reopened.listResourceSamples()).toEqual([sample]);
    expect(await reopened.listModelUsage()).toEqual([model]);
    expect(await reopened.listToolUsage()).toEqual([tool]);
    expect(await reopened.listAuditEvents()).toHaveLength(1);
    expect(await reopened.listRollups()).toHaveLength(1);
    expect(await runStore.read(runId)).toHaveLength(1);
    reopened.close();
    runStore.close();
    cleanup(path);
  });

  it('cleans only samples and rollups, never usage or audit history', async () => {
    const store = new SqliteObservabilityLedger(':memory:');
    await appendFixture(store);
    await store.rebuildRollups();
    const result = await store.cleanup({ samplesBefore: '2026-08-05T00:00:00.000Z', rollupsBefore: '2026-08-05T00:00:00.000Z' });
    expect(result).toEqual({ resourceSamples: 1, rollups: 1 });
    expect(await store.listModelUsage()).toHaveLength(1);
    expect(await store.listAuditEvents()).toHaveLength(1);
    await store.close();
  });

  it('rejects operations after close', async () => {
    const store = new SqliteObservabilityLedger(':memory:');
    await store.close();
    await expect(store.listModelUsage()).rejects.toThrow('closed');
  });
});
