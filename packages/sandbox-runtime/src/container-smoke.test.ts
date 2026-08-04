import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ContainerCliRuntimeProbe,
  ContainerSmokeRunner,
  buildContainerLaunchPlan,
  type ContainerRuntimeProbe,
  type ContainerRuntimeProbeResult,
  type ContainerSmokeRequest,
  type SandboxExecutionResult,
  type SandboxLaunchRequest,
  type SandboxLaunchPlan,
  type SandboxProcessRunner,
} from './index.js';

const image = `ghcr.io/ready4vibe/runner@sha256:${'a'.repeat(64)}`;
const workspaceRoot = resolve('sandbox-smoke-fixture');

function request(overrides: Partial<ContainerSmokeRequest> = {}): ContainerSmokeRequest {
  return { runtime: 'docker', image, workspaceRoot, ...overrides };
}

function execution(overrides: Partial<SandboxExecutionResult> = {}): SandboxExecutionResult {
  return { exitCode: 0, stdout: 'ready4vibe-smoke', stderr: '', truncated: false, timedOut: false, cancelled: false, ...overrides };
}

class FakeProbe implements ContainerRuntimeProbe {
  calls = 0;

  constructor(private readonly result: ContainerRuntimeProbeResult) {}

  async probe(): Promise<ContainerRuntimeProbeResult> {
    this.calls += 1;
    return this.result;
  }
}

describe('container smoke runner', () => {
  it('runs only the fixed fixture with restricted network and reports bounded healthy status', async () => {
    const probe = new FakeProbe({ available: true, exitCode: 0, timedOut: false, cancelled: false });
    const calls: SandboxLaunchRequest[] = [];
    const executor = {
      execute: async (input: SandboxLaunchRequest): Promise<SandboxExecutionResult> => {
        calls.push(input);
        return execution({ stderr: 'secret-token=must-not-escape' });
      },
    };
    const report = await new ContainerSmokeRunner({ probe, executor }).run(request());

    expect(report).toMatchObject({ schemaVersion: 'sandbox-smoke/v1', runtime: 'docker', image, status: 'healthy', engineAvailable: true });
    expect(calls[0]).toMatchObject({ network: 'restricted', writableRoots: [], command: ['sh', '-c', 'printf ready4vibe-smoke'], env: {}, envAllowlist: [] });
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(probe.calls).toBe(1);
    expect(calls[0]).toBeDefined();
    expect(buildContainerLaunchPlan(calls[0]! ).argv).toEqual(expect.arrayContaining(['--pull=never', '--rm', '--network', 'none']));
  });

  it('returns unavailable for a missing or unhealthy engine without executing a container', async () => {
    let executions = 0;
    const report = await new ContainerSmokeRunner({
      probe: new FakeProbe({ available: false, exitCode: null, timedOut: false, cancelled: false, errorCode: 'PROBE_FAILED' }),
      executor: { execute: async () => { executions += 1; return execution(); } },
    }).run(request());

    expect(report).toMatchObject({ status: 'unavailable', engineAvailable: false, errorCode: 'PROBE_FAILED' });
    expect(executions).toBe(0);
  });

  it('fails closed for wrong digest before probing and never echoes the invalid value', async () => {
    const probe = new FakeProbe({ available: true, exitCode: 0, timedOut: false, cancelled: false });
    const report = await new ContainerSmokeRunner({ probe }).run(request({ image: 'node:latest' }));

    expect(report).toMatchObject({ status: 'failed', errorCode: 'IMAGE_INVALID', image: '<invalid>' });
    expect(probe.calls).toBe(0);
  });

  it('maps probe timeout and cancellation to stable statuses', async () => {
    const timeout = await new ContainerSmokeRunner({
      probe: new FakeProbe({ available: false, exitCode: null, timedOut: true, cancelled: false, errorCode: 'PROBE_TIMEOUT' }),
    }).run(request());
    const cancelled = await new ContainerSmokeRunner({
      probe: new FakeProbe({ available: false, exitCode: null, timedOut: false, cancelled: true, errorCode: 'PROBE_CANCELLED' }),
    }).run(request());

    expect(timeout).toMatchObject({ status: 'unavailable', timedOut: true, errorCode: 'PROBE_TIMEOUT' });
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelled: true, errorCode: 'PROBE_CANCELLED' });
  });

  it.each([
    ['timeout', execution({ timedOut: true }), 'EXECUTION_TIMEOUT'],
    ['cancel', execution({ cancelled: true }), 'EXECUTION_CANCELLED'],
    ['output cap', execution({ truncated: true }), 'OUTPUT_TRUNCATED'],
    ['non-zero exit', execution({ exitCode: 17 }), 'EXECUTION_FAILED'],
    ['fixture mismatch', execution({ stdout: 'unexpected' }), 'FIXTURE_MISMATCH'],
  ])('fails closed for execution %s', async (_label, result, errorCode) => {
    const report = await new ContainerSmokeRunner({
      probe: new FakeProbe({ available: true, exitCode: 0, timedOut: false, cancelled: false }),
      executor: { execute: async () => result },
    }).run(request());

    expect(report.status).toBe(errorCode === 'EXECUTION_CANCELLED' ? 'cancelled' : 'failed');
    expect(report.errorCode).toBe(errorCode);
  });

  it('surfaces deterministic cleanup failure without exposing execution output', async () => {
    const report = await new ContainerSmokeRunner({
      probe: new FakeProbe({ available: true, exitCode: 0, timedOut: false, cancelled: false }),
      executor: { execute: async () => execution({ stdout: 'secret-output' }) },
      cleanup: async () => { throw new Error('private cleanup detail'); },
    }).run(request());

    expect(report).toMatchObject({ status: 'failed', cleanup: 'failed', errorCode: 'CLEANUP_FAILED' });
    expect(JSON.stringify(report)).not.toContain('secret-output');
  });
});

describe('container runtime probe', () => {
  it('uses argv-only runtime version and maps runner results without returning output', async () => {
    let captured: SandboxLaunchPlan | undefined;
    const runner: SandboxProcessRunner = {
      run: async (plan) => {
        captured = plan;
        return execution({ stdout: 'Docker version 99.99 private' });
      },
    };
    const result = await new ContainerCliRuntimeProbe(runner).probe('podman');

    expect(result).toMatchObject({ available: true, exitCode: 0 });
    expect(captured).toMatchObject({ runtime: 'podman', argv: ['podman', 'version'], env: {} });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('fails closed when the runtime runner cannot start', async () => {
    const runner: SandboxProcessRunner = { run: async () => { throw new Error('secret startup detail'); } };
    await expect(new ContainerCliRuntimeProbe(runner).probe('docker')).resolves.toMatchObject({ available: false, errorCode: 'PROBE_FAILED' });
  });
});
