import { describe, expect, it } from 'vitest';
import {
  GoalEventTypeSchema,
  GoalHandoffSchema,
  GoalRecordSchema,
  GoalRunBindingSchema,
  GoalVerificationPlanSchema,
  NewGoalEventSchema,
  StoredGoalEventSchema,
  findGoalPrivacyViolations,
  parseNewGoalEvent,
} from './index.js';

const goal = {
  goalId: 'goal_12345678',
  title: 'Ship the first slice',
  objective: 'Keep the harness small, testable, and safe.',
  status: 'active' as const,
  controlRevision: 0,
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z',
  schemaVersion: 1 as const,
};

const event = {
  schemaVersion: 'ready4vibe_goal_event_v0' as const,
  eventId: 'gevt_12345678',
  goalId: goal.goalId,
  eventType: 'goal.created' as const,
  recordedAt: goal.createdAt,
  producer: 'web',
  privacy: 'local_private' as const,
  projectionVersion: 'goal_control_projection_v0' as const,
  refs: {},
  payload: { goal },
};

describe('goal contracts', () => {
  it('accepts bounded objective verification plans and rejects overlap/unknown fields', () => {
    const plan = {
      schemaVersion: 'ready4vibe_goal_verification_plan_v1' as const,
      requiredEventTypes: ['model.completed', 'run.completed'],
      forbiddenEventTypes: ['model.error'],
      minimumOutputBytes: 1,
    };
    expect(GoalVerificationPlanSchema.parse(plan)).toEqual(plan);
    expect(() => GoalVerificationPlanSchema.parse({ ...plan, forbiddenEventTypes: ['run.completed'] })).toThrow(/overlap/iu);
    expect(() => GoalVerificationPlanSchema.parse({ ...plan, extra: true })).toThrow();
    expect(GoalVerificationPlanSchema.parse({ ...plan, semanticAssertions: [{ assertionId: 'assert_exit_12345678', fact: 'run.exitReason', operator: 'equals', expected: 'model-completed' }] })).toMatchObject({ semanticAssertions: [{ fact: 'run.exitReason' }] });
    expect(() => GoalVerificationPlanSchema.parse({ ...plan, semanticAssertions: [{ assertionId: 'assert_bad_12345678', fact: 'run.outputBytes', operator: 'at_least' }] })).toThrow(/expected/iu);
  });

  it('accepts versioned goal records and rejects a missing revision', () => {
    expect(GoalRecordSchema.parse(goal)).toEqual(goal);
    const { controlRevision: _revision, ...withoutRevision } = goal;
    expect(() => GoalRecordSchema.parse(withoutRevision)).toThrow();
  });

  it('rejects unknown event types and preserves the explicit event vocabulary', () => {
    expect(GoalEventTypeSchema.parse('todo.claim_released')).toBe('todo.claim_released');
    expect(GoalEventTypeSchema.parse('writeback.failed')).toBe('writeback.failed');
    expect(() => GoalEventTypeSchema.parse('tool.exec')).toThrow();
    expect(parseNewGoalEvent(event)).toMatchObject({ eventId: 'gevt_12345678' });
    expect(() => NewGoalEventSchema.parse({ ...event, eventType: 'tool.exec' })).toThrow();
  });

  it('rejects secret-shaped payload fields and absolute paths', () => {
    expect(findGoalPrivacyViolations({ apiKey: 'sk-not-a-real-key' })).toContain('secret-shaped field is not allowed at apiKey');
    expect(findGoalPrivacyViolations({ token: 'opaque-token' })).toContain('secret-shaped field is not allowed at token');
    expect(findGoalPrivacyViolations({ claimTokenHash: 'a'.repeat(64) })).toEqual([]);
    expect(findGoalPrivacyViolations({ environment: { MODEL_API_KEY: 'sk-not-a-real-key' } })).toContain('secret-shaped field is not allowed at environment');
    expect(findGoalPrivacyViolations({ details: { cwd: 'C:\\Users\\someone\\repo' } })).toContain('absolute path is not allowed at details.cwd');
    expect(findGoalPrivacyViolations({ details: { path: '/var/lib/ready4vibe' } })).toContain('absolute path is not allowed at details.path');
    expect(() => NewGoalEventSchema.parse({ ...event, payload: { apiKey: 'sk-not-a-real-key' } })).toThrow(/secret-shaped/);
    expect(() => NewGoalEventSchema.parse({ ...event, payload: { summary: 'x'.repeat(128 * 1024) } })).toThrow(/too large/);
  });

  it('requires a source for every handoff', () => {
    expect(() => GoalHandoffSchema.parse({
      handoffId: 'handoff_12345678',
      goalId: goal.goalId,
      toTodoId: 'todo_12345678',
      summary: 'Continue the next step.',
      createdAt: goal.createdAt,
    })).toThrow(/handoff must reference/);
    expect(GoalHandoffSchema.parse({
      handoffId: 'handoff_12345678',
      goalId: goal.goalId,
      fromTodoId: 'todo_12345678',
      toTodoId: 'todo_87654321',
      summary: 'Continue the next step.',
      createdAt: goal.createdAt,
    })).toMatchObject({ fromTodoId: 'todo_12345678' });
  });

  it('requires a binding id and goal-local append sequence for stored events', () => {
    expect(GoalRunBindingSchema.parse({ bindingId: 'binding_12345678', goalId: goal.goalId, todoId: 'todo_12345678', mode: 'governed', controlRevision: 0 })).toMatchObject({ bindingId: 'binding_12345678' });
    expect(() => GoalRunBindingSchema.parse({ goalId: goal.goalId, mode: 'governed' })).toThrow();
    expect(StoredGoalEventSchema.parse({ ...event, appendSequence: 1 })).toMatchObject({ appendSequence: 1 });
    expect(() => StoredGoalEventSchema.parse({ ...event, appendSequence: 0 })).toThrow();
  });
});
