import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryToolSettingsManager } from './tool-settings.js';

const config = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: 'default',
  userMessage: 'read a file',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 1, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 5, maxOutputBytes: 100_000, maxContextBytes: 100_000 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
  ...overrides,
});

describe('daemon filesystem tool settings', () => {
  it('keeps filesystem runtime disabled until explicitly enabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-daemon-tools-'));
    try {
      const manager = new InMemoryToolSettingsManager(root);
      expect(manager.status()).toMatchObject({ filesystemEnabled: false, availableTools: [], workspaceLabel: expect.any(String) });
      expect(manager.status().workspaceLabel).not.toContain(root);
      expect(manager.runtimeForRun()).toBeUndefined();
      const enabled = manager.setFilesystemEnabled(true);
      expect(enabled.filesystemEnabled).toBe(true);
      expect(enabled.availableTools).toEqual(['filesystem.read@1.0.0', 'filesystem.write@1.0.0']);
      expect(manager.runtimeForRun()).toBeDefined();
      manager.setFilesystemEnabled(false);
      expect(manager.runtimeForRun()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reads through PathGuard and fails closed for writes and untrusted host fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-daemon-tools-'));
    try {
      await writeFile(join(root, 'note.txt'), 'hello');
      const manager = new InMemoryToolSettingsManager(root);
      manager.setFilesystemEnabled(true);
      const runtime = manager.runtimeForRun()!;
      const read = runtime.descriptors.find((descriptor) => descriptor.id === 'filesystem.read')!;
      await expect(runtime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: read, input: { path: 'note.txt' }, config: config(), signal: new AbortController().signal })).resolves.toEqual({ output: { path: 'note.txt', content: 'hello', bytes: 5 } });
      await expect(runtime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-2', descriptor: read, input: { path: '../outside.txt' }, config: config(), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'PATH_GUARD' });
      const write = runtime.descriptors.find((descriptor) => descriptor.id === 'filesystem.write')!;
      await expect(runtime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-3', descriptor: write, input: { path: 'new.txt', content: 'x' }, config: config({ sandbox: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' } }), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      await expect(runtime.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-4', descriptor: read, input: { path: 'note.txt' }, config: config({ taskTrust: 'untrusted-content' }), signal: new AbortController().signal })).rejects.toMatchObject({ code: 'TOOL_FORBIDDEN' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
