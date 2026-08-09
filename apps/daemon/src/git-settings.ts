import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { RunConfig } from '@ready4vibe/contracts';
import type { ToolRuntime, ToolRuntimeRequest } from '@ready4vibe/agent';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import { SandboxResolver, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import {
  GitToolAdapter,
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

export interface GitSettingsStatus {
  readonly enabled: boolean;
  readonly workspaceLabel: string;
  readonly availableTools: readonly string[];
}

export interface GitSettingsManager {
  status(): GitSettingsStatus;
  setGitEnabled(enabled: boolean): GitSettingsStatus;
  runtimeForRun(config?: RunConfig): ToolRuntime | undefined;
}

export interface GitSettingsOptions {
  readonly workspaceRegistry?: WorkspaceRegistry;
  readonly processRunner?: ProcessRunner;
  readonly resolveRunRoot?: (config?: RunConfig) => string | undefined;
}

export interface GitProcessRunnerOptions {
  readonly spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
}

/**
 * Process-memory Git settings. The setting is intentionally opt-in and only
 * creates a runtime for trusted host workspaces; untrusted runs must use the
 * external sandbox and therefore never receive host Git descriptors.
 */
export class InMemoryGitSettingsManager implements GitSettingsManager {
  private readonly workspaceRegistry: WorkspaceRegistry;
  private readonly processRunner: ProcessRunner;
  private readonly resolveRunRoot: ((config?: RunConfig) => string | undefined) | undefined;
  private enabled = false;

  constructor(options: GitSettingsOptions = {}) {
    this.workspaceRegistry = options.workspaceRegistry ?? new InMemoryWorkspaceRegistry({ defaultRoot: process.cwd() });
    this.processRunner = options.processRunner ?? new ChildProcessGitRunner();
    this.resolveRunRoot = options.resolveRunRoot;
  }

  status(): GitSettingsStatus {
    const defaultWorkspace = this.workspaceRegistry.status().workspaces.find((workspace) => workspace.id === 'default');
    return {
      enabled: this.enabled,
      workspaceLabel: defaultWorkspace?.label ?? 'workspace',
      availableTools: this.enabled ? gitDescriptors().map((descriptor) => `${descriptor.id}@${descriptor.version}`) : [],
    };
  }

  setGitEnabled(enabled: boolean): GitSettingsStatus {
    if (typeof enabled !== 'boolean') throw new GitSettingsError();
    this.enabled = enabled;
    return this.status();
  }

  runtimeForRun(config?: RunConfig): ToolRuntime | undefined {
    if (!this.enabled || !config || config.taskTrust !== 'trusted-workspace') return undefined;
    if (config.sandbox.mode !== 'read-only' && config.sandbox.mode !== 'workspace-write') return undefined;
    const workspaceRoot = this.resolveRunRoot?.(config) ?? this.workspaceRegistry.resolveRoot(config.workspaceId);
    if (!workspaceRoot) return undefined;
    return createGitRuntime(workspaceRoot, config.workspaceId, this.processRunner);
  }
}

export class GitSettingsError extends Error {
  readonly code = 'INVALID_GIT_SETTINGS';

  constructor() {
    super('Git settings are invalid.');
    this.name = 'GitSettingsError';
  }
}

/** Executes a fixed `git` executable with bounded output and no shell. */
export class ChildProcessGitRunner implements ProcessRunner {
  private readonly spawn: NonNullable<GitProcessRunnerOptions['spawn']>;
  private readonly baseEnv: Readonly<Record<string, string | undefined>>;

  constructor(options: GitProcessRunnerOptions = {}) {
    this.spawn = options.spawn ?? ((command, args, spawnOptions) => defaultSpawn(command, args, spawnOptions));
    this.baseEnv = options.baseEnv ?? process.env;
  }

  run(request: ProcessRunRequest): Promise<ProcessRunResult> {
    if (request.shell !== false) return Promise.reject(new ToolAdapterError('ARGV_GUARD'));
    if (request.signal.aborted) return Promise.resolve({ exitCode: -1, stdout: '', stderr: '', truncated: false });
    const env = this.minimalEnv(request.env);
    return new Promise((resolveResult, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawn('git', [...request.argv], {
          shell: false,
          windowsHide: true,
          cwd: request.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        });
      } catch {
        reject(new ToolAdapterError('TOOL_EXECUTION_UNAVAILABLE'));
        return;
      }

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let truncated = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const terminate = (): void => {
        if (settled) return;
        try { child.kill('SIGKILL'); } catch { /* best effort */ }
      };
      const append = (target: Buffer[], value: unknown): void => {
        if (settled) return;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
        const remaining = request.maxOutputBytes - outputBytes;
        if (remaining <= 0) {
          truncated = true;
          terminate();
          return;
        }
        if (chunk.byteLength > remaining) {
          target.push(chunk.subarray(0, remaining));
          outputBytes += remaining;
          truncated = true;
          terminate();
          return;
        }
        target.push(chunk);
        outputBytes += chunk.byteLength;
      };
      const settle = (exitCode: number | null): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
        resolveResult({ exitCode: exitCode ?? -1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), truncated });
      };
      const onAbort = (): void => { if (!settled) terminate(); };

      child.stdout?.on('data', (chunk: Buffer | string) => append(stdout, chunk));
      child.stderr?.on('data', (chunk: Buffer | string) => append(stderr, chunk));
      child.once('error', () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
        reject(new ToolAdapterError('TOOL_EXECUTION_UNAVAILABLE'));
      });
      child.once('close', (exitCode: number | null) => settle(exitCode));
      request.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => { if (!settled) { truncated = true; terminate(); } }, request.timeoutMs);
    });
  }

  private minimalEnv(requestEnv: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    if (this.baseEnv.PATH !== undefined) env.PATH = this.baseEnv.PATH;
    if (this.baseEnv.SystemRoot !== undefined) env.SystemRoot = this.baseEnv.SystemRoot;
    for (const [key, value] of Object.entries(requestEnv)) env[key] = value;
    return env;
  }
}

function createGitRuntime(workspaceRoot: string, workspaceId: string, processRunner: ProcessRunner): ToolExecutorRuntime {
  const registry = new ToolRegistry();
  for (const descriptor of gitDescriptors()) registry.register(descriptor);
  const handlers = new ToolHandlerRegistry();
  for (const descriptor of gitDescriptors()) handlers.register(new GitToolAdapter(descriptor.id, processRunner));
  const executor = new ToolExecutor({ registry, approvalPolicy: new ApprovalPolicy(registry), sandboxResolver: new SandboxResolver(), handlers });
  return new ToolExecutorRuntime({
    registry,
    executor,
    resolveWorkspaceRoot: (request) => {
      if (request.config.workspaceId !== workspaceId) throw new ToolAdapterError('TOOL_INPUT_INVALID');
      return workspaceRoot;
    },
    createIntent: (request) => createIntent(request),
    createSandboxRequest: (request) => createSandboxRequest(request.config),
  });
}

function gitDescriptors() {
  return [
    { id: 'git.status' as const, version: '1.0.0', risk: 'read' as const, summary: 'Show bounded working-tree status without changing files.', supportedSandboxModes: ['read-only', 'workspace-write'] as const, inputSchema: { type: 'object', properties: { timeoutMs: { type: 'integer', minimum: 1 }, maxOutputBytes: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
    { id: 'git.diff' as const, version: '1.0.0', risk: 'read' as const, summary: 'Show a bounded read-only diff for the selected workspace.', supportedSandboxModes: ['read-only', 'workspace-write'] as const, inputSchema: { type: 'object', properties: { staged: { type: 'boolean' }, timeoutMs: { type: 'integer', minimum: 1 }, maxOutputBytes: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
    { id: 'git.log' as const, version: '1.0.0', risk: 'read' as const, summary: 'Show a bounded recent commit log without remote access.', supportedSandboxModes: ['read-only', 'workspace-write'] as const, inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, timeoutMs: { type: 'integer', minimum: 1 }, maxOutputBytes: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
  ] as const;
}

function createIntent(request: ToolRuntimeRequest): ToolIntent {
  const networkAccess = 'network' in request.config.sandbox ? request.config.sandbox.network : 'restricted';
  return {
    workspaceId: request.config.workspaceId,
    toolId: request.descriptor.id,
    toolVersion: request.descriptor.version,
    risk: request.descriptor.risk,
    taskTrust: request.config.taskTrust,
    sandboxMode: request.config.sandbox.mode,
    networkAccess,
    approvalPolicy: request.config.approval,
    policyRevision: 'git-read-only-v1',
    sessionId: request.config.createdBySessionId,
  };
}

function createSandboxRequest(config: RunConfig): SandboxResolveRequest {
  return { taskTrust: config.taskTrust, policy: config.sandbox };
}
