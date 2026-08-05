import { describe, expect, it } from 'vitest';
import type { GoalVerifierInputV1 } from '@ready4vibe/contracts';
import {
  ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR,
  AdvancementGoalExecutionVerifier,
  createHarnessGoalVerifierRegistry,
} from './goal-execution-verifier.js';

const at = '2026-08-06T00:00:00.000Z';

function input(overrides: Record<string, unknown> = {}): GoalVerifierInputV1 {
  const binding = {
    schemaVersion: 'ready4vibe_goal_binding_v1' as const,
    bindingId: 'binding_12345678',
    runId: 'run_12345678',
    goalId: 'goal_12345678',
    todoId: 'todo_12345678',
    mode: 'governed' as const,
    goalControlRevision: 3,
    policyRevision: 'policy-1',
    capabilityProfileRevision: 'profile-1',
    approvalPolicyRevision: 'approval-1',
    sandboxSnapshotRevision: 'sandbox-1',
    workspaceId: 'workspace_main',
    admissionId: 'admission_12345678',
    createdAt: at,
    expiresAt: '2026-08-06T01:00:00.000Z',
    attempt: 1,
    requestId: 'request_12345678',
  };
  const events = [
    { schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345678', seq: 1, type: 'model.requested', at },
    { schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345679', seq: 2, type: 'model.completed', at },
    { schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345680', seq: 3, type: 'run.completed', at },
  ];
  return {
    schemaVersion: 'ready4vibe_goal_verifier_input_v1',
    binding,
    taskClass: 'advancement',
    run: { runId: binding.runId, status: 'completed', lastEventSeq: 3, outputBytes: 4 },
    terminal: events[2]!,
    events,
    ...overrides,
  } as GoalVerifierInputV1;
}

describe('AdvancementGoalExecutionVerifier', () => {
  it('validates only a bounded completed execution evidence shape', async () => {
    const result = await new AdvancementGoalExecutionVerifier().verify(input());
    expect(result).toMatchObject({
      status: 'validated',
      verifierId: ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR.verifierId,
      verifierRevision: ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR.verifierRevision,
      refs: { runId: 'run_12345678', eventIds: ['evt_12345680'] },
    });
  });

  it.each([
    ['wrong task class', { taskClass: 'monitor' as const }],
    ['run is not completed', { run: { runId: 'run_12345678', status: 'failed' as const, lastEventSeq: 3, outputBytes: 4 } }],
    ['terminal is not run.completed', { terminal: { schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345680', seq: 3, type: 'run.failed', at } }],
    ['model completion is absent', { events: [{ schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345680', seq: 3, type: 'run.completed', at }] }],
    ['failure digest is present', { events: [
      { schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345679', seq: 2, type: 'model.error', at },
      { schemaVersion: 'ready4vibe_goal_verifier_event_digest_v1' as const, id: 'evt_12345680', seq: 3, type: 'run.completed', at },
    ] }],
    ['output is empty', { run: { runId: 'run_12345678', status: 'completed' as const, lastEventSeq: 3, outputBytes: 0 } }],
  ] as const)('returns inconclusive for %s', async (_name, override) => {
    const result = await new AdvancementGoalExecutionVerifier().verify(input(override));
    expect(result.status).toBe('inconclusive');
    expect(result.refs).toEqual({ runId: 'run_12345678', eventIds: ['evt_12345680'] });
  });

  it('fails closed when cancelled before evaluation and exposes no raw data', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await new AdvancementGoalExecutionVerifier().verify(input(), controller.signal);
    expect(result.status).toBe('inconclusive');
    expect(JSON.stringify(result)).not.toMatch(/prompt|transcript|output|secret|path|command/iu);
  });
});

describe('createHarnessGoalVerifierRegistry', () => {
  it('registers only the explicit advancement execution lane', () => {
    const registry = createHarnessGoalVerifierRegistry();
    expect(registry.descriptors()).toEqual([ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR]);
    expect(registry.resolve('advancement').status).toBe('ready');
    expect(registry.resolve('monitor').status).toBe('missing');
    expect(registry.resolve('user_action').status).toBe('blocked');
  });
});
