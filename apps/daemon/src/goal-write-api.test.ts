import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthGate } from '@ready4vibe/auth';
import { GoalWriteService, InMemoryGoalEventStore } from '@ready4vibe/goal-control';
import { SqliteGoalEventStore } from '@ready4vibe/storage';
import { createDaemonServer } from './server.js';

const servers: ReturnType<typeof createDaemonServer>[] = [];

async function listen(server: ReturnType<typeof createDaemonServer>): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

function body(eventId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { eventId, ...extra };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    if (!server.listening) return;
    server.close();
    await once(server, 'close');
  }));
});

describe('Goal mutation API', () => {
  it('supports bounded create/add/open/resolve/evidence/complete mutations', async () => {
    const store = new InMemoryGoalEventStore();
    const service = new GoalWriteService(store, { producer: 'daemon-goal-api', clock: () => '2026-08-04T00:00:00.000Z' });
    const server = createDaemonServer({ goalEventStore: store, goalWriteService: service });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const created = await fetch(`${base}/api/v1/goals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body('gevt_00000001', { title: 'API goal', objective: 'Exercise the bounded write boundary.' })),
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { controlRevision: number; projection: { goal?: { goalId: string } | null } };
    const goalId = createdBody.projection.goal?.goalId;
    expect(goalId).toMatch(/^goal_/u);

    const added = await fetch(`${base}/api/v1/goals/${goalId}/todos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body('gevt_00000002', { expectedRevision: 1, title: 'Add API coverage', priority: 0 })),
    });
    expect(added.status).toBe(200);
    const addedBody = await added.json() as { controlRevision: number; projection: { todos: Array<{ todoId: string }> } };
    const todoId = addedBody.projection.todos[0]!.todoId;

    const opened = await fetch(`${base}/api/v1/goals/${goalId}/gates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body('gevt_00000003', { expectedRevision: 2, kind: 'owner_review', question: 'Approve?', blocking: true })),
    });
    expect(opened.status).toBe(200);
    const openedBody = await opened.json() as { controlRevision: number; projection: { gates: Array<{ gateId: string }> } };
    const gateId = openedBody.projection.gates[0]!.gateId;

    const resolved = await fetch(`${base}/api/v1/goals/${goalId}/gates/${gateId}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body('gevt_00000004', { expectedRevision: 3, status: 'approved', resolvedBy: 'user' })),
    });
    expect(resolved.status).toBe(200);

    const evidence = await fetch(`${base}/api/v1/goals/${goalId}/evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body('gevt_00000005', { expectedRevision: 4, kind: 'validation', summary: 'Focused tests passed.', status: 'validated', refs: {} })),
    });
    expect(evidence.status).toBe(200);
    const evidenceBody = await evidence.json() as { controlRevision: number; projection: { evidence: Array<{ evidenceId: string }> } };
    const evidenceId = evidenceBody.projection.evidence[0]!.evidenceId;

    const completed = await fetch(`${base}/api/v1/goals/${goalId}/todos/${todoId}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body('gevt_00000006', { expectedRevision: 5, evidenceId })),
    });
    expect(completed.status).toBe(200);
    const completedText = await completed.text();
    expect(completedText).toContain('ready4vibe_goal_write_api_v0');
    expect(completedText).not.toMatch(/api[_-]?key|claimTokenHash|C:\\Users|\/var\//iu);
    expect(JSON.parse(completedText)).toMatchObject({ controlRevision: 6, projection: { todos: [{ todoId, status: 'done' }] } });
  });

  it('returns stable safe errors for stale revisions, invalid input, and unsupported methods', async () => {
    const store = new InMemoryGoalEventStore();
    const service = new GoalWriteService(store, { producer: 'daemon-goal-api', clock: () => '2026-08-04T00:00:00.000Z' });
    const server = createDaemonServer({ goalEventStore: store, goalWriteService: service });
    servers.push(server);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;
    const created = await fetch(`${base}/api/v1/goals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('gevt_00000011', { title: 'Error goal', objective: 'Check safe mutation errors.' })) });
    const goalId = ((await created.json()) as { projection: { goal: { goalId: string } } }).projection.goal.goalId;
    await expect(fetch(`${base}/api/v1/goals/${goalId}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('gevt_00000012', { expectedRevision: 0, title: 'Stale' })) })).resolves.toMatchObject({ status: 409 });
    const stale = await fetch(`${base}/api/v1/goals/${goalId}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('gevt_00000013', { expectedRevision: 0, title: 'Stale' })) });
    expect(await stale.json()).toMatchObject({ error: { code: 'GOAL_CONTROL_REVISION_STALE' } });

    const secret = await fetch(`${base}/api/v1/goals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('gevt_00000014', { title: 'Reject secret', objective: 'Unknown fields must not cross the boundary.', apiKey: 'sk-not-real' })) });
    expect(secret.status).toBe(400);
    expect(JSON.stringify(await secret.json())).not.toContain('sk-not-real');
    const conflict = await fetch(`${base}/api/v1/goals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('gevt_00000011', { title: 'Changed', objective: 'Unknown fields must not cross the boundary.' })) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: { code: 'GOAL_EVENT_CONFLICT' } });
    const method = await fetch(`${base}/api/v1/goals/${goalId}/todos`, { method: 'GET' });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');
  });

  it('inherits the LAN authentication gate for Goal mutations', async () => {
    const authGate = new AuthGate({ mode: 'lan', tlsRequired: false, randomBytes: (() => new Uint8Array(64)) });
    const store = new InMemoryGoalEventStore();
    const server = createDaemonServer({ host: '0.0.0.0', transportMode: 'lan', authGate, goalEventStore: store, goalWriteService: new GoalWriteService(store) });
    servers.push(server);
    const port = await listen(server);
    const denied = await fetch(`http://127.0.0.1:${port}/api/v1/goals`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body('gevt_00000021', { title: 'Denied', objective: 'Authentication must run first.' })) });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ error: { code: 'AUTH_REQUIRED' } });
  });

  it('keeps eventId idempotency after rebuilding the service from SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-goal-write-'));
    const databasePath = join(root, 'events.sqlite');
    try {
      const firstStore = new SqliteGoalEventStore(databasePath);
      const firstService = new GoalWriteService(firstStore, { producer: 'daemon-goal-api', clock: () => '2026-08-04T00:00:00.000Z' });
      const input = { eventId: 'gevt_00000031', title: 'Durable retry', objective: 'Retry after a daemon restart without a duplicate event.' };
      const first = await firstService.createGoal(input);
      firstStore.close();

      const secondStore = new SqliteGoalEventStore(databasePath);
      const secondService = new GoalWriteService(secondStore, { producer: 'daemon-goal-api', clock: () => '2026-08-04T00:05:00.000Z' });
      const repeated = await secondService.createGoal(input);
      expect(repeated).toEqual(first);
      expect(secondStore.lastSequence(first.projection.goal!.goalId)).toBe(1);
      secondStore.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
