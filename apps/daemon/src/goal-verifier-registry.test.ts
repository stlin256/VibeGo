import { describe, expect, it } from 'vitest';
import type { GoalRunVerifier } from './goal-writeback.js';
import { GoalVerifierRegistry } from './goal-verifier-registry.js';

const at = '2026-08-06T00:00:00.000Z';
const descriptor = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1',
  verifierId: 'verifier_advancement_v1',
  taskClass: 'advancement',
  verifierRevision: 1,
  status: 'ready',
  privacy: 'local_private',
  updatedAt: at,
  ...overrides,
});

const verifier: GoalRunVerifier = {
  verify: async () => ({
    status: 'validated',
    verifierId: 'verifier_advancement_v1',
    verifierRevision: 1,
    summary: 'bounded',
    refs: {},
  }),
};

describe('GoalVerifierRegistry', () => {
  it('selects a ready verifier by authoritative automatic task class', () => {
    const registry = new GoalVerifierRegistry();
    registry.register(descriptor(), verifier);
    const resolved = registry.resolve('advancement');
    expect(resolved.status).toBe('ready');
    expect(resolved.descriptor).toMatchObject({ taskClass: 'advancement', verifierRevision: 1 });
    expect(resolved.verifier).toBe(verifier);
    expect(registry.resolve('user_action').status).toBe('blocked');
    expect(registry.resolve('user_gate').status).toBe('blocked');
  });

  it('fails closed for missing, non-ready and stale selections', () => {
    const registry = new GoalVerifierRegistry();
    expect(registry.resolve('monitor').status).toBe('missing');
    registry.register(descriptor({ taskClass: 'monitor', verifierId: 'verifier_monitor_v1', status: 'degraded' }), verifier);
    expect(registry.resolve('monitor').status).toBe('blocked');
    expect(registry.resolve('monitor', 2).status).toBe('blocked');
  });

  it('rejects duplicate and stale registration but accepts a strictly newer revision', () => {
    const registry = new GoalVerifierRegistry();
    registry.register(descriptor(), verifier);
    expect(() => registry.register(descriptor(), verifier)).toThrow(/already exists/iu);
    expect(() => registry.register(descriptor({ verifierId: 'verifier_old', verifierRevision: 1 }), verifier)).toThrow(/stale/iu);
    const newer = descriptor({ verifierId: 'verifier_advancement_v2', verifierRevision: 2 });
    registry.register(newer, verifier);
    expect(registry.resolve('advancement')).toMatchObject({ status: 'ready', descriptor: newer });
    expect(registry.resolve('advancement', 1).status).toBe('stale');
  });

  it('does not expose implementation objects in metadata snapshots', () => {
    const registry = new GoalVerifierRegistry();
    registry.register(descriptor(), verifier);
    const snapshot = registry.descriptors();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).not.toHaveProperty('verifier');
    expect(registry.has('advancement')).toBe(true);
    expect(registry.has('user_action')).toBe(false);
  });
});
