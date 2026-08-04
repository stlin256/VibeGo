import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelUsageRecord, ResourceSample, ToolUsageRecord } from '@ready4vibe/contracts';
import { AuthGate } from '@ready4vibe/auth';
import type { AuditEventDraft } from '@ready4vibe/observability';
import { InMemoryObservabilityLedger, type ObservabilityLedger } from '@ready4vibe/storage';
import { createDaemonServer } from './server.js';

const servers: ReturnType<typeof createDaemonServer>[] = [];
const ledgers: ObservabilityLedger[] = [];
const at = '2026-08-04T10:00:00.000Z';

const model: ModelUsageRecord = {
  schemaVersion: 'ready4vibe_model_usage_v1', usageId: 'usage_daemon_api_01', runId: 'run_daemon_api_01', turnId: 'turn_daemon_api_01', requestId: 'request_daemon_api_01',
  providerId: 'deepseek', model: 'deepseek-v4-flash', attempt: 1, startedAt: at, status: 'completed', tokens: { input: 10, output: 4 }, tokenAccuracy: 'reported',
};
const tool: ToolUsageRecord = {
  schemaVersion: 'ready4vibe_tool_usage_v1', usageId: 'tool_daemon_api_01', runId: 'run_daemon_api_01', turnId: 'turn_daemon_api_01', callId: 'call_daemon_api_01', toolId: 'filesystem.read', attempt: 1, startedAt: at, status: 'completed', risk: 'read', runtime: 'host-restricted', accuracy: 'measured',
};
const sample: ResourceSample = {
  schemaVersion: 'ready4vibe_resource_sample_v1', sampleId: 'sample_daemon_api_01', sampledAt: at, scope: 'daemon', source: 'node', accuracy: 'measured', cpu: { milliPercent: 100 }, memory: { rssBytes: '1000' }, samplingIntervalMs: 5000, droppedSampleCount: 1,
};
const audit: AuditEventDraft = {
  schemaVersion: 'ready4vibe_audit_event_v1', eventId: 'audit_daemon_api_01', at, actor: 'system', transport: 'loopback', action: 'run.completed', targetKind: 'run', targetId: 'run_daemon_api_01', outcome: 'succeeded', correlationId: 'corr_daemon_api_01', safeDetails: { status: 'completed' },
};

async function listen(server: ReturnType<typeof createDaemonServer>): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

async function fixtureLedger(): Promise<InMemoryObservabilityLedger> {
  const ledger = new InMemoryObservabilityLedger();
  ledgers.push(ledger);
  await ledger.appendBatch({ modelUsages: [model], toolUsages: [tool], resourceSamples: [sample], auditEvents: [audit] });
  return ledger;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const ledger of ledgers.splice(0)) await ledger.close();
});

describe('observability daemon API', () => {
  it('projects summary, timeseries, run usage, audit pages, and operations without raw payloads', async () => {
    const ledger = await fixtureLedger();
    const server = createDaemonServer({ observabilityLedger: ledger });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const summary = await fetch(`${base}/api/v1/usage/summary?range=24h`);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ schemaVersion: 'ready4vibe_observability_api_v1', modelAttempts: 1, toolCalls: 1, tokens: { input: { total: 10 }, output: { total: 4 } } });

    const timeseries = await fetch(`${base}/api/v1/usage/timeseries?metric=tokens&range=24h`);
    expect(timeseries.status).toBe(200);
    expect(await timeseries.json()).toMatchObject({ metric: 'tokens', points: [{ inputTokens: 10, outputTokens: 4 }] });

    const runUsage = await fetch(`${base}/api/v1/runs/${model.runId}/usage`);
    expect(runUsage.status).toBe(200);
    expect(await runUsage.json()).toMatchObject({ runId: model.runId, modelUsages: [{ usageId: model.usageId }], toolUsages: [{ usageId: tool.usageId }] });

    const auditPage = await fetch(`${base}/api/v1/audit/events?action=run.completed&outcome=succeeded`);
    const auditBody = await auditPage.json() as { events: Array<Record<string, unknown>> };
    expect(auditPage.status).toBe(200);
    expect(auditBody.events).toHaveLength(1);
    expect(JSON.stringify(auditBody)).not.toMatch(/api[_-]?key|secret|C:\\|prompt|transcript|tool output/iu);

    expect((await fetch(`${base}/api/v1/usage/rebuild`, { method: 'POST' })).status).toBe(200);
    expect((await fetch(`${base}/api/v1/audit/verify`, { method: 'POST' })).status).toBe(200);
  });

  it('fails closed on malformed bounded query parameters', async () => {
    const server = createDaemonServer({ observabilityLedger: await fixtureLedger() });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    await expect(fetch(`${base}/api/v1/usage/summary?range=all`)).resolves.toMatchObject({ status: 400 });
    await expect(fetch(`${base}/api/v1/usage/timeseries?metric=prompt`)).resolves.toMatchObject({ status: 400 });
    await expect(fetch(`${base}/api/v1/audit/events?after=-1`)).resolves.toMatchObject({ status: 400 });
    await expect(fetch(`${base}/api/v1/audit/events?action=../secret`)).resolves.toMatchObject({ status: 400 });
  });

  it('returns stable degraded errors when the ledger is unavailable', async () => {
    const server = createDaemonServer();
    servers.push(server);
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/usage/summary`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
  });

  it('keeps LAN authentication as the existing boundary for observability routes', async () => {
    const authGate = new AuthGate({ mode: 'lan', tlsRequired: false, randomBytes: () => new Uint8Array(64) });
    const server = createDaemonServer({ host: '0.0.0.0', transportMode: 'lan', authGate, observabilityLedger: await fixtureLedger() });
    servers.push(server);
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/usage/summary`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });
});
