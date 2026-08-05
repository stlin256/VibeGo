import { describe, expect, it } from 'vitest';
import {
  GoalAdmissionDecisionV1Schema,
  GoalControlEventEnvelopeSchema,
  GoalQuotaReservationV1Schema,
  GoalRunBindingV1Schema,
  GoalValidationEvidenceV1Schema,
  NewGoalControlEventV1Schema,
} from './goal-control-v1.js';
import { GoalRunBindingSchema } from './goal.js';

const at = '2026-08-05T00:00:00.000Z';
const goalId = 'goal_12345678';

function binding() {
  return {
    schemaVersion: 'ready4vibe_goal_binding_v1' as const,
    bindingId: 'binding_12345678',
    runId: 'run_12345678',
    goalId,
    todoId: 'todo_12345678',
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
  };
}

describe('Goal Control v1 contracts', () => {
  it('validates a complete binding and rejects missing revision snapshots', () => {
    expect(GoalRunBindingV1Schema.parse(binding())).toMatchObject({ mode: 'governed', attempt: 1 });
    expect(GoalRunBindingSchema.parse(binding())).toMatchObject({ schemaVersion: 'ready4vibe_goal_binding_v1' });
    const { policyRevision: _policyRevision, ...missing } = binding();
    expect(() => GoalRunBindingV1Schema.parse(missing)).toThrow();
  });

  it('rejects secrets, environment values and absolute paths in v1 events', () => {
    const event = {
      schemaVersion: 'ready4vibe_goal_event_v1' as const,
      eventId: 'gevt_12345678',
      goalId,
      eventType: 'binding.created' as const,
      controlRevision: 3,
      recordedAt: at,
      producer: 'contract-test',
      privacy: 'local_private' as const,
      projectionVersion: 'goal_control_projection_v1' as const,
      refs: { bindingId: 'binding_12345678' },
      payload: { apiKey: 'sk-test', cwd: 'C:\\Users\\secret' },
    };
    expect(() => NewGoalControlEventV1Schema.parse(event)).toThrow();
  });

  it('rejects unknown event types and preserves a strict v0/v1 envelope', () => {
    expect(() => NewGoalControlEventV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_event_v1',
      eventId: 'gevt_12345678',
      goalId,
      eventType: 'tool.exec',
      controlRevision: 1,
      recordedAt: at,
      producer: 'contract-test',
      privacy: 'local_private',
      projectionVersion: 'goal_control_projection_v1',
      refs: {},
      payload: {},
    })).toThrow();
    expect(GoalControlEventEnvelopeSchema.safeParse({
      schemaVersion: 'ready4vibe_goal_event_v1',
      eventId: 'gevt_12345678',
      goalId,
      eventType: 'binding.created',
      controlRevision: 1,
      recordedAt: at,
      producer: 'contract-test',
      privacy: 'local_private',
      projectionVersion: 'goal_control_projection_v1',
      refs: {},
      payload: {},
      appendSequence: 1,
    }).success).toBe(true);
  });

  it('enforces bounded admission, quota and validation fields', () => {
    const decision = GoalAdmissionDecisionV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_admission_v1',
      admissionId: 'admission_12345678',
      goalId,
      status: 'blocked',
      reasonCode: 'GATE_OPEN',
      reason: 'Operator gate is open.',
      projectionChecksum: 'a'.repeat(64),
      controlRevision: 2,
      nextStep: 'resolve_gate',
      createdAt: at,
      requestId: 'request_12345678',
    });
    expect(decision.status).toBe('blocked');
    expect(GoalQuotaReservationV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_quota_reservation_v1',
      reservationId: 'reservation_12345678',
      bindingId: 'binding_12345678',
      goalId,
      attempt: 1,
      turnKey: 'turn_goal_1',
      units: 1,
      status: 'reserved',
      createdAt: at,
      expiresAt: '2026-08-05T01:00:00.000Z',
      updatedAt: at,
    }).status).toBe('reserved');
    expect(() => GoalValidationEvidenceV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_validation_evidence_v1',
      evidenceId: 'evidence_12345678',
      goalId,
      bindingId: 'binding_12345678',
      runId: 'run_12345678',
      attempt: 1,
      verifierId: 'verifier_1',
      verifierRevision: 1,
      status: 'validated',
      checkedAt: at,
      summary: 'x'.repeat(2_001),
      refs: { runId: 'run_12345678' },
      evidenceChecksum: 'b'.repeat(64),
    })).toThrow();
  });
});
