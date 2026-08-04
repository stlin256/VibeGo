import { describe, expect, it } from 'vitest';
import { GoalEventConflictError, GoalProjectionBuilder, TodoCompletionValidationError } from './index.js';
import { GoalWriteService } from './write.js';
import { InMemoryGoalEventStore } from './index.js';

const at1 = '2026-08-04T00:00:00.000Z';
const at2 = '2026-08-04T00:01:00.000Z';

function eventId(sequence: number): string {
  return `gevt_${sequence.toString().padStart(8, '0')}`;
}

describe('GoalWriteService', () => {
  it('creates and replays the bounded Goal/Todo/Gate/Evidence/complete mutations', async () => {
    const store = new InMemoryGoalEventStore();
    const service = new GoalWriteService(store, { clock: () => at1, producer: 'goal-write-test' });

    const created = await service.createGoal({
      eventId: eventId(1),
      title: 'Ship the first slice',
      objective: 'Deliver a small, safe mutation API.',
    });
    expect(created.eventId).toBe(eventId(1));
    expect(created.controlRevision).toBe(1);
    const goalId = created.projection.goal?.goalId;
    expect(goalId).toMatch(/^goal_[A-Za-z0-9_-]{8,128}$/u);

    const todo = await service.addTodo(goalId!, {
      eventId: eventId(2),
      expectedRevision: created.controlRevision,
      title: 'Write tests',
      priority: 0,
    });
    const todoId = todo.projection.todos[0]?.todoId;
    expect(todoId).toMatch(/^todo_[A-Za-z0-9_-]{8,128}$/u);

    const opened = await service.openGate(goalId!, {
      eventId: eventId(3),
      expectedRevision: todo.controlRevision,
      kind: 'owner_review',
      question: 'Review the bounded API?',
      blocking: true,
    });
    const gateId = opened.projection.gates[0]?.gateId;
    expect(gateId).toMatch(/^gate_[A-Za-z0-9_-]{8,128}$/u);

    const resolved = await service.resolveGate(goalId!, gateId!, {
      eventId: eventId(4),
      expectedRevision: opened.controlRevision,
      status: 'approved',
      resolvedBy: 'owner',
    });
    expect(resolved.projection.gates[0]).toMatchObject({ status: 'approved', resolvedBy: 'owner' });

    const evidence = await service.attachEvidence(goalId!, {
      eventId: eventId(5),
      expectedRevision: resolved.controlRevision,
      kind: 'validation',
      summary: 'Focused service tests passed.',
      status: 'validated',
      refs: {},
    });
    const evidenceId = evidence.projection.evidence[0]?.evidenceId;
    expect(evidenceId).toMatch(/^evidence_[A-Za-z0-9_-]{8,128}$/u);

    const completed = await service.completeTodo(goalId!, todoId!, {
      eventId: eventId(6),
      expectedRevision: evidence.controlRevision,
      evidenceId: evidenceId!,
    });
    expect(completed.projection.todos[0]).toMatchObject({ todoId, status: 'done' });
    expect(completed.projection.controlRevision).toBe(6);
    expect((await store.read(goalId!)).map((event) => event.eventType)).toEqual([
      'goal.created',
      'todo.added',
      'gate.opened',
      'gate.resolved',
      'evidence.attached',
      'todo.completed',
    ]);
  });

  it('keeps retries idempotent even when the server clock moves, and detects conflicts', async () => {
    const store = new InMemoryGoalEventStore();
    let now = at1;
    const service = new GoalWriteService(store, { clock: () => now, producer: 'goal-write-test' });

    const first = await service.createGoal({ eventId: eventId(10), title: 'Stable goal', objective: 'Retry without duplicate events.' });
    now = at2;
    const repeated = await service.createGoal({ eventId: eventId(10), title: 'Stable goal', objective: 'Retry without duplicate events.' });
    expect(repeated).toEqual(first);
    expect(store.lastSequence(first.projection.goal!.goalId)).toBe(1);

    await expect(service.createGoal({ eventId: eventId(10), title: 'Changed title', objective: 'Retry without duplicate events.' })).rejects.toBeInstanceOf(GoalEventConflictError);
  });

  it('serializes concurrent writes and fails closed on stale revisions', async () => {
    const store = new InMemoryGoalEventStore();
    const service = new GoalWriteService(store, { clock: () => at1, producer: 'goal-write-test' });
    const created = await service.createGoal({ eventId: eventId(20), title: 'Concurrent goal', objective: 'Only one write may use a revision.' });
    const goalId = created.projection.goal!.goalId;

    const results = await Promise.allSettled([
      service.addTodo(goalId, { eventId: eventId(21), expectedRevision: 1, title: 'First todo' }),
      service.addTodo(goalId, { eventId: eventId(22), expectedRevision: 1, title: 'Second todo' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({ code: 'GOAL_CONTROL_REVISION_STALE' });
  });

  it('requires a current validated Evidence before Todo completion', async () => {
    const store = new InMemoryGoalEventStore();
    const service = new GoalWriteService(store, { clock: () => at1, producer: 'goal-write-test' });
    const created = await service.createGoal({ eventId: eventId(30), title: 'Evidence goal', objective: 'Completion must be independently validated.' });
    const goalId = created.projection.goal!.goalId;
    const todo = await service.addTodo(goalId, { eventId: eventId(31), expectedRevision: 1, title: 'Validate me' });
    const todoId = todo.projection.todos[0]!.todoId;
    const observed = await service.attachEvidence(goalId, { eventId: eventId(32), expectedRevision: 2, kind: 'validation', summary: 'Observed, not validated.', status: 'observed', refs: {} });
    const evidenceId = observed.projection.evidence[0]!.evidenceId;

    await expect(service.completeTodo(goalId, todoId, { eventId: eventId(33), expectedRevision: observed.controlRevision, evidenceId })).rejects.toBeInstanceOf(TodoCompletionValidationError);
    expect((await store.read(goalId)).at(-1)?.eventType).toBe('evidence.attached');
  });

  it('rejects secret-shaped and absolute-path input before appending an event', async () => {
    const service = new GoalWriteService(new InMemoryGoalEventStore(), { clock: () => at1, producer: 'goal-write-test' });
    await expect(service.createGoal({ eventId: eventId(40), title: 'Bad input', objective: 'Reject unknown fields.', apiKey: 'sk-not-real' } as never)).rejects.toThrow();
    await expect(service.createGoal({ eventId: eventId(41), title: 'Bad input', objective: 'Reject paths.', workspaceId: 'C:\\Users\\secret\\repo' } as never)).rejects.toThrow();
  });

  it('does not leak claim hashes through the write service projection contract', async () => {
    const store = new InMemoryGoalEventStore();
    const service = new GoalWriteService(store, { clock: () => at1, producer: 'goal-write-test' });
    const created = await service.createGoal({ eventId: eventId(50), title: 'Safe projection', objective: 'Write responses should be safe.' });
    const todo = await service.addTodo(created.projection.goal!.goalId, { eventId: eventId(51), expectedRevision: 1, title: 'No claim fields' });
    expect(JSON.stringify(todo)).not.toContain('claimTokenHash');
    expect(new GoalProjectionBuilder().build(await store.read(created.projection.goal!.goalId))).toMatchObject({ sourceEventCount: 2 });
  });
});
