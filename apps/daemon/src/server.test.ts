import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY, type AgentMemoryKnowledgeProvider, type AgentMemoryKnowledgeToolList, type AgentMemoryKnowledgeResult, type AgentMemoryStatus, type ModelEvent, type ModelProvider, type ModelRequest, type NewGoalEvent } from '@ready4vibe/contracts';
import { InMemoryApprovalBroker } from '@ready4vibe/agent';
import { AuthGate } from '@ready4vibe/auth';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore, InMemorySettingsStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { RunManager } from './run-manager.js';
import { InMemoryModelSettingsManager } from './model-config.js';
import { createDaemonServer } from './server.js';
import { InMemoryToolSettingsManager } from './tool-settings.js';
import { InMemorySandboxSettingsManager } from './sandbox-settings.js';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import { InMemoryGitSettingsManager } from './git-settings.js';
import { InMemoryGoalEventStore, createGoalEvent } from '@ready4vibe/goal-control';
import { AgentMemorySettingsManager } from './agent-memory-settings.js';
import { AgentMemoryKnowledgeSettingsManager } from './agent-memory-knowledge-settings.js';
import { McpSettingsManager } from './mcp-settings.js';

const servers: ReturnType<typeof createDaemonServer>[] = [];

const runConfig = (workspaceId = 'workspace-api') => ({
  workspaceId,
  userMessage: 'say hello',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: {
    maxTurns: 1,
    maxWallTimeMs: 60_000,
    maxModelInputTokens: 100,
    maxModelOutputTokens: 100,
    maxToolCalls: 10,
    maxOutputBytes: 100,
    maxContextBytes: 100_000,
  },
  createdBySessionId: 'session-api',
  clientRequestId: `client-${workspaceId}`,
});

async function goalStoreForApi(): Promise<InMemoryGoalEventStore> {
  const store = new InMemoryGoalEventStore();
  const goalId = 'goal_12345678';
  const todoId = 'todo_12345678';
  const at = '2026-08-03T00:00:00.000Z';
  await store.appendBatch([
    createGoalEvent({
      eventId: 'gevt_00000001',
      goalId,
      eventType: 'goal.created',
      recordedAt: at,
      producer: 'server-test',
      privacy: 'local_private',
      refs: {},
      payload: {
        goal: {
          goalId,
          title: 'Server Goal',
          objective: 'Verify the authenticated projection boundary.',
          status: 'active',
          controlRevision: 0,
          createdAt: at,
          updatedAt: at,
          schemaVersion: 1,
        },
      },
    }),
    createGoalEvent({
      eventId: 'gevt_00000002',
      goalId,
      eventType: 'todo.added',
      recordedAt: at,
      producer: 'server-test',
      privacy: 'local_private',
      refs: { todoId },
      payload: {
        todo: {
          todoId,
          goalId,
          role: 'agent',
          status: 'open',
          taskClass: 'advancement',
          title: 'Check API',
          priority: 1,
        },
      },
    }),
    createGoalEvent({
      eventId: 'gevt_00000003',
      goalId,
      eventType: 'todo.claimed',
      recordedAt: at,
      producer: 'server-test',
      privacy: 'local_private',
      refs: { todoId },
      payload: {
        todoId,
        claimedBy: 'agent-a',
        claimTokenHash: 'b'.repeat(64),
        claimedAt: at,
        claimExpiresAt: '2026-08-03T01:00:00.000Z',
      },
    }),
  ] as NewGoalEvent[]);
  return store;
}

async function listen(server: ReturnType<typeof createDaemonServer>): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

function makeRunServer(provider: FakeModelProvider, bodyLimitBytes?: number) {
  const manager = new RunManager({
    eventStore: new InMemoryEventStore(),
    scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
    modelProvider: provider,
  });
  const server = bodyLimitBytes === undefined
    ? createDaemonServer({ runManager: manager })
    : createDaemonServer({ runManager: manager, bodyLimitBytes });
  servers.push(server);
  return { manager, server };
}

class ApprovalModelProvider implements ModelProvider {
  readonly id = 'approval-model';
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: true } as const;
  private turn = 0;

  async *stream(_request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (this.turn++ === 0) {
      yield { type: 'tool-call-delta', callId: 'server-approval', name: 'write', argumentsChunk: '{}' };
      yield { type: 'completed', finishReason: 'tool-calls' };
      return;
    }
    yield { type: 'text-delta', text: 'approved' };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

class UntrustedApprovalModelProvider implements ModelProvider {
  readonly id = 'untrusted-approval-model';
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: true } as const;
  private turn = 0;

  async *stream(_request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (this.turn++ === 0) {
      yield { type: 'tool-call-delta', callId: 'untrusted-shell', name: 'shell.exec', argumentsChunk: JSON.stringify({ argv: ['printf', 'approved'] }) };
      yield { type: 'completed', finishReason: 'tool-calls' };
      return;
    }
    yield { type: 'text-delta', text: 'approved' };
    yield { type: 'completed', finishReason: 'stop' };
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }));
});

describe('daemon health server', () => {
  it('accepts a single approval decision and resumes the waiting run', async () => {
    const provider = new ApprovalModelProvider();
    let approved = false;
    const runtime = {
      descriptors: [{ name: 'write', id: 'test.write', version: '1.0.0', risk: 'write' as const, summary: 'Write' }],
      execute: async () => {
        if (!approved) throw Object.assign(new Error('prompt'), { code: 'APPROVAL_REQUIRED' });
        return { output: { ok: true } };
      },
      approve: async () => { approved = true; },
    };
    const manager = new RunManager({ eventStore: new InMemoryEventStore(), scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime, approvalBroker: new InMemoryApprovalBroker({ timeoutMs: 2_000 }) });
    const server = createDaemonServer({ runManager: manager });
    servers.push(server);
    const port = await listen(server);
    const started = await manager.start({ ...runConfig('workspace-approval'), limits: { ...runConfig('workspace-approval').limits, maxTurns: 2 } });
    await vi.waitFor(() => expect(manager.snapshot(started.runId).then((snapshot) => snapshot?.approvals)).resolves.toHaveLength(1));
    const pending = (await manager.snapshot(started.runId))!.approvals[0]!;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/runs/${started.runId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: pending.approvalId, decision: 'allow' }) });
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(manager.completion(started.runId)?.status).toBe('completed'));
    expect((await manager.snapshot(started.runId))?.output).toBe('approved');
    const repeated = await fetch(`http://127.0.0.1:${port}/api/v1/runs/${started.runId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: pending.approvalId, decision: 'deny' }) });
    expect(repeated.status).toBe(409);
  });

  it('keeps an untrusted external-sandbox tool behind approval and executes it once after Web allow', async () => {
    const provider = new UntrustedApprovalModelProvider();
    const processCalls: unknown[] = [];
    const workspaceRegistry = new InMemoryWorkspaceRegistry({ defaultRoot: process.cwd() });
    const sandboxSettings = new InMemorySandboxSettingsManager({
      workspaceRegistry,
      probe: { probe: async () => ({ detected: true, healthy: true, version: 'fixture' }) },
      processRunner: {
        run: async (plan) => {
          processCalls.push(plan);
          return { exitCode: 0, stdout: 'approved', stderr: '', truncated: false, timedOut: false, cancelled: false };
        },
      },
    });
    const imageDigest = `ghcr.io/ready4vibe/runner@sha256:${'c'.repeat(64)}`;
    await sandboxSettings.probe('docker');
    await sandboxSettings.configure({ provider: 'docker', imageDigest, network: 'restricted', resources: {}, enabled: true });
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: provider,
      toolRuntimeForRun: (config) => sandboxSettings.runtimeForRun(config),
      approvalBroker: new InMemoryApprovalBroker({ timeoutMs: 2_000 }),
      workspaceExists: (workspaceId) => workspaceId === 'default',
    });
    const server = createDaemonServer({ runManager: manager });
    servers.push(server);
    const port = await listen(server);
    const started = await manager.start({
      ...runConfig('default'),
      taskTrust: 'untrusted-content',
      sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' },
      approval: 'untrusted',
      limits: { ...runConfig('default').limits, maxTurns: 2 },
    });

    await vi.waitFor(() => expect(manager.snapshot(started.runId).then((snapshot) => snapshot?.approvals)).resolves.toHaveLength(1));
    const pending = (await manager.snapshot(started.runId))!.approvals[0]!;
    expect(pending).toMatchObject({ toolId: 'shell.exec', risk: 'destructive', details: { sandboxProvider: 'docker', sandboxImageDigest: imageDigest, network: 'restricted' } });
    expect(processCalls).toHaveLength(0);

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/runs/${started.runId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: pending.approvalId, decision: 'allow' }) });
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(manager.completion(started.runId)?.status).toBe('completed'));
    expect((await manager.snapshot(started.runId))?.output).toBe('approved');
    expect(processCalls).toHaveLength(1);
    expect((processCalls[0] as { runtime?: string; argv?: readonly string[] }).runtime).toBe('docker');
    expect((processCalls[0] as { argv?: readonly string[] }).argv).toEqual(expect.arrayContaining(['docker', 'run', '--rm', '--init', '--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit', '128', '--network', 'none', '--memory', '536870912b', '--cpus', '2', imageDigest, 'printf', 'approved']));

    const repeated = await fetch(`http://127.0.0.1:${port}/api/v1/runs/${started.runId}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ approvalId: pending.approvalId, decision: 'deny' }) });
    expect(repeated.status).toBe(409);
    const events = await manager.eventStore.read(started.runId);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(['approval.required', 'approval.decided', 'tool.completed', 'run.completed']));
    expect(events.filter((event) => event.type === 'tool.started')).toHaveLength(2);
  });

  it('keeps tools opt-in while forwarding an explicitly injected runtime', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const runtime = {
      descriptors: [{ name: 'echo', id: 'test.echo', version: '1.0.0', risk: 'read' as const, summary: 'Echo' }],
      execute: vi.fn(async () => ({ output: 'unused' })),
    };
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: provider,
      toolRuntime: runtime,
    });

    const { runId } = await manager.start(runConfig());
    await vi.waitFor(() => expect(manager.completion(runId)?.status).toBe('completed'));
    expect(provider.requests[0]?.tools).toEqual([expect.objectContaining({ type: 'function' })]);
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('rejects invalid TLS material before opening a listener', () => {
    expect(() => createDaemonServer({ tls: { cert: Buffer.from('not a certificate'), key: Buffer.from('not a key') } })).toThrow();
  });

  it('serves a secret-free health response on loopback', async () => {
    const server = createDaemonServer({ host: '127.0.0.1', storageKind: 'sqlite', version: 'test-version' });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', service: 'ready4vibe-daemon', version: 'test-version' });
    expect(body).toHaveProperty('transport.tlsRequired', false);
    expect(body).toHaveProperty('storage.kind', 'sqlite');
    expect(JSON.stringify(body)).not.toContain('token');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('serves certificate metadata without PEM material and reports missing status', async () => {
    const unavailable = createDaemonServer();
    servers.push(unavailable);
    const unavailablePort = await listen(unavailable);
    const missing = await fetch(`http://127.0.0.1:${unavailablePort}/api/v1/certificates/status`);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: { code: 'CERTIFICATE_STATUS_UNAVAILABLE' } });

    const server = createDaemonServer({
      certificateStatus: {
        subject: 'CN=dev.example.test',
        issuer: 'CN=Test CA',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2030-01-01T00:00:00.000Z',
        daysRemaining: 1_000,
        fingerprint256: 'AA:BB:CC',
        subjectAltNames: ['dev.example.test'],
      },
    });
    servers.push(server);
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/certificates/status`);
    const body = await response.json() as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ subject: 'CN=dev.example.test', subjectAltNames: ['dev.example.test'] });
    expect(JSON.stringify(body)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(body)).not.toContain('cert.pem');
  });

  it('serves authenticated read-only Goal projections and bounded event replay', async () => {
    const goalEventStore = await goalStoreForApi();
    const server = createDaemonServer({ goalEventStore });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const list = await fetch(`${base}/api/v1/goals`);
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      schemaVersion: 'ready4vibe_goal_api_v0',
      goals: [{ goal: { goalId: 'goal_12345678' }, sourceEventCount: 3 }],
    });

    const detail = await fetch(`${base}/api/v1/goals/goal_12345678`);
    const detailBody = await detail.json() as Record<string, unknown>;
    expect(detail.status).toBe(200);
    expect(detailBody).toHaveProperty('goal.goalId', 'goal_12345678');
    expect(JSON.stringify(detailBody)).not.toContain('claimTokenHash');

    const page = await fetch(`${base}/api/v1/goals/goal_12345678/events?after=1&limit=1`);
    const pageBody = await page.json() as { nextAfter: number; hasMore: boolean; events: unknown[] };
    expect(page.status).toBe(200);
    expect(pageBody).toMatchObject({ nextAfter: 2, hasMore: true });
    expect(pageBody.events).toHaveLength(1);

    const claimPage = await fetch(`${base}/api/v1/goals/goal_12345678/events?after=2&limit=1`);
    expect(JSON.stringify(await claimPage.json())).not.toContain('claimTokenHash');

    const invalidLimit = await fetch(`${base}/api/v1/goals/goal_12345678/events?limit=1001`);
    expect(invalidLimit.status).toBe(400);
    await expect(fetch(`${base}/api/v1/goals/goal_missing1`)).resolves.toMatchObject({ status: 404 });
    await expect(fetch(`${base}/api/v1/goals`, { method: 'POST' })).resolves.toMatchObject({ status: 405 });
  });

  it('inherits the LAN auth gate for Goal projection reads', async () => {
    const authGate = new AuthGate({ mode: 'lan', tlsRequired: false, randomBytes: (() => new Uint8Array(64)) });
    const server = createDaemonServer({ host: '0.0.0.0', transportMode: 'lan', authGate, goalEventStore: await goalStoreForApi() });
    servers.push(server);
    const port = await listen(server);
    const denied = await fetch(`http://127.0.0.1:${port}/api/v1/goals`);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('supports the versioned alias and rejects unknown paths', async () => {
    const server = createDaemonServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    await expect(fetch(`http://127.0.0.1:${address.port}/api/v1/health`)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(`http://127.0.0.1:${address.port}/runs`)).resolves.toMatchObject({ status: 404 });
  });

  it('allows only GET for health', async () => {
    const server = createDaemonServer();
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/health`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('creates a run, projects a snapshot, and replays terminal SSE events', async () => {
    const { server } = makeRunServer(new FakeModelProvider({ events: [
      { type: 'text-delta', text: 'hello' },
      { type: 'completed', finishReason: 'stop' },
    ] }));
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const created = await fetch(`${base}/api/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runConfig()),
    });
    const createdBody = await created.json() as { runId: string; status: string };
    expect(created.status).toBe(202);
    expect(createdBody.status).toBe('queued');

    let snapshot: { status: string; output: string; lastEventSeq: number } | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${base}/api/v1/runs/${createdBody.runId}`);
      const current = await response.json() as { status: string; output: string; lastEventSeq: number };
      snapshot = current;
      if (current.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(snapshot).toBeDefined();
    if (!snapshot) throw new Error('snapshot was not returned');
    expect(snapshot).toMatchObject({ status: 'completed', output: 'hello' });

    const sse = await fetch(`${base}/api/v1/runs/${createdBody.runId}/events`);
    const text = await sse.text();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(sse.status).toBe(200);
    expect(ids.length).toBe(snapshot.lastEventSeq);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));

    const after = ids[0] ?? 0;
    const resumed = await fetch(`${base}/api/v1/runs/${createdBody.runId}/events?after=${after}`);
    const resumedText = await resumed.text();
    const resumedIds = [...resumedText.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(resumedIds.every((id) => id > after)).toBe(true);
  });

  it('requires explicit confirmation before retrying a recovered run', async () => {
    const eventStore = new InMemoryEventStore();
    const recoveredRunId = 'run_recovered_api';
    await eventStore.append({ runId: recoveredRunId, type: 'run.created', source: 'user', correlationId: 'corr_recovery', payload: { config: runConfig('workspace-retry') } });
    await eventStore.append({ runId: recoveredRunId, type: 'run.status', source: 'system', correlationId: 'corr_recovery', payload: { from: 'created', to: 'queued' } });
    const manager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }) });
    await manager.recoverAfterRestart();
    const server = createDaemonServer({ runManager: manager });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/runs/${recoveredRunId}/retry`;

    const invalid = await fetch(base, { method: 'POST', body: JSON.stringify({ confirmation: 'retry' }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });

    const retried = await fetch(base, { method: 'POST', body: JSON.stringify({ confirmation: 'retry-as-new-run' }) });
    const body = await retried.json() as { runId: string; status: string; retryOf: string };
    expect(retried.status).toBe(202);
    expect(body).toMatchObject({ status: 'queued', retryOf: recoveredRunId });
    expect(body.runId).not.toBe(recoveredRunId);
    const snapshot = await manager.snapshot(body.runId);
    expect(snapshot?.config.clientRequestId).toMatch(/^recovery_/u);
    expect((await manager.snapshot(recoveredRunId))?.status).toBe('needs-recovery');
  });

  it('cancels an active run idempotently', async () => {
    const { server } = makeRunServer(new FakeModelProvider({
      delayMs: 25,
      events: [{ type: 'text-delta', text: 'slow' }, { type: 'completed', finishReason: 'stop' }],
    }));
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const created = await fetch(`${base}/api/v1/runs`, {
      method: 'POST',
      body: JSON.stringify(runConfig('workspace-cancel')),
    });
    const { runId } = await created.json() as { runId: string };
    const cancelled = await fetch(`${base}/api/v1/runs/${runId}/cancel`, { method: 'POST' });
    const cancelledBody = await cancelled.json() as { status: string };
    expect(cancelled.status).toBe(202);
    expect(cancelledBody.status).toBe('cancelling');

    const repeated = await fetch(`${base}/api/v1/runs/${runId}/cancel`, { method: 'POST' });
    expect(repeated.status).toBe(202);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await fetch(`${base}/api/v1/runs/${runId}`);
      const body = await response.json() as { status: string };
      if (body.status === 'cancelled') {
        expect(body.status).toBe('cancelled');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('run did not reach cancelled state');
  });

  it('rejects malformed and oversized run bodies', async () => {
    const { server } = makeRunServer(new FakeModelProvider({ events: [] }), 32);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/runs`;
    const malformed = await fetch(base, { method: 'POST', body: '{' });
    expect(malformed.status).toBe(400);
    expect((await malformed.json())).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    const oversized = await fetch(base, { method: 'POST', body: 'x'.repeat(100) });
    expect(oversized.status).toBe(413);
    expect((await oversized.json())).toMatchObject({ error: { code: 'BODY_TOO_LARGE' } });
  });

  it('gates LAN APIs behind pairing while keeping health secret-free', async () => {
    const authGate = new AuthGate({ mode: 'lan', tlsRequired: false, randomBytes: (() => {
      let value = 0;
      return (size: number) => Uint8Array.from({ length: size }, () => (value += 1) % 255);
    })() });
    const server = createDaemonServer({ host: '0.0.0.0', transportMode: 'lan', authGate });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${address.port}`;

    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ transport: { kind: 'http-lan', tlsRequired: false }, auth: { pairingRequired: true } });

    const denied = await fetch(`${base}/api/v1/runs/run_missing`);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
    const deniedCertificateStatus = await fetch(`${base}/api/v1/certificates/status`);
    expect(deniedCertificateStatus.status).toBe(401);

    const pairingStart = await fetch(`${base}/api/v1/pairing/start`, { method: 'POST' });
    const pairing = await pairingStart.json() as { code: string };
    expect(pairingStart.status).toBe(200);
    const pairingComplete = await fetch(`${base}/api/v1/pairing/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairing.code }),
    });
    const session = await pairingComplete.json() as { accessToken: string };
    expect(pairingComplete.status).toBe(200);
    const allowed = await fetch(`${base}/api/v1/runs/run_missing`, { headers: { authorization: `Bearer ${session.accessToken}` } });
    expect(allowed.status).toBe(503);
    expect(await allowed.json()).toMatchObject({ error: { code: 'RUNS_UNAVAILABLE' } });
  });

  it('serves and mutates model settings without returning the provider key', async () => {
    const modelSettings = new InMemoryModelSettingsManager({});
    const server = createDaemonServer({ modelSettings });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/settings/model`;
    const initial = await fetch(base);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({ configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured' });
    const configured = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' }),
    });
    const configuredBody = await configured.text();
    expect(configured.status).toBe(200);
    expect(configuredBody).not.toContain('test-secret');
    expect(JSON.parse(configuredBody)).toMatchObject({ configured: true, source: 'web-memory', providerId: 'openai-compatible' });
    const cleared = await fetch(base, { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ configured: false, source: 'unconfigured' });
  });

  it('rejects a run whose provider selection does not match the captured daemon binding', async () => {
    const modelSettings = new InMemoryModelSettingsManager({});
    modelSettings.configure({ provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', apiKey: 'test-secret', model: 'deepseek-v4-flash' });
    const eventStore = new InMemoryEventStore();
    const manager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
      modelBindingForRun: (config) => modelSettings.bindRun(config.model),
    });
    const server = createDaemonServer({ runManager: manager, modelSettings });
    servers.push(server);
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runConfig()),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'INVALID_PROVIDER', message: 'The requested model provider is not configured for this daemon.' } });
    expect(eventStore.listRunIds()).toEqual([]);
  });

  it('serves durable agent-memory settings and keeps provider secrets/paths out of the API', async () => {
    const manager = new AgentMemorySettingsManager({ settings: new InMemorySettingsStore() });
    const server = createDaemonServer({ agentMemorySettings: manager });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/settings/agent-memory`;
    const initial = await fetch(base);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ settings: { enabled: false, mode: 'off' }, status: { updateState: 'disabled' } });
    const patched = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo', upstreamRef: 'feat/server_team' }) });
    const patchedBody = await patched.text();
    expect(patched.status).toBe(200);
    expect(patchedBody).not.toContain('apiKey');
    expect(patchedBody).not.toContain('C:\\Users');
    expect(JSON.parse(patchedBody)).toMatchObject({ settings: { enabled: true, userId: 'user_demo' }, status: { degraded: true, lastErrorCode: 'unavailable' } });
    const malformed = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: 'secret' }) });
    expect(malformed.status).toBe(400);
    const probe = await fetch(`${base}/probe`, { method: 'POST' });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ status: { degraded: true } });
    const update = await fetch(`${base}/update`, { method: 'POST' });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ status: { lastErrorCode: 'update' } });
    const webhook = await fetch(`${base}/webhook`, { method: 'POST' });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toMatchObject({ status: { lastErrorCode: 'update' } });
    const rollback = await fetch(`${base}/rollback`, { method: 'POST' });
    expect(rollback.status).toBe(200);
    expect(await rollback.json()).toMatchObject({ status: { lastErrorCode: 'rollback' } });
    const operations = await fetch(`${base}/updates`);
    expect(operations.status).toBe(200);
    const operationsBody = await operations.text();
    expect(operationsBody).toContain('ready4vibe_agent_memory_operations_v1');
    expect(operationsBody).not.toMatch(/api[_-]?key|C:\\Users|secret/iu);
  });

  it('serves independent knowledge settings and bounded probe without exposing sidecar details', async () => {
    const list: AgentMemoryKnowledgeToolList = {
      schemaVersion: 'ready4vibe_agent_memory_knowledge_tools_v1', knowledgeId: 'wiki_demo', resourceType: 'wiki', name: 'Demo docs', summary: null, status: 'ready',
      tools: [{ name: 'search', description: 'Search docs.', params: { query: { type: 'string', required: true } } }], sourceRevision: 'knowledge_rev_1', elapsedMs: 1, degraded: false, errorCode: null,
    };
    const result: AgentMemoryKnowledgeResult = {
      schemaVersion: 'ready4vibe_agent_memory_knowledge_result_v1', knowledgeId: 'wiki_demo', toolName: 'search', items: [], sourceRevision: 'knowledge_rev_1', elapsedMs: 1, degraded: false, errorCode: null,
    };
    const provider: AgentMemoryKnowledgeProvider = {
      id: 'tencentdb-memory-knowledge',
      status: vi.fn(async (): Promise<AgentMemoryStatus> => ({ schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: true, mode: 'full-stack', available: true, degraded: false, revision: 'knowledge_rev_1', previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'ready', lastErrorCode: null, capabilities: ['knowledge'] })),
      listTools: vi.fn(async () => list),
      call: vi.fn(async () => result),
      retrieve: vi.fn(async () => result),
      close: vi.fn(async () => undefined),
    };
    const manager = new AgentMemoryKnowledgeSettingsManager({ settings: new InMemorySettingsStore(), provider });
    const server = createDaemonServer({ agentMemoryKnowledgeSettings: manager });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/settings/agent-memory/knowledge`;
    const initial = await fetch(base);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ settings: { enabled: false, knowledgeId: 'wiki_demo', autoRetrieve: false } });
    const patched = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, autoRetrieve: true, knowledgeId: 'wiki_demo' }) });
    expect(patched.status).toBe(200);
    const patchedBody = await patched.text();
    expect(patchedBody).not.toMatch(/endpoint|api[_-]?key|C:\\Users/iu);
    const probe = await fetch(`${base}/probe`, { method: 'POST' });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ available: true, resourceType: 'wiki', resourceName: 'Demo docs', tools: [{ name: 'search' }] });
    const malformed = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'http://private' }) });
    expect(malformed.status).toBe(400);
  });

  it('serves explicit filesystem tool settings without exposing the workspace path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-tool-settings-'));
    try {
      const toolSettings = new InMemoryToolSettingsManager(root);
      const server = createDaemonServer({ toolSettings });
      servers.push(server);
      const port = await listen(server);
      const base = `http://127.0.0.1:${port}/api/v1/settings/tools`;
      const initial = await fetch(base);
      expect(initial.status).toBe(200);
      const initialBody = await initial.text();
      expect(initialBody).not.toContain(root);
      expect(JSON.parse(initialBody)).toMatchObject({ filesystemEnabled: false, availableTools: [] });
      const enabled = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filesystemEnabled: true }) });
      expect(enabled.status).toBe(200);
      expect(await enabled.json()).toMatchObject({ filesystemEnabled: true, availableTools: ['filesystem.read@1.0.0', 'filesystem.write@1.0.0'] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serves explicit Git read-only settings without exposing the workspace path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-git-settings-'));
    try {
      const gitSettings = new InMemoryGitSettingsManager({ workspaceRegistry: new InMemoryWorkspaceRegistry({ defaultRoot: root }), processRunner: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false }) } });
      const server = createDaemonServer({ gitSettings });
      servers.push(server);
      const port = await listen(server);
      const base = `http://127.0.0.1:${port}/api/v1/settings/git`;
      const initial = await fetch(base);
      const initialBody = await initial.text();
      expect(initial.status).toBe(200);
      expect(initialBody).not.toContain(root);
      expect(JSON.parse(initialBody)).toMatchObject({ enabled: false, availableTools: [] });
      const malformed = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: 'yes' }) });
      expect(malformed.status).toBe(400);
      const pathInjection = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, path: root }) });
      expect(pathInjection.status).toBe(400);
      const enabled = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      expect(enabled.status).toBe(200);
      const enabledBody = await enabled.text();
      expect(enabledBody).not.toContain(root);
      expect(JSON.parse(enabledBody)).toMatchObject({ enabled: true, availableTools: ['git.status@1.0.0', 'git.diff@1.0.0', 'git.log@1.0.0'] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps external sandbox probing and enablement explicit and secret-free', async () => {
    const sandboxSettings = new InMemorySandboxSettingsManager({ probe: { probe: async () => ({ detected: true, healthy: true, version: 'test-runtime' }) }, processRunner: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false }) } });
    const server = createDaemonServer({ sandboxSettings });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/settings/sandbox`;
    expect(await (await fetch(base)).json()).toMatchObject({ enabled: false, detected: false, healthy: false, provider: null });
    const rejected = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'docker', imageDigest: 'node:22', network: 'restricted', resources: {}, enabled: true }) });
    expect(rejected.status).toBe(400);
    const probe = await fetch(`${base}/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'docker' }) });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toMatchObject({ healthy: true, capabilities: { version: 'test-runtime' } });
    const enabled = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'docker', imageDigest: `ghcr.io/ready4vibe/runner@sha256:${'a'.repeat(64)}`, network: 'restricted', resources: {}, enabled: true }) });
    const enabledBody = await enabled.text();
    expect(enabled.status).toBe(200);
    expect(enabledBody).not.toContain('C:\\Users');
    expect(JSON.parse(enabledBody)).toMatchObject({ enabled: true, provider: 'docker', imageDigest: expect.stringContaining('@sha256:') });
  });

  it('serves optional MCP settings/status without starting transport when disabled', async () => {
    const probe = { probe: vi.fn(async () => ({
      schemaVersion: 'ready4vibe_mcp_probe_result_v0' as const,
      serverId: 'demo-mcp',
      manifestRevision: 'manifest-20260804',
      health: 'healthy-verified' as const,
      currentRevision: 'cap-20260804',
      previousRevision: null,
      capabilityCount: 1,
    })) };
    const mcpSettings = new McpSettingsManager({ settings: new InMemorySettingsStore(), probe });
    const server = createDaemonServer({ mcpSettings });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}/api/v1/settings/mcp`;

    const initial = await fetch(base);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ status: 'disabled', settings: { enabled: false, transport: 'stdio' }, nextAction: 'enable' });
    const noOpProbe = await fetch(`${base}/probe`, { method: 'POST' });
    expect(noOpProbe.status).toBe(200);
    expect(await noOpProbe.json()).toMatchObject({ status: 'disabled' });
    expect(probe.probe).not.toHaveBeenCalled();

    const enabled = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      enabled: true, serverId: 'demo-mcp', serverVersion: '1.2.3', transport: 'streamable-http', endpointLabel: 'Demo integration',
      manifestRevision: 'manifest-20260804', capabilityAllowlist: ['demo-mcp/tool/read_file@1.0.0'],
    }) });
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ status: 'degraded', degraded: true, nextAction: 'probe' });
    expect(probe.probe).not.toHaveBeenCalled();

    const unsafe = await fetch(base, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpointLabel: 'https://example.test' }) });
    expect(unsafe.status).toBe(400);
    expect(await unsafe.json()).toMatchObject({ error: { code: 'INVALID_SETTINGS' } });

    const probed = await fetch(`${base}/probe`, { method: 'POST' });
    expect(probed.status).toBe(200);
    expect(await probed.json()).toMatchObject({ status: 'ready', health: 'healthy-verified', currentRevision: 'cap-20260804', capabilityCount: 1, nextAction: 'none' });
    expect(probe.probe).toHaveBeenCalledTimes(1);
    expect((await (await fetch(base)).text())).not.toMatch(/rawResponse|token|secret|C:\\\\|\/(?:Users|home)\//iu);
  });

  it('keeps MCP settings behind the existing LAN authentication gate', async () => {
    const authGate = new AuthGate({ mode: 'lan', tlsRequired: false, randomBytes: (() => new Uint8Array(64)) });
    const mcpSettings = new McpSettingsManager({ settings: new InMemorySettingsStore() });
    const server = createDaemonServer({ host: '0.0.0.0', transportMode: 'lan', authGate, mcpSettings });
    servers.push(server);
    const port = await listen(server);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/settings/mcp`);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('guides workspace registration without returning daemon paths and rejects unknown runs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-workspaces-'));
    try {
      const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root });
      const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
      const manager = new RunManager({ eventStore: new InMemoryEventStore(), scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, workspaceExists: (workspaceId) => registry.resolveRoot(workspaceId) !== undefined });
      const server = createDaemonServer({ runManager: manager, workspaceRegistry: registry });
      servers.push(server);
      const port = await listen(server);
      const base = `http://127.0.0.1:${port}`;

      const initial = await fetch(`${base}/api/v1/workspaces`);
      const initialBody = await initial.text();
      expect(initial.status).toBe(200);
      expect(initialBody).not.toContain(root);
      expect(JSON.parse(initialBody)).toMatchObject({ workspaces: [{ id: 'default', canRemove: false }] });

      const missingConfirmation = await fetch(`${base}/api/v1/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'repo-a', path: root }) });
      expect(missingConfirmation.status).toBe(400);
      const added = await fetch(`${base}/api/v1/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'repo-a', label: 'Project A', path: root, confirmation: 'add-workspace' }) });
      const addedBody = await added.text();
      expect(added.status).toBe(200);
      expect(addedBody).not.toContain(root);
      expect(JSON.parse(addedBody)).toMatchObject({ workspaces: expect.arrayContaining([expect.objectContaining({ id: 'repo-a', label: 'Project A', canRemove: true })]) });

      const duplicate = await fetch(`${base}/api/v1/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'repo-a', path: root, confirmation: 'add-workspace' }) });
      expect(duplicate.status).toBe(409);
      const unknownRun = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(runConfig('missing')) });
      expect(unknownRun.status).toBe(400);
      expect(await unknownRun.json()).toMatchObject({ error: { code: 'WORKSPACE_NOT_FOUND' } });

      const removed = await fetch(`${base}/api/v1/workspaces/repo-a`, { method: 'DELETE' });
      expect(removed.status).toBe(200);
      expect((await removed.json()).workspaces).toHaveLength(1);
      const protectedDefault = await fetch(`${base}/api/v1/workspaces/default`, { method: 'DELETE' });
      expect(protectedDefault.status).toBe(409);
      expect(await protectedDefault.json()).toMatchObject({ error: { code: 'WORKSPACE_PROTECTED' } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
