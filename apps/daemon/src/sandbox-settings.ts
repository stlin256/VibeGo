import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import type { RunConfig } from '@ready4vibe/contracts';
import type { ToolRuntime, ToolRuntimeRequest } from '@ready4vibe/agent';
import { ArgvGuard, PathGuard } from '@ready4vibe/execution';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import { SandboxResolver, type SandboxProviderStatus, type SandboxProviderVerifier, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import {
  ContainerCliRunner,
  ExternalSandboxExecutor,
  SandboxRuntimeError,
  type SandboxExecutionResult,
  type SandboxNetwork,
  type SandboxProcessRunner,
} from '@ready4vibe/sandbox-runtime';
import {
  ShellToolAdapter,
  ToolAdapterError,
  ToolExecutor,
  ToolExecutorRuntime,
  ToolHandlerRegistry,
  type ProcessRunRequest,
  type ProcessRunResult,
  type ProcessRunner,
} from '@ready4vibe/tool-adapters';
import { ToolRegistry } from '@ready4vibe/tools';
import { InMemoryWorkspaceRegistry, type WorkspaceRegistry } from '@ready4vibe/workspaces';

export type ExternalSandboxProvider = 'docker' | 'podman';

export interface SandboxResourceSettings {
  maxMemoryBytes: number;
  maxCpuMillis: number;
  maxPids: number;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxCapabilitiesStatus {
  version: string;
  networkModes: readonly SandboxNetwork[];
  maxMemoryBytes: number;
  maxCpuMillis: number;
}

export interface SandboxSettingsStatus {
  provider: ExternalSandboxProvider | null;
  detected: boolean;
  healthy: boolean;
  enabled: boolean;
  imageDigest: string | null;
  network: SandboxNetwork;
  resources: SandboxResourceSettings;
  capabilities: SandboxCapabilitiesStatus | null;
}

export interface SandboxSettingsInput {
  provider: ExternalSandboxProvider;
  imageDigest: string;
  network: SandboxNetwork;
  resources: Partial<SandboxResourceSettings>;
  enabled: boolean;
}

export interface SandboxProbeResult {
  detected: boolean;
  healthy: boolean;
  version?: string;
}

export interface SandboxRuntimeProbe {
  probe(provider: ExternalSandboxProvider, signal?: AbortSignal): Promise<SandboxProbeResult>;
}

export interface SandboxSettingsOptions {
  workspaceRoot?: string;
  workspaceRegistry?: WorkspaceRegistry;
  probe?: SandboxRuntimeProbe;
  processRunner?: SandboxProcessRunner;
}

export interface SandboxSettingsManager {
  status(): SandboxSettingsStatus;
  probe(provider: ExternalSandboxProvider): Promise<SandboxSettingsStatus>;
  configure(input: SandboxSettingsInput): Promise<SandboxSettingsStatus>;
}

export class SandboxSettingsError extends Error {
  constructor(readonly code: 'INVALID_PROVIDER' | 'INVALID_IMAGE' | 'INVALID_NETWORK' | 'INVALID_RESOURCES' | 'RUNTIME_NOT_READY', message: string) {
    super(message);
    this.name = 'SandboxSettingsError';
  }
}

const DEFAULT_RESOURCES: SandboxResourceSettings = {
  maxMemoryBytes: 512 * 1024 * 1024,
  maxCpuMillis: 2_000,
  maxPids: 128,
  timeoutMs: 15 * 60 * 1_000,
  maxOutputBytes: 8 * 1024 * 1024,
};

const RESOURCE_CEILINGS: SandboxResourceSettings = {
  maxMemoryBytes: 4 * 1024 * 1024 * 1024,
  maxCpuMillis: 16_000,
  maxPids: 1_024,
  timeoutMs: 30 * 60 * 1_000,
  maxOutputBytes: 50 * 1024 * 1024,
};

const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/u;

export class InMemorySandboxSettingsManager implements SandboxSettingsManager {
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly probeRunner: SandboxRuntimeProbe;
  private readonly processRunner: SandboxProcessRunner;
  private lastProbe: { provider: ExternalSandboxProvider; result: SandboxProbeResult } | undefined;
  private config: { provider: ExternalSandboxProvider; imageDigest: string; network: SandboxNetwork; resources: SandboxResourceSettings; enabled: boolean } | undefined;

  constructor(options: SandboxSettingsOptions = {}) {
    this.workspaceRegistry = options.workspaceRegistry ?? new InMemoryWorkspaceRegistry({ defaultRoot: resolve(options.workspaceRoot ?? process.cwd()) });
    this.probeRunner = options.probe ?? new ChildProcessSandboxProbe();
    this.processRunner = options.processRunner ?? new ContainerCliRunner();
  }

  status(): SandboxSettingsStatus {
    const config = this.config;
    const probe = this.lastProbe;
    const capabilities = probe?.result.healthy ? {
      version: probe.result.version ?? 'unknown',
      networkModes: ['restricted', 'enabled'] as const,
      maxMemoryBytes: RESOURCE_CEILINGS.maxMemoryBytes,
      maxCpuMillis: RESOURCE_CEILINGS.maxCpuMillis,
    } : null;
    return {
      provider: probe?.provider ?? config?.provider ?? null,
      detected: probe?.result.detected ?? false,
      healthy: probe?.result.healthy ?? false,
      enabled: config?.enabled === true && probe?.provider === config.provider && probe.result.healthy === true,
      imageDigest: config?.imageDigest ?? null,
      network: config?.network ?? 'restricted',
      resources: { ...(config?.resources ?? DEFAULT_RESOURCES) },
      capabilities,
    };
  }

  async probe(provider: ExternalSandboxProvider): Promise<SandboxSettingsStatus> {
    if (provider !== 'docker' && provider !== 'podman') throw new SandboxSettingsError('INVALID_PROVIDER', 'Only Docker and Podman are supported.');
    const result = await this.probeRunner.probe(provider);
    this.lastProbe = { provider, result };
    return this.status();
  }

  async configure(input: SandboxSettingsInput): Promise<SandboxSettingsStatus> {
    const normalized = normalizeSettings(input);
    if (normalized.enabled && (!this.lastProbe || this.lastProbe.provider !== normalized.provider || !this.lastProbe.result.healthy)) {
      throw new SandboxSettingsError('RUNTIME_NOT_READY', 'Probe the selected container runtime successfully before enabling external shell.');
    }
    this.config = normalized;
    return this.status();
  }

  runtimeForRun(config: RunConfig): ToolRuntime | undefined {
    const settings = this.config;
    if (!settings?.enabled || !this.lastProbe?.result.healthy || config.sandbox.mode !== 'external-sandbox') return undefined;
    if (config.sandbox.provider !== settings.provider) return undefined;
    if (settings.network === 'restricted' && config.sandbox.network === 'enabled') return undefined;
    const workspaceRoot = this.workspaceRegistry.resolveRoot(config.workspaceId);
    if (!workspaceRoot) return undefined;
    return createShellRuntime(workspaceRoot, config.workspaceId, settings, config, this.processRunner);
  }
}

export class ChildProcessSandboxProbe implements SandboxRuntimeProbe {
  constructor(
    private readonly spawn: (command: string, args: string[], options: SpawnOptions) => ChildProcess = (command, args, options) => defaultSpawn(command, args, options),
    private readonly baseEnv: Readonly<Record<string, string | undefined>> = process.env,
  ) {}

  probe(provider: ExternalSandboxProvider, signal?: AbortSignal): Promise<SandboxProbeResult> {
    return new Promise((resolveResult) => {
      let child: ChildProcess;
      try {
        child = this.spawn(provider, ['version', '--format', '{{.Server.Version}}'], {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
          env: minimalEnvironment(this.baseEnv),
        });
      } catch {
        resolveResult({ detected: false, healthy: false });
        return;
      }
      let output = '';
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch { /* best effort */ } resolveResult({ detected: true, healthy: false }); } }, 2_000);
      const finish = (result: SandboxProbeResult): void => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolveResult(result); };
      const onAbort = (): void => { try { child.kill('SIGKILL'); } catch { /* best effort */ } finish({ detected: true, healthy: false }); };
      child.stdout?.on('data', (chunk: Buffer | string) => { if (output.length < 256) output += String(chunk).slice(0, 256 - output.length); });
      child.once('error', () => finish({ detected: false, healthy: false }));
      child.once('close', (code) => finish({ detected: true, healthy: code === 0, ...(code === 0 && output.trim() ? { version: output.trim().replace(/[\r\n]/gu, '').slice(0, 128) } : {}) }));
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

function createShellRuntime(workspaceRoot: string, workspaceId: string, settings: { provider: ExternalSandboxProvider; imageDigest: string; network: SandboxNetwork; resources: SandboxResourceSettings }, config: RunConfig, processRunner: SandboxProcessRunner): ToolRuntime {
  const registry = new ToolRegistry();
  registry.register({
    id: 'shell.exec',
    version: '1.0.0',
    risk: 'destructive',
    summary: 'Execute a bounded argv inside the selected external sandbox.',
    supportedSandboxModes: ['external-sandbox'],
    inputSchema: { type: 'object', properties: { argv: { type: 'array', items: { type: 'string' } }, cwd: { type: 'string' }, env: { type: 'object' }, timeoutMs: { type: 'integer', minimum: 1 }, maxOutputBytes: { type: 'integer', minimum: 1 } }, required: ['argv'], additionalProperties: false },
  });
  const handlers = new ToolHandlerRegistry();
  handlers.register(new ShellToolAdapter(new PathGuard(workspaceRoot), new ArgvGuard({ allowedEnv: ['CI', 'NODE_ENV', 'TERM'] }), new SandboxShellProcessRunner(workspaceRoot, settings, config, processRunner), { timeoutMs: settings.resources.timeoutMs, maxOutputBytes: settings.resources.maxOutputBytes }));
  const provider: SandboxProviderVerifier = {
    runtime: settings.provider,
    verify: async (): Promise<SandboxProviderStatus> => ({ healthy: true, capabilities: { runtime: settings.provider, version: 'configured', isolation: 'container', networkModes: ['restricted', 'enabled'], maxMemoryBytes: settings.resources.maxMemoryBytes, maxCpuMillis: settings.resources.maxCpuMillis } }),
  };
  const executor = new ToolExecutor({ registry, approvalPolicy: new ApprovalPolicy(registry), sandboxResolver: new SandboxResolver([provider]), handlers });
  return new ToolExecutorRuntime({
    registry,
    executor,
    resolveWorkspaceRoot: (request) => { if (request.config.workspaceId !== workspaceId) throw new ToolAdapterError('TOOL_INPUT_INVALID'); return workspaceRoot; },
    createIntent: (request) => createIntent(request),
    createSandboxRequest: (request) => createSandboxRequest(request.config, settings),
    approvalDetails: () => ({ sandboxProvider: settings.provider, sandboxImageDigest: settings.imageDigest, network: config.sandbox.mode === 'external-sandbox' ? config.sandbox.network : 'restricted' }),
  });
}

function createIntent(request: ToolRuntimeRequest): ToolIntent {
  const config = request.config;
  const networkAccess = 'network' in config.sandbox ? config.sandbox.network : 'restricted';
  return {
    workspaceId: config.workspaceId,
    toolId: request.descriptor.id,
    toolVersion: request.descriptor.version,
    risk: request.descriptor.risk,
    taskTrust: config.taskTrust,
    sandboxMode: config.sandbox.mode,
    ...(config.sandbox.mode === 'external-sandbox' ? { sandboxProvider: config.sandbox.provider } : {}),
    networkAccess,
    approvalPolicy: config.approval,
    policyRevision: 'external-shell-v1',
    sessionId: config.createdBySessionId,
  };
}

function createSandboxRequest(config: RunConfig, settings: { resources: SandboxResourceSettings }): SandboxResolveRequest {
  return { taskTrust: config.taskTrust, policy: config.sandbox, resources: { maxMemoryBytes: settings.resources.maxMemoryBytes, maxCpuMillis: settings.resources.maxCpuMillis } };
}

class SandboxShellProcessRunner implements ProcessRunner {
  constructor(private readonly workspaceRoot: string, private readonly settings: { provider: ExternalSandboxProvider; imageDigest: string; network: SandboxNetwork; resources: SandboxResourceSettings }, private readonly config: RunConfig, private readonly runner: SandboxProcessRunner) {}

  async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    const workdir = relative(this.workspaceRoot, request.cwd);
    if (workdir.startsWith('..') || workdir.includes(`..${sep}`)) throw new ToolAdapterError('PATH_GUARD');
    const sandbox = this.config.sandbox;
    if (sandbox.mode !== 'external-sandbox') throw new ToolAdapterError('SANDBOX_REQUEST_MISMATCH');
    const writableRoots = await this.resolveWritableRoots(sandbox.writableRoots ?? []);
    let result: SandboxExecutionResult;
    try {
      result = await new ExternalSandboxExecutor(this.runner).execute({
        runtime: this.settings.provider,
        image: this.settings.imageDigest,
        workspaceRoot: this.workspaceRoot,
        ...(workdir ? { workdir } : {}),
        ...(writableRoots.length > 0 ? { writableRoots } : {}),
        network: sandbox.network,
        command: request.argv,
        env: request.env,
        envAllowlist: Object.keys(request.env),
        limits: {
          maxMemoryBytes: this.settings.resources.maxMemoryBytes,
          maxCpuMillis: this.settings.resources.maxCpuMillis,
          maxPids: this.settings.resources.maxPids,
          timeoutMs: Math.min(request.timeoutMs, this.settings.resources.timeoutMs),
          maxOutputBytes: Math.min(request.maxOutputBytes, this.settings.resources.maxOutputBytes),
        },
      }, request.signal);
    } catch (error) {
      if (error instanceof SandboxRuntimeError) throw new ToolAdapterError('TOOL_EXECUTION_UNAVAILABLE');
      throw error;
    }
    return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated };
  }

  private async resolveWritableRoots(values: readonly string[]): Promise<string[]> {
    const guard = new PathGuard(this.workspaceRoot);
    const roots: string[] = [];
    for (const value of values) roots.push(value === '.' ? this.workspaceRoot : await guard.resolve(value));
    return roots;
  }
}

function normalizeSettings(input: SandboxSettingsInput): { provider: ExternalSandboxProvider; imageDigest: string; network: SandboxNetwork; resources: SandboxResourceSettings; enabled: boolean } {
  if (input.provider !== 'docker' && input.provider !== 'podman') throw new SandboxSettingsError('INVALID_PROVIDER', 'Only Docker and Podman are supported.');
  if (typeof input.imageDigest !== 'string' || !DIGEST_IMAGE.test(input.imageDigest)) throw new SandboxSettingsError('INVALID_IMAGE', 'An immutable sha256 image digest is required.');
  if (input.network !== 'restricted' && input.network !== 'enabled') throw new SandboxSettingsError('INVALID_NETWORK', 'Sandbox network mode is invalid.');
  const resources: SandboxResourceSettings = { ...DEFAULT_RESOURCES };
  for (const key of Object.keys(resources) as Array<keyof SandboxResourceSettings>) {
    const value = input.resources[key];
    if (value !== undefined) resources[key] = value;
    if (!Number.isSafeInteger(resources[key]) || resources[key] <= 0 || resources[key] > RESOURCE_CEILINGS[key]) throw new SandboxSettingsError('INVALID_RESOURCES', 'Sandbox resource limits exceed the safe ceiling.');
  }
  return { provider: input.provider, imageDigest: input.imageDigest, network: input.network, resources, enabled: input.enabled === true };
}

function minimalEnvironment(baseEnv: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (baseEnv.PATH !== undefined) env.PATH = baseEnv.PATH;
  if (baseEnv.SystemRoot !== undefined) env.SystemRoot = baseEnv.SystemRoot;
  return env;
}
