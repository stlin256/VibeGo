import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  ExternalSandboxExecutor,
  SandboxRuntimeError,
  buildContainerLaunchPlan,
  ContainerCliRunner,
  type SpawnFunction,
  type SandboxLaunchRequest,
} from './index.js';

const digestImage = 'ghcr.io/ready4vibe/runner@sha256:' + 'a'.repeat(64);
const workspaceRoot = resolve('sandbox-fixture');

function request(overrides: Partial<SandboxLaunchRequest> = {}): SandboxLaunchRequest {
  return {
    runtime: 'docker',
    image: digestImage,
    workspaceRoot,
    workdir: 'src',
    writableRoots: [resolve(workspaceRoot, 'src')],
    network: 'restricted',
    command: ['node', 'run.mjs', '--mode', 'safe'],
    env: { NODE_ENV: 'test' },
    envAllowlist: ['NODE_ENV'],
    limits: { maxMemoryBytes: 512 * 1024 * 1024, maxCpuMillis: 1_500, maxPids: 128, timeoutMs: 10_000, maxOutputBytes: 100_000 },
    ...overrides,
  };
}

describe('external sandbox runtime plan', () => {
  it('builds a digest-pinned, read-only container plan with explicit mounts and limits', () => {
    const plan = buildContainerLaunchPlan(request());
    expect(plan.runtime).toBe('docker');
    expect(plan.argv).toEqual(expect.arrayContaining([
      'run', '--rm', '--init', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--pids-limit', '128', '--network', 'none', '--memory', '536870912b', '--cpus', '1.5', '--env', 'NODE_ENV',
      digestImage, 'node', 'run.mjs', '--mode', 'safe',
    ]));
    expect(plan.argv).toEqual(expect.arrayContaining(['--workdir', '/workspace/src']));
    expect(plan.argv.join(' ')).toContain(`dst=/workspace/${'src'},rw`);
    expect(plan.env).toEqual({ NODE_ENV: 'test' });
    expect(plan.limits).toEqual({ timeoutMs: 10_000, maxOutputBytes: 100_000 });
  });

  it('requires immutable images unless mutable tag use is explicit', () => {
    expect(() => buildContainerLaunchPlan(request({ image: 'node:22' }))).toThrowError(
      new SandboxRuntimeError('IMAGE_INVALID', 'Sandbox image must use an immutable sha256 digest unless mutable tags are explicitly enabled.'),
    );
    expect(buildContainerLaunchPlan(request({ image: 'node:22', allowMutableImageTag: true })).argv).toContain('node:22');
  });

  it('rejects workspace escapes, broad roots, invalid argv, and unallowlisted env', () => {
    expect(() => buildContainerLaunchPlan(request({ workspaceRoot: resolve('/') }))).toThrowError(new SandboxRuntimeError('WORKSPACE_INVALID', 'Sandbox workspace root is too broad or cannot be mounted safely.'));
    expect(() => buildContainerLaunchPlan(request({ workdir: '../outside' }))).toThrowError(new SandboxRuntimeError('WORKSPACE_INVALID', 'Sandbox working directory must remain inside the workspace.'));
    expect(() => buildContainerLaunchPlan(request({ writableRoots: [resolve(workspaceRoot, '..', 'outside')] }))).toThrowError(new SandboxRuntimeError('WRITABLE_ROOT_INVALID', 'Writable root must remain within the workspace.'));
    expect(() => buildContainerLaunchPlan(request({ command: ['sh', '-c', 'echo $HOME'] }))).toThrowError(new SandboxRuntimeError('ARGV_INVALID', 'Sandbox command contains disallowed process input.'));
    expect(() => buildContainerLaunchPlan(request({ env: { NODE_ENV: 'test', SECRET_TOKEN: 'x' } }))).toThrowError(new SandboxRuntimeError('ENV_NOT_ALLOWED', 'Sandbox environment key is not allowlisted.'));
  });

  it('fails closed for VM, invalid resources, and missing runners', async () => {
    expect(() => buildContainerLaunchPlan(request({ runtime: 'vm' }))).toThrowError(new SandboxRuntimeError('RUNTIME_UNSUPPORTED', 'VM sandbox runtime is not wired yet.'));
    expect(() => buildContainerLaunchPlan(request({ limits: { maxPids: 0 } }))).toThrowError(new SandboxRuntimeError('RESOURCE_INVALID', 'Sandbox execution limits are invalid.'));
    await expect(new ExternalSandboxExecutor().execute(request())).rejects.toEqual(new SandboxRuntimeError('RUNTIME_UNAVAILABLE', 'No sandbox process runner is configured.'));
  });

  it('passes an in-memory plan to an injected runner without starting a host process itself', async () => {
    const calls: string[][] = [];
    const executor = new ExternalSandboxExecutor({
      run: async (plan) => {
        calls.push([...plan.argv]);
        return { exitCode: 0, stdout: 'ok', stderr: '', truncated: false, timedOut: false, cancelled: false };
      },
    });
    await expect(executor.execute(request())).resolves.toMatchObject({ exitCode: 0, stdout: 'ok' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(digestImage);
  });

  it('uses shell:false, windowsHide, and a minimal environment for the CLI', async () => {
    const child = new FakeChild();
    let captured: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
    const spawn = ((command, args, options) => {
      captured = { command, args, options: options as Record<string, unknown> };
      return child.asChildProcess();
    }) as SpawnFunction;
    const runner = new ContainerCliRunner({ spawn, baseEnv: { PATH: 'safe-path', SystemRoot: 'C:\\Windows', LEAK: 'no' } });
    const pending = runner.run(buildContainerLaunchPlan(request()));
    child.stdout.write('stdout');
    child.stderr.write('stderr');
    child.emit('close', 0);
    await expect(pending).resolves.toMatchObject({ exitCode: 0, stdout: 'stdout', stderr: 'stderr', timedOut: false, cancelled: false });
    expect(captured).toMatchObject({ command: 'docker', options: { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: 'safe-path', SystemRoot: 'C:\\Windows', NODE_ENV: 'test' } } });
    expect(captured?.args).toContain('--env');
    expect(captured?.args).toContain('NODE_ENV');
    expect(captured?.options.env).not.toHaveProperty('LEAK');
  });

  it('terminates and marks output truncation when the combined cap is exceeded', async () => {
    const child = new FakeChild();
    const runner = new ContainerCliRunner({ spawn: (() => child.asChildProcess()) as SpawnFunction });
    const pending = runner.run(buildContainerLaunchPlan(request({ limits: { maxOutputBytes: 4, timeoutMs: 1_000 } })));
    child.stdout.write('123456');
    await expect(pending).resolves.toMatchObject({ stdout: '1234', truncated: true, timedOut: false, cancelled: false });
    expect(child.killed).toBe(true);
  });

  it('marks timeout and AbortSignal cancellation separately', async () => {
    const timeoutChild = new FakeChild();
    const timeoutRunner = new ContainerCliRunner({ spawn: (() => timeoutChild.asChildProcess()) as SpawnFunction });
    await expect(timeoutRunner.run(buildContainerLaunchPlan(request({ limits: { timeoutMs: 1 } })))).resolves.toMatchObject({ timedOut: true, cancelled: false });
    expect(timeoutChild.killed).toBe(true);

    const abortChild = new FakeChild();
    const abortRunner = new ContainerCliRunner({ spawn: (() => abortChild.asChildProcess()) as SpawnFunction });
    const controller = new AbortController();
    const pending = abortRunner.run(buildContainerLaunchPlan(request({ limits: { timeoutMs: 1_000 } })), controller.signal);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ timedOut: false, cancelled: true });
    expect(abortChild.killed).toBe(true);
  });

  it('maps synchronous CLI startup failure to a secret-free stable error', async () => {
    const runner = new ContainerCliRunner({ spawn: (() => { throw new Error('private key leaked'); }) as SpawnFunction });
    await expect(runner.run(buildContainerLaunchPlan(request()))).rejects.toEqual(new SandboxRuntimeError('PROCESS_START_FAILED', 'Sandbox process could not be started.'));
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
