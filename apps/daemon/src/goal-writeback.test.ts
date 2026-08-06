import { describe, expect, it, vi } from 'vitest';
import type { CapabilityProfileRunSnapshot, GoalRecord, GoalTodo, ModelEvent, NewGoalEvent, RunConfig } from '@ready4vibe/contracts';
import { createGoalEvent, GoalControlProjectionBuilder, GoalControlV1WriteService, InMemoryGoalControlEventStore } from '@ready4vibe/goal-control';
import { DEFAULT_SCHEDULER_POLICY, Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { GoalAdmissionService } from './goal-admission.js';
import {
  GoalRunWritebackService,
  MAX_GOAL_VERIFIER_TIMEOUT_MS,
  MIN_GOAL_VERIFIER_TIMEOUT_MS,
  type GoalRunVerifier,
  type GoalRunVerifierResult,
  type GoalRunWritebackOptions,
} from './goal-writeback.js';
import { GoalVerifierRegistry } from './goal-verifier-registry.js';
import { createHarnessGoalVerifierRegistry, createProductionGoalVerifierRegistry } from './goal-execution-verifier.js';
import { RunManager } from './run-manager.js';
import { createDaemonServer } from './server.js';

const at = '2026-08-05T00:00:00.000Z';
const goalId = 'goal_12345678';
const todoId = 'todo_12345678';
const workspaceId = 'workspace_main';

const runConfig: RunConfig = {
  workspaceId,
  userMessage: 'Complete the bounded writeback fixture.',
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

function capabilitySnapshot(): CapabilityProfileRunSnapshot {
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
  };
}

function fixtureEvents(withVerificationPlan = false): NewGoalEvent[] {
  const goal: GoalRecord = {
    goalId,
    title: 'Writeback fixture',
    objective: 'Exercise terminal validation and recovery.',
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
    title: 'Run validation',
    priority: 1,
    ...(withVerificationPlan ? { verificationPlan: {
      schemaVersion: 'ready4vibe_goal_verification_plan_v1' as const,
      requiredEventTypes: ['model.completed', 'run.completed'],
      forbiddenEventTypes: ['model.error'],
      minimumOutputBytes: 1,
    } } : {}),
  };
  return [
    createGoalEvent({ eventId: 'gevt_00000001', goalId, eventType: 'goal.created', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: {}, payload: { goal } }),
    createGoalEvent({ eventId: 'gevt_00000002', goalId, eventType: 'todo.added', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: { todoId }, payload: { todo } }),
    createGoalEvent({ eventId: 'gevt_00000003', goalId, eventType: 'todo.claimed', recordedAt: at, producer: 'fixture', privacy: 'local_private', refs: { todoId }, payload: {
      todoId, claimedBy: 'agent_12345678', claimTokenHash: 'a'.repeat(64), claimedAt: at, claimExpiresAt: '2026-08-05T01:00:00.000Z',
    } }),
  ];
}

function governedInput(expectedControlRevision: number): Record<string, unknown> {
  return {
    ...runConfig,
    runMode: 'governed',
    goalId,
    todoId,
    expectedControlRevision,
    agentId: 'agent_12345678',
    turnKey: 'turn_goal_1',
    requestId: 'request_12345678',
    attempt: 1,
  };
}

async function seed(store: InMemoryGoalControlEventStore, withVerificationPlan = false): Promise<number> {
  for (const [index, event] of fixtureEvents(withVerificationPlan).entries()) store.seedLegacy({ ...event, appendSequence: index + 1 });
  return fixtureEvents(withVerificationPlan).length;
}

function makeVerifier(status: 'validated' | 'inconclusive' = 'validated'): GoalRunVerifier {
  return {
    verify: async () => ({
      status,
      verifierId: 'fixture_verifier',
      verifierRevision: 1,
      summary: status === 'validated' ? 'Fixture validation passed.' : 'Fixture validation is inconclusive.',
      refs: {},
    }),
  };
}

function makeFixture(
  model: FakeModelProvider,
  verifier: GoalRunVerifier = makeVerifier(),
  registerBinding = true,
  verifierRegistry?: GoalVerifierRegistry,
  writebackOptions: Pick<GoalRunWritebackOptions, 'verifierTimeoutMs'> = {},
) {
  const goalStore = new InMemoryGoalControlEventStore();
  const eventStore = new InMemoryEventStore();
  const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
  const runManager = new RunManager({ eventStore, scheduler, modelProvider: model, workspaceExists: () => true });
  const goalControl = new GoalControlV1WriteService(goalStore, { producer: 'writeback-test', clock: () => at });
  const writeback = new GoalRunWritebackService({ goalStore, runManager, goalControl, verifier, ...(verifierRegistry ? { verifierRegistry } : {}), ...writebackOptions, clock: () => new Date(at) });
  const admission = new GoalAdmissionService({
    goalStore,
    runManager,
    goalControl,
    scheduler,
    capabilitySnapshotForRun: () => capabilitySnapshot(),
    workspace: { exists: () => true },
    approval: () => ({ ready: true, revision: 'approval-1' }),
    sandbox: () => ({ ready: true, revision: 'sandbox-1' }),
    quotaPolicy: { enabled: true },
    ...(registerBinding ? { registerBinding: (binding: Parameters<typeof writeback.registerBinding>[0]) => { writeback.registerBinding(binding, 'advancement'); } } : {}),
    clock: () => new Date(at),
  });
  return { goalStore, eventStore, runManager, writeback, admission };
}

describe('GoalRunWritebackService', () => {
  it('uses objective criteria to validate and complete a governed Todo', async () => {
    const fixture = makeFixture(
      new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }),
      makeVerifier(),
      true,
      createProductionGoalVerifierRegistry(),
    );
    const expectedRevision = await seed(fixture.goalStore, true);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.consumed')).toBe(true));
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.todos[0]?.status).toBe('done');
    expect(projection.validationEvidence[0]).toMatchObject({ verifierId: 'verifier_advancement_objective_v1', status: 'validated' });
    fixture.writeback.close();
  });

  it('validates a completed governed run and atomically completes Todo plus quota', async () => {
    const fixture = makeFixture(new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }));
    const expectedRevision = await seed(fixture.goalStore);
    const admitted = await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => {
      const events = await fixture.goalStore.read(goalId);
      expect(events.some((event) => event.eventType === 'quota.consumed')).toBe(true);
    });
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.todos[0]).toMatchObject({ todoId, status: 'done' });
    expect(projection.quota.reservations[0]).toMatchObject({ status: 'consumed' });
    expect((await fixture.goalStore.read(goalId)).filter((event) => event.eventType === 'validation.recorded')).toHaveLength(1);

    await fixture.runManager.eventStore.append({
      runId: admitted.runId,
      type: 'run.completed',
      source: 'orchestrator',
      correlationId: 'corr_duplicate_terminal',
      payload: { summary: 'duplicate', exitReason: 'stop' },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await fixture.goalStore.read(goalId)).filter((event) => event.eventType === 'quota.consumed')).toHaveLength(1);
    fixture.writeback.close();
  });

  it('waits for the explicit terminal event before invoking a task verifier', async () => {
    let terminalType: string | undefined;
    const verifier: GoalRunVerifier = {
      verify: async (input) => {
        terminalType = input.terminal.type;
        return {
          status: 'validated',
          verifierId: 'verifier_advancement_v1',
          verifierRevision: 1,
          summary: 'Terminal event ordering fixture passed.',
          refs: {},
        };
      },
    };
    const registry = new GoalVerifierRegistry();
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v1',
      taskClass: 'advancement',
      verifierRevision: 1,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, verifier);
    const fixture = makeFixture(
      new FakeModelProvider({ delayMs: 20, events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }),
      verifier,
      true,
      registry,
    );
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.consumed')).toBe(true), { timeout: 3_000 });
    expect(terminalType).toBe('run.completed');
    fixture.writeback.close();
  });

  it('records failed validation and releases reservation without completing Todo', async () => {
    const fixture = makeFixture(new FakeModelProvider({ events: [{ type: 'error', code: 'MODEL_FAILED', retryable: false, safeMessage: 'provider failed' }] }));
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => {
      const events = await fixture.goalStore.read(goalId);
      expect(events.some((event) => event.eventType === 'quota.released')).toBe(true);
    });
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]).toMatchObject({ status: 'released' });
    expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.consumed')).toBe(false);
    let retryInput: Record<string, unknown> | undefined;
    const retryService = new GoalRunWritebackService({
      goalStore: fixture.goalStore,
      runManager: fixture.runManager,
      admitGoverned: async (input) => { retryInput = input as Record<string, unknown>; return { status: 'queued' }; },
      clock: () => new Date(at),
    });
    const failedRun = fixture.runManager.eventStore.listRunIds()[0];
    expect(failedRun).toBeDefined();
    const retried = await retryService.retryGoverned(failedRun!, { agentId: 'agent_12345678' });
    expect(retried).toMatchObject({ status: 'queued' });
    expect(retryInput).toMatchObject({ runMode: 'governed', attempt: 2, goalId, todoId });
    expect(retryInput?.requestId).not.toBe('request_12345678');
    expect(retryInput?.turnKey).not.toBe('turn_goal_1');
    const server = createDaemonServer({ runManager: fixture.runManager, goalRunWriteback: retryService });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('server did not expose a TCP address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/runs/${failedRun}/governed-retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: 'retry-as-new-governed-run', agentId: 'agent_12345678' }),
      });
      expect(response.status).toBe(202);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    retryService.close();
    fixture.writeback.close();
  });

  it('reconciles a terminal run after subscription loss without replaying tools', async () => {
    const model = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] });
    const fixture = makeFixture(model, makeVerifier(), false);
    const expectedRevision = await seed(fixture.goalStore);
    // Simulate a process that persisted binding/reservation and finished while
    // the writeback subscriber was down.
    fixture.writeback.close();
    const admitted = await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(() => expect(fixture.runManager.completion(admitted.runId)).toBeDefined());
    const verifier = makeVerifier();
    const recovered = new GoalRunWritebackService({ goalStore: fixture.goalStore, runManager: fixture.runManager, verifier, clock: () => new Date(at) });
    const result = await recovered.reconcile();
    expect(result.terminalRuns).toBe(1);
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.consumed')).toBe(true));
    expect(model.requests).toHaveLength(1);
    recovered.close();
  });

  it('records needs-recovery without executing the old run or spending quota', async () => {
    const goalStore = new InMemoryGoalControlEventStore();
    const eventStore = new InMemoryEventStore();
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const runManager = new RunManager({ eventStore, scheduler, modelProvider: model, workspaceExists: () => true });
    const goalControl = new GoalControlV1WriteService(goalStore, { producer: 'recovery-test', clock: () => at });
    const expectedRevision = await seed(goalStore);
    const binding = await goalControl.createBinding(goalId, {
      eventId: 'gevt_00000004',
      expectedRevision,
      binding: {
        bindingId: 'binding_recovery1',
        runId: 'run_recovery12345678',
        goalId,
        todoId,
        mode: 'governed',
        goalControlRevision: expectedRevision,
        policyRevision: 'policy-1',
        capabilityProfileRevision: 'profile-1',
        approvalPolicyRevision: 'approval-1',
        sandboxSnapshotRevision: 'sandbox-1',
        workspaceId,
        admissionId: 'admission_recovery1',
        createdAt: at,
        expiresAt: '2026-08-05T01:00:00.000Z',
        attempt: 1,
        requestId: 'request_recovery1',
      },
    });
    await goalControl.reserveQuota(goalId, {
      eventId: 'gevt_00000005',
      expectedRevision: binding.controlRevision,
      requestId: 'request_recovery1',
      reservation: {
        reservationId: 'reservation_recovery1',
        bindingId: 'binding_recovery1',
        goalId,
        todoId,
        attempt: 1,
        turnKey: 'turn_recovery_1',
        units: 1,
        expiresAt: '2026-08-05T01:00:00.000Z',
      },
    });
    await eventStore.append({ runId: 'run_recovery12345678', type: 'run.created', source: 'user', correlationId: 'corr_recovery', payload: { config: runConfig } });
    await eventStore.append({ runId: 'run_recovery12345678', type: 'run.status', source: 'system', correlationId: 'corr_recovery', payload: { from: 'created', to: 'queued' } });
    await runManager.recoverAfterRestart();
    const writeback = new GoalRunWritebackService({ goalStore, runManager, goalControl, verifier: makeVerifier(), clock: () => new Date(at) });
    const result = await writeback.reconcile();
    expect(result.terminalRuns).toBe(1);
    const projection = new GoalControlProjectionBuilder().build(await goalStore.read(goalId));
    expect(projection.recoveries).toHaveLength(1);
    expect(projection.recoveries[0]).toMatchObject({ status: 'needs_recovery', runId: 'run_recovery12345678' });
    expect(projection.quota.reservations[0]).toMatchObject({ status: 'reserved' });
    expect(model.requests).toHaveLength(0);
    writeback.close();
  });

  it('selects a task-specific verifier from the Goal projection and passes only bounded digests', async () => {
    let seenInput: Record<string, unknown> | undefined;
    const taskVerifier: GoalRunVerifier = {
      verify: async (input) => {
        seenInput = input as unknown as Record<string, unknown>;
        return {
          status: 'validated',
          verifierId: 'verifier_advancement_v1',
          verifierRevision: 1,
          summary: 'Task verifier passed.',
          refs: {},
        };
      },
    };
    const registry = new GoalVerifierRegistry();
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v1',
      taskClass: 'advancement',
      verifierRevision: 1,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, taskVerifier);
    const fixture = makeFixture(new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }), taskVerifier, true, registry);
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.consumed')).toBe(true));
    expect(seenInput).toBeDefined();
    expect(seenInput).toMatchObject({ taskClass: 'advancement' });
    expect(Object.keys(seenInput ?? {}).sort()).toEqual(['binding', 'events', 'objective', 'run', 'schemaVersion', 'taskClass', 'terminal']);
    expect((seenInput?.events as Array<Record<string, unknown>>)[0]).toMatchObject({ schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' });
    expect(seenInput).not.toHaveProperty('prompt');
    expect(seenInput).not.toHaveProperty('transcript');
    expect(seenInput).not.toHaveProperty('output');
    expect(seenInput).toHaveProperty('objective.objectiveDigest');
    expect(seenInput).not.toHaveProperty('objective.verificationPlan');
    fixture.writeback.close();
  });

  it('uses the deterministic execution verifier and releases quota for incomplete evidence', async () => {
    const registry = createHarnessGoalVerifierRegistry();
    const fixture = makeFixture(new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }), makeVerifier(), true, registry);
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.released')).toBe(true));
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]?.status).toBe('released');
    expect(projection.validationEvidence[0]).toMatchObject({
      status: 'inconclusive',
      verifierId: 'verifier_advancement_execution_v1',
      verifierRevision: 1,
    });
    fixture.writeback.close();
  });

  it('fails closed and releases quota when a registry verifier returns a mismatched id or revision', async () => {
    const mismatched: GoalRunVerifier = {
      verify: async () => ({
        status: 'validated',
        verifierId: 'verifier_other',
        verifierRevision: 99,
        summary: 'must not complete',
        refs: {},
      }),
    };
    const registry = new GoalVerifierRegistry();
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v1',
      taskClass: 'advancement',
      verifierRevision: 1,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, mismatched);
    const fixture = makeFixture(new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }), mismatched, true, registry);
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.released')).toBe(true));
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]?.status).toBe('released');
    expect(projection.validationEvidence[0]).toMatchObject({ status: 'inconclusive', verifierId: 'verifier_mismatch', verifierRevision: 0 });
    fixture.writeback.close();
  });

  it('fails closed and releases quota when a verifier result violates the runtime contract', async () => {
    const invalidResult: GoalRunVerifier = {
      verify: async () => ({
        status: 'validated',
        verifierId: 'verifier_advancement_v1',
        verifierRevision: 1,
        summary: 'api_key=sk-12345678901234567890',
        refs: {},
      }),
    };
    const registry = new GoalVerifierRegistry();
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v1',
      taskClass: 'advancement',
      verifierRevision: 1,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, invalidResult);
    const fixture = makeFixture(new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }), invalidResult, true, registry);
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.released')).toBe(true));
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.validationEvidence[0]).toMatchObject({ status: 'inconclusive', verifierId: 'verifier_mismatch' });
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]?.status).toBe('released');
    fixture.writeback.close();
  });

  it('does not invoke a verifier when run-event digests exceed the server bound', async () => {
    let called = false;
    const verifier: GoalRunVerifier = {
      verify: async () => {
        called = true;
        return { status: 'validated', verifierId: 'verifier_advancement_v1', verifierRevision: 1, summary: 'must not run', refs: {} };
      },
    };
    const registry = new GoalVerifierRegistry();
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v1',
      taskClass: 'advancement',
      verifierRevision: 1,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, verifier);
    const modelEvents: ModelEvent[] = Array.from({ length: 600 }, () => ({ type: 'text-delta' as const, text: 'x' }));
    modelEvents.push({ type: 'completed', finishReason: 'stop' });
    const fixture = makeFixture(new FakeModelProvider({ events: modelEvents }), verifier, true, registry);
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.released')).toBe(true), { timeout: 3_000 });
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(called).toBe(false);
    expect(projection.validationEvidence[0]).toMatchObject({ status: 'inconclusive', verifierId: 'verifier_input_invalid' });
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]?.status).toBe('released');
    fixture.writeback.close();
  });

  it('aborts a cooperative verifier at the bounded deadline and releases quota', async () => {
    let signal: AbortSignal | undefined;
    const verifier: GoalRunVerifier = {
      verify: async (_input, providedSignal) => {
        signal = providedSignal;
        await new Promise<void>((resolve) => {
          if (providedSignal?.aborted) {
            resolve();
            return;
          }
          providedSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('cooperative verifier stopped');
      },
    };
    const fixture = makeFixture(
      new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }),
      verifier,
      true,
      undefined,
      { verifierTimeoutMs: MIN_GOAL_VERIFIER_TIMEOUT_MS },
    );
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.released')).toBe(true), { timeout: 2_000 });
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(signal?.aborted).toBe(true);
    expect(projection.validationEvidence[0]).toMatchObject({ status: 'inconclusive', verifierId: 'verifier_timeout' });
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]?.status).toBe('released');
    fixture.writeback.close();
  });

  it('ignores a late non-cooperative verifier result after timeout', async () => {
    let resolveVerifier!: (value: GoalRunVerifierResult) => void;
    const verifier: GoalRunVerifier = {
      verify: () => new Promise((resolve) => {
        resolveVerifier = resolve;
      }),
    };
    const fixture = makeFixture(
      new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }),
      verifier,
      true,
      undefined,
      { verifierTimeoutMs: MIN_GOAL_VERIFIER_TIMEOUT_MS },
    );
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.released')).toBe(true), { timeout: 2_000 });
    resolveVerifier({ status: 'validated', verifierId: 'late_verifier', verifierRevision: 1, summary: 'late', refs: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(projection.validationEvidence[0]).toMatchObject({ status: 'inconclusive', verifierId: 'verifier_timeout' });
    expect(projection.todos[0]?.status).toBe('open');
    expect(projection.quota.reservations[0]?.status).toBe('released');
    fixture.writeback.close();
  });

  it('uses the verifier revision captured before terminal events when the registry updates', async () => {
    let firstCalls = 0;
    let secondCalls = 0;
    const firstVerifier: GoalRunVerifier = {
      verify: async () => {
        firstCalls += 1;
        return { status: 'validated', verifierId: 'verifier_advancement_v1', verifierRevision: 1, summary: 'first', refs: {} };
      },
    };
    const secondVerifier: GoalRunVerifier = {
      verify: async () => {
        secondCalls += 1;
        return { status: 'validated', verifierId: 'verifier_advancement_v2', verifierRevision: 2, summary: 'second', refs: {} };
      },
    };
    const registry = new GoalVerifierRegistry();
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v1',
      taskClass: 'advancement',
      verifierRevision: 1,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, firstVerifier);
    const fixture = makeFixture(
      new FakeModelProvider({ delayMs: 80, events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] }),
      firstVerifier,
      true,
      registry,
    );
    const expectedRevision = await seed(fixture.goalStore);
    await fixture.admission.admit(governedInput(expectedRevision));
    await new Promise((resolve) => setTimeout(resolve, 10));
    registry.register({
      schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
      verifierId: 'verifier_advancement_v2',
      taskClass: 'advancement',
      verifierRevision: 2,
      status: 'ready',
      privacy: 'local_private',
      updatedAt: at,
    }, secondVerifier);
    await vi.waitFor(async () => expect((await fixture.goalStore.read(goalId)).some((event) => event.eventType === 'quota.consumed')).toBe(true), { timeout: 3_000 });
    const projection = new GoalControlProjectionBuilder().build(await fixture.goalStore.read(goalId));
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(0);
    expect(projection.validationEvidence[0]).toMatchObject({ verifierId: 'verifier_advancement_v1', verifierRevision: 1, status: 'validated' });
    fixture.writeback.close();
  });

  it('rejects verifier timeout options outside the server-owned bounds', () => {
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    expect(() => makeFixture(model, makeVerifier(), false, undefined, { verifierTimeoutMs: MIN_GOAL_VERIFIER_TIMEOUT_MS - 1 })).toThrow(/between/iu);
    expect(() => makeFixture(model, makeVerifier(), false, undefined, { verifierTimeoutMs: MAX_GOAL_VERIFIER_TIMEOUT_MS + 1 })).toThrow(/between/iu);
    expect(() => makeFixture(model, makeVerifier(), false, undefined, { verifierTimeoutMs: 1.5 })).toThrow(/between/iu);
  });
});
