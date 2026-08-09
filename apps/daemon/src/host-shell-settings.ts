import type { RunConfig } from '@ready4vibe/contracts';
import type { ToolRuntime, ToolRuntimeRequest, AgentToolDescriptor } from '@ready4vibe/agent';
import { PathGuard } from '@ready4vibe/execution';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import { SandboxResolver, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import {
  HOST_PROCESS_LIMITS,
  HostRestrictedProcessRunner,
  probeHostShell,
  type HostShellProbe,
} from '@ready4vibe/sandbox-runtime';
import {
  HostShellToolAdapter,
  ToolAdapterError,
  ToolExecutor,
  ToolExecutorRuntime,
  ToolHandlerRegistry,
  type HostShellRunner,
} from '@ready4vibe/tool-adapters';
import { ToolRegistry } from '@ready4vibe/tools';

export type HostShellHealth = 'ready' | 'missing';

export interface HostShellSettingsOptions {
  probe?: HostShellProbe;
  runner?: HostShellRunner;
  resolveRunRoot?: (config?: RunConfig) => string | undefined;
}

/**
 * Owns the probed host shell and exposes a run-scoped `shell.exec` runtime
 * for the `host-restricted` capability shell mode. Registration is mutually
 * exclusive with the external sandbox runtime; the composition root picks at
 * most one per run.
 */
export class InMemoryHostShellSettingsManager {
  private readonly probe: HostShellProbe;
  private readonly runner: HostShellRunner | undefined;
  private readonly resolveRunRoot: ((config?: RunConfig) => string | undefined) | undefined;

  constructor(options: HostShellSettingsOptions = {}) {
    this.probe = options.probe ?? probeHostShell();
    this.runner = options.runner;
    this.resolveRunRoot = options.resolveRunRoot;
  }

  health(): HostShellHealth {
    return this.probe.status === 'ok' && this.probe.shell !== undefined ? 'ready' : 'missing';
  }

  runtimeForRun(config: RunConfig): ToolRuntime | undefined {
    if (this.health() !== 'ready') return undefined;
    if (config.sandbox.mode !== 'workspace-write' && config.sandbox.mode !== 'danger-full-access') return undefined;
    const workspaceRoot = this.resolveRunRoot?.(config);
    if (!workspaceRoot) return undefined;
    return createHostShellRuntime(workspaceRoot, config.workspaceId, this.probe, this.runner);
  }
}

export function createHostShellRuntime(workspaceRoot: string, workspaceId: string, probe: HostShellProbe, runner?: HostShellRunner): ToolRuntime {
  const shell = probe.shell;
  if (probe.status !== 'ok' || shell === undefined) throw new ToolAdapterError('TOOL_EXECUTION_UNAVAILABLE');
  const summary = hostShellSummary(probe);
  const inputSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', minLength: 1, maxLength: 8_000 },
      cwd: { type: 'string' },
      timeoutMs: { type: 'integer', minimum: 1, maximum: HOST_PROCESS_LIMITS.maxTimeoutMs },
      maxOutputBytes: { type: 'integer', minimum: 1, maximum: HOST_PROCESS_LIMITS.maxOutputBytes },
    },
    required: ['command'],
    additionalProperties: false,
  } as const;
  const registry = new ToolRegistry();
  registry.register({
    id: 'shell.exec',
    version: '1.0.0',
    risk: 'destructive',
    summary,
    supportedSandboxModes: ['workspace-write', 'danger-full-access'],
    inputSchema: { ...inputSchema, properties: { ...inputSchema.properties }, required: [...inputSchema.required] },
  });
  const handlers = new ToolHandlerRegistry();
  handlers.register(new HostShellToolAdapter(new PathGuard(workspaceRoot), runner ?? new HostRestrictedProcessRunner(), { shell, args: probe.args }));
  const executor = new ToolExecutor({ registry, approvalPolicy: new ApprovalPolicy(registry), sandboxResolver: new SandboxResolver(), handlers });
  // Explicit descriptors keep the inputSchema visible to the model; registry.list() drops it.
  const descriptors: readonly AgentToolDescriptor[] = [{ name: 'shell.exec', id: 'shell.exec', version: '1.0.0', risk: 'destructive', summary, inputSchema }];
  return new ToolExecutorRuntime({
    registry,
    executor,
    descriptors,
    resolveWorkspaceRoot: (request) => { if (request.config.workspaceId !== workspaceId) throw new ToolAdapterError('TOOL_INPUT_INVALID'); return workspaceRoot; },
    createIntent: (request) => createIntent(request),
    createSandboxRequest: (request) => createSandboxRequest(request.config),
  });
}

/** Tool description shown to the model; it is the only environment documentation the model sees. */
export function hostShellSummary(probe: HostShellProbe): string {
  const windows = probe.platform === 'win32';
  const shell = probe.shell ?? (windows ? 'pwsh' : 'bash');
  const invocation = `${shell} ${probe.args.join(' ')} <command>`;
  const platform = windows ? `${probe.platform} (Windows)` : probe.platform;
  const syntax = windows
    ? 'use PowerShell syntax (e.g. Get-ChildItem instead of ls, $env:VAR for environment variables, ; or && for sequencing)'
    : 'use POSIX shell syntax (e.g. ls and grep, $VAR for environment variables, | for pipes, && or ; for sequencing, > for redirection)';
  return `Run a shell command on the host machine. Platform: ${platform}. The command is executed via: ${invocation} — ${syntax}. Working directory is the current workspace/session folder and must stay inside it; prefer relative paths. Output is truncated at ${HOST_PROCESS_LIMITS.defaultMaxOutputBytes} bytes; default timeout ${HOST_PROCESS_LIMITS.defaultTimeoutMs} ms (max ${HOST_PROCESS_LIMITS.maxTimeoutMs} ms). Use this for builds, tests, package managers, git operations, and inspecting the project. Potentially destructive commands require explicit user approval before they run.`;
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
    networkAccess,
    approvalPolicy: config.approval,
    policyRevision: 'host-shell-v1',
    sessionId: config.createdBySessionId,
  };
}

function createSandboxRequest(config: RunConfig): SandboxResolveRequest {
  return { taskTrust: config.taskTrust, policy: config.sandbox };
}
