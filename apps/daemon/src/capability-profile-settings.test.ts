import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { type CapabilityProfile } from '@ready4vibe/contracts';
import { type CapabilityProfilePolicy } from '@ready4vibe/policy';
import { DurableCapabilityProfileSettingsManager, CapabilityProfileSettingsError } from './capability-profile-settings.js';

const at = '2026-08-05T00:00:00.000Z';

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
    transportHealth: { loopback: 'ready', 'lan-tls': 'ready', tailscale: 'missing', ssh: 'missing' },
    workspaceHealth: 'ready',
    modelHealth: 'ready',
    filesystemHealth: 'ready',
    externalSandboxHealth: 'ready',
    hostRunnerHealth: 'missing',
    networkHealth: 'enabled',
    mcpSkillHealth: 'ready',
    ...overrides,
  };
}

function profile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    schemaVersion: 'ready4vibe_capability_profile_v1',
    profileId: 'workspace-coding',
    transportMode: 'loopback',
    workspaceId: 'repo',
    modelMode: 'configured',
    filesystemMode: 'workspace-write',
    shellMode: 'off',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalMode: 'on-request',
    policyRevision: 'policy-1',
    requiresAcknowledgement: false,
    updatedAt: at,
    ...overrides,
  };
}

function manager(settings = new InMemorySettingsStore(), policyValue: CapabilityProfilePolicy = policy()): DurableCapabilityProfileSettingsManager {
  return new DurableCapabilityProfileSettingsManager({ settings, policy: () => policyValue, clock: () => new Date(at) });
}

describe('DurableCapabilityProfileSettingsManager', () => {
  it('initializes a safe preview snapshot and resolver projection', () => {
    const result = manager().status();
    expect(result).toMatchObject({
      settings: { profile: { profileId: 'preview' }, profileRevision: 'profile-1' },
      resolution: { status: 'ready', reasonCode: 'PROFILE_READY', effectiveProfile: { profileId: 'preview' } },
    });
  });

  it('persists a complete profile and rejects stale concurrent writers', () => {
    const settings = new InMemorySettingsStore();
    const first = manager(settings);
    const saved = first.patch({ profile: profile(), expectedRevision: 'profile-1' });
    expect(saved).toMatchObject({ currentRevision: 'profile-2', previousRevision: 'profile-1', settings: { profile: { profileId: 'workspace-coding' } } });
    expect(() => first.patch({ profile: profile({ profileId: 'custom' }), expectedRevision: 'profile-1' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    const restarted = manager(settings);
    expect(restarted.status()).toMatchObject({ currentRevision: 'profile-2', settings: { profile: { profileId: 'workspace-coding' } } });
  });

  it('fails closed for a stale policy revision and recovers persisted intent to preview', () => {
    const settings = new InMemorySettingsStore();
    const first = manager(settings);
    first.patch({ profile: profile(), expectedRevision: 'profile-1' });
    const restarted = manager(settings, policy({ policyRevision: 'policy-2' }));
    expect(restarted.status()).toMatchObject({
      currentRevision: 'profile-3',
      previousRevision: 'profile-2',
      settings: { profile: { profileId: 'preview', policyRevision: 'policy-2' } },
      resolution: { status: 'ready', reasonCode: 'PROFILE_READY' },
    });
  });

  it('rejects secrets and keeps reset history without touching external runtimes', () => {
    const settings = new InMemorySettingsStore();
    const value = manager(settings);
    expect(() => value.patch({ profile: { ...profile(), sandboxRef: 'apiKey=secret' }, expectedRevision: 'profile-1' })).toThrowError(expect.objectContaining({ code: 'INVALID_SETTINGS' }));
    const reset = value.reset('profile-1');
    expect(reset).toMatchObject({ currentRevision: 'profile-2', previousRevision: 'profile-1', settings: { profile: { profileId: 'preview' } } });
  });

  it('returns stable error codes for stale policy updates', () => {
    const value = manager();
    expect(() => value.patch({ profile: profile({ policyRevision: 'policy-2' }), expectedRevision: 'profile-1' })).toThrowError(new CapabilityProfileSettingsError('STALE_POLICY_REVISION', 'Capability profile policy revision is stale.'));
  });
});
