import { describe, expect, it, vi } from 'vitest';
import type { PermissionProfile } from '@ready4vibe/contracts';
import { constrainPermissionToolRuntime } from './permission-profile-runtime.js';

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

function runtime() {
  const execute = vi.fn(async () => ({ output: { ok: true } }));
  const approve = vi.fn(async () => undefined);
  return {
    runtime: {
      descriptors: [
        { name: 'filesystem.read', id: 'filesystem.read', version: '1.0.0', risk: 'read' as const, summary: 'read' },
        { name: 'filesystem.write', id: 'filesystem.write', version: '1.0.0', risk: 'write' as const, summary: 'write' },
        { name: 'shell.exec', id: 'shell.exec', version: '1.0.0', risk: 'destructive' as const, summary: 'shell' },
        { name: 'docs-server/tool/search@1.0.0', id: 'docs-server/tool/search@1.0.0', version: '1.0.0', risk: 'read' as const, summary: 'mcp' },
      ],
      execute,
      approve,
    },
    execute,
    approve,
  };
}

describe('permission profile runtime narrowing', () => {
  it('keeps workspace filesystem tools and removes host process/MCP families by default', () => {
    const value = runtime();
    const constrained = constrainPermissionToolRuntime(value.runtime, profile());
    expect(constrained?.descriptors.map((entry) => entry.id)).toEqual(['filesystem.read', 'filesystem.write']);
  });

  it('captures a stable descriptor set and delegates approved calls', async () => {
    const value = runtime();
    const constrained = constrainPermissionToolRuntime(value.runtime, profile({ processScope: 'external-sandbox', sandboxRevision: 'sandbox-1', mcpSkillMode: 'configured' }))!;
    const captured = [...constrained.descriptors];
    await constrained.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: captured[0]!, input: {}, config: {} as never, signal: new AbortController().signal });
    expect(value.execute).toHaveBeenCalledOnce();
    expect(constrained.descriptors).toEqual(captured);
  });

  it('allows host families only when the captured profile requests them', async () => {
    const value = runtime();
    const constrained = constrainPermissionToolRuntime(value.runtime, profile({ profileId: 'full-host', filesystemScope: 'host', processScope: 'host', taskTrust: 'trusted-user', requiresConfirmation: true }))!;
    expect(constrained.descriptors.map((entry) => entry.id)).toEqual(['filesystem.read', 'filesystem.write', 'shell.exec']);
    await expect(constrained.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: value.runtime.descriptors[3]!, input: {}, config: {} as never, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TOOL_FORBIDDEN' });
  });

  it('preserves the no-runtime behavior when every descriptor is outside the profile', () => {
    const value = runtime();
    expect(constrainPermissionToolRuntime(value.runtime, profile({ filesystemScope: 'host', processScope: 'none', mcpSkillMode: 'off' }))).toBeDefined();
    expect(constrainPermissionToolRuntime(value.runtime, profile({ filesystemScope: 'workspace-only', processScope: 'none', mcpSkillMode: 'off' }))?.descriptors.length).toBe(2);
  });
});
