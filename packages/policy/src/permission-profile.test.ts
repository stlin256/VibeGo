import { describe, expect, it } from 'vitest';
import type { PermissionProfile, PermissionSessionGrant } from '@ready4vibe/contracts';
import { ToolRegistry } from '@ready4vibe/tools';
import { compilePermissionProfilePolicy, permissionToolAllowed, resolvePermissionProfile } from './permission-profile.js';

const baseProfile = (overrides: Partial<PermissionProfile> = {}): PermissionProfile => ({
  schemaVersion: 'ready4vibe_permission_profile_v1',
  profileId: 'workspace-coding',
  filesystemScope: 'workspace-only',
  processScope: 'none',
  networkMode: 'off',
  mcpSkillMode: 'off',
  approvalPosture: 'bounded-auto',
  taskTrust: 'trusted-workspace',
  workspaceId: 'workspace-1',
  policyRevision: 'policy-1',
  profileRevision: 'profile-1',
  requiresConfirmation: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
  ...overrides,
});

const run = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: 'workspace-1',
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'workspace-write' as const, writableRoots: ['.'], network: 'restricted' as const },
  approval: 'on-request' as const,
  createdBySessionId: 'session-1',
  ...overrides,
});

const grant = (overrides: Partial<PermissionSessionGrant> = {}): PermissionSessionGrant => ({
  schemaVersion: 'ready4vibe_permission_session_grant_v1',
  grantId: 'grant-1',
  sessionId: 'session-1',
  userId: 'user-1',
  scope: {
    kind: 'session',
    profileId: 'full-host',
    filesystemScope: 'host',
    processScope: 'host',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalPosture: 'session-auto',
    taskTrust: 'trusted-user',
    confirmationRef: 'confirmation-1',
  },
  policyRevision: 'policy-1',
  profileRevision: 'profile-1',
  issuedAt: '2026-08-05T00:00:00.000Z',
  expiresAt: '2026-08-05T01:00:00.000Z',
  maxUses: 3,
  usedUses: 0,
  status: 'active',
  revokedAt: null,
  auditRef: 'audit-1',
  ...overrides,
});

describe('permission profile application adapter', () => {
  it('keeps workspace-coding within the selected workspace and existing sandbox', () => {
    const result = resolvePermissionProfile({ profile: baseProfile(), run: run(), currentPolicyRevision: 'policy-1', currentProfileRevision: 'profile-1' });
    expect(result).toMatchObject({ status: 'ready', reasonCode: 'PROFILE_READY', effectiveProfile: { profileId: 'workspace-coding' }, networkAccess: 'restricted' });
  });

  it('fails closed for stale policy/profile revisions and workspace mismatch', () => {
    expect(resolvePermissionProfile({ profile: baseProfile(), run: run(), currentPolicyRevision: 'policy-2' })).toMatchObject({ status: 'blocked', reasonCode: 'STALE_POLICY_REVISION' });
    expect(resolvePermissionProfile({ profile: baseProfile(), run: run(), currentPolicyRevision: 'policy-1', currentProfileRevision: 'profile-2' })).toMatchObject({ status: 'blocked', reasonCode: 'STALE_PROFILE_REVISION' });
    expect(resolvePermissionProfile({ profile: baseProfile(), run: run({ workspaceId: 'workspace-2' }), currentPolicyRevision: 'policy-1' })).toMatchObject({ status: 'blocked', reasonCode: 'WORKSPACE_UNAVAILABLE' });
  });

  it('requires external sandbox for process scope and never falls back to host', () => {
    const profile = baseProfile({ profileId: 'custom', processScope: 'external-sandbox', sandboxRevision: 'sandbox-1' });
    expect(resolvePermissionProfile({ profile, run: run(), currentPolicyRevision: 'policy-1' })).toMatchObject({ status: 'blocked', reasonCode: 'SANDBOX_REQUIRED' });
    expect(resolvePermissionProfile({ profile, run: run({ sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' } }), currentPolicyRevision: 'policy-1', currentSandboxRevision: 'sandbox-1' })).toMatchObject({ status: 'ready' });
  });

  it('requires explicit trusted confirmation and danger-full-access for full-host', () => {
    const profile = baseProfile({ profileId: 'full-host', filesystemScope: 'host', processScope: 'host', taskTrust: 'trusted-user', requiresConfirmation: true, approvalPosture: 'explicit' });
    const fullHostRun = run({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-1' })).toMatchObject({ status: 'blocked', reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED' });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-1', fullHostConfirmed: true })).toMatchObject({ status: 'ready', dangerFullAccessConfirmed: true });
    expect(resolvePermissionProfile({ profile, run: run({ taskTrust: 'untrusted-content', sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }), currentPolicyRevision: 'policy-1', fullHostConfirmed: true })).toMatchObject({ status: 'blocked', reasonCode: 'UNTRUSTED_CONTENT' });
    expect(resolvePermissionProfile({ profile: baseProfile(), run: run({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }), currentPolicyRevision: 'policy-1' })).toMatchObject({ status: 'blocked', reasonCode: 'POLICY_DENIED' });
  });

  it('does not widen approval=never and validates session-auto grant boundaries', () => {
    const profile = baseProfile({ profileId: 'full-host', filesystemScope: 'host', processScope: 'host', taskTrust: 'trusted-user', requiresConfirmation: true, approvalPosture: 'session-auto' });
    const fullHostRun = run({ approval: 'on-request', sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-1', fullHostConfirmed: true, sessionId: 'session-1', userId: 'user-1' })).toMatchObject({ status: 'blocked', reasonCode: 'SESSION_GRANT_REQUIRED' });
    expect(resolvePermissionProfile({ profile, run: { ...fullHostRun, approval: 'never' }, currentPolicyRevision: 'policy-1', fullHostConfirmed: true })).toMatchObject({ status: 'blocked', reasonCode: 'POLICY_DENIED' });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-1', fullHostConfirmed: true, sessionId: 'session-1', userId: 'user-1', sessionGrant: grant(), now: '2026-08-05T00:30:00.000Z' })).toMatchObject({ status: 'ready' });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-1', fullHostConfirmed: true, sessionId: 'session-1', userId: 'user-1', sessionGrant: grant({ status: 'revoked', revokedAt: '2026-08-05T00:20:00.000Z' }), now: '2026-08-05T00:30:00.000Z' })).toMatchObject({ status: 'blocked', reasonCode: 'SESSION_GRANT_REVOKED' });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-2', fullHostConfirmed: true, sessionId: 'session-1', userId: 'user-1', sessionGrant: grant(), now: '2026-08-05T00:30:00.000Z' })).toMatchObject({ status: 'blocked', reasonCode: 'STALE_POLICY_REVISION' });
    expect(resolvePermissionProfile({ profile, run: fullHostRun, currentPolicyRevision: 'policy-1', fullHostConfirmed: true, sessionId: 'session-1', userId: 'user-1', sessionGrant: grant({ profileRevision: 'profile-2' }), now: '2026-08-05T00:30:00.000Z' })).toMatchObject({ status: 'blocked', reasonCode: 'STALE_PROFILE_REVISION' });
  });

  it('filters only permission families and rejects unknown tools', () => {
    const profile = baseProfile({ processScope: 'external-sandbox', sandboxRevision: 'sandbox-1', mcpSkillMode: 'configured' });
    expect(permissionToolAllowed(profile, { id: 'filesystem.read', risk: 'read' })).toBe(true);
    expect(permissionToolAllowed(profile, { id: 'shell.exec', risk: 'destructive' })).toBe(true);
    expect(permissionToolAllowed(profile, { id: 'docs-server/tool/search@1', risk: 'read' })).toBe(true);
    expect(permissionToolAllowed(profile, { id: 'network.fetch', risk: 'network' })).toBe(false);
    expect(permissionToolAllowed(baseProfile(), { id: 'unknown.tool', risk: 'read' })).toBe(false);
  });

  it('reuses the existing compiler after profile resolution instead of creating a second policy path', () => {
    const registry = new ToolRegistry();
    registry.register({ id: 'filesystem.read', version: '1.0.0', risk: 'read', summary: 'read', supportedSandboxModes: ['read-only'], inputSchema: { type: 'object' } });
    const result = compilePermissionProfilePolicy({
      profile: baseProfile(),
      run: run({ sandbox: { mode: 'read-only', network: 'restricted' } }),
      currentPolicyRevision: 'policy-1',
      registry,
      toolId: 'filesystem.read',
      toolVersion: '1.0.0',
      risk: 'read',
      argumentsFingerprint: 'a'.repeat(64),
    });
    expect(result.application.status).toBe('ready');
    expect(result.compiled).toMatchObject({ decision: 'allow', reasonCode: 'READ_ONLY' });
    expect(compilePermissionProfilePolicy({
      ...resultInputForHost(registry),
      profile: baseProfile({ profileId: 'full-host', filesystemScope: 'host', processScope: 'host', taskTrust: 'trusted-user', requiresConfirmation: true }),
      run: run({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }),
      fullHostConfirmed: false,
    }).compiled).toBeUndefined();
  });
});

function resultInputForHost(registry: ToolRegistry) {
  return {
    run: run({ sandbox: { mode: 'read-only' as const, network: 'restricted' as const } }),
    currentPolicyRevision: 'policy-1',
    registry,
    toolId: 'filesystem.read',
    toolVersion: '1.0.0',
    risk: 'read' as const,
    argumentsFingerprint: 'b'.repeat(64),
  };
}
