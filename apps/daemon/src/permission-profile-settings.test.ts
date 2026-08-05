import { describe, expect, it } from 'vitest';
import type { RunConfig } from '@ready4vibe/contracts';
import type { CapabilityProfilePolicy } from '@ready4vibe/policy';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { PermissionProfileSettingsError, DurablePermissionProfileSettingsManager } from './permission-profile-settings.js';

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
    hostRunnerHealth: 'ready',
    networkHealth: 'enabled',
    mcpSkillHealth: 'ready',
    ...overrides,
  };
}

const runConfig = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  workspaceId: 'repo',
  userMessage: 'inspect',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace',
  sandbox: { mode: 'read-only', network: 'restricted' },
  approval: 'on-request',
  limits: { maxTurns: 1, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 10, maxOutputBytes: 1_000, maxContextBytes: 100_000 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
  ...overrides,
});

function manager(
  settings = new InMemorySettingsStore(),
  policyValue: CapabilityProfilePolicy = policy(),
  grantMaxUses = 2,
  clock: () => Date = () => new Date(at),
  grantTtlMs?: number,
): DurablePermissionProfileSettingsManager {
  return new DurablePermissionProfileSettingsManager({
    settings,
    policy: () => policyValue,
    workspaceExists: (workspaceId) => workspaceId === 'repo' || workspaceId === 'default',
    defaultWorkspaceId: 'repo',
    sessionGrantMaxUses: grantMaxUses,
    ...(grantTtlMs === undefined ? {} : { sessionGrantTtlMs: grantTtlMs }),
    clock,
  });
}

describe('DurablePermissionProfileSettingsManager', () => {
  it('persists a safe workspace profile and exposes only bounded settings metadata', () => {
    const settings = new InMemorySettingsStore();
    const value = manager(settings);
    expect(value.status()).toMatchObject({
      settings: { currentRevision: 'profile-1', profile: { profileId: 'workspace-coding', workspaceId: 'repo', processScope: 'none', networkMode: 'off' } },
      resolution: { status: 'ready', effectiveProfile: { profileId: 'workspace-coding' } },
    });
    expect(JSON.stringify(value.status())).not.toMatch(/api[_-]?key|token|secret|password|[A-Z]:\\/iu);

    const snapshot = value.snapshotForRun(runConfig(), 'session-1');
    expect(snapshot).toMatchObject({
      status: 'ready',
      reasonCode: 'PROFILE_READY',
      profileRevision: 'profile-1',
      effectiveProfile: {
        profileId: 'workspace-coding',
        filesystemScope: 'workspace-only',
        processScope: 'none',
        networkMode: 'off',
      },
      effectiveScope: {
        profileId: 'workspace-coding',
        filesystemScope: 'workspace-only',
        processScope: 'none',
        networkMode: 'off',
      },
      grantId: null,
      grantExpiresAt: null,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/api[_-]?key|token|secret|password|[A-Z]:\\/iu);
  });

  it('uses optimistic revisions and recovers stale policy to the safe default', () => {
    const settings = new InMemorySettingsStore();
    const first = manager(settings);
    const patched = first.patch({
      profile: { ...first.status().settings.profile, taskTrust: 'trusted-workspace' },
      expectedRevision: 'profile-1',
    });
    expect(patched.currentRevision).toBe('profile-2');
    expect(() => first.patch({ profile: first.status().settings.profile, expectedRevision: 'profile-1' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    const restarted = manager(settings, policy({ policyRevision: 'policy-2' }));
    expect(restarted.status()).toMatchObject({ currentRevision: 'profile-3', previousRevision: 'profile-2', settings: { profile: { profileId: 'workspace-coding', policyRevision: 'policy-2' } } });
  });

  it('requires an authenticated session for full-host, then bounds confirmation by uses and revoke', () => {
    const value = manager();
    const fullHost = {
      ...value.status().settings.profile,
      profileId: 'full-host' as const,
      filesystemScope: 'host' as const,
      processScope: 'host' as const,
      approvalPosture: 'session-auto' as const,
      taskTrust: 'trusted-user' as const,
      workspaceId: undefined,
      requiresConfirmation: true,
    };
    const settings = value.patch({ profile: fullHost, expectedRevision: 'profile-1' });
    const request = {
      schemaVersion: 'ready4vibe_permission_confirmation_request_v1' as const,
      requestId: 'request-1',
      sessionId: 'session-1',
      userId: 'local-user',
      requestedProfile: settings.settings.profile,
      expectedProfileRevision: settings.currentRevision,
      acknowledged: true as const,
      requestedAt: at,
    };
    expect(() => value.confirmFullHost(request, undefined)).toThrowError(expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }));
    expect(() => value.confirmFullHost(request, { sessionId: 'session-2', userId: 'local-user' })).toThrowError(expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }));
    const confirmed = value.confirmFullHost(request, { sessionId: 'session-1', userId: 'local-user' });
    expect(confirmed).toMatchObject({ status: 'ready', grant: { status: 'active', maxUses: 2, usedUses: 0 } });
    const hostRun = runConfig({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' }, createdBySessionId: 'session-1' });
    expect(value.snapshotForRun(hostRun, 'session-1')).toMatchObject({ status: 'ready', grantId: expect.any(String), effectiveProfile: { profileId: 'full-host' } });
    expect(value.snapshotForRun(hostRun, 'session-1')).toMatchObject({ status: 'ready' });
    expect(value.snapshotForRun(hostRun, 'session-1')).toMatchObject({ status: 'blocked', reasonCode: 'SESSION_GRANT_EXHAUSTED' });
    expect(value.snapshotForRun({ ...hostRun, createdBySessionId: 'session-2' }, 'session-2')).toMatchObject({ status: 'blocked', reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED' });
    expect(() => value.revoke({
      schemaVersion: 'ready4vibe_permission_revoke_request_v1',
      requestId: 'revoke-wrong-session',
      sessionId: 'session-1',
      userId: 'local-user',
      grantId: confirmed.grant?.grantId,
      reason: 'user-requested',
      requestedAt: at,
    }, { sessionId: 'session-2', userId: 'local-user' })).toThrowError(expect.objectContaining({ code: 'AUTHENTICATION_REQUIRED' }));
    const revoked = value.revoke({
      schemaVersion: 'ready4vibe_permission_revoke_request_v1',
      requestId: 'revoke-1',
      sessionId: 'session-1',
      userId: 'local-user',
      grantId: confirmed.grant?.grantId,
      reason: 'user-requested',
      requestedAt: at,
    }, { sessionId: 'session-1', userId: 'local-user' });
    expect(revoked.status).toBe('revoked');
    expect(value.snapshotForRun(hostRun, 'session-1')).toMatchObject({ status: 'blocked', reasonCode: 'SESSION_GRANT_REVOKED', grantId: null });
  });

  it('expires a full-host grant at its bounded TTL and never falls back to host execution', () => {
    let now = new Date(at);
    const value = manager(new InMemorySettingsStore(), policy(), 5, () => now, 1_000);
    const fullHost = {
      ...value.status().settings.profile,
      profileId: 'full-host' as const,
      filesystemScope: 'host' as const,
      processScope: 'host' as const,
      approvalPosture: 'session-auto' as const,
      taskTrust: 'trusted-user' as const,
      workspaceId: undefined,
      requiresConfirmation: true,
    };
    const saved = value.patch({ profile: fullHost, expectedRevision: 'profile-1' });
    const request = {
      schemaVersion: 'ready4vibe_permission_confirmation_request_v1' as const,
      requestId: 'request-ttl',
      sessionId: 'session-1',
      userId: 'local-user',
      requestedProfile: saved.settings.profile,
      expectedProfileRevision: saved.currentRevision,
      acknowledged: true as const,
      requestedAt: at,
    };
    value.confirmFullHost(request, { sessionId: 'session-1', userId: 'local-user' });
    const hostRun = runConfig({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' }, createdBySessionId: 'session-1' });
    expect(value.snapshotForRun(hostRun, 'session-1')).toMatchObject({ status: 'ready' });

    now = new Date(Date.parse(at) + 1_001);
    expect(value.permissionStatus('session-1')).toMatchObject({
      status: 'expired',
      reasonCode: 'SESSION_GRANT_EXPIRED',
      effectiveProfile: null,
      grant: { status: 'expired' },
    });
    expect(value.snapshotForRun(hostRun, 'session-1')).toMatchObject({
      status: 'blocked',
      reasonCode: 'SESSION_GRANT_EXPIRED',
      effectiveProfile: null,
      grantId: null,
    });
  });

  it('keeps an already captured workspace snapshot unchanged after settings change', () => {
    const value = manager();
    const captured = value.snapshotForRun(runConfig(), 'session-1');
    const original = structuredClone(captured);
    const fullHost = {
      ...value.status().settings.profile,
      profileId: 'full-host' as const,
      filesystemScope: 'host' as const,
      processScope: 'host' as const,
      approvalPosture: 'explicit' as const,
      taskTrust: 'trusted-user' as const,
      workspaceId: undefined,
      requiresConfirmation: true,
    };
    value.patch({ profile: fullHost, expectedRevision: 'profile-1' });

    expect(captured).toEqual(original);
    expect(captured).toMatchObject({
      status: 'ready',
      profileRevision: 'profile-1',
      effectiveProfile: { profileId: 'workspace-coding', processScope: 'none' },
    });
    expect(value.snapshotForRun(runConfig({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }), 'session-1')).toMatchObject({
      status: 'blocked',
      reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED',
      profileRevision: 'profile-2',
    });
  });

  it('fails closed for untrusted host requests and an unavailable host runner', () => {
    const value = manager(new InMemorySettingsStore(), policy({ hostRunnerHealth: 'missing' }));
    const fullHost = {
      ...value.status().settings.profile,
      profileId: 'full-host' as const,
      filesystemScope: 'host' as const,
      processScope: 'host' as const,
      approvalPosture: 'explicit' as const,
      taskTrust: 'trusted-user' as const,
      workspaceId: undefined,
      requiresConfirmation: true,
    };
    const settings = value.patch({ profile: fullHost, expectedRevision: 'profile-1' });
    const request = { schemaVersion: 'ready4vibe_permission_confirmation_request_v1' as const, requestId: 'request-2', sessionId: 'session-1', userId: 'local-user', requestedProfile: settings.settings.profile, expectedProfileRevision: settings.currentRevision, acknowledged: true as const, requestedAt: at };
    value.confirmFullHost(request, { sessionId: 'session-1', userId: 'local-user' });
    expect(value.snapshotForRun(runConfig({ taskTrust: 'untrusted-content', sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }), 'session-1')).toMatchObject({ status: 'blocked', reasonCode: 'UNTRUSTED_CONTENT' });
    expect(value.snapshotForRun(runConfig({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }), 'session-1')).toMatchObject({ status: 'blocked', reasonCode: 'CAPABILITY_UNAVAILABLE' });
  });

  it('drops grants on daemon restart', () => {
    const settings = new InMemorySettingsStore();
    const first = manager(settings);
    const profile = { ...first.status().settings.profile, profileId: 'full-host' as const, filesystemScope: 'host' as const, processScope: 'host' as const, approvalPosture: 'session-auto' as const, taskTrust: 'trusted-user' as const, requiresConfirmation: true, workspaceId: undefined };
    const saved = first.patch({ profile, expectedRevision: 'profile-1' });
    first.confirmFullHost({ schemaVersion: 'ready4vibe_permission_confirmation_request_v1', requestId: 'request-3', sessionId: 'session-1', userId: 'local-user', requestedProfile: saved.settings.profile, expectedProfileRevision: saved.currentRevision, acknowledged: true, requestedAt: at }, { sessionId: 'session-1', userId: 'local-user' });
    const restarted = manager(settings);
    expect(restarted.permissionStatus('session-1')).toMatchObject({ status: 'blocked', reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED', grant: null });
  });
});
