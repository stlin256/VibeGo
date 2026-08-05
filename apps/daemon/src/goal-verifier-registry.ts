import {
  GoalVerifierDescriptorV1Schema,
  type GoalVerifierDescriptorV1,
  type GoalVerifierTaskClass,
} from '@ready4vibe/contracts';
import type { GoalRunVerifier } from './goal-writeback.js';

export type GoalVerifierResolutionStatus = 'ready' | 'missing' | 'blocked' | 'stale' | 'conflict';

export interface GoalVerifierResolution {
  readonly status: GoalVerifierResolutionStatus;
  readonly descriptor?: GoalVerifierDescriptorV1;
  readonly verifier?: GoalRunVerifier;
  readonly reason: string;
}

export interface GoalVerifierRegistration {
  readonly descriptor: unknown;
  readonly verifier: GoalRunVerifier;
}

interface Entry {
  readonly descriptor: GoalVerifierDescriptorV1;
  readonly verifier: GoalRunVerifier;
}

/**
 * Daemon application registry for explicit task-specific validation.
 *
 * This class is deliberately only a selector. It never runs a verifier,
 * scheduler, model, tool, shell, filesystem, Git, MCP/Skill or sandbox.
 */
export class GoalVerifierRegistry {
  private readonly entries = new Map<GoalVerifierTaskClass, Entry>();

  constructor(registrations: readonly GoalVerifierRegistration[] = []) {
    for (const registration of registrations) this.register(registration.descriptor, registration.verifier);
  }

  /**
   * Register one task lane. A lane may be replaced only by a strictly newer
   * verifier revision; equal or older registrations fail closed.
   */
  register(descriptorInput: unknown, verifier: GoalRunVerifier): GoalVerifierDescriptorV1 {
    const descriptor = GoalVerifierDescriptorV1Schema.parse(descriptorInput);
    if (!verifier || typeof verifier.verify !== 'function') {
      throw new Error('Goal verifier implementation is invalid.');
    }
    const existing = this.entries.get(descriptor.taskClass);
    if (existing) {
      if (existing.descriptor.verifierId === descriptor.verifierId
        && existing.descriptor.verifierRevision === descriptor.verifierRevision) {
        throw new Error(`Goal verifier registration already exists for ${descriptor.taskClass}.`);
      }
      if (descriptor.verifierRevision <= existing.descriptor.verifierRevision) {
        throw new Error(`Goal verifier revision is stale for ${descriptor.taskClass}.`);
      }
    }
    this.entries.set(descriptor.taskClass, { descriptor, verifier });
    return descriptor;
  }

  unregister(taskClass: string, expectedRevision?: number): boolean {
    if (!isAutomaticTaskClass(taskClass)) return false;
    const existing = this.entries.get(taskClass);
    if (!existing) return false;
    if (expectedRevision !== undefined && existing.descriptor.verifierRevision !== expectedRevision) return false;
    this.entries.delete(taskClass);
    return true;
  }

  /** Return immutable metadata only; implementations are never exposed here. */
  descriptors(): readonly GoalVerifierDescriptorV1[] {
    return [...this.entries.values()]
      .map((entry) => ({ ...entry.descriptor }))
      .sort((left, right) => left.taskClass.localeCompare(right.taskClass));
  }

  /**
   * Resolve a task lane. A caller may fence selection to an expected revision;
   * a mismatch is stale rather than a best-effort fallback.
   */
  resolve(taskClass: string | null | undefined, expectedRevision?: number): GoalVerifierResolution {
    if (!isAutomaticTaskClass(taskClass)) {
      return { status: 'blocked', reason: 'The Todo task class has no automatic verifier lane.' };
    }
    const entry = this.entries.get(taskClass);
    if (!entry) return { status: 'missing', reason: 'No task-specific verifier is configured.' };
    if (entry.descriptor.status !== 'ready') {
      return { status: 'blocked', descriptor: entry.descriptor, reason: `Verifier status is ${entry.descriptor.status}.` };
    }
    if (expectedRevision !== undefined && entry.descriptor.verifierRevision !== expectedRevision) {
      return { status: 'stale', descriptor: entry.descriptor, reason: 'Verifier revision is stale for this run.' };
    }
    return { status: 'ready', descriptor: entry.descriptor, verifier: entry.verifier, reason: 'Task-specific verifier is ready.' };
  }

  /** Used by application tests to prove no hidden runtime is created. */
  has(taskClass: string): boolean {
    return isAutomaticTaskClass(taskClass) && this.entries.has(taskClass);
  }
}

function isAutomaticTaskClass(value: string | null | undefined): value is GoalVerifierTaskClass {
  return value === 'advancement' || value === 'monitor' || value === 'blocker';
}
