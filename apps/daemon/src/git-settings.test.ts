import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunConfig } from '@ready4vibe/contracts';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import {
  ChildProcessGitRunner,
  InMemoryGitSettingsManager,
  type GitProcessRunnerOptions,
} from './git-settings.js';
import type { ProcessRunner } from '@ready4vibe/tool-adapters';

const config = (overrides: Partial<RunConfig> = {}): RunConfig => ({
  workspaceId: 'default',
  userMessage: 'inspect the workspace',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace',
  sandbox: { mode: 'read-only', network: 'restricted' },
  approval: 'on-request',
  limits: { maxTurns: 1, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 5, maxOutputBytes: 100_000, maxContextBytes: 100_000 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
  ...overrides,
});

describe('daemon Git settings', () => {
  it('keeps Git disabled by default and exposes only fixed descriptors after the Web toggle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-git-settings-'));
    try {
      const calls: string[] = [];
      const processRunner: ProcessRunner = { run: vi.fn(async (request) => { calls.push(request.cwd); return { exitCode: 0, stdout: `root=${root}`, stderr: '', truncated: false }; }) };
      const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root });
      const manager = new InMemoryGitSettingsManager({ workspaceRegistry: registry, processRunner });
      expect(manager.status()).toMatchObject({ enabled: false, availableTools: [], workspaceLabel: expect.any(String) });
      expect(manager.runtimeForRun(config())).toBeUndefined();

      const enabled = manager.setGitEnabled(true);
      expect(enabled).toMatchObject({ enabled: true, availableTools: [
        'git.status@1.0.0', 'git.diff@1.0.0', 'git.log@1.0.0',
        'git.add@1.0.0', 'git.commit@1.0.0', 'git.branch@1.0.0',
        'git.push@1.0.0', 'git.reset@1.0.0', 'git.restore@1.0.0',
      ] });
      const runtime = manager.runtimeForRun(config());
      expect(runtime?.descriptors.map((descriptor) => descriptor.name)).toEqual(['git.status', 'git.diff', 'git.log']);
      const status = runtime?.descriptors[0];
      await expect(runtime?.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor: status!, input: {}, config: config(), signal: new AbortController().signal })).resolves.toEqual({ output: { exitCode: 0, stdout: 'root=[workspace]', stderr: '', truncated: false } });
      expect(calls).toEqual([root]);
      manager.setGitEnabled(false);
      await expect(runtime?.execute({ runId: 'run-1', turnId: 'turn-1', callId: 'call-2', descriptor: status!, input: {}, config: config(), signal: new AbortController().signal })).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes write and destructive Git tools only in workspace-write mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-git-settings-'));
    try {
      const manager = new InMemoryGitSettingsManager({ workspaceRegistry: new InMemoryWorkspaceRegistry({ defaultRoot: root }), processRunner: { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false })) } });
      manager.setGitEnabled(true);
      const readOnly = manager.runtimeForRun(config());
      expect(readOnly?.descriptors.map((d) => d.name)).toEqual(['git.status', 'git.diff', 'git.log']);
      const workspaceWrite = manager.runtimeForRun(config({ sandbox: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' } }));
      expect(workspaceWrite?.descriptors.map((d) => d.name)).toEqual([
        'git.status', 'git.diff', 'git.log', 'git.add', 'git.commit', 'git.branch', 'git.push', 'git.reset', 'git.restore',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for unknown workspaces, untrusted tasks, and external sandbox requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-git-settings-'));
    try {
      const manager = new InMemoryGitSettingsManager({ workspaceRegistry: new InMemoryWorkspaceRegistry({ defaultRoot: root }), processRunner: { run: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false })) } });
      manager.setGitEnabled(true);
      expect(manager.runtimeForRun(config({ workspaceId: 'missing' }))).toBeUndefined();
      expect(manager.runtimeForRun(config({ taskTrust: 'untrusted-content', sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' } }))).toBeUndefined();
      expect(manager.runtimeForRun(config({ sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' } }))).toBeUndefined();
      expect(manager.runtimeForRun(config({ sandbox: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' } }))).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('ChildProcessGitRunner', () => {
  it('uses shell=false, a minimal environment, bounded output, timeout, and abort', async () => {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: (signal?: NodeJS.Signals) => boolean };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => { queueMicrotask(() => child.emit('close', 0)); return true; });
    const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
    const options: GitProcessRunnerOptions = {
      baseEnv: { PATH: 'safe-path', SystemRoot: 'safe-root', SECRET: 'must-not-pass' },
      spawn: (command, args, spawnOptions) => { calls.push({ command, args, options: spawnOptions as Record<string, unknown> }); return child as unknown as ChildProcess; },
    };
    const runner = new ChildProcessGitRunner(options);
    const controller = new AbortController();
    const resultPromise = runner.run({ argv: ['--no-pager', 'status'], shell: false, cwd: 'C:\\workspace', env: { GIT_TERMINAL_PROMPT: '0' }, timeoutMs: 1_000, maxOutputBytes: 4, signal: controller.signal });
    child.stdout.emit('data', Buffer.from('12345'));
    controller.abort();
    const result = await resultPromise;
    expect(result.truncated).toBe(true);
    expect(calls[0]).toMatchObject({ command: 'git', args: ['--no-pager', 'status'], options: { shell: false, cwd: 'C:\\workspace', env: { PATH: 'safe-path', SystemRoot: 'safe-root', GIT_TERMINAL_PROMPT: '0' } } });
    expect(child.kill).toHaveBeenCalled();
  });
});
