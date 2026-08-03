import { readFile as defaultReadFile, stat as defaultStat, writeFile as defaultWriteFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
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

export interface ToolSettingsStatus {
  filesystemEnabled: boolean;
  workspaceLabel: string;
  availableTools: readonly string[];
}

export interface ToolSettingsManager {
  status(): ToolSettingsStatus;
  setFilesystemEnabled(enabled: boolean): ToolSettingsStatus;
  runtimeForRun(): ToolRuntime | undefined;
}

export class InMemoryToolSettingsManager implements ToolSettingsManager {
  private enabled = false;
  private readonly runtime: ToolExecutorRuntime;
  private readonly workspaceRoot: string;
  private readonly workspaceLabel: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = resolve(workspaceRoot);
    const label = basename(this.workspaceRoot);
    this.workspaceLabel = label || 'workspace';
    this.runtime = createFilesystemRuntime(this.workspaceRoot);
  }

  status(): ToolSettingsStatus {
    return {
      filesystemEnabled: this.enabled,
      workspaceLabel: this.workspaceLabel,
      availableTools: this.enabled ? this.runtime.descriptors.map((descriptor) => `${descriptor.id}@${descriptor.version}`) : [],
    };
  }

  setFilesystemEnabled(enabled: boolean): ToolSettingsStatus {
    if (typeof enabled !== 'boolean') throw new ToolSettingsError();
    this.enabled = enabled;
    return this.status();
  }

  runtimeForRun(): ToolRuntime | undefined {
    return this.enabled ? this.runtime : undefined;
  }
}

export class ToolSettingsError extends Error {
  readonly code = 'INVALID_TOOL_SETTINGS';

  constructor() {
    super('Filesystem tool settings are invalid.');
    this.name = 'ToolSettingsError';
  }
}

function createFilesystemRuntime(workspaceRoot: string): ToolExecutorRuntime {
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
      if (request.config.workspaceId !== 'default') throw new ToolAdapterError('TOOL_INPUT_INVALID');
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
