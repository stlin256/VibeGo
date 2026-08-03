import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { AuthGate } from '@ready4vibe/auth';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { RunManager } from './run-manager.js';
import { createDaemonServer } from './server.js';

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

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (server.listening) {
      server.close();
      await once(server, 'close');
    }
  }));
});

describe('daemon health server', () => {
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
});
