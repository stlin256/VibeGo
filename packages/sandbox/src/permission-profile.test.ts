import { describe, expect, it } from 'vitest';
import type { PermissionProfile } from '@ready4vibe/contracts';
import { createPermissionSandboxRequest, resolvePermissionSandbox, SandboxResolver } from './index.js';

const profile = (overrides: Partial<PermissionProfile> = {}): PermissionProfile => ({
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

describe('permission profile sandbox adapter', () => {
  it('projects workspace-only requests without widening the selected sandbox', () => {
    const request = createPermissionSandboxRequest({
      profile: profile(),
      taskTrust: 'trusted-workspace',
      runSandbox: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' },
    });
    expect(request).toMatchObject({ taskTrust: 'trusted-workspace', policy: { mode: 'workspace-write' } });
  });

  it('requires explicit confirmation for full-host and never accepts untrusted host access', () => {
    const fullHost = profile({ profileId: 'full-host', filesystemScope: 'host', processScope: 'host', taskTrust: 'trusted-user', requiresConfirmation: true, approvalPosture: 'explicit' });
    const runSandbox = { mode: 'danger-full-access' as const, enabledBy: 'explicit-user-only' as const };
    expect(createPermissionSandboxRequest({ profile: fullHost, taskTrust: 'trusted-workspace', runSandbox })).toBeUndefined();
    expect(createPermissionSandboxRequest({ profile: fullHost, taskTrust: 'trusted-workspace', runSandbox, fullHostConfirmed: true })).toMatchObject({ policy: { mode: 'danger-full-access' }, explicitDangerFullAccess: true });
    expect(createPermissionSandboxRequest({ profile: fullHost, taskTrust: 'untrusted-content', runSandbox, fullHostConfirmed: true })).toBeUndefined();
    expect(createPermissionSandboxRequest({ profile: profile(), taskTrust: 'trusted-workspace', runSandbox })).toBeUndefined();
  });

  it('delegates external sandbox health to SandboxResolver and does not fall back', async () => {
    const external = profile({ profileId: 'custom', processScope: 'external-sandbox', sandboxRevision: 'sandbox-1' });
    const input = { profile: external, taskTrust: 'trusted-workspace' as const, runSandbox: { mode: 'external-sandbox' as const, provider: 'docker' as const, network: 'restricted' as const } };
    expect((await resolvePermissionSandbox(input, new SandboxResolver())).reasonCode).toBe('SANDBOX_UNAVAILABLE');
    const ready = await resolvePermissionSandbox(input, new SandboxResolver([{ runtime: 'docker', verify: async () => ({ healthy: true, capabilities: { runtime: 'docker', version: 'fixture', isolation: 'container', networkModes: ['restricted'], maxMemoryBytes: 1024, maxCpuMillis: 100 } }) }]));
    expect(ready).toMatchObject({ status: 'ready', reasonCode: 'PROFILE_READY', resolved: { provider: 'docker' } });
  });

  it('does not permit a profile with network off/restricted to inherit enabled network', () => {
    expect(createPermissionSandboxRequest({ profile: profile(), taskTrust: 'trusted-workspace', runSandbox: { mode: 'read-only', network: 'enabled' } })).toBeUndefined();
    expect(createPermissionSandboxRequest({ profile: profile({ networkMode: 'restricted' }), taskTrust: 'trusted-workspace', runSandbox: { mode: 'read-only', network: 'enabled' } })).toBeUndefined();
  });
});
