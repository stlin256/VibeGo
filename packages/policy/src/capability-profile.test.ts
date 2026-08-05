import { describe, expect, it } from 'vitest';
import { parseCapabilityProfile, type CapabilityProfile } from '@ready4vibe/contracts';
import { resolveCapabilityProfile, type CapabilityProfilePolicy } from './capability-profile.js';

const evaluatedAt = '2026-08-05T00:00:00.000Z';

function profile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return parseCapabilityProfile({
    schemaVersion: 'ready4vibe_capability_profile_v1',
    profileId: 'custom',
    transportMode: 'loopback',
    workspaceId: 'repo',
    modelMode: 'configured',
    filesystemMode: 'workspace-write',
    shellMode: 'external-sandbox',
    networkMode: 'enabled',
    mcpSkillMode: 'configured',
    approvalMode: 'bounded-auto',
    sandboxRef: 'sandbox-1',
    policyRevision: 'policy-1',
    requiresAcknowledgement: true,
    updatedAt: evaluatedAt,
    ...overrides,
  });
}

function policy(overrides: Partial<CapabilityProfilePolicy> = {}): CapabilityProfilePolicy {
  return {
    policyRevision: 'policy-1',
    transportModes: ['loopback', 'lan-tls', 'tailscale', 'ssh'],
    modelModes: ['off', 'fake', 'configured'],
    filesystemModes: ['off', 'workspace-read', 'workspace-write'],
    shellModes: ['off', 'external-sandbox', 'host-restricted'],
    networkModes: ['off', 'restricted', 'enabled'],
    mcpSkillModes: ['off', 'configured'],
    approvalModes: ['none', 'on-request', 'bounded-auto', 'explicit'],
    transportHealth: { loopback: 'ready', 'lan-tls': 'ready', tailscale: 'ready', ssh: 'ready' },
    workspaceHealth: 'ready',
    modelHealth: 'ready',
    filesystemHealth: 'ready',
    externalSandboxHealth: 'ready',
    hostRunnerHealth: 'ready',
    networkHealth: 'enabled',
    mcpSkillHealth: 'ready',
    ...overrides,
  };
}

describe('CapabilityProfileResolver', () => {
  it('returns a deterministic ready result when policy and health match', () => {
    const input = profile();
    const first = resolveCapabilityProfile(input, policy(), evaluatedAt);
    const second = resolveCapabilityProfile(input, policy(), evaluatedAt);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'ready', reasonCode: 'PROFILE_READY', effectiveProfile: input });
  });

  it('fails closed for a stale policy revision without an effective profile', () => {
    const result = resolveCapabilityProfile(profile(), policy({ policyRevision: 'policy-2' }), evaluatedAt);
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'STALE_POLICY_REVISION', effectiveProfile: null });
  });

  it('does not silently switch an unavailable transport', () => {
    const result = resolveCapabilityProfile(profile({ transportMode: 'tailscale' }), policy({ transportHealth: { tailscale: 'missing' } }), evaluatedAt);
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'TRANSPORT_UNAVAILABLE', effectiveProfile: null });
  });

  it('monotonically narrows capabilities when policy allows only safer modes', () => {
    const result = resolveCapabilityProfile(profile(), policy({
      modelModes: ['off', 'fake'],
      filesystemModes: ['off', 'workspace-read'],
      shellModes: ['off'],
      networkModes: ['off', 'restricted'],
      mcpSkillModes: ['off'],
      approvalModes: ['none', 'on-request'],
      networkHealth: 'restricted',
      externalSandboxHealth: 'blocked',
    }), evaluatedAt);
    expect(result.status).toBe('degraded');
    expect(result.reasonCode).toBe('CAPABILITY_NARROWED');
    expect(result.effectiveProfile).toMatchObject({
      modelMode: 'fake',
      filesystemMode: 'workspace-read',
      shellMode: 'off',
      networkMode: 'restricted',
      mcpSkillMode: 'off',
      approvalMode: 'on-request',
    });
  });

  it('fails closed when a workspace-backed request has no workspace', () => {
    const result = resolveCapabilityProfile(profile({ workspaceId: undefined }), policy(), evaluatedAt);
    expect(result).toMatchObject({ status: 'blocked', reasonCode: 'WORKSPACE_REQUIRED', effectiveProfile: null });
  });

  it('uses a fake model and disables unavailable optional runtimes', () => {
    const result = resolveCapabilityProfile(profile(), policy({
      modelHealth: 'degraded',
      externalSandboxHealth: 'degraded',
      mcpSkillHealth: 'missing',
    }), evaluatedAt);
    expect(result.status).toBe('degraded');
    expect(result.effectiveProfile).toMatchObject({ modelMode: 'fake', shellMode: 'off', mcpSkillMode: 'off' });
  });

  it('keeps transport and policy revisions in the snapshot', () => {
    const result = resolveCapabilityProfile(profile({ transportMode: 'lan-tls' }), policy(), evaluatedAt);
    expect(result.effectiveProfile).toMatchObject({ transportMode: 'lan-tls', policyRevision: 'policy-1' });
    expect(result.policyRevision).toBe('policy-1');
  });
});
