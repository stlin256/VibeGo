import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GoalEventType } from '@ready4vibe/contracts';
import { SqliteGoalEventConflictError, SqliteGoalEventOrderError, SqliteGoalEventStore, SqliteGoalEventStoreError } from './goal.js';
import { SqliteGoalControlV1EventStore } from './goal-control-v1.js';
import { SqliteEventStore } from './index.js';

const goalId = 'goal_12345678';
const at = '2026-08-03T10:00:00.000Z';

function goalEvent(eventId: string, eventType: GoalEventType, payload: Record<string, unknown> = { summary: eventType }) {
  return {
    schemaVersion: 'ready4vibe_goal_event_v0' as const,
    eventId,
    goalId,
    eventType,
    recordedAt: at,
    producer: 'storage-test',
    privacy: 'local_private' as const,
    projectionVersion: 'goal_control_projection_v0' as const,
    refs: {},
    payload,
  };
}

function databasePath(): string {
  return join(tmpdir(), `ready4vibe-goal-${randomUUID()}.sqlite`);
}

function cleanup(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

function v1BindingEvent() {
  return {
    schemaVersion: 'ready4vibe_goal_event_v1' as const,
    eventId: 'gevt_00000002',
    goalId,
    eventType: 'binding.created' as const,
    controlRevision: 2,
    recordedAt: at,
    producer: 'storage-test',
    privacy: 'local_private' as const,
    projectionVersion: 'goal_control_projection_v1' as const,
    refs: { bindingId: 'binding_12345678' },
    payload: {
      binding: {
        schemaVersion: 'ready4vibe_goal_binding_v1' as const,
        bindingId: 'binding_12345678',
        runId: 'run_12345678',
        goalId,
        todoId: 'todo_12345678',
        mode: 'governed' as const,
        goalControlRevision: 1,
        policyRevision: 1,
        capabilityProfileRevision: 1,
        approvalPolicyRevision: 1,
        sandboxSnapshotRevision: 1,
        workspaceId: 'workspace_main',
        admissionId: 'admission_12345678',
        createdAt: at,
        expiresAt: '2026-08-05T01:00:00.000Z',
        attempt: 1,
        requestId: 'request_12345678',
      },
    },
  };
}

describe('SqliteGoalEventStore', () => {
  it('persists goal-local events across reopen and leaves run_events independent', async () => {
    const path = databasePath();
    const runStore = new SqliteEventStore(path);
    await runStore.append({ runId: 'run_12345678', type: 'run.created', source: 'system', correlationId: 'corr_1', payload: { ok: true } });
    const goalStore = new SqliteGoalEventStore(path);
    await goalStore.appendBatch([
      goalEvent('gevt_00000001', 'goal.created'),
      goalEvent('gevt_00000002', 'todo.added'),
    ]);
    expect(await goalStore.read(goalId)).toHaveLength(2);
    expect(goalStore.listGoalIds()).toEqual([goalId]);
    expect(await runStore.read('run_12345678')).toHaveLength(1);
    goalStore.close();
    runStore.close();

    const reopened = new SqliteGoalEventStore(path);
    expect((await reopened.read(goalId)).map((event) => event.appendSequence)).toEqual([1, 2]);
    expect(reopened.lastSequence(goalId)).toBe(2);
    reopened.close();
    cleanup(path);
  });

  it('treats same event id and canonical content as a no-op, but conflicts on different content', async () => {
    const store = new SqliteGoalEventStore(':memory:');
    const first = goalEvent('gevt_00000001', 'goal.created', { z: 1, a: 2 });
    const stored = await store.append(first);
    const repeated = await store.append(goalEvent('gevt_00000001', 'goal.created', { a: 2, z: 1 }));
    expect(repeated).toEqual(stored);
    expect(store.lastSequence(goalId)).toBe(1);
    await expect(store.append(goalEvent('gevt_00000001', 'goal.created', { a: 3, z: 1 }))).rejects.toBeInstanceOf(SqliteGoalEventConflictError);
    expect(store.lastSequence(goalId)).toBe(1);
    store.close();
  });

  it('keeps v0 reads compatible with additive v1 rows and rejects unsafe legacy appends', async () => {
    const path = databasePath();
    const legacy = new SqliteGoalEventStore(path);
    const v1 = new SqliteGoalControlV1EventStore(path);
    await legacy.append(goalEvent('gevt_00000001', 'goal.created'));
    await v1.append(v1BindingEvent());

    expect((await legacy.read(goalId)).map((event) => event.eventId)).toEqual(['gevt_00000001']);
    expect(legacy.lastSequence(goalId)).toBe(1);
    expect(legacy.listGoalIds()).toEqual([goalId]);
    await expect(legacy.append(goalEvent('gevt_00000003', 'todo.added'))).rejects.toBeInstanceOf(SqliteGoalEventOrderError);

    legacy.close();
    v1.close();
    cleanup(path);
  });

  it('assigns goal-local sequences and keeps a conflicting batch atomic', async () => {
    const store = new SqliteGoalEventStore(':memory:');
    await store.append(goalEvent('gevt_00000001', 'goal.created'));
    await expect(store.appendBatch([
      goalEvent('gevt_00000002', 'todo.added'),
      goalEvent('gevt_00000001', 'goal.created', { changed: true }),
    ])).rejects.toBeInstanceOf(SqliteGoalEventConflictError);
    expect(await store.read(goalId)).toHaveLength(1);
    expect(store.lastSequence(goalId)).toBe(1);

    const duplicateBatch = await store.appendBatch([
      goalEvent('gevt_00000002', 'todo.added'),
      goalEvent('gevt_00000002', 'todo.added'),
    ]);
    expect(duplicateBatch.map((event) => event.appendSequence)).toEqual([2, 2]);
    expect(store.lastSequence(goalId)).toBe(2);
    store.close();
  });

  it('serializes independent writers with BEGIN IMMEDIATE', async () => {
    const path = databasePath();
    const first = new SqliteGoalEventStore(path);
    const second = new SqliteGoalEventStore(path);
    const results = await Promise.all([
      first.append(goalEvent('gevt_00000001', 'goal.created')),
      second.append(goalEvent('gevt_00000002', 'todo.added')),
    ]);
    expect(results.map((event) => event.appendSequence).sort()).toEqual([1, 2]);
    expect((await first.read(goalId)).map((event) => event.eventId)).toEqual(['gevt_00000001', 'gevt_00000002']);
    first.close();
    second.close();
    cleanup(path);
  });

  it('rejects invalid cursors, non-JSON payloads, and closed operations', async () => {
    const store = new SqliteGoalEventStore(':memory:');
    await expect(store.read(goalId, -1)).rejects.toBeInstanceOf(SqliteGoalEventStoreError);
    const invalid = goalEvent('gevt_00000001', 'goal.created', { summary: undefined });
    await expect(store.append(invalid)).rejects.toBeInstanceOf(SqliteGoalEventStoreError);
    store.close();
    await expect(store.read(goalId)).rejects.toThrow('closed');
  });
});
