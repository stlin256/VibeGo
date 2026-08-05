import { describe, expect, it } from 'vitest';
import { CAPABILITY_PROFILE_SCHEMA_VERSION, parseCapabilityProfile } from './capability-profile.js';

const base = {
  schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
  profileId: 'preview' as const,
  transportMode: 'loopback' as const,
  modelMode: 'fake' as const,
  filesystemMode: 'off' as const,
  shellMode: 'off' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalMode: 'none' as const,
  policyRevision: 'policy-1',
  requiresAcknowledgement: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
};

describe('capability profile contract', () => {
  it('accepts each stable profile id with bounded intent fields', () => {
    expect(parseCapabilityProfile(base).profileId).toBe('preview');
    expect(parseCapabilityProfile({
      ...base,
      profileId: 'workspace-coding',
      workspaceId: 'repo',
      modelMode: 'configured',
      filesystemMode: 'workspace-write',
      approvalMode: 'bounded-auto',
    }).profileId).toBe('workspace-coding');
    expect(parseCapabilityProfile({
      ...base,
      profileId: 'advanced-local',
      workspaceId: 'repo',
      modelMode: 'configured',
      filesystemMode: 'workspace-write',
      shellMode: 'host-restricted',
      approvalMode: 'explicit',
      requiresAcknowledgement: true,
    }).profileId).toBe('advanced-local');
    expect(parseCapabilityProfile({ ...base, profileId: 'custom' }).profileId).toBe('custom');
  });

  it('rejects unknown fields and secret-shaped or path values', () => {
    expect(() => parseCapabilityProfile({ ...base, extra: true })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, workspaceId: 'C:\\workspace' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, sandboxRef: 'apiKey=secret-value' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, policyRevision: 'TOKEN=secret-value' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, environment: { NODE_ENV: 'test' } })).toThrow();
  });

  it('rejects malformed ids, timestamps and control text', () => {
    expect(() => parseCapabilityProfile({ ...base, policyRevision: '../policy' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, updatedAt: 'not-a-time' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, workspaceId: 'repo\nnext' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, transportMode: 'public' })).toThrow();
  });

  it('requires explicit acknowledgement for host shell and enabled network', () => {
    expect(() => parseCapabilityProfile({ ...base, shellMode: 'host-restricted' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, networkMode: 'enabled' })).toThrow();
    expect(parseCapabilityProfile({ ...base, shellMode: 'host-restricted', requiresAcknowledgement: true, profileId: 'advanced-local' }).requiresAcknowledgement).toBe(true);
  });

  it('requires a sandbox reference for external shell and keeps preview side-effect free', () => {
    expect(() => parseCapabilityProfile({ ...base, shellMode: 'external-sandbox' })).toThrow();
    expect(() => parseCapabilityProfile({ ...base, mcpSkillMode: 'configured' })).toThrow();
    expect(parseCapabilityProfile({ ...base, profileId: 'workspace-coding', shellMode: 'external-sandbox', sandboxRef: 'sandbox-1', modelMode: 'configured' }).sandboxRef).toBe('sandbox-1');
  });
});
