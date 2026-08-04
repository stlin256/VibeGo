import { readFile as defaultReadFile, stat as defaultStat, writeFile as defaultWriteFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ToolRuntime, ToolRuntimeRequest } from '@ready4vibe/agent';
import type { RunConfig } from '@ready4vibe/contracts';
import { PathGuard } from '@ready4vibe/execution';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import { SandboxResolver, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import {
  FileSystemToolAdapter,
  FileSystemWriteToolAdapter,
  ToolAdapterError,
  ToolExecutor,
  ToolExecutorRuntime,
  ToolHandlerRegistry,
  type FileSystemAdapterFileSystem,
} from '@ready4vibe/tool-adapters';
import { ToolRegistry } from '@ready4vibe/tools';
import { InMemoryWorkspaceRegistry, type WorkspaceRegistry } from '@ready4vibe/workspaces';

export interface ToolSettingsStatus {
  filesystemEnabled: boolean;
  workspaceLabel: string;
  availableTools: readonly string[];
}

export interface ToolSettingsManager {
  status(): ToolSettingsStatus;
  setFilesystemEnabled(enabled: boolean): ToolSettingsStatus;
  runtimeForRun(config?: RunConfig): ToolRuntime | undefined;
}

export class InMemoryToolSettingsManager implements ToolSettingsManager {
  private enabled = false;
  private readonly workspaceRegistry: WorkspaceRegistry;

  constructor(workspaceRootOrRegistry: string | WorkspaceRegistry = process.cwd()) {
    this.workspaceRegistry = typeof workspaceRootOrRegistry === 'string'
      ? new InMemoryWorkspaceRegistry({ defaultRoot: resolve(workspaceRootOrRegistry) })
      : workspaceRootOrRegistry;
  }

  status(): ToolSettingsStatus {
    const defaultWorkspace = this.workspaceRegistry.status().workspaces.find((workspace) => workspace.id === 'default');
    return {
      filesystemEnabled: this.enabled,
      workspaceLabel: defaultWorkspace?.label ?? 'workspace',
      availableTools: this.enabled ? ['filesystem.read@1.0.0', 'filesystem.write@1.0.0'] : [],
    };
  }

  setFilesystemEnabled(enabled: boolean): ToolSettingsStatus {
    if (typeof enabled !== 'boolean') throw new ToolSettingsError();
    this.enabled = enabled;
    return this.status();
  }

  runtimeForRun(config?: RunConfig): ToolRuntime | undefined {
    if (!this.enabled) return undefined;
    const workspaceRoot = this.workspaceRegistry.resolveRoot(config?.workspaceId ?? 'default');
    return workspaceRoot ? createFilesystemRuntime(workspaceRoot, config?.workspaceId ?? 'default') : undefined;
  }
}

/** Combines independently gated runtimes without exposing a shared mutable registry. */
export function composeToolRuntimes(runtimes: readonly (ToolRuntime | undefined)[]): ToolRuntime | undefined {
  const available = runtimes.filter((runtime): runtime is ToolRuntime => runtime !== undefined);
  if (available.length === 0) return undefined;
  if (available.length === 1) return available[0];
  const byName = new Map<string, ToolRuntime>();
  const descriptors = available.flatMap((runtime) => runtime.descriptors);
  for (const runtime of available) {
    for (const descriptor of runtime.descriptors) {
      if (byName.has(descriptor.name)) throw new ToolSettingsError();
      byName.set(descriptor.name, runtime);
    }
  }
  const composed: ToolRuntime = {
    descriptors: Object.freeze([...descriptors]),
    execute: async (request) => {
      const runtime = byName.get(request.descriptor.name);
      if (!runtime) throw new ToolSettingsError();
      return runtime.execute(request);
    },
    approve: async (request, ttlMs) => {
      const runtime = byName.get(request.descriptor.name);
      if (!runtime?.approve) throw new ToolSettingsError();
      return runtime.approve(request, ttlMs);
    },
    approvalDetails: (request) => byName.get(request.descriptor.name)?.approvalDetails?.(request),
  };
  const disposables = available
    .map((runtime) => (runtime as ToolRuntime & { dispose?: () => Promise<void> | void }).dispose)
    .filter((dispose): dispose is () => Promise<void> | void => typeof dispose === 'function');
  if (disposables.length === 0) return composed;
  return Object.assign(composed, {
    dispose: async (): Promise<void> => {
      await Promise.all(disposables.map((dispose) => Promise.resolve().then(() => dispose()).catch(() => undefined)));
    },
  });
}

export class ToolSettingsError extends Error {
  readonly code = 'INVALID_TOOL_SETTINGS';

  constructor() {
    super('Filesystem tool settings are invalid.');
    this.name = 'ToolSettingsError';
  }
}

function createFilesystemRuntime(workspaceRoot: string, workspaceId: string): ToolExecutorRuntime {
  const registry = new ToolRegistry();
  registry.register({
    id: 'filesystem.read',
    version: '1.0.0',
    risk: 'read',
    summary: 'Read a bounded UTF-8 file inside the workspace.',
    supportedSandboxModes: ['read-only', 'workspace-write'],
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
  });
  registry.register({
    id: 'filesystem.write',
    version: '1.0.0',
    risk: 'write',
    summary: 'Write bounded UTF-8 content inside the workspace after approval.',
    supportedSandboxModes: ['workspace-write', 'external-sandbox'],
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, maxBytes: { type: 'integer', minimum: 1 } }, required: ['path', 'content'], additionalProperties: false },
  });

  const pathGuard = new PathGuard(workspaceRoot);
  const fileSystem: FileSystemAdapterFileSystem = {
    stat: async (path) => defaultStat(path),
    readFile: async (path) => new Uint8Array(await defaultReadFile(path)),
    writeFile: async (path, content) => { await defaultWriteFile(path, content); },
  };
  const handlers = new ToolHandlerRegistry();
  handlers.register(new FileSystemToolAdapter(pathGuard, fileSystem));
  handlers.register(new FileSystemWriteToolAdapter(pathGuard, fileSystem));
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

function createIntent(request: ToolRuntimeRequest): ToolIntent {
  const input = request.input;
  const path = typeof input === 'object' && input !== null && 'path' in input && typeof input.path === 'string' ? input.path : undefined;
  const networkAccess = 'network' in request.config.sandbox ? request.config.sandbox.network : 'restricted';
  return {
    workspaceId: request.config.workspaceId,
    toolId: request.descriptor.id,
    toolVersion: request.descriptor.version,
    risk: request.descriptor.risk,
    ...(path ? { path } : {}),
    taskTrust: request.config.taskTrust,
    sandboxMode: request.config.sandbox.mode,
    networkAccess,
    approvalPolicy: request.config.approval,
    policyRevision: 'filesystem-v1',
    sessionId: request.config.createdBySessionId,
  };
}

function createSandboxRequest(config: RunConfig): SandboxResolveRequest {
  return { taskTrust: config.taskTrust, policy: config.sandbox };
}
