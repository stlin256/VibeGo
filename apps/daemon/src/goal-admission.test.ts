import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCHEDULER_POLICY,
  type CapabilityProfileRunSnapshot,
  type GoalRecord,
  type GoalTodo,
  type NewGoalEvent,
  type RunConfig,
} from '@ready4vibe/contracts';
import { createGoalEvent, InMemoryGoalControlEventStore } from '@ready4vibe/goal-control';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore, SqliteEventStore, SqliteGoalControlV1EventStore, SqliteGoalEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { GoalAdmissionService, type GoalAdmissionOptions } from './goal-admission.js';
import { readGoalProjection } from './goal-api.js';
import { RunManager } from './run-manager.js';
import { createDaemonServer } from './server.js';

const at = '2026-08-05T00:00:00.000Z';
const goalId = 'goal_12345678';
const todoId = 'todo_12345678';
const workspaceId = 'workspace_main';

const runConfig: RunConfig = {
  workspaceId,
  userMessage: 'Implement the next bounded slice.',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace',
  sandbox: { mode: 'read-only', network: 'restricted' },
  approval: 'on-request',
  limits: {
    maxTurns: 1,
    maxWallTimeMs: 60_000,
    maxModelInputTokens: 100,
    maxModelOutputTokens: 100,
    maxToolCalls: 4,
    maxOutputBytes: 4_096,
    maxContextBytes: 16_384,
  },
  createdBySessionId: 'session_12345678',
  clientRequestId: 'client_12345678',
};

function snapshot(overrides: Record<string, unknown> = {}): CapabilityProfileRunSnapshot {
  const profile = {
    schemaVersion: 'ready4vibe_capability_profile_v1' as const,
    profileId: 'workspace-coding' as const,
    transportMode: 'loopback' as const,
    workspaceId,
    modelMode: 'fake' as const,
    filesystemMode: 'off' as const,
    shellMode: 'off' as const,
    networkMode: 'off' as const,
    mcpSkillMode: 'off' as const,
    approvalMode: 'on-request' as const,
    policyRevision: 'daemon-policy-1',
    requiresAcknowledgement: false,
    updatedAt: at,
  };
  return {
    schemaVersion: 'ready4vibe_capability_profile_run_snapshot_v1',
    profileRevision: 'profile-1',
    policyRevision: 'daemon-policy-1',
    status: 'ready',
    reasonCode: 'PROFILE_READY',
    requestedProfile: profile,
    effectiveProfile: profile,
    capturedAt: at,
    ...overrides,
  } as CapabilityProfileRunSnapshot;
}

function legacyFixture(options: { gate?: boolean; claimedBy?: string; claimExpiresAt?: string } = {}) {
  const goal: GoalRecord = {
    goalId,
    title: 'Governed admission fixture',
    objective: 'Exercise the application boundary.',
    workspaceId,
    status: 'active',
    controlRevision: 0,
    createdAt: at,
    updatedAt: at,
    schemaVersion: 1,
  };
  const todo: GoalTodo = {
    todoId,
    goalId,
    role: 'agent',
    status: 'open',
    taskClass: 'advancement',
    title: 'Run the fixture',
    priority: 1,
  };
  const events: NewGoalEvent[] = [
    createGoalEvent({ eventId: 'gevt_00000001', goalId, eventType: 'goal.created', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: {}, payload: { goal } }),
    createGoalEvent({ eventId: 'gevt_00000002', goalId, eventType: 'todo.added', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: { todoId }, payload: { todo } }),
    createGoalEvent({ eventId: 'gevt_00000003', goalId, eventType: 'todo.claimed', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: { todoId }, payload: {
      todoId,
      claimedBy: options.claimedBy ?? 'agent_12345678',
      claimTokenHash: 'a'.repeat(64),
      claimedAt: at,
      claimExpiresAt: options.claimExpiresAt ?? '2026-08-05T01:00:00.000Z',
    } }),
  ];
  if (options.gate) {
    events.push(createGoalEvent({ eventId: 'gevt_00000004', goalId, eventType: 'gate.opened', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: { gateId: 'gate_12345678' }, payload: {
      gate: { gateId: 'gate_12345678', goalId, kind: 'user_decision', status: 'open', blocking: true, question: 'Approve?', openedAt: at },
    }}));
  }
  return events.map((event, index) => ({ ...event, appendSequence: index + 1 }));
}

function input(expectedControlRevision: number, overrides: Record<string, unknown> = {}) {
  return {
    ...runConfig,
    runMode: 'governed' as const,
    goalId,
    todoId,
    expectedControlRevision,
    agentId: 'agent_12345678',
    turnKey: 'turn_goal_1',
    requestId: 'request_12345678',
    ...overrides,
  };
}

function serviceFixture(options: Partial<GoalAdmissionOptions> = {}) {
  const goalStore = new InMemoryGoalControlEventStore();
  const eventStore = new InMemoryEventStore();
  const model = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] });
  const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
  const runManager = new RunManager({
    eventStore,
    scheduler,
    modelProvider: model,
    workspaceExists: () => true,
  });
  const service = new GoalAdmissionService({
    goalStore,
    runManager,
    scheduler,
    capabilitySnapshotForRun: () => snapshot(),
    workspace: { exists: () => true },
    approval: () => ({ ready: true, revision: 'approval-1' }),
    sandbox: () => ({ ready: true, revision: 'sandbox-1' }),
    clock: () => new Date(at),
    ...options,
  });
  return { goalStore, eventStore, model, scheduler, runManager, service };
}

function sqlitePath(): string {
  return join(tmpdir(), `ready4vibe-governed-${randomUUID()}.sqlite`);
}

function cleanupSqlite(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

async function seed(store: InMemoryGoalControlEventStore, options: Parameters<typeof legacyFixture>[0] = {}) {
  for (const event of legacyFixture(options)) store.seedLegacy(event);
  return legacyFixture(options).length;
}

describe('GoalAdmissionService', () => {
  it('runs only after Goal/capability/readiness preflight and persists a binding before run.created', async () => {
    const calls: string[] = [];
    const fixture = serviceFixture({
      capabilitySnapshotForRun: () => { calls.push('capability'); return snapshot(); },
      schedulerRequestForRun: (runId, config) => { calls.push('scheduler-request'); return { runId, workspaceId: config.workspaceId, workspaceAccess: 'read', resources: { modelCalls: 1 } }; },
      scheduler: { inspect: (request) => { calls.push('scheduler'); return new Scheduler(DEFAULT_SCHEDULER_POLICY).inspect(request); } },
      workspace: { exists: () => { calls.push('workspace'); return true; } },
      approval: () => { calls.push('approval'); return { ready: true, revision: 'approval-1' }; },
      sandbox: () => { calls.push('sandbox'); return { ready: true, revision: 'sandbox-1' }; },
    });
    const expectedRevision = await seed(fixture.goalStore);
    const result = await fixture.service.admit(input(expectedRevision));
    expect(result).toMatchObject({ status: 'queued', goalId, todoId, binding: { mode: 'governed', runId: result.runId } });
    expect(calls).toEqual(['capability', 'scheduler-request', 'scheduler', 'workspace', 'approval', 'sandbox']);
    await vi.waitFor(() => expect(fixture.runManager.completion(result.runId)).toBeDefined());
    expect(fixture.model.requests).toHaveLength(1);
    const runEvents = await fixture.eventStore.read(result.runId);
    expect(runEvents[0]?.type).toBe('run.created');
    const goalEvents = await fixture.goalStore.read(goalId);
    expect(goalEvents.map((event) => event.eventType)).toEqual(['goal.created', 'todo.added', 'todo.claimed', 'admission.recorded', 'binding.created']);
    expect(goalEvents.some((event) => event.eventType === 'quota.reserved' || event.eventType === 'quota.consumed')).toBe(false);
  });

  it.each([
    ['missing explicit run mode', () => input(3, { runMode: undefined }), 'INVALID_REQUEST'],
    ['stale Goal revision', () => input(2), 'STALE_REVISION'],
    ['blocking gate', () => input(4), 'GATE_OPEN'],
    ['missing claim', () => input(3, { agentId: 'agent_other' }), 'TODO_ALREADY_CLAIMED'],
    ['expired claim', () => input(3), 'TODO_CLAIM_EXPIRED'],
  ] as const)('%s fails closed before model/run events', async (name, makeInput, code) => {
    const fixture = serviceFixture();
    const seedOptions = name === 'blocking gate' ? { gate: true } : name === 'expired claim' ? { claimExpiresAt: '2026-08-04T23:00:00.000Z' } : {};
    const expectedRevision = await seed(fixture.goalStore, seedOptions);
    const actualInput = name === 'blocking gate' ? makeInput() : name === 'stale Goal revision' ? makeInput() : makeInput();
    await expect(fixture.service.admit(actualInput)).rejects.toMatchObject({ code });
    expect(fixture.model.requests).toHaveLength(0);
    expect(fixture.eventStore.listRunIds()).toEqual([]);
  });

  it('rejects an unclaimed Todo with a safe decision and never auto-claims it', async () => {
    const fixture = serviceFixture();
    const events = legacyFixture().slice(0, 2).map((event) => ({ ...event, appendSequence: event.appendSequence }));
    for (const event of events) fixture.goalStore.seedLegacy(event);
    await expect(fixture.service.admit(input(2))).rejects.toMatchObject({ code: 'TODO_CLAIM_REQUIRED', decision: { nextStep: 'claim_todo' } });
    expect((await fixture.goalStore.read(goalId)).map((event) => event.eventType)).toEqual(['goal.created', 'todo.added']);
    expect(fixture.eventStore.listRunIds()).toEqual([]);
  });

  it('does not queue when Scheduler readiness is busy or unsatisfiable', async () => {
    const fixture = serviceFixture();
    const expectedRevision = await seed(fixture.goalStore);
    const lease = await fixture.scheduler.acquire({ runId: 'run_existing_12345678', workspaceId: 'workspace_other', workspaceAccess: 'read', resources: { modelCalls: 2 } });
    await expect(fixture.service.admit(input(expectedRevision))).rejects.toMatchObject({ code: 'SCHEDULER_UNAVAILABLE', decision: { status: 'waiting' } });
    expect(fixture.scheduler.queuedRunIds()).toEqual([]);
    expect(fixture.eventStore.listRunIds()).toEqual([]);
    lease.release();
  });

  it('replays the same governed request idempotently without a second run or binding', async () => {
    const fixture = serviceFixture();
    const expectedRevision = await seed(fixture.goalStore);
    const first = await fixture.service.admit(input(expectedRevision));
    await vi.waitFor(() => expect(fixture.runManager.completion(first.runId)).toBeDefined());
    const second = await fixture.service.admit(input(expectedRevision));
    expect(second.runId).toBe(first.runId);
    expect(fixture.model.requests).toHaveLength(1);
    expect((await fixture.goalStore.read(goalId)).filter((event) => event.eventType === 'binding.created')).toHaveLength(1);
  });

  it('keeps the ordinary one-argument interactive start outside Goal admission', async () => {
    const fixture = serviceFixture();
    const started = await fixture.runManager.start(runConfig);
    await vi.waitFor(() => expect(fixture.runManager.completion(started.runId)).toBeDefined());
    expect((await fixture.eventStore.read(started.runId)).some((event) => event.type === 'run.created')).toBe(true);
    expect(fixture.goalStore.listGoalIds()).toEqual([]);
  });

  it('exposes governed admission only through the explicit daemon route', async () => {
    const fixture = serviceFixture();
    const expectedRevision = await seed(fixture.goalStore);
    const server = createDaemonServer({ runManager: fixture.runManager, goalAdmissionService: fixture.service });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/runs/governed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input(expectedRevision)),
      });
      expect(response.status).toBe(202);
      const body = await response.json() as { runId: string; status: string };
      expect(body.status).toBe('queued');
      await vi.waitFor(() => expect(fixture.runManager.completion(body.runId)).toBeDefined());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a governed envelope on the ordinary interactive route', async () => {
    const fixture = serviceFixture();
    const expectedRevision = await seed(fixture.goalStore);
    const server = createDaemonServer({ runManager: fixture.runManager, goalAdmissionService: fixture.service });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input(expectedRevision)),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'GOVERNED_ROUTE_REQUIRED' } });
      expect(fixture.model.requests).toHaveLength(0);
      expect(fixture.eventStore.listRunIds()).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('persists governed admission and binding through the SQLite v1 store', async () => {
    const path = sqlitePath();
    const legacy = new SqliteGoalEventStore(path);
    for (const stored of legacyFixture()) {
      const { appendSequence: _appendSequence, ...event } = stored;
      await legacy.append(event);
    }
    legacy.close();

    const goalStore = new SqliteGoalControlV1EventStore(path);
    const eventStore = new SqliteEventStore(path);
    const model = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] });
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const runManager = new RunManager({ eventStore, scheduler, modelProvider: model, workspaceExists: () => true });
    const service = new GoalAdmissionService({
      goalStore,
      runManager,
      scheduler,
      capabilitySnapshotForRun: () => snapshot(),
      workspace: { exists: () => true },
      approval: () => ({ ready: true, revision: 'approval-1' }),
      sandbox: () => ({ ready: true, revision: 'sandbox-1' }),
      clock: () => new Date(at),
    });
    try {
      const result = await service.admit(input(3));
      await vi.waitFor(() => expect(runManager.completion(result.runId)).toBeDefined());
      const reopened = new SqliteGoalControlV1EventStore(path);
      const legacyReader = new SqliteGoalEventStore(path);
      try {
        const events = await reopened.read(goalId);
        expect(events.map((event) => event.eventType)).toEqual([
          'goal.created', 'todo.added', 'todo.claimed', 'admission.recorded', 'binding.created',
        ]);
        expect((await readGoalProjection(legacyReader, goalId))?.goal?.goalId).toBe(goalId);
        expect((await eventStore.read(result.runId)).some((event) => event.type === 'run.created')).toBe(true);
      } finally {
        reopened.close();
        legacyReader.close();
      }
    } finally {
      goalStore.close();
      eventStore.close();
      cleanupSqlite(path);
    }
  });
});
