import { createHash } from 'node:crypto';
import {
  GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION,
  type GoalObjectiveSnapshotV1,
  type GoalVerifierInputV1,
} from '@ready4vibe/contracts';
import type { GoalRunVerifier, GoalRunVerifierResult } from './goal-writeback.js';
import { GoalVerifierRegistry } from './goal-verifier-registry.js';

/**
 * This verifier is deliberately narrower than semantic Goal validation. It
 * proves only that the bounded execution evidence has the expected successful
 * shape; it never sees a prompt, transcript, model output, tool arguments or
 * workspace data.
 */
export const ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR = Object.freeze({
  schemaVersion: GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION,
  verifierId: 'verifier_advancement_execution_v1',
  taskClass: 'advancement' as const,
  verifierRevision: 1,
  status: 'ready' as const,
  privacy: 'local_private' as const,
  updatedAt: '2026-08-06T00:00:00.000Z',
});

export const OBJECTIVE_GOAL_VERIFIER_DESCRIPTORS = Object.freeze({
  advancement: Object.freeze({
    schemaVersion: GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION,
    verifierId: 'verifier_advancement_objective_v1',
    taskClass: 'advancement' as const,
    verifierRevision: 1,
    status: 'ready' as const,
    privacy: 'local_private' as const,
    updatedAt: '2026-08-06T00:00:00.000Z',
  }),
  monitor: Object.freeze({
    schemaVersion: GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION,
    verifierId: 'verifier_monitor_objective_v1',
    taskClass: 'monitor' as const,
    verifierRevision: 1,
    status: 'ready' as const,
    privacy: 'local_private' as const,
    updatedAt: '2026-08-06T00:00:00.000Z',
  }),
  blocker: Object.freeze({
    schemaVersion: GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION,
    verifierId: 'verifier_blocker_objective_v1',
    taskClass: 'blocker' as const,
    verifierRevision: 1,
    status: 'ready' as const,
    privacy: 'local_private' as const,
    updatedAt: '2026-08-06T00:00:00.000Z',
  }),
});

const NEGATIVE_EVENT_TYPES = new Set([
  'model.error',
  'run.failed',
  'run.cancelled',
  'run.needs_recovery',
]);

export class AdvancementGoalExecutionVerifier implements GoalRunVerifier {
  async verify(input: GoalVerifierInputV1, signal?: AbortSignal): Promise<GoalRunVerifierResult> {
    const refs = { runId: input.run.runId, eventIds: [input.terminal.id] };
    if (signal?.aborted) {
      return inconclusive(refs, 'cancelled_before_evaluation');
    }
    const hasModelCompletion = input.events.some((event) => event.type === 'model.completed');
    const hasNegativeEvent = input.events.some((event) => NEGATIVE_EVENT_TYPES.has(event.type));
    if (input.taskClass !== 'advancement') return inconclusive(refs, 'task_class_mismatch');
    if (input.run.status !== 'completed') return inconclusive(refs, 'run_status_not_completed');
    if (input.terminal.type !== 'run.completed') return inconclusive(refs, 'terminal_event_mismatch');
    if (!hasModelCompletion) return inconclusive(refs, 'model_completion_missing');
    if (hasNegativeEvent) return inconclusive(refs, 'negative_event_present');
    if (input.run.outputBytes <= 0) return inconclusive(refs, 'output_empty');
    return {
      status: 'validated',
      verifierId: ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR.verifierId,
      verifierRevision: ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR.verifierRevision,
      summary: 'Bounded advancement execution evidence satisfied.',
      refs,
    };
  }
}

/**
 * Deterministic objective criteria verifier. The Goal supplies an explicit
 * verification plan; this class never infers completion from model prose and
 * never executes a model, tool, shell, filesystem, Git, MCP/Skill or sandbox.
 */
export class ObjectiveAwareGoalVerifier implements GoalRunVerifier {
  async verify(input: GoalVerifierInputV1, signal?: AbortSignal): Promise<GoalRunVerifierResult> {
    const terminalId = input.terminal.id;
    const refs = { runId: input.run.runId, eventIds: [terminalId] };
    if (signal?.aborted) return semanticInconclusive(refs, 'cancelled_before_evaluation', input.taskClass);
    const objective = input.objective;
    if (!objective) return semanticInconclusive(refs, 'objective_snapshot_missing', input.taskClass);
    if (!objective.verificationPlan) return semanticInconclusive(refs, 'verification_plan_missing', input.taskClass);
    if (objective.goalId !== input.binding.goalId || objective.todoId !== input.binding.todoId) {
      return semanticInconclusive(refs, 'objective_binding_mismatch', input.taskClass);
    }
    if (hashGoalObjectiveSnapshot(objective) !== objective.objectiveDigest) {
      return semanticInconclusive(refs, 'objective_digest_mismatch', input.taskClass);
    }
    if (!isAutomaticTaskClass(input.taskClass)) return semanticInconclusive(refs, 'task_class_not_automatic', input.taskClass);
    if (input.run.status !== 'completed' || input.terminal.type !== 'run.completed') {
      return semanticInconclusive(refs, 'run_not_successfully_completed', input.taskClass);
    }
    const eventTypes = new Set(input.events.map((event) => event.type));
    if (['model.error', 'run.failed', 'run.cancelled', 'run.needs_recovery'].some((type) => eventTypes.has(type))) {
      return semanticInconclusive(refs, 'negative_event_present', input.taskClass);
    }
    const missing = objective.verificationPlan.requiredEventTypes.filter((type) => !eventTypes.has(type));
    if (missing.length > 0) return semanticInconclusive(refs, 'required_objective_evidence_missing', input.taskClass);
    if (objective.verificationPlan.forbiddenEventTypes.some((type) => eventTypes.has(type))) {
      return semanticInconclusive(refs, 'forbidden_objective_evidence_present', input.taskClass);
    }
    if (input.run.outputBytes < objective.verificationPlan.minimumOutputBytes) {
      return semanticInconclusive(refs, 'objective_output_threshold_not_met', input.taskClass);
    }
    const evidenceEventIds = input.events
      .filter((event) => objective.verificationPlan?.requiredEventTypes.includes(event.type))
      .map((event) => event.id)
      .slice(0, 63);
    return {
      status: 'validated',
      verifierId: `verifier_${input.taskClass}_objective_v1`,
      verifierRevision: 1,
      summary: 'Objective acceptance criteria satisfied by bounded run evidence.',
      refs: { runId: input.run.runId, eventIds: [...new Set([terminalId, ...evidenceEventIds])].slice(0, 64) },
    };
  }
}

/** Stable digest used by the application snapshot builder and verifier. */
export function hashGoalObjectiveSnapshot(snapshot: Omit<GoalObjectiveSnapshotV1, 'objectiveDigest'> | GoalObjectiveSnapshotV1): string {
  const withoutDigest = { ...snapshot } as Record<string, unknown>;
  delete withoutDigest.objectiveDigest;
  return createHash('sha256').update(JSON.stringify(withoutDigest), 'utf8').digest('hex');
}

/** Production composition; Harness keeps its narrower explicit fixture factory. */
export function createProductionGoalVerifierRegistry(): GoalVerifierRegistry {
  const registry = new GoalVerifierRegistry();
  const verifier = new ObjectiveAwareGoalVerifier();
  registry.register(OBJECTIVE_GOAL_VERIFIER_DESCRIPTORS.advancement, verifier);
  registry.register(OBJECTIVE_GOAL_VERIFIER_DESCRIPTORS.monitor, verifier);
  registry.register(OBJECTIVE_GOAL_VERIFIER_DESCRIPTORS.blocker, verifier);
  return registry;
}

/**
 * Explicit fixture-only composition. The production daemon intentionally does
 * not call this factory, so its default verifier registry stays empty.
 */
export function createHarnessGoalVerifierRegistry(): GoalVerifierRegistry {
  const registry = new GoalVerifierRegistry();
  registry.register(ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR, new AdvancementGoalExecutionVerifier());
  return registry;
}

function inconclusive(refs: { readonly runId: string; readonly eventIds: string[] }, summary: string): GoalRunVerifierResult {
  return {
    status: 'inconclusive',
    verifierId: ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR.verifierId,
    verifierRevision: ADVANCEMENT_EXECUTION_VERIFIER_DESCRIPTOR.verifierRevision,
    summary,
    refs,
  };
}

function semanticInconclusive(refs: { readonly runId: string; readonly eventIds: string[] }, summary: string, taskClass: GoalVerifierInputV1['taskClass']): GoalRunVerifierResult {
  return {
    status: 'inconclusive',
    verifierId: isAutomaticTaskClass(taskClass) ? `verifier_${taskClass}_objective_v1` : 'verifier_objective_inconclusive_v1',
    verifierRevision: 1,
    summary,
    refs,
  };
}

function isAutomaticTaskClass(value: GoalVerifierInputV1['taskClass']): value is 'advancement' | 'monitor' | 'blocker' {
  return value === 'advancement' || value === 'monitor' || value === 'blocker';
}
