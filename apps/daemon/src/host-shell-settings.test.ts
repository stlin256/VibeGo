import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RunConfig } from '@ready4vibe/contracts';
import type { HostShellProbe } from '@ready4vibe/sandbox-runtime';
import type { HostShellRunner } from '@ready4vibe/tool-adapters';
import { InMemoryHostShellSettingsManager, createHostShellRuntime, hostShellSummary } from './host-shell-settings.js';

const winProbe: HostShellProbe = { status: 'ok', shell: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'], platform: 'win32' };
const posixProbe: HostShellProbe = { status: 'ok', shell: 'bash', args: ['-c'], platform: 'linux' };
const missingProbe: HostShellProbe = { status: 'missing', args: [], platform: 'linux' };

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    workspaceId: 'default',
    userMessage: 'run checks',
    model: { provider: 'fake', name: 'test' },
    taskTrust: 'trusted-workspace',
    sandbox: { mode: 'workspace-write', writableRoots: ['.'], network: 'restricted' },
    approval: 'on-request',
    limits: { maxTurns: 2, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 4, maxOutputBytes: 10_000, maxContextBytes: 10_000 },
    createdBySessionId: 'session-test',
    clientRequestId: 'client-test',
    ...overrides,
  };
}

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ready4vibe-host-shell-'));
}

describe('host shell settings', () => {
  it('describes the probed shell environment for the model', () => {
    const windows = hostShellSummary(winProbe);
    expect(windows).toContain('Platform: win32 (Windows)');
    expect(windows).toContain('pwsh -NoProfile -NonInteractive -Command <command>');
    expect(windows).toContain('PowerShell syntax');
    expect(windows).toContain('must stay inside it');
    expect(windows).toContain('require explicit user approval');
    const posix = hostShellSummary(posixProbe);
    expect(posix).toContain('Platform: linux');
    expect(posix).toContain('bash -c <command>');
    expect(posix).toContain('POSIX shell syntax');
  });

  it('registers shell.exec with host-restricted sandbox modes and an environment summary', async () => {
    const root = await temporaryRoot();
    try {
      const runtime = createHostShellRuntime(root, 'default', winProbe, { run: async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false }) });
      expect(runtime.descriptors).toHaveLength(1);
      const descriptor = runtime.descriptors[0]!;
      expect(descriptor).toMatchObject({ id: 'shell.exec', version: '1.0.0', risk: 'destructive' });
      expect(descriptor.summary).toContain('pwsh -NoProfile -NonInteractive -Command');
      expect(descriptor.inputSchema).toMatchObject({ required: ['command'] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('gates execution behind approval and runs through the injected runner', async () => {
    const root = await temporaryRoot();
    try {
      const runner: HostShellRunner = { run: vi.fn(async () => ({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false, timedOut: false, cancelled: false })) };
      const manager = new InMemoryHostShellSettingsManager({ probe: winProbe, runner, resolveRunRoot: () => root });
      expect(manager.health()).toBe('ready');
      const runtime = manager.runtimeForRun(config());
      expect(runtime?.descriptors).toEqual([expect.objectContaining({ id: 'shell.exec', risk: 'destructive' })]);
      const descriptor = runtime!.descriptors[0]!;
      const request = { runId: 'run', turnId: 'turn', callId: 'call', descriptor, input: { command: 'Get-ChildItem | Select-Object -First 1' }, config: config(), signal: new AbortController().signal };
      await expect(runtime!.execute(request)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
      await runtime!.approve?.(request, 1_000);
      await expect(runtime!.execute(request)).resolves.toMatchObject({ output: { exitCode: 0, stdout: 'ok' } });
      expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({
        workspaceRoot: root,
        command: ['pwsh', '-NoProfile', '-NonInteractive', '-Command', 'Get-ChildItem | Select-Object -First 1'],
        allowShellMetacharacters: true,
      }), expect.anything());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stays unregistered without a probe, a host sandbox mode or a run root', async () => {
    const root = await temporaryRoot();
    try {
      const missing = new InMemoryHostShellSettingsManager({ probe: missingProbe, resolveRunRoot: () => root });
      expect(missing.health()).toBe('missing');
      expect(missing.runtimeForRun(config())).toBeUndefined();
      const manager = new InMemoryHostShellSettingsManager({ probe: posixProbe, resolveRunRoot: () => root });
      expect(manager.runtimeForRun(config({ sandbox: { mode: 'read-only', network: 'restricted' } }))).toBeUndefined();
      expect(manager.runtimeForRun(config({ sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' } }))).toBeUndefined();
      expect(manager.runtimeForRun(config({ sandbox: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' } }))).toBeDefined();
      const noRoot = new InMemoryHostShellSettingsManager({ probe: posixProbe, resolveRunRoot: () => undefined });
      expect(noRoot.runtimeForRun(config())).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never approves a prompt under approval mode never', async () => {
    const root = await temporaryRoot();
    try {
      const manager = new InMemoryHostShellSettingsManager({ probe: posixProbe, runner: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false }) }, resolveRunRoot: () => root });
      const denied = config({ approval: 'never' });
      const runtime = manager.runtimeForRun(denied)!;
      const descriptor = runtime.descriptors[0]!;
      const request = { runId: 'run', turnId: 'turn', callId: 'call', descriptor, input: { command: 'ls' }, config: denied, signal: new AbortController().signal };
      await expect(runtime.execute(request)).rejects.toMatchObject({ code: 'TOOL_FORBIDDEN' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
