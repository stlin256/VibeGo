import { describe, expect, it } from 'vitest';
import type { NewGoalEvent } from '@ready4vibe/contracts';
import { InMemoryGoalEventStore, createGoalEvent } from '@ready4vibe/goal-control';
import { listGoalProjections, readGoalEventPage, readGoalProjection } from './goal-api.js';

const goalId = 'goal_12345678';
const todoId = 'todo_12345678';
const at = '2026-08-03T00:00:00.000Z';

function goalCreated(): NewGoalEvent {
  return createGoalEvent({
    eventId: 'gevt_00000001',
    goalId,
    eventType: 'goal.created',
    recordedAt: at,
    producer: 'goal-api-test',
    privacy: 'local_private',
    refs: {},
    payload: {
      goal: {
        goalId,
        title: 'API projection',
        objective: 'Expose a bounded read-only projection.',
        status: 'active',
        controlRevision: 0,
        createdAt: at,
        updatedAt: at,
        schemaVersion: 1,
      },
    },
  });
}

function todoAdded(): NewGoalEvent {
  return createGoalEvent({
    eventId: 'gevt_00000002',
    goalId,
    eventType: 'todo.added',
    recordedAt: at,
    producer: 'goal-api-test',
    privacy: 'local_private',
    refs: { todoId },
    payload: {
      todo: {
        todoId,
        goalId,
        role: 'agent',
        status: 'open',
        taskClass: 'advancement',
        title: 'Read the projection',
        priority: 1,
      },
    },
  });
}

function todoClaimed(): NewGoalEvent {
  return createGoalEvent({
    eventId: 'gevt_00000003',
    goalId,
    eventType: 'todo.claimed',
    recordedAt: at,
    producer: 'goal-api-test',
    privacy: 'local_private',
    refs: { todoId },
    payload: {
      todoId,
      claimedBy: 'agent-a',
      claimTokenHash: 'a'.repeat(64),
      claimedAt: at,
      claimExpiresAt: '2026-08-03T01:00:00.000Z',
    },
  });
}

async function storeWithEvents(): Promise<InMemoryGoalEventStore> {
  const store = new InMemoryGoalEventStore();
  await store.appendBatch([goalCreated(), todoAdded(), todoClaimed()]);
  return store;
}

describe('read-only goal API projection helpers', () => {
  it('replays a safe projection and strips the claim hash without mutating storage', async () => {
    const store = await storeWithEvents();
    const projection = await readGoalProjection(store, goalId);

    expect(projection).toMatchObject({
      goal: { goalId, title: 'API projection' },
      todos: [{ todoId, claimedBy: 'agent-a' }],
      sourceEventCount: 3,
      lastAppendSequence: 3,
    });
    expect(projection?.todos[0]).not.toHaveProperty('claimTokenHash');
    expect(JSON.stringify(projection)).not.toContain('claimTokenHash');
    expect((await store.read(goalId))[2]?.payload).toHaveProperty('claimTokenHash');
  });

  it('returns deterministic list ordering and bounded event pages', async () => {
    const store = await storeWithEvents();
    const list = await listGoalProjections(store);
    expect(list).toMatchObject({ schemaVersion: 'ready4vibe_goal_api_v0', goals: [{ goal: { goalId } }] });

    const firstPage = await readGoalEventPage(store, goalId, 1, 1);
    expect(firstPage).toMatchObject({ afterSequence: 1, nextAfter: 2, lastAppendSequence: 3, hasMore: true });
    expect(firstPage?.events).toHaveLength(1);

    const claimPage = await readGoalEventPage(store, goalId, 2, 1);
    expect(claimPage?.events[0]?.payload).toEqual({
      todoId,
      claimedBy: 'agent-a',
      claimedAt: at,
      claimExpiresAt: '2026-08-03T01:00:00.000Z',
    });
    expect(JSON.stringify(claimPage)).not.toContain('claimTokenHash');
  });

  it('returns undefined for an unknown goal without inventing state', async () => {
    const store = new InMemoryGoalEventStore();
    await expect(readGoalProjection(store, goalId)).resolves.toBeUndefined();
    await expect(readGoalEventPage(store, goalId, 0, 10)).resolves.toBeUndefined();
    await expect(listGoalProjections(store)).resolves.toMatchObject({ goals: [] });
  });
});
