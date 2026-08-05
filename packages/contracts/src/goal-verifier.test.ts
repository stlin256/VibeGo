import { describe, expect, it } from 'vitest';
import { GoalVerifierDescriptorV1Schema, findGoalVerifierPrivacyViolations, parseGoalVerifierDescriptorV1 } from './goal-verifier.js';

const descriptor = {
  schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1' as const,
  verifierId: 'verifier_advancement_v1',
  taskClass: 'advancement' as const,
  verifierRevision: 1,
  status: 'ready' as const,
  privacy: 'local_private' as const,
  updatedAt: '2026-08-06T00:00:00.000Z',
};

describe('GoalVerifierDescriptorV1', () => {
  it('accepts a bounded ready descriptor', () => {
    expect(parseGoalVerifierDescriptorV1(descriptor)).toEqual(descriptor);
  });

  it('supports only automatic task classes', () => {
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, taskClass: 'user_action' })).toThrow();
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, taskClass: 'user_gate' })).toThrow();
  });

  it('rejects unknown fields, invalid revisions, non-ISO times and public privacy', () => {
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, extra: true })).toThrow();
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, verifierRevision: 'r/1' })).toThrow();
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, updatedAt: 'not-a-time' })).toThrow();
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, privacy: 'public_safe' })).toThrow();
  });

  it('rejects secret-shaped, environment and absolute-path content', () => {
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, verifierId: 'verifier_api_key=sk-12345678901234567890' })).toThrow(/secret|credential/iu);
    expect(findGoalVerifierPrivacyViolations({ path: 'C:\\workspace' })).toContain('absolute path is not allowed at path');
    expect(findGoalVerifierPrivacyViolations({ environment: 'HOME' })).toContain('secret-shaped field is not allowed at environment');
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, verifierId: 'verifier_env' })).not.toThrow();
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, status: 'degraded', privacy: 'private_pointer' })).not.toThrow();
  });

  it('requires local_private for a ready descriptor', () => {
    expect(() => GoalVerifierDescriptorV1Schema.parse({ ...descriptor, privacy: 'private_pointer' })).toThrow(/local_private/iu);
  });
});
