import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteEventStore } from './index.js';
import { SqliteGoalEventStore } from './goal.js';
import { SqliteGoalControlV1ConflictError, SqliteGoalControlV1EventStore, SqliteGoalControlV1StoreError } from './goal-control-v1.js';

const goalId = 'goal_12345678';
const at = '2026-08-05T00:00:00.000Z';

function pathForTest(): string {
  return join(tmpdir(), `ready4vibe-goal-v1-${randomUUID()}.sqlite`);
}

function cleanup(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

function bindingEvent(eventId = 'gevt_00000002', controlRevision = 2) {
  return {
    schemaVersion: 'ready4vibe_goal_event_v1' as const,
    eventId,
    goalId,
    eventType: 'binding.created' as const,
    controlRevision,
    recordedAt: at,
    producer: 'storage-v1-test',
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

describe('SqliteGoalControlV1EventStore', () => {
  it('shares goal_events with v0, preserves run_events, and survives reopen', async () => {
    const path = pathForTest();
    const runStore = new SqliteEventStore(path);
    await runStore.append({ runId: 'run_12345678', type: 'run.created', source: 'system', correlationId: 'corr_1', payload: { ok: true } });
    const legacy = new SqliteGoalEventStore(path);
    await legacy.append({
      schemaVersion: 'ready4vibe_goal_event_v0',
      eventId: 'gevt_00000001',
      goalId,
      eventType: 'goal.created',
      recordedAt: at,
      producer: 'storage-v1-test',
      privacy: 'local_private',
      projectionVersion: 'goal_control_projection_v0',
      refs: {},
      payload: { goal: { goalId, title: 'Storage v1', objective: 'Persist', status: 'active', controlRevision: 0, createdAt: at, updatedAt: at, schemaVersion: 1 } },
    });
    legacy.close();
    const store = new SqliteGoalControlV1EventStore(path);
    const stored = await store.append(bindingEvent());
    expect(stored.appendSequence).toBe(2);
    expect(stored.controlRevision).toBe(2);
    expect((await store.read(goalId)).map((event) => event.schemaVersion)).toEqual(['ready4vibe_goal_event_v0', 'ready4vibe_goal_event_v1']);
    expect(await runStore.read('run_12345678')).toHaveLength(1);
    store.close();
    runStore.close();

    const reopened = new SqliteGoalControlV1EventStore(path);
    expect(reopened.lastSequence(goalId)).toBe(2);
    expect((await reopened.read(goalId))[1]).toMatchObject({ eventId: 'gevt_00000002', controlRevision: 2 });
    reopened.close();
    cleanup(path);
  });

  it('is idempotent by event id, conflicts on changed content, and keeps batches atomic', async () => {
    const store = new SqliteGoalControlV1EventStore(':memory:');
    const first = await store.append(bindingEvent());
    expect(await store.append(bindingEvent())).toEqual(first);
    await expect(store.append(bindingEvent('gevt_00000002', 3))).rejects.toBeInstanceOf(SqliteGoalControlV1ConflictError);
    await expect(store.appendBatch([bindingEvent('gevt_00000003', 3), bindingEvent('gevt_00000002', 4)])).rejects.toBeInstanceOf(SqliteGoalControlV1ConflictError);
    expect(store.lastSequence(goalId)).toBe(1);
    store.close();
  });

  it('rejects invalid cursors and operations after close', async () => {
    const store = new SqliteGoalControlV1EventStore(':memory:');
    await expect(store.read(goalId, -1)).rejects.toBeInstanceOf(SqliteGoalControlV1StoreError);
    store.close();
    await expect(store.read(goalId)).rejects.toThrow('closed');
  });
});
