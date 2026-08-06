import { describe, expect, it } from 'vitest';
import { createGoalControlEventV1, createGoalEvent, InMemoryGoalControlEventStore, GoalControlProjectionBuilder } from '@ready4vibe/goal-control';
import type { GoalControlProjectionV1 } from '@ready4vibe/contracts';
import { GoalRecoveryMonitor } from './goal-recovery-monitor.js';

const at = '2026-08-06T00:00:00.000Z';
const goal = {
  goalId: 'goal_12345678', title: 'Ship objective', objective: 'Produce a tested change.',
  status: 'active' as const, controlRevision: 0, createdAt: at, updatedAt: at, schemaVersion: 1 as const,
};
const todo = {
  todoId: 'todo_12345678', goalId: goal.goalId, role: 'agent' as const, status: 'open' as const,
  taskClass: 'advancement' as const, title: 'Implement change', priority: 1,
  verificationPlan: {
    schemaVersion: 'ready4vibe_goal_verification_plan_v1' as const,
    requiredEventTypes: ['model.completed', 'run.completed'], forbiddenEventTypes: ['model.error'], minimumOutputBytes: 1,
  },
};

async function fixture() {
  const store = new InMemoryGoalControlEventStore();
  const builder = new GoalControlProjectionBuilder();
  store.seedLegacy({ ...createGoalEvent({ eventId: 'gevt_goal_12345678', goalId: goal.goalId, eventType: 'goal.created', recordedAt: at, producer: 'test', privacy: 'local_private', refs: {}, payload: { goal } }), appendSequence: 1 });
  store.seedLegacy({ ...createGoalEvent({ eventId: 'gevt_todo_12345678', goalId: goal.goalId, eventType: 'todo.added', recordedAt: at, producer: 'test', privacy: 'local_private', refs: { todoId: todo.todoId }, payload: { todo } }), appendSequence: 2 });
  return { store, projection: builder.build(await store.read(goal.goalId)) };
}

describe('GoalRecoveryMonitor', () => {
  it('reconciles first, evaluates due Todos and serializes overlapping ticks', async () => {
    const { store, projection } = await fixture();
    let reconcileCalls = 0;
    let launchCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const monitor = new GoalRecoveryMonitor({
      goalStore: store,
      writeback: { reconcile: async () => { reconcileCalls += 1; await gate; return { bindings: 0, terminalRuns: 0, recovered: 0, skipped: 0 }; } },
      clock: () => new Date(at),
      intervalMs: 500,
      onEligible: async () => { launchCalls += 1; },
    });
    const first = monitor.runOnce();
    const second = monitor.runOnce();
    expect(first).toBe(second);
    release();
    const result = await first;
    expect(result.status).toBe('healthy');
    expect(result.projectedGoals).toBe(1);
    expect(result.decisions[0]?.status).toBe('eligible');
    expect(result.launched).toBe(1);
    expect(reconcileCalls).toBe(1);
    expect(launchCalls).toBe(1);
    expect(projection.goal?.goalId).toBe(goal.goalId);
  });

  it('keeps reconcile/projection failures bounded and never starts a run itself', async () => {
    const { store } = await fixture();
    const monitor = new GoalRecoveryMonitor({ goalStore: store, writeback: { reconcile: async () => { throw new Error('private path'); } }, intervalMs: 500 });
    const result = await monitor.runOnce();
    expect(result.status).toBe('degraded');
    expect(result.errorCode).toBe('GOAL_MONITOR_RECONCILE_FAILED');
    expect(JSON.stringify(result)).not.toMatch(/private path|C:\\|token|secret/iu);
  });

  it('uses a daemon-owned claim identity and treats a refused retry as skipped', async () => {
    const store = new InMemoryGoalControlEventStore();
    const claimedTodo = {
      ...todo,
      claimedBy: 'agent_12345678',
      claimTokenHash: 'a'.repeat(64),
      claimedAt: at,
      claimExpiresAt: '2026-08-06T00:30:00.000Z',
    };
    store.seedLegacy({ ...createGoalEvent({ eventId: 'gevt_goal_22345678', goalId: goal.goalId, eventType: 'goal.created', recordedAt: at, producer: 'test', privacy: 'local_private', refs: {}, payload: { goal } }), appendSequence: 1 });
    store.seedLegacy({ ...createGoalEvent({ eventId: 'gevt_todo_22345678', goalId: goal.goalId, eventType: 'todo.added', recordedAt: at, producer: 'test', privacy: 'local_private', refs: { todoId: claimedTodo.todoId }, payload: { todo: claimedTodo } }), appendSequence: 2 });
    const monitor = new GoalRecoveryMonitor({
      goalStore: store,
      writeback: { reconcile: async () => ({ bindings: 0, terminalRuns: 0, recovered: 0, skipped: 0 }) },
      clock: () => new Date(at),
      intervalMs: 500,
      agentIdForGoal: () => 'agent_12345678',
      onEligible: async () => false,
    });
    const result = await monitor.runOnce();
    expect(result.decisions[0]?.status).toBe('eligible');
    expect(result.launched).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('starts and stops one timer without owning a scheduler queue', () => {
    const store = new InMemoryGoalControlEventStore();
    const monitor = new GoalRecoveryMonitor({ goalStore: store, writeback: { reconcile: async () => ({ bindings: 0, terminalRuns: 0, recovered: 0, skipped: 0 }) }, intervalMs: 500 });
    monitor.start();
    monitor.start();
    expect(monitor.isRunning()).toBe(true);
    monitor.stop();
    expect(monitor.isRunning()).toBe(false);
  });

  it('does not launch a second attempt while the latest governed run is active', async () => {
    const { store } = await fixture();
    await store.append(createGoalControlEventV1({
      eventId: 'gevt_binding_12345678',
      goalId: goal.goalId,
      eventType: 'binding.created',
      controlRevision: 3,
      recordedAt: at,
      producer: 'monitor_test',
      privacy: 'local_private',
      refs: { bindingId: 'binding_12345678', todoId: todo.todoId, runId: 'run_12345678' },
      payload: { binding: {
        schemaVersion: 'ready4vibe_goal_binding_v1', bindingId: 'binding_12345678', runId: 'run_12345678', goalId: goal.goalId, todoId: todo.todoId,
        mode: 'governed', goalControlRevision: 2, policyRevision: 'policy-1', capabilityProfileRevision: 'profile-1', approvalPolicyRevision: 'approval-1',
        sandboxSnapshotRevision: 'sandbox-1', workspaceId: 'workspace_main', admissionId: 'admission_12345678', createdAt: at, expiresAt: '2026-08-06T01:00:00.000Z',
        attempt: 1, requestId: 'request_12345678',
      } },
    }));
    let launchCalls = 0;
    const monitor = new GoalRecoveryMonitor({
      goalStore: store,
      writeback: { reconcile: async () => ({ bindings: 1, terminalRuns: 0, recovered: 0, skipped: 0 }) },
      clock: () => new Date(at),
      intervalMs: 500,
      runStatusForBinding: async () => 'executing' as const,
      onEligible: async () => { launchCalls += 1; },
    });
    const result = await monitor.runOnce();
    expect(result.decisions[0]?.status).toBe('eligible');
    expect(result.launched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(launchCalls).toBe(0);
  });
});
