import type { ContainerRuntime, ExternalSandboxExecutor, SandboxExecutionResult, SandboxLaunchRequest, SandboxRuntimeErrorCode, SandboxRuntimeLimits, SandboxProcessRunner } from './index.js';
import { ContainerCliRunner, ExternalSandboxExecutor as ExternalSandboxExecutorRuntime, SandboxRuntimeError, buildContainerLaunchPlan } from './index.js';

export const CONTAINER_SMOKE_SCHEMA_VERSION = 'sandbox-smoke/v1' as const;
export const CONTAINER_SMOKE_FIXTURE = Object.freeze(['sh', '-c', 'printf ready4vibe-smoke'] as const);
const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/u;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_PROBE_OUTPUT_BYTES = 16 * 1024;
const DEFAULT_SMOKE_TIMEOUT_MS = 30_000;
const DEFAULT_SMOKE_OUTPUT_BYTES = 64 * 1024;

export type ContainerSmokeStatus = 'healthy' | 'unavailable' | 'failed' | 'cancelled';

export type ContainerSmokeErrorCode =
  | SandboxRuntimeErrorCode
  | 'PROBE_FAILED'
  | 'PROBE_TIMEOUT'
  | 'PROBE_CANCELLED'
  | 'EXECUTION_FAILED'
  | 'EXECUTION_TIMEOUT'
  | 'EXECUTION_CANCELLED'
  | 'OUTPUT_TRUNCATED'
  | 'FIXTURE_MISMATCH'
  | 'CLEANUP_FAILED';

export interface ContainerSmokeRequest {
  readonly runtime: ContainerRuntime;
  readonly image: string;
  readonly workspaceRoot: string;
  readonly limits?: SandboxRuntimeLimits;
}

export interface ContainerRuntimeProbeResult {
  readonly available: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly errorCode?: Extract<ContainerSmokeErrorCode, 'PROBE_FAILED' | 'PROBE_TIMEOUT' | 'PROBE_CANCELLED'>;
}

export interface ContainerRuntimeProbe {
  probe(runtime: ContainerRuntime, signal?: AbortSignal): Promise<ContainerRuntimeProbeResult>;
}

export interface ContainerSmokeReport {
  readonly schemaVersion: typeof CONTAINER_SMOKE_SCHEMA_VERSION;
  readonly runtime: ContainerRuntime | 'unknown';
  readonly image: string;
  readonly fixture: 'ready4vibe-smoke';
  readonly status: ContainerSmokeStatus;
  readonly engineAvailable: boolean;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly cleanup: 'deterministic' | 'failed';
  readonly errorCode?: ContainerSmokeErrorCode;
}

export interface ContainerSmokeRunnerOptions {
  readonly probe?: ContainerRuntimeProbe;
  readonly executor?: Pick<ExternalSandboxExecutor, 'execute'>;
  /** Test-only hook. Production cleanup is guaranteed by the `--rm` plan flag. */
  readonly cleanup?: () => Promise<void> | void;
}

/**
 * Probes a locally installed container CLI without pulling images or exposing
 * its output. The existing bounded ContainerCliRunner supplies shell:false,
 * minimal environment, timeout and cancellation behavior.
 */
export class ContainerCliRuntimeProbe implements ContainerRuntimeProbe {
  constructor(
    private readonly runner: SandboxProcessRunner = new ContainerCliRunner(),
    private readonly limits: Pick<SandboxRuntimeLimits, 'timeoutMs' | 'maxOutputBytes'> = {
      timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      maxOutputBytes: DEFAULT_PROBE_OUTPUT_BYTES,
    },
  ) {}

  async probe(runtime: ContainerRuntime, signal?: AbortSignal): Promise<ContainerRuntimeProbeResult> {
    if (signal?.aborted) {
      return { available: false, exitCode: null, timedOut: false, cancelled: true, errorCode: 'PROBE_CANCELLED' };
    }

    try {
      const result = await this.runner.run({
        runtime,
        argv: [runtime, 'version'],
        env: {},
        limits: {
          timeoutMs: this.limits.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
          maxOutputBytes: this.limits.maxOutputBytes ?? DEFAULT_PROBE_OUTPUT_BYTES,
        },
      }, signal);
      if (result.cancelled || signal?.aborted) {
        return { available: false, exitCode: result.exitCode, timedOut: false, cancelled: true, errorCode: 'PROBE_CANCELLED' };
      }
      if (result.timedOut) {
        return { available: false, exitCode: result.exitCode, timedOut: true, cancelled: false, errorCode: 'PROBE_TIMEOUT' };
      }
      if (result.exitCode !== 0 || result.truncated) {
        return { available: false, exitCode: result.exitCode, timedOut: false, cancelled: false, errorCode: 'PROBE_FAILED' };
      }
      return { available: true, exitCode: result.exitCode, timedOut: false, cancelled: false };
    } catch {
      return { available: false, exitCode: null, timedOut: false, cancelled: false, errorCode: 'PROBE_FAILED' };
    }
  }
}

/** Runs only the fixed, harmless, digest-pinned smoke fixture. */
export class ContainerSmokeRunner {
  private readonly probe: ContainerRuntimeProbe;
  private readonly executor: Pick<ExternalSandboxExecutor, 'execute'>;
  private readonly cleanup: () => Promise<void> | void;

  constructor(options: ContainerSmokeRunnerOptions = {}) {
    this.probe = options.probe ?? new ContainerCliRuntimeProbe();
    this.executor = options.executor ?? new ExternalSandboxExecutorRuntime(new ContainerCliRunner());
    this.cleanup = options.cleanup ?? (() => undefined);
  }

  async run(request: ContainerSmokeRequest, signal?: AbortSignal): Promise<ContainerSmokeReport> {
    const runtime = safeRuntime(request?.runtime);
    const image = safeImage(request?.image);
    const base = {
      schemaVersion: CONTAINER_SMOKE_SCHEMA_VERSION,
      runtime,
      image,
      fixture: 'ready4vibe-smoke' as const,
      engineAvailable: false,
      exitCode: null,
      timedOut: false,
      cancelled: false,
      truncated: false,
      cleanup: 'deterministic' as const,
    };

    let smokeRequest: SandboxLaunchRequest;
    try {
      if (runtime === 'unknown' || image === '<invalid>') {
        throw new SandboxRuntimeError(image === '<invalid>' ? 'IMAGE_INVALID' : 'RUNTIME_UNSUPPORTED');
      }
      smokeRequest = {
        runtime,
        image: request.image,
        workspaceRoot: request.workspaceRoot,
        writableRoots: [],
        network: 'restricted',
        command: CONTAINER_SMOKE_FIXTURE,
        env: {},
        envAllowlist: [],
        limits: normalizeSmokeLimits(request.limits),
      };
      // Validate before probing so malformed requests never invoke an engine.
      buildContainerLaunchPlan(smokeRequest);
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        errorCode: error instanceof SandboxRuntimeError ? error.code : 'EXECUTION_FAILED',
      };
    }

    const probe = await this.probe.probe(runtime, signal).catch(() => ({
      available: false,
      exitCode: null,
      timedOut: false,
      cancelled: false,
      errorCode: 'PROBE_FAILED' as const,
    }));
    if (probe.cancelled || signal?.aborted) {
      return { ...base, status: 'cancelled', cancelled: true, errorCode: 'PROBE_CANCELLED' };
    }
    if (!probe.available) {
      return {
        ...base,
        status: 'unavailable',
        exitCode: probe.exitCode,
        timedOut: probe.timedOut,
        errorCode: probe.errorCode ?? 'PROBE_FAILED',
      };
    }

    const availableBase = { ...base, engineAvailable: true };

    let result: SandboxExecutionResult | undefined;
    let executionError: ContainerSmokeErrorCode | undefined;
    try {
      result = await this.executor.execute(smokeRequest, signal);
    } catch (error) {
      executionError = error instanceof SandboxRuntimeError ? error.code : 'EXECUTION_FAILED';
    }

    let cleanupError = false;
    try {
      await this.cleanup();
    } catch {
      cleanupError = true;
    }
    if (cleanupError) {
      return {
        ...availableBase,
        status: signal?.aborted ? 'cancelled' : 'failed',
        cancelled: signal?.aborted === true,
        cleanup: 'failed',
        errorCode: 'CLEANUP_FAILED',
      };
    }
    if (executionError || !result) {
      return { ...availableBase, status: signal?.aborted ? 'cancelled' : 'failed', cancelled: signal?.aborted === true, errorCode: executionError ?? 'EXECUTION_FAILED' };
    }

    if (result.cancelled || signal?.aborted) {
      return { ...availableBase, status: 'cancelled', cancelled: true, exitCode: result.exitCode, errorCode: 'EXECUTION_CANCELLED' };
    }
    if (result.timedOut) {
      return { ...availableBase, status: 'failed', timedOut: true, exitCode: result.exitCode, errorCode: 'EXECUTION_TIMEOUT' };
    }
    if (result.truncated) {
      return { ...availableBase, status: 'failed', truncated: true, exitCode: result.exitCode, errorCode: 'OUTPUT_TRUNCATED' };
    }
    if (result.exitCode !== 0) {
      return { ...availableBase, status: 'failed', exitCode: result.exitCode, errorCode: 'EXECUTION_FAILED' };
    }
    if (result.stdout !== 'ready4vibe-smoke') {
      return { ...availableBase, status: 'failed', exitCode: result.exitCode, errorCode: 'FIXTURE_MISMATCH' };
    }
    return { ...availableBase, status: 'healthy', exitCode: result.exitCode };
  }
}

function normalizeSmokeLimits(limits: SandboxRuntimeLimits | undefined): SandboxRuntimeLimits {
  return {
    maxMemoryBytes: limits?.maxMemoryBytes ?? 512 * 1024 * 1024,
    maxCpuMillis: limits?.maxCpuMillis ?? 1_000,
    maxPids: limits?.maxPids ?? 64,
    timeoutMs: limits?.timeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS,
    maxOutputBytes: limits?.maxOutputBytes ?? DEFAULT_SMOKE_OUTPUT_BYTES,
  };
}

function safeRuntime(value: unknown): ContainerRuntime | 'unknown' {
  return value === 'docker' || value === 'podman' ? value : 'unknown';
}

function safeImage(value: unknown): string {
  return typeof value === 'string' && DIGEST_IMAGE.test(value) ? value : '<invalid>';
}
