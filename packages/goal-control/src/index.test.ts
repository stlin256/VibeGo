import { describe, expect, it } from 'vitest';
import type { GoalEventType, GoalProjection, GoalTodo, NewGoalEvent } from '@ready4vibe/contracts';
import { GoalControlRevisionError, GoalControlService, GoalEventConflictError, GoalEventStoreError, GoalProjectionBuilder, InMemoryGoalEventStore, TodoClaimConflictError, assertValidatedTodoCompletion, createGoalEvent, shouldRun } from './index.js';

const goalId = 'goal_12345678';
const at = '2026-08-03T10:00:00.000Z';

function makeGoal(status: 'active' | 'paused' | 'blocked' | 'completed' | 'archived' = 'active') {
  return {
    goalId,
    title: 'Ship the first slice',
    objective: 'Keep the harness small, testable, and safe.',
    status,
    controlRevision: status === 'active' ? 0 : 1,
    createdAt: at,
    updatedAt: at,
    schemaVersion: 1 as const,
  };
}

function makeTodo(overrides: Partial<GoalTodo> = {}): GoalTodo {
  return {
    todoId: 'todo_12345678',
    goalId,
    role: 'agent',
    status: 'open',
    taskClass: 'advancement',
    title: 'Implement the next slice',
    priority: 1,
    ...overrides,
  };
}

function makeEvent<TPayload extends Record<string, unknown>>(
  eventType: GoalEventType,
  payload: TPayload,
  eventId: string,
  refs: Record<string, string> = {},
) {
  return createGoalEvent<TPayload>({
    eventId,
    goalId,
    eventType,
    recordedAt: at,
    producer: 'test',
    privacy: 'local_private',
    refs,
    payload,
  });
}

function goalCreated(eventId = 'gevt_00000001') {
  return makeEvent('goal.created', { goal: makeGoal() }, eventId);
}

async function projectionFor(events: readonly NewGoalEvent[]): Promise<GoalProjection> {
  const store = new InMemoryGoalEventStore();
  await store.appendBatch(events);
  return new GoalProjectionBuilder().build(await store.read(goalId));
}

describe('InMemoryGoalEventStore', () => {
  it('is idempotent for the same event and detects content conflicts', async () => {
    const store = new InMemoryGoalEventStore();
    const created = goalCreated();
    const first = await store.append(created);
    const repeated = await store.append(created);

    expect(repeated).toEqual(first);
    expect(store.lastSequence(goalId)).toBe(1);
    await expect(store.append(makeEvent('goal.created', { goal: { ...makeGoal(), title: 'different' } }, created.eventId))).rejects.toBeInstanceOf(GoalEventConflictError);
  });

  it('assigns goal-local sequences, supports cursors, and keeps batches atomic', async () => {
    const store = new InMemoryGoalEventStore();
    const created = goalCreated();
    const added = makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002');
    const completed = makeEvent('todo.completed', { todoId: 'todo_12345678' }, 'gevt_00000003');
    const batch = await store.appendBatch([created, added, completed] as NewGoalEvent[]);

    expect(batch.map((event) => event.appendSequence)).toEqual([1, 2, 3]);
    expect((await store.read(goalId, 1)).map((event) => event.eventId)).toEqual(['gevt_00000002', 'gevt_00000003']);

    const conflicting = makeEvent('goal.created', { goal: { ...makeGoal(), title: 'conflict' } }, created.eventId);
    await expect(store.appendBatch([makeEvent('run.recorded', {}, 'gevt_00000004'), conflicting])).rejects.toBeInstanceOf(GoalEventConflictError);
    expect(store.lastSequence(goalId)).toBe(3);
  });

  it('rejects invalid cursors and operations after close', async () => {
    const store = new InMemoryGoalEventStore();
    await expect(store.read(goalId, -1)).rejects.toThrow('afterSequence');
    store.close();
    expect(() => store.lastSequence(goalId)).toThrow('closed');
    await expect(store.append(goalCreated())).rejects.toBeInstanceOf(GoalEventStoreError);
  });
});

describe('GoalProjectionBuilder', () => {
  it('replays goal, todo, gate, evidence, handoff, claim, release, and quota events deterministically', async () => {
    const events = [
      goalCreated(),
      makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002'),
      makeEvent('gate.opened', { gate: {
        gateId: 'gate_12345678', goalId, kind: 'user_decision', status: 'open', blocking: true,
        question: 'Approve the next step?', openedAt: at,
      } }, 'gevt_00000003'),
      makeEvent('evidence.attached', { evidence: {
        evidenceId: 'evidence_12345678', goalId, kind: 'validation', status: 'validated',
        summary: 'The focused tests passed.', refs: {}, recordedAt: at,
      } }, 'gevt_00000004'),
      makeEvent('todo.claimed', {
        todoId: 'todo_12345678', claimedBy: 'agent-1', claimTokenHash: 'a'.repeat(64), claimedAt: at, claimExpiresAt: '2026-08-03T11:00:00.000Z',
      }, 'gevt_00000005'),
      makeEvent('todo.claim_released', { todoId: 'todo_12345678', claimTokenHash: 'a'.repeat(64) }, 'gevt_00000006'),
      makeEvent('todo.completed', { todoId: 'todo_12345678', completedAt: at }, 'gevt_00000007'),
      makeEvent('gate.resolved', { gate: {
        gateId: 'gate_12345678', goalId, kind: 'user_decision', status: 'approved', blocking: true,
        question: 'Approve the next step?', openedAt: at, resolvedAt: at, resolvedBy: 'user',
      } }, 'gevt_00000008'),
      makeEvent('handoff.created', { handoff: {
        handoffId: 'handoff_12345678', goalId, fromTodoId: 'todo_12345678', toTodoId: 'todo_87654321',
        summary: 'Continue after validation.', createdAt: at,
      } }, 'gevt_00000009'),
      makeEvent('run.recorded', {}, 'gevt_00000010'),
      makeEvent('writeback.failed', { reason: 'transient storage error' }, 'gevt_00000011'),
      makeEvent('quota.spent', { turnKey: 'turn_goal_1' }, 'gevt_00000012'),
    ];
    const store = new InMemoryGoalEventStore();
    await store.appendBatch(events);
    const stored = await store.read(goalId);
    const builder = new GoalProjectionBuilder();
    const projection = builder.build(stored);
    const replayed = builder.build([...stored].reverse());

    expect(projection.goal).toMatchObject({ goalId, status: 'active', controlRevision: 12 });
    expect(projection.todos[0]).toMatchObject({ todoId: 'todo_12345678', status: 'done' });
    expect(projection.todos[0]).not.toHaveProperty('claimTokenHash');
    expect(projection.gates[0]).toMatchObject({ status: 'approved' });
    expect(projection.evidence[0]).toMatchObject({ status: 'validated' });
    expect(projection.handoffs[0]).toMatchObject({ toTodoId: 'todo_87654321' });
    expect(projection.quota).toEqual({ spentTurnKeys: ['turn_goal_1'], totalSpent: 1 });
    expect(projection.lastAppendSequence).toBe(12);
    expect(projection.sourceEventCount).toBe(12);
    expect(projection.sourceChecksum).toBe(replayed.sourceChecksum);
  });

  it('rejects domain events that reference unknown entities or invalid claims', async () => {
    const store = new InMemoryGoalEventStore();
    const unknownTodo = makeEvent('todo.completed', { todoId: 'todo_12345678' }, 'gevt_00000002');
    await store.appendBatch([goalCreated(), unknownTodo] as NewGoalEvent[]);
    const stored = await store.read(goalId);
    expect(() => new GoalProjectionBuilder().build(stored)).toThrow(/unknown todo/);
  });
});

describe('GoalControlService claims', () => {
  it('serializes concurrent claims and fails closed on a stale revision', async () => {
    const store = new InMemoryGoalEventStore();
    await store.appendBatch([goalCreated(), makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002')] as NewGoalEvent[]);
    const service = new GoalControlService(store);
    const expectedRevision = new GoalProjectionBuilder().build(await store.read(goalId)).controlRevision;
    const requests = [
      { goalId, todoId: 'todo_12345678', expectedRevision, claimant: 'agent-a', requestId: 'req_00000001', leaseMs: 60_000, now: at },
      { goalId, todoId: 'todo_12345678', expectedRevision, claimant: 'agent-b', requestId: 'req_00000002', leaseMs: 60_000, now: at },
    ];
    const results = await Promise.allSettled(requests.map((request) => service.claimTodo(request)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(GoalControlRevisionError);
    const successfulIndex = results.findIndex((result) => result.status === 'fulfilled');
    const successful = results[successfulIndex];
    if (successful?.status !== 'fulfilled') throw new Error('expected one successful claim');
    const successfulRequest = requests[successfulIndex]!;
    expect(successful.value.claimToken).toMatch(/^[a-f0-9]{64}$/u);
    const stored = await store.read(goalId);
    expect(stored[2]?.payload).not.toHaveProperty('claimToken');
    expect(stored[2]?.payload).toHaveProperty('claimTokenHash');

    await expect(service.claimTodo({ ...successfulRequest, requestId: 'req_00000003', expectedRevision })).rejects.toBeInstanceOf(GoalControlRevisionError);
    const repeated = await service.claimTodo(successfulRequest);
    expect(repeated.claimToken).toBe(successful.value.claimToken);

    const afterClaim = new GoalProjectionBuilder().build(stored);
    await expect(service.releaseTodoClaim({ goalId, todoId: 'todo_12345678', expectedRevision: afterClaim.controlRevision, claimToken: successful.value.claimToken, requestId: 'req_00000004', now: at, claimant: successfulRequest.claimant })).resolves.toMatchObject({ todos: [{ todoId: 'todo_12345678' }] });
  });

  it('rejects duplicate active claims and prevents invalid validation writeback', async () => {
    const store = new InMemoryGoalEventStore();
    await store.appendBatch([goalCreated(), makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002')] as NewGoalEvent[]);
    const service = new GoalControlService(store);
    const initial = new GoalProjectionBuilder().build(await store.read(goalId));
    const first = await service.claimTodo({ goalId, todoId: 'todo_12345678', expectedRevision: initial.controlRevision, claimant: 'agent-a', requestId: 'req_00000001', leaseMs: 60_000, now: at });
    const claimed = first.projection;
    await expect(service.claimTodo({ goalId, todoId: 'todo_12345678', expectedRevision: claimed.controlRevision, claimant: 'agent-b', requestId: 'req_00000002', leaseMs: 60_000, now: at })).rejects.toBeInstanceOf(TodoClaimConflictError);
    expect(() => assertValidatedTodoCompletion({ projection: claimed, todoId: 'todo_12345678', validation: { status: 'blocked', evidenceStatus: 'failed' } })).toThrow(/validated independent evidence/);
    expect((await store.read(goalId)).at(-1)?.eventType).toBe('todo.claimed');
  });
});

describe('shouldRun', () => {
  it('returns waiting when there is no goal and validates the clock input', async () => {
    const projection = new GoalProjectionBuilder().build([]);
    expect(shouldRun({ projection, now: at })).toMatchObject({ status: 'waiting', goalId: 'goal_00000000' });
    expect(() => shouldRun({ projection, now: 'not-a-date' })).toThrow('ISO date');
  });

  it('returns paused, blocked health, operator gate, and eligible decisions', async () => {
    const paused = await projectionFor([makeEvent('goal.created', { goal: makeGoal('paused') }, 'gevt_00000001')]);
    expect(shouldRun({ projection: paused, now: at })).toMatchObject({ status: 'paused' });

    const blocked = await projectionFor([makeEvent('goal.created', { goal: makeGoal('blocked') }, 'gevt_00000001')]);
    expect(shouldRun({ projection: blocked, now: at })).toMatchObject({ status: 'blocked_health' });

    const gated = await projectionFor([
      goalCreated(),
      makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002'),
      makeEvent('gate.opened', { gate: { gateId: 'gate_12345678', goalId, kind: 'user_decision', status: 'open', blocking: true, question: 'Approve?', openedAt: at } }, 'gevt_00000003'),
    ]);
    expect(shouldRun({ projection: gated, now: at })).toMatchObject({ status: 'operator_gate' });

    const eligible = await projectionFor([goalCreated(), makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002')]);
    expect(shouldRun({ projection: eligible, now: at, capabilities: [], writeScopes: [], turnKey: 'turn_goal_2' })).toMatchObject({ status: 'eligible', todoId: 'todo_12345678', turnKey: 'turn_goal_2' });
  });

  it('returns waiting, throttled, and blocked-health decisions for admission constraints', async () => {
    const userAction = await projectionFor([goalCreated(), makeEvent('todo.added', { todo: makeTodo({ taskClass: 'user_action' }) }, 'gevt_00000002')]);
    expect(shouldRun({ projection: userAction, now: at })).toMatchObject({ status: 'waiting' });

    const eligible = await projectionFor([goalCreated(), makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002')]);
    expect(shouldRun({ projection: eligible, now: at, remainingDeliveryQuota: 0 })).toMatchObject({ status: 'throttled' });
    const spent = await projectionFor([goalCreated(), makeEvent('todo.added', { todo: makeTodo() }, 'gevt_00000002'), makeEvent('quota.spent', { turnKey: 'turn_goal_3' }, 'gevt_00000003')]);
    expect(shouldRun({ projection: spent, now: at, turnKey: 'turn_goal_3' })).toMatchObject({ status: 'throttled', turnKey: 'turn_goal_3' });

    const needsCapability = await projectionFor([goalCreated(), makeEvent('todo.added', { todo: makeTodo({ requiredCapabilities: ['docker'] }) }, 'gevt_00000002')]);
    expect(shouldRun({ projection: needsCapability, now: at, capabilities: [] })).toMatchObject({ status: 'blocked_health', todoId: 'todo_12345678' });
  });
});

describe('createGoalEvent', () => {
  it('creates a versioned event with a generated id when omitted', () => {
    const event = createGoalEvent({
      goalId,
      eventType: 'projection.refreshed',
      recordedAt: at,
      producer: 'test',
      privacy: 'local_private',
      refs: {},
      payload: {},
    });
    expect(event.eventId).toMatch(/^gevt_[A-Za-z0-9_-]{8,128}$/u);
    expect(event.projectionVersion).toBe('goal_control_projection_v0');
  });
});
