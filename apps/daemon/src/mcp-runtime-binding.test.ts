import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { McpCapabilityDescriptor, McpCapabilitySnapshot, McpToolCallPort } from '@ready4vibe/skill-mcp';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import { McpRunBindingError, McpRunBindingManager } from './mcp-runtime-binding.js';

const config = {
  workspaceId: 'default',
  userMessage: 'find docs',
  model: { provider: 'fixture', name: 'fixture' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 1, maxWallTimeMs: 30_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 4, maxOutputBytes: 8_192, maxContextBytes: 8_192 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
};

function descriptor(revision = '1.0.0'): McpCapabilityDescriptor {
  return {
    schemaVersion: 'mcp-capability/v1', source: 'mcp', serverId: 'docs-server', serverVersion: '1.0.0', protocolVersion: '2025-06-18',
    kind: 'tool', id: 'search', name: 'search', version: revision, revision, qualifiedName: `docs-server/tool/search@${revision}`,
    summary: 'Search docs.', risk: 'read', sandboxMode: 'workspace-read', networkAccess: 'disabled', approvalMode: 'none', executable: true,
    inputSchema: { type: 'object' },
  };
}

function snapshot(revision = '1.0.0'): McpCapabilitySnapshot {
  return {
    schemaVersion: 'mcp-capability-snapshot/v1', serverId: 'docs-server', serverVersion: '1.0.0', protocolVersion: '2025-06-18',
    health: 'healthy-verified', healthCheckId: 1, capabilities: [descriptor(revision)], fingerprint: revision === '1.0.0' ? 'a'.repeat(64) : 'b'.repeat(64),
  };
}

describe('McpRunBindingManager', () => {
  it('is disabled by default and rejects unverified activation without transport side effects', async () => {
    const workspace = new InMemoryWorkspaceRegistry({ defaultRoot: process.cwd() });
    const manager = new McpRunBindingManager(workspace);
    expect(manager.status()).toMatchObject({ enabled: false, currentRevision: null, capabilityCount: 0 });
    expect(manager.runtimeForRun(config)).toBeUndefined();
    const callPort: McpToolCallPort = { call: vi.fn() };
    const unverified = { ...snapshot(), health: 'healthy-connectivity-only' as const } as unknown as McpCapabilitySnapshot;
    expect(() => manager.activate(unverified, callPort)).toThrowError(new McpRunBindingError('INVALID_SNAPSHOT'));
    expect(callPort.call).not.toHaveBeenCalled();
  });

  it('captures a run runtime snapshot and keeps it stable after a later activation', async () => {
    const workspace = new InMemoryWorkspaceRegistry({ defaultRoot: process.cwd() });
    const manager = new McpRunBindingManager(workspace);
    const firstPort: McpToolCallPort = { call: vi.fn(async () => ({ revision: 'first' })) };
    const secondPort: McpToolCallPort = { call: vi.fn(async () => ({ revision: 'second' })) };
    manager.activate(snapshot('1.0.0'), firstPort);
    const firstRuntime = manager.runtimeForRun(config)!;
    manager.activate(snapshot('2.0.0'), secondPort);
    const secondRuntime = manager.runtimeForRun(config)!;
    expect(firstRuntime.descriptors[0]?.version).toBe('1.0.0');
    expect(secondRuntime.descriptors[0]?.version).toBe('2.0.0');
    await expect(firstRuntime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: firstRuntime.descriptors[0]!, input: { query: 'one' }, config, signal: new AbortController().signal })).resolves.toMatchObject({ output: { value: { revision: 'first' } } });
    await expect(secondRuntime.execute({ runId: 'run-2', turnId: 'turn-1', callId: 'call-2', descriptor: secondRuntime.descriptors[0]!, input: { query: 'two' }, config, signal: new AbortController().signal })).resolves.toMatchObject({ output: { value: { revision: 'second' } } });
    expect(firstPort.call).toHaveBeenCalledOnce();
    expect(secondPort.call).toHaveBeenCalledOnce();
  });

  it('does not create a runtime for an unknown workspace and deactivates cleanly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-mcp-binding-'));
    try {
      const workspace = new InMemoryWorkspaceRegistry({ defaultRoot: root });
      const manager = new McpRunBindingManager(workspace);
      manager.activate(snapshot(), { call: vi.fn(async () => ({ ok: true })) });
      expect(manager.runtimeForRun({ ...config, workspaceId: 'missing' })).toBeUndefined();
      manager.deactivate();
      expect(manager.status()).toMatchObject({ enabled: false, currentRevision: null });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
