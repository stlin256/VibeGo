import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { RunConfig } from '@ready4vibe/contracts';
import type { SandboxLaunchPlan, SpawnFunction } from '@ready4vibe/sandbox-runtime';
import { ChildProcessSandboxProbe, InMemorySandboxSettingsManager } from './sandbox-settings.js';

const digest = `ghcr.io/ready4vibe/runner@sha256:${'a'.repeat(64)}`;

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    workspaceId: 'default',
    userMessage: 'run checks',
    model: { provider: 'fake', name: 'test' },
    taskTrust: 'trusted-workspace',
    sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' },
    approval: 'on-request',
    limits: { maxTurns: 2, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 4, maxOutputBytes: 10_000, maxContextBytes: 10_000 },
    createdBySessionId: 'session-test',
    clientRequestId: 'client-test',
    ...overrides,
  };
}

describe('guided external sandbox settings', () => {
  it('probes with shell disabled and a minimal environment', async () => {
    const child = new ProbeChild();
    let captured: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
    const spawn: SpawnFunction = (command, args, options) => {
      captured = { command, args, options: options as Record<string, unknown> };
      queueMicrotask(() => { child.stdout.write('27.1\n'); child.emit('close', 0); });
      return child as unknown as import('node:child_process').ChildProcess;
    };
    const probe = new ChildProcessSandboxProbe(spawn, { PATH: 'safe', SECRET: 'do-not-copy' });
    await expect(probe.probe('docker')).resolves.toMatchObject({ detected: true, healthy: true, version: '27.1' });
    expect(captured).toMatchObject({ command: 'docker', args: ['version', '--format', '{{.Server.Version}}'], options: { shell: false, windowsHide: true, env: { PATH: 'safe' } } });
  });

  it('starts disabled and requires a healthy probe before enablement', async () => {
    const manager = new InMemorySandboxSettingsManager({ probe: { probe: async () => ({ detected: true, healthy: true, version: 'test' }) } });
    expect(manager.status()).toMatchObject({ enabled: false, detected: false, healthy: false, provider: null });
    await expect(manager.configure({ provider: 'docker', imageDigest: digest, network: 'restricted', resources: {}, enabled: true })).rejects.toMatchObject({ code: 'RUNTIME_NOT_READY' });
    await expect(manager.configure({ provider: 'docker', imageDigest: 'node:22', network: 'restricted', resources: {}, enabled: false })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await manager.probe('docker');
    await manager.configure({ provider: 'docker', imageDigest: digest, network: 'restricted', resources: {}, enabled: true });
    expect(manager.status()).toMatchObject({ enabled: true, healthy: true, imageDigest: digest, capabilities: { version: 'test' } });
    await manager.probe('podman');
    expect(manager.status()).toMatchObject({ provider: 'podman', enabled: false, healthy: true });
  });

  it('exposes shell only for the selected external provider and preserves approval', async () => {
    const calls: string[][] = [];
    const manager = new InMemorySandboxSettingsManager({
      probe: { probe: async () => ({ detected: true, healthy: true, version: 'test' }) },
      processRunner: { run: async (plan: SandboxLaunchPlan) => { calls.push([...plan.argv]); return { exitCode: 0, stdout: 'ok', stderr: '', truncated: false, timedOut: false, cancelled: false }; } },
    });
    await manager.probe('docker');
    await manager.configure({ provider: 'docker', imageDigest: digest, network: 'restricted', resources: {}, enabled: true });
    const runtime = manager.runtimeForRun(config());
    expect(runtime?.descriptors).toEqual([expect.objectContaining({ id: 'shell.exec', risk: 'destructive' })]);
    const descriptor = runtime!.descriptors[0]!;
    const request = { runId: 'run', turnId: 'turn', callId: 'call', descriptor, input: { argv: ['node', '--version'] }, config: config(), signal: new AbortController().signal };
    expect(runtime!.approvalDetails?.(request)).toMatchObject({ sandboxProvider: 'docker', sandboxImageDigest: digest, network: 'restricted' });
    await expect(runtime!.execute(request)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    await runtime!.approve?.(request, 1_000);
    await expect(runtime!.execute(request)).resolves.toMatchObject({ output: { exitCode: 0, stdout: 'ok' } });
    expect(calls[0]).toContain(digest);
    expect(manager.runtimeForRun(config({ sandbox: { mode: 'read-only', network: 'restricted' } }))).toBeUndefined();
  });

  it('keeps untrusted host fallback disabled and rejects an unknown workspace', async () => {
    const manager = new InMemorySandboxSettingsManager({ probe: { probe: async () => ({ detected: true, healthy: true }) } });
    await manager.probe('docker');
    await manager.configure({ provider: 'docker', imageDigest: digest, network: 'restricted', resources: {}, enabled: true });
    expect(manager.runtimeForRun(config({ taskTrust: 'untrusted-content', sandbox: { mode: 'read-only', network: 'restricted' } }))).toBeUndefined();
    expect(manager.runtimeForRun(config({ sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'enabled' } }))).toBeUndefined();
    expect(manager.runtimeForRun(config({ workspaceId: 'other' }))).toBeUndefined();
  });
});

class ProbeChild extends EventEmitter {
  readonly stdout = new PassThrough();

  kill(): boolean {
    return true;
  }
}
