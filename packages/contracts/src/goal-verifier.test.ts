import { describe, expect, it } from 'vitest';
import {
  GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION,
  GOAL_VERIFIER_INPUT_SCHEMA_VERSION,
  GOAL_VERIFIER_MAX_EVENT_DIGESTS,
  GOAL_VERIFIER_MAX_OUTPUT_BYTES,
  GOAL_VERIFIER_RESULT_SCHEMA_VERSION,
  GoalVerifierDescriptorV1Schema,
  GoalVerifierEventDigestV1Schema,
  GoalVerifierInputV1Schema,
  GoalVerifierResultV1Schema,
  findGoalVerifierPrivacyViolations,
  parseGoalVerifierDescriptorV1,
} from './goal-verifier.js';

const descriptor = {
  schemaVersion: 'ready4vibe_goal_verifier_descriptor_v1' as const,
  verifierId: 'verifier_advancement_v1',
  taskClass: 'advancement' as const,
  verifierRevision: 1,
  status: 'ready' as const,
  privacy: 'local_private' as const,
  updatedAt: '2026-08-06T00:00:00.000Z',
};

const binding = {
  schemaVersion: 'ready4vibe_goal_binding_v1' as const,
  bindingId: 'binding_12345678',
  runId: 'run_12345678',
  goalId: 'goal_12345678',
  todoId: 'todo_12345678',
  mode: 'governed' as const,
  goalControlRevision: 1,
  policyRevision: 'policy-1',
  capabilityProfileRevision: 'profile-1',
  approvalPolicyRevision: 'approval-1',
  sandboxSnapshotRevision: 'sandbox-1',
  workspaceId: 'default',
  admissionId: 'admission_12345678',
  createdAt: '2026-08-06T00:00:00.000Z',
  expiresAt: '2026-08-06T01:00:00.000Z',
  attempt: 1,
  requestId: 'request_12345678',
};

const digest = {
  schemaVersion: GOAL_VERIFIER_EVENT_DIGEST_SCHEMA_VERSION,
  id: 'evt_12345678',
  seq: 1,
  type: 'run.completed',
  at: '2026-08-06T00:00:01.000Z',
};

const verifierInput = {
  schemaVersion: GOAL_VERIFIER_INPUT_SCHEMA_VERSION,
  binding,
  taskClass: 'advancement' as const,
  run: { runId: binding.runId, status: 'completed' as const, lastEventSeq: 1, outputBytes: 12 },
  terminal: digest,
  events: [digest],
};

const verifierResult = {
  schemaVersion: GOAL_VERIFIER_RESULT_SCHEMA_VERSION,
  status: 'validated' as const,
  verifierId: 'verifier_advancement_v1',
  verifierRevision: 1,
  summary: 'bounded validation',
  refs: { runId: binding.runId, eventIds: [digest.id] },
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

describe('GoalVerifierInputV1 and GoalVerifierResultV1', () => {
  it('accepts a versioned bounded input and result', () => {
    expect(GoalVerifierInputV1Schema.parse(verifierInput)).toEqual(verifierInput);
    expect(GoalVerifierResultV1Schema.parse(verifierResult)).toEqual(verifierResult);
    expect(GoalVerifierEventDigestV1Schema.parse(digest)).toEqual(digest);
  });

  it('rejects unknown, secret-shaped and absolute-path input fields', () => {
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, extra: true })).toThrow();
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, prompt: 'do not pass' })).toThrow(/unknown|Unrecognized/iu);
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, binding: { ...binding, workspaceId: 'C:\\private' } })).toThrow(/absolute|path/iu);
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, binding: { ...binding, policyRevision: 'api_key=sk-12345678901234567890' } })).toThrow(/secret|credential/iu);
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, run: { ...verifierInput.run, runId: 'run_87654321' } })).toThrow(/match|binding/iu);
  });

  it('enforces server-owned event and output bounds without truncation', () => {
    const tooManyEvents = Array.from({ length: GOAL_VERIFIER_MAX_EVENT_DIGESTS + 1 }, (_, index) => ({ ...digest, id: `evt_${String(index + 10000000).padStart(8, '0')}`, seq: index + 1 }));
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, events: tooManyEvents })).toThrow(/array|event/iu);
    expect(() => GoalVerifierInputV1Schema.parse({ ...verifierInput, run: { ...verifierInput.run, outputBytes: GOAL_VERIFIER_MAX_OUTPUT_BYTES + 1 } })).toThrow(/output|bound/iu);
    expect(() => GoalVerifierEventDigestV1Schema.parse({ ...digest, seq: 0 })).toThrow();
  });

  it('rejects malformed or secret-shaped verifier results', () => {
    expect(() => GoalVerifierResultV1Schema.parse({ ...verifierResult, status: 'done' })).toThrow();
    expect(() => GoalVerifierResultV1Schema.parse({ ...verifierResult, extra: 'raw output' })).toThrow();
    expect(() => GoalVerifierResultV1Schema.parse({ ...verifierResult, summary: 'api_key=sk-12345678901234567890' })).toThrow(/secret|credential/iu);
    expect(() => GoalVerifierResultV1Schema.parse({ ...verifierResult, refs: { artifactIds: ['C:\\workspace\\artifact'] } })).toThrow(/absolute|path/iu);
  });
});
