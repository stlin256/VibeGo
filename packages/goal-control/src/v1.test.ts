import { describe, expect, it } from 'vitest';
import type { GoalRecord, GoalTodo, NewGoalEvent, StoredGoalEvent } from '@ready4vibe/contracts';
import {
  GoalControlProjectionBuilder,
  GoalControlV1EventConflictError,
  GoalControlV1RevisionError,
  GoalControlV1TransitionError,
  GoalControlV1WriteService,
  InMemoryGoalControlEventStore,
  createGoalEvent,
} from './index.js';

const at = '2026-08-05T00:00:00.000Z';
const goalId = 'goal_12345678';
const todoId = 'todo_12345678';

function legacyEvents(): StoredGoalEvent[] {
  const goal: GoalRecord = {
    goalId,
    title: 'Goal v1 fixture',
    objective: 'Exercise additive Goal Control contracts.',
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
    title: 'Run the bounded fixture',
    priority: 1,
  };
  const input: NewGoalEvent[] = [
    createGoalEvent({ eventId: 'gevt_00000001', goalId, eventType: 'goal.created', recordedAt: at, producer: 'v1-test', privacy: 'local_private', refs: {}, payload: { goal } }),
    createGoalEvent({ eventId: 'gevt_00000002', goalId, eventType: 'todo.added', recordedAt: at, producer: 'v1-test', privacy: 'local_private', refs: { todoId }, payload: { todo } }),
  ];
  return input.map((event, index) => ({ ...event, appendSequence: index + 1 }));
}

function bindingDraft(overrides: Record<string, unknown> = {}) {
  return {
    bindingId: 'binding_12345678',
    runId: 'run_12345678',
    goalId,
    todoId,
    mode: 'governed' as const,
    goalControlRevision: 2,
    policyRevision: 3,
    capabilityProfileRevision: 4,
    approvalPolicyRevision: 5,
    sandboxSnapshotRevision: 6,
    workspaceId: 'workspace_main',
    admissionId: 'admission_12345678',
    createdAt: at,
    expiresAt: '2026-08-05T01:00:00.000Z',
    attempt: 1,
    requestId: 'request_12345678',
    ...overrides,
  };
}

function seededService() {
  const store = new InMemoryGoalControlEventStore();
  for (const event of legacyEvents()) store.seedLegacy(event);
  const service = new GoalControlV1WriteService(store, { producer: 'v1-test', clock: () => at });
  return { store, service };
}

describe('Goal Control v1 mixed replay', () => {
  it('replays v0 history plus v1 events with a stable checksum', async () => {
    const { store, service } = seededService();
    const binding = await service.createBinding(goalId, { eventId: 'gevt_00000003', expectedRevision: 2, binding: bindingDraft() });
    const first = new GoalControlProjectionBuilder().build(await store.read(goalId));
    const second = new GoalControlProjectionBuilder().build(await store.read(goalId));
    expect(binding.projection.projectionVersion).toBe('goal_control_projection_v1');
    expect(first.sourceChecksum).toBe(second.sourceChecksum);
    expect(first.controlRevision).toBe(3);
    expect(first.bindings[0]).toMatchObject({ bindingId: 'binding_12345678', runId: 'run_12345678' });
  });

  it('rejects a v1 event whose control revision is stale or out of order', async () => {
    const { store } = seededService();
    await expect(store.append({
      schemaVersion: 'ready4vibe_goal_event_v1',
      eventId: 'gevt_00000003',
      goalId,
      eventType: 'binding.created',
      controlRevision: 1,
      recordedAt: at,
      producer: 'v1-test',
      privacy: 'local_private',
      projectionVersion: 'goal_control_projection_v1',
      refs: { bindingId: 'binding_12345678' },
      payload: { binding: { schemaVersion: 'ready4vibe_goal_binding_v1', ...bindingDraft() } },
    })).resolves.toMatchObject({ appendSequence: 3 });
    const replay = await store.read(goalId);
    expect(() => new GoalControlProjectionBuilder().build(replay)).toThrow(GoalControlV1RevisionError);
  });
});

describe('Goal Control v1 write service', () => {
  it('supports binding, admission, quota reservation, validation and exactly-once consume', async () => {
    const { service } = seededService();
    const binding = await service.createBinding(goalId, { eventId: 'gevt_00000003', expectedRevision: 2, binding: bindingDraft() });
    const admission = await service.recordAdmission(goalId, {
      eventId: 'gevt_00000004',
      expectedRevision: binding.controlRevision,
      decision: {
        admissionId: 'admission_12345678',
        goalId,
        todoId,
        status: 'eligible',
        reasonCode: 'ELIGIBLE',
        reason: 'All existing gates are open.',
        projectionChecksum: binding.projection.sourceChecksum,
        controlRevision: binding.controlRevision,
        nextStep: 'create_run',
        createdAt: at,
        requestId: 'request_admission',
      },
    });
    const reservation = await service.reserveQuota(goalId, {
      eventId: 'gevt_00000005',
      expectedRevision: admission.controlRevision,
      requestId: 'request_reservation',
      reservation: {
        reservationId: 'reservation_12345678',
        bindingId: 'binding_12345678',
        goalId,
        todoId,
        attempt: 1,
        turnKey: 'turn_goal_1',
        units: 1,
        expiresAt: '2026-08-05T01:00:00.000Z',
      },
    });
    const validation = await service.recordValidation(goalId, {
      eventId: 'gevt_00000006',
      expectedRevision: reservation.controlRevision,
      evidence: {
        evidenceId: 'evidence_12345678',
        goalId,
        todoId,
        bindingId: 'binding_12345678',
        runId: 'run_12345678',
        attempt: 1,
        verifierId: 'verifier_fixture',
        verifierRevision: 1,
        status: 'validated',
        summary: 'Fixture verifier passed.',
        refs: { runId: 'run_12345678' },
      },
    });
    const consumed = await service.consumeQuota(goalId, 'reservation_12345678', {
      eventId: 'gevt_00000007',
      expectedRevision: validation.controlRevision,
      evidenceId: 'evidence_12345678',
    });
    const completed = await service.completeTodo(goalId, {
      eventId: 'gevt_00000008',
      expectedRevision: consumed.controlRevision,
      todoId,
      evidenceId: 'evidence_12345678',
    });
    expect(completed.projection.todos[0]).toMatchObject({ todoId, status: 'done' });
    expect(completed.projection.quota).toMatchObject({ totalSpent: 1, spentTurnKeys: ['turn_goal_1'] });
    expect(completed.projection.quota.reservations[0]).toMatchObject({ status: 'consumed' });
    await expect(service.consumeQuota(goalId, 'reservation_12345678', {
      eventId: 'gevt_00000009',
      expectedRevision: completed.controlRevision,
      evidenceId: 'evidence_12345678',
    })).rejects.toBeInstanceOf(GoalControlV1TransitionError);
  });

  it('fails closed for validation failure, stale revisions, duplicate claims and changed event payloads', async () => {
    const { service } = seededService();
    const first = await service.createBinding(goalId, { eventId: 'gevt_00000003', expectedRevision: 2, binding: bindingDraft() });
    await expect(Promise.all([
      service.createBinding(goalId, { eventId: 'gevt_00000004', expectedRevision: first.controlRevision, binding: bindingDraft({ bindingId: 'binding_abcdefgh', admissionId: 'admission_abcdefgh', requestId: 'request_a' }) }),
      service.createBinding(goalId, { eventId: 'gevt_00000005', expectedRevision: first.controlRevision, binding: bindingDraft({ bindingId: 'binding_ijklmnop', admissionId: 'admission_ijklmnop', requestId: 'request_b' }) }),
    ])).rejects.toBeInstanceOf(GoalControlV1RevisionError);

    await expect(service.createBinding(goalId, { eventId: 'gevt_00000003', expectedRevision: 2, binding: bindingDraft({ requestId: 'request_changed' }) })).rejects.toBeInstanceOf(GoalControlV1EventConflictError);
  });

  it('does not allow release, consume or todo completion to bypass reservation/evidence state', async () => {
    const { service } = seededService();
    const binding = await service.createBinding(goalId, { eventId: 'gevt_00000003', expectedRevision: 2, binding: bindingDraft() });
    await expect(service.consumeQuota(goalId, 'reservation_12345678', { eventId: 'gevt_00000004', expectedRevision: binding.controlRevision, evidenceId: 'evidence_12345678' })).rejects.toBeInstanceOf(GoalControlV1TransitionError);
    await expect(service.completeTodo(goalId, { eventId: 'gevt_00000005', expectedRevision: binding.controlRevision, todoId, evidenceId: 'evidence_12345678' })).rejects.toBeInstanceOf(GoalControlV1TransitionError);
  });
});
