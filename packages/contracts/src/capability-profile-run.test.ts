import { describe, expect, it } from 'vitest';
import { CapabilityProfileRunSnapshotSchema, CAPABILITY_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION } from './capability-profile-run.js';

const requested = {
  schemaVersion: 'ready4vibe_capability_profile_v1' as const,
  profileId: 'workspace-coding' as const,
  transportMode: 'loopback' as const,
  workspaceId: 'repo',
  modelMode: 'configured' as const,
  filesystemMode: 'workspace-write' as const,
  shellMode: 'off' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalMode: 'on-request' as const,
  policyRevision: 'policy-1',
  requiresAcknowledgement: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const ready = {
  schemaVersion: CAPABILITY_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION,
  profileRevision: 'profile-2',
  policyRevision: 'policy-1',
  status: 'ready' as const,
  reasonCode: 'PROFILE_READY' as const,
  requestedProfile: requested,
  effectiveProfile: requested,
  capturedAt: '2026-08-05T00:00:01.000Z',
};

describe('capability profile run snapshot contract', () => {
  it('accepts a strict ready snapshot and keeps it metadata-only', () => {
    expect(CapabilityProfileRunSnapshotSchema.parse(ready)).toMatchObject({ profileRevision: 'profile-2', effectiveProfile: { workspaceId: 'repo' } });
  });

  it('accepts a blocked snapshot only without an effective profile', () => {
    expect(CapabilityProfileRunSnapshotSchema.parse({ ...ready, status: 'blocked', reasonCode: 'WORKSPACE_REQUIRED', effectiveProfile: null })).toMatchObject({ status: 'blocked', effectiveProfile: null });
    expect(() => CapabilityProfileRunSnapshotSchema.parse(ready)).not.toThrow();
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, status: 'blocked', reasonCode: 'WORKSPACE_REQUIRED' })).toThrow(/effective profile/iu);
  });

  it('rejects unknown fields, secret-shaped values, paths and revision mismatches', () => {
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, extra: true })).toThrow();
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, profileRevision: 'apiKey=secret' })).toThrow();
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, requestedProfile: { ...requested, workspaceId: 'C:\\workspace' } })).toThrow(/absolute path/iu);
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, policyRevision: 'policy-2' })).toThrow(/policyRevision/iu);
  });

  it('requires a non-blocked effective profile and rejects malformed timestamps', () => {
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, status: 'degraded', reasonCode: 'CAPABILITY_NARROWED', effectiveProfile: null })).toThrow(/effective profile/iu);
    expect(() => CapabilityProfileRunSnapshotSchema.parse({ ...ready, capturedAt: 'not-a-time' })).toThrow();
  });
});
