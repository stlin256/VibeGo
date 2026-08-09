import { describe, expect, it, vi } from 'vitest';
import { constrainToolRuntime } from './capability-profile-runtime.js';

const profile = (filesystemMode: 'off' | 'workspace-read' | 'workspace-write', shellMode: 'off' | 'external-sandbox' | 'host-restricted' = 'off', mcpSkillMode: 'off' | 'configured' = 'off') => ({
  schemaVersion: 'ready4vibe_capability_profile_v1' as const,
  profileId: 'custom' as const,
  transportMode: 'loopback' as const,
  modelMode: 'fake' as const,
  filesystemMode,
  shellMode,
  networkMode: 'off' as const,
  mcpSkillMode,
  approvalMode: 'on-request' as const,
  policyRevision: 'policy-1',
  requiresAcknowledgement: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
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
        { name: 'unknown.tool', id: 'unknown.tool', version: '1.0.0', risk: 'read' as const, summary: 'unknown' },
      ],
      execute,
      approve,
    },
    execute,
    approve,
  };
}

describe('capability profile runtime constraint', () => {
  it('removes filesystem and shell descriptors when the profile is preview-like', () => {
    const value = runtime();
    const constrained = constrainToolRuntime(value.runtime, profile('off'));
    expect(constrained).toBeUndefined();
  });

  it('keeps read-only workspace tools but drops writes', () => {
    const value = runtime();
    const constrained = constrainToolRuntime(value.runtime, profile('workspace-read'));
    expect(constrained?.descriptors.map((entry) => entry.id)).toEqual(['filesystem.read']);
  });

  it('keeps only the selected capability families', async () => {
    const value = runtime();
    const constrained = constrainToolRuntime(value.runtime, profile('workspace-write', 'external-sandbox', 'configured'));
    expect(constrained?.descriptors.map((entry) => entry.id)).toEqual(['filesystem.read', 'filesystem.write', 'shell.exec', 'docs-server/tool/search@1.0.0']);
    await constrained?.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: constrained.descriptors[0]!, input: {}, config: {} as never, signal: new AbortController().signal });
    expect(value.execute).toHaveBeenCalledOnce();
  });

  it('keeps shell.exec for the host-restricted shell mode', () => {
    const value = runtime();
    const constrained = constrainToolRuntime(value.runtime, profile('workspace-write', 'host-restricted'));
    expect(constrained?.descriptors.map((entry) => entry.id)).toEqual(['filesystem.read', 'filesystem.write', 'shell.exec']);
  });

  it('rejects a descriptor that was not captured by the constrained snapshot', async () => {
    const value = runtime();
    const constrained = constrainToolRuntime(value.runtime, profile('workspace-read'))!;
    await expect(constrained.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: value.runtime.descriptors[1]!, input: {}, config: {} as never, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TOOL_FORBIDDEN' });
    expect(value.execute).not.toHaveBeenCalled();
  });
});
