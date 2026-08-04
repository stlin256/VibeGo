import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  HostRestrictedProcessError,
  HostRestrictedProcessRunner,
  buildHostProcessPlan,
  type HostProcessLaunchRequest,
  type HostProcessSpawnFunction,
} from './host-process.js';

const workspaceRoot = resolve('host-process-fixture');

function request(overrides: Partial<HostProcessLaunchRequest> = {}): HostProcessLaunchRequest {
  return {
    workspaceRoot,
    cwd: resolve(workspaceRoot, 'src'),
    command: ['node', 'script.mjs', '--mode', 'safe'],
    env: { NODE_ENV: 'test' },
    envAllowlist: ['NODE_ENV'],
    limits: { timeoutMs: 1_000, maxOutputBytes: 100 },
    ...overrides,
  };
}

describe('host-restricted process plan', () => {
  it('keeps .cmd and PowerShell fixtures as argv with shell:false', async () => {
    const cmd = await buildHostProcessPlan(request({ command: ['cmd.exe', '/d', '/c', 'script.cmd'] }), async (value) => value);
    const powershell = await buildHostProcessPlan(request({ command: ['powershell.exe', '-NoProfile', '-File', 'script.ps1'] }), async (value) => value);
    expect(cmd.argv).toEqual(['cmd.exe', '/d', '/c', 'script.cmd']);
    expect(powershell.argv).toEqual(['powershell.exe', '-NoProfile', '-File', 'script.ps1']);
    expect(cmd.shell).toBe(false);
    expect(powershell.shell).toBe(false);
  });

  it('rejects root/escape/symlink cwd, command injection and unsafe environment', async () => {
    await expect(buildHostProcessPlan(request({ workspaceRoot: resolve('/') }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('WORKSPACE_INVALID'),
    );
    await expect(buildHostProcessPlan(request({ cwd: resolve(workspaceRoot, '..', 'outside') }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('CWD_OUTSIDE_WORKSPACE'),
    );
    await expect(buildHostProcessPlan(request({ cwd: resolve(workspaceRoot, 'link') }), async (value) => value === resolve(workspaceRoot, 'link') ? resolve(workspaceRoot, '..', 'outside') : value)).rejects.toEqual(
      new HostRestrictedProcessError('SYMLINK_ESCAPE'),
    );
    await expect(buildHostProcessPlan(request({ command: ['node', '-e', 'console.log("a&b")'] }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('ARGV_INVALID'),
    );
    await expect(buildHostProcessPlan(request({ env: { API_KEY: 'nope' }, envAllowlist: ['API_KEY'] }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('ENV_NOT_ALLOWED'),
    );
    await expect(buildHostProcessPlan(request({ env: { NODE_ENV: 'api_key=sk-' + 'x'.repeat(24) } }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('ENV_INVALID'),
    );
    await expect(buildHostProcessPlan(request({ env: { NODE_ENV: 'line\nfeed' } }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('ENV_INVALID'),
    );
    await expect(buildHostProcessPlan(request({ envAllowlist: Array.from({ length: 65 }, (_, index) => `ENV_${index}`) }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('ENV_INVALID'),
    );
    await expect(buildHostProcessPlan(request({ limits: { timeoutMs: 0, maxOutputBytes: 100 } }), async (value) => value)).rejects.toEqual(
      new HostRestrictedProcessError('RESOURCE_INVALID'),
    );
  });

  it('produces a minimal environment and bounded limits without raw paths in metadata', async () => {
    const plan = await buildHostProcessPlan(request(), async (value) => value);
    expect(plan.env).toEqual({ NODE_ENV: 'test' });
    expect(plan.limits).toEqual({ timeoutMs: 1_000, maxOutputBytes: 100 });
    expect(JSON.stringify(plan)).not.toContain('SECRET');
    expect(plan.cwd).toBe(resolve(workspaceRoot, 'src'));
  });
});

describe('HostRestrictedProcessRunner', () => {
  it('spawns with shell:false, bounded cwd/env and returns capped output', async () => {
    const child = new FakeChild();
    let captured: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
    const spawn = ((command, args, options) => {
      captured = { command, args, options: options as Record<string, unknown> };
      return child.asChildProcess();
    }) as HostProcessSpawnFunction;
    const runner = new HostRestrictedProcessRunner({
      spawn,
      baseEnv: { PATH: 'safe-path', SystemRoot: 'C:\\Windows', SECRET: 'no' },
      realpath: async (value) => value,
      terminateTree: (process) => process.kill(),
    });
    const pending = runner.run(request());
    await new Promise((done) => setTimeout(done, 0));
    child.stdout.write('stdout');
    child.stderr.write('stderr');
    child.emit('close', 0);
    await expect(pending).resolves.toMatchObject({ exitCode: 0, stdout: 'stdout', stderr: 'stderr', timedOut: false, cancelled: false });
    expect(captured).toMatchObject({ command: 'node', options: { shell: false, windowsHide: true, cwd: resolve(workspaceRoot, 'src'), stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: 'safe-path', SystemRoot: 'C:\\Windows', NODE_ENV: 'test' } } });
    expect(captured?.options.env).not.toHaveProperty('SECRET');
  });

  it('terminates on combined output cap, timeout and abort without replaying a command', async () => {
    const outputChild = new FakeChild();
    let terminations = 0;
    const outputRunner = new HostRestrictedProcessRunner({
      spawn: (() => outputChild.asChildProcess()) as HostProcessSpawnFunction,
      realpath: async (value) => value,
      terminateTree: (process) => { terminations += 1; process.kill(); },
    });
    const outputPending = outputRunner.run(request({ limits: { timeoutMs: 1_000, maxOutputBytes: 4 } }));
    await new Promise((done) => setTimeout(done, 0));
    outputChild.stdout.write('123456');
    await expect(outputPending).resolves.toMatchObject({ stdout: '1234', truncated: true, timedOut: false, cancelled: false });
    expect(terminations).toBe(1);

    const timeoutChild = new FakeChild();
    const timeoutRunner = new HostRestrictedProcessRunner({
      spawn: (() => timeoutChild.asChildProcess()) as HostProcessSpawnFunction,
      realpath: async (value) => value,
      terminateTree: (process) => process.kill(),
    });
    await expect(timeoutRunner.run(request({ limits: { timeoutMs: 1, maxOutputBytes: 100 } }))).resolves.toMatchObject({ timedOut: true, cancelled: false });

    const abortChild = new FakeChild();
    const abortRunner = new HostRestrictedProcessRunner({
      spawn: (() => abortChild.asChildProcess()) as HostProcessSpawnFunction,
      realpath: async (value) => value,
      terminateTree: (process) => process.kill(),
    });
    const controller = new AbortController();
    const abortPending = abortRunner.run(request(), controller.signal);
    controller.abort();
    await expect(abortPending).resolves.toMatchObject({ timedOut: false, cancelled: true });
  });

  it('maps startup errors to a stable secret-free error', async () => {
    const runner = new HostRestrictedProcessRunner({
      spawn: (() => { throw new Error('private key leaked'); }) as HostProcessSpawnFunction,
      realpath: async (value) => value,
    });
    await expect(runner.run(request())).rejects.toEqual(new HostRestrictedProcessError('PROCESS_START_FAILED'));
  });

  it('keeps a cancelled run from starting and permits a later run to start fresh', async () => {
    const controller = new AbortController();
    controller.abort();
    let starts = 0;
    const child = new FakeChild();
    const runner = new HostRestrictedProcessRunner({
      spawn: (() => { starts += 1; return child.asChildProcess(); }) as HostProcessSpawnFunction,
      realpath: async (value) => value,
      terminateTree: (process) => process.kill(),
    });
    await expect(runner.run(request(), controller.signal)).resolves.toMatchObject({ cancelled: true });
    const later = runner.run(request());
    await new Promise((done) => setTimeout(done, 0));
    child.emit('close', 0);
    await expect(later).resolves.toMatchObject({ exitCode: 0, cancelled: false });
    expect(starts).toBe(1);
  });

  it('routes Windows process-tree termination through the injected adapter', async () => {
    const child = new FakeChild();
    let terminated = 0;
    const runner = new HostRestrictedProcessRunner({
      platform: 'win32',
      spawn: (() => child.asChildProcess()) as HostProcessSpawnFunction,
      realpath: async (value) => value,
      terminateTree: (process) => { terminated += 1; process.kill(); },
    });
    const controller = new AbortController();
    const pending = runner.run(request({ command: ['cmd.exe', '/d', '/c', 'script.cmd'] }), controller.signal);
    await new Promise((done) => setTimeout(done, 0));
    controller.abort();
    await expect(pending).resolves.toMatchObject({ cancelled: true, timedOut: false });
    expect(terminated).toBe(1);
  });
});

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('close', null));
    return true;
  }

  asChildProcess(): import('node:child_process').ChildProcess {
    return this as unknown as import('node:child_process').ChildProcess;
  }
}
