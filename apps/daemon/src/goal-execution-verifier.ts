import {
  GOAL_VERIFIER_DESCRIPTOR_SCHEMA_VERSION,
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
      return inconclusive(refs, 'Advancement execution evidence was cancelled before evaluation.');
    }
    const hasModelCompletion = input.events.some((event) => event.type === 'model.completed');
    const hasNegativeEvent = input.events.some((event) => NEGATIVE_EVENT_TYPES.has(event.type));
    const valid = input.taskClass === 'advancement'
      && input.run.status === 'completed'
      && input.terminal.type === 'run.completed'
      && hasModelCompletion
      && !hasNegativeEvent
      && input.run.outputBytes > 0;
    if (!valid) {
      return inconclusive(refs, 'Bounded advancement execution evidence is incomplete or contradictory.');
    }
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
