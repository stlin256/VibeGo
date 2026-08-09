import type { AgentToolDescriptor, ToolRuntime, ToolRuntimeRequest, ToolRuntimeResult } from '@ready4vibe/agent';
import type { SandboxPolicy } from '@ready4vibe/contracts';
import { McpExecutionError, McpExecutionLedger, type McpCapabilityDescriptor, type McpCapabilitySnapshot, type McpToolCallPort } from '@ready4vibe/skill-mcp';
import {
  ArgvGuard,
  ArgvGuardError,
  PathGuard,
  PathGuardError,
  type ValidatedArgv,
  validateExecutionLimits,
} from '@ready4vibe/execution';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
import type { ApprovalDetails } from '@ready4vibe/agent';
import { SandboxResolver, SandboxUnavailableError, type ResolvedSandbox, type SandboxResolveRequest } from '@ready4vibe/sandbox';
import { ToolRegistry, type ToolSandboxMode } from '@ready4vibe/tools';

export type ToolAdapterErrorCode =
  | 'TOOL_INPUT_INVALID'
  | 'TOOL_FORBIDDEN'
  | 'APPROVAL_REQUIRED'
  | 'SANDBOX_REQUEST_MISMATCH'
  | 'TOOL_HANDLER_UNAVAILABLE'
  | 'TOOL_EXECUTION_UNAVAILABLE'
  | 'FILE_TOO_LARGE'
  | 'TARGET_NOT_FILE'
  | 'TARGET_UNAVAILABLE'
  | 'PARENT_UNAVAILABLE'
  | 'TOOL_FAILED'
  | 'PATH_GUARD'
  | 'ARGV_GUARD';

export class ToolAdapterError extends Error {
  constructor(readonly code: ToolAdapterErrorCode, message = 'The tool request was rejected.') {
    super(message);
    this.name = 'ToolAdapterError';
  }
}

export interface ToolExecutionRequest {
  workspaceRoot: string;
  intent: ToolIntent;
  sandbox: SandboxResolveRequest;
  input: unknown;
  metadata?: ToolExecutionMetadata;
}

export interface ToolExecutionMetadata {
  readonly runId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly descriptorRevision: string;
}

export interface ToolHandlerContext {
  readonly workspaceRoot: string;
  readonly intent: ToolIntent;
  readonly sandbox: ResolvedSandbox;
  readonly signal: AbortSignal;
  readonly metadata?: ToolExecutionMetadata;
}

export interface ToolHandler {
  readonly id: string;
  readonly version: string;
  execute(input: unknown, context: ToolHandlerContext): Promise<unknown>;
}

export class ToolHandlerRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    if (!handler.id || !handler.version) throw new Error('tool handler id and version are required');
    const key = this.key(handler.id, handler.version);
    if (this.handlers.has(key)) throw new Error(`tool handler already registered: ${handler.id}@${handler.version}`);
    this.handlers.set(key, handler);
  }

  get(id: string, version: string): ToolHandler | undefined {
    return this.handlers.get(this.key(id, version));
  }

  private key(id: string, version: string): string {
    return `${id}\u0000${version}`;
  }
}

export interface ToolExecutorOptions {
  registry: ToolRegistry;
  approvalPolicy: ApprovalPolicy;
  sandboxResolver: SandboxResolver;
  handlers: ToolHandlerRegistry;
}

export class ToolExecutor {
  constructor(private readonly options: ToolExecutorOptions) {}

  approve(request: ToolExecutionRequest, ttlMs: number): void {
    const descriptor = this.options.registry.get(request.intent.toolId, request.intent.toolVersion);
    if (!descriptor || descriptor.risk !== request.intent.risk) throw new ToolAdapterError('TOOL_FORBIDDEN', 'The requested tool is not available.');
    const evaluation = this.options.approvalPolicy.approve(request.intent, ttlMs);
    if (evaluation.decision !== 'allow') throw new ToolAdapterError('APPROVAL_REQUIRED', 'User approval is required for this tool.');
  }

  async execute(request: ToolExecutionRequest, signal?: AbortSignal): Promise<unknown> {
    const descriptor = this.options.registry.get(request.intent.toolId, request.intent.toolVersion);
    if (!descriptor) throw new ToolAdapterError('TOOL_FORBIDDEN', 'The requested tool is not available.');
    const evaluation = this.options.approvalPolicy.evaluate(request.intent);
    if (evaluation.decision === 'prompt') throw new ToolAdapterError('APPROVAL_REQUIRED', 'User approval is required for this tool.');
    if (evaluation.decision === 'forbidden') throw new ToolAdapterError('TOOL_FORBIDDEN', 'The tool request is forbidden.');
    this.assertSandboxRequestMatchesIntent(request.intent, request.sandbox);

    let sandbox: ResolvedSandbox;
    try {
      sandbox = await this.options.sandboxResolver.resolve(request.sandbox, signal);
    } catch (error) {
      if (error instanceof SandboxUnavailableError) throw error;
      throw new SandboxUnavailableError('provider-unhealthy');
    }

    const handler = this.options.handlers.get(request.intent.toolId, request.intent.toolVersion);
    if (!handler) throw new ToolAdapterError('TOOL_HANDLER_UNAVAILABLE', 'The tool implementation is unavailable.');
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      return await handler.execute(request.input, {
        workspaceRoot: request.workspaceRoot,
        intent: request.intent,
        sandbox,
        signal: controller.signal,
        ...(request.metadata ? { metadata: request.metadata } : {}),
      });
    } catch (error) {
      if (error instanceof SandboxUnavailableError || error instanceof ToolAdapterError) throw error;
      if (error instanceof McpExecutionError) throw error;
      throw new ToolAdapterError('TOOL_FAILED');
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private assertSandboxRequestMatchesIntent(intent: ToolIntent, sandbox: SandboxResolveRequest): void {
    if (sandbox.taskTrust !== intent.taskTrust || sandbox.policy.mode !== intent.sandboxMode) {
      throw new ToolAdapterError('SANDBOX_REQUEST_MISMATCH');
    }
    if ('network' in sandbox.policy && sandbox.policy.network !== intent.networkAccess) {
      throw new ToolAdapterError('SANDBOX_REQUEST_MISMATCH');
    }
  }
}

export interface ToolExecutorRuntimeOptions {
  readonly registry: ToolRegistry;
  readonly executor: ToolExecutor;
  readonly descriptors?: readonly AgentToolDescriptor[];
  readonly resolveWorkspaceRoot: (request: ToolRuntimeRequest) => string;
  readonly createIntent: (request: ToolRuntimeRequest) => ToolIntent;
  readonly createSandboxRequest: (request: ToolRuntimeRequest) => SandboxResolveRequest;
  readonly approvalDetails?: (request: ToolRuntimeRequest) => ApprovalDetails | undefined;
}

/**
 * Explicit bridge from the agent package to the policy/sandbox/handler
 * executor. It intentionally has no default workspace, intent, or sandbox
 * resolver, so callers cannot accidentally bypass approval boundaries.
 */
export class ToolExecutorRuntime implements ToolRuntime {
  readonly descriptors: readonly AgentToolDescriptor[];
  private readonly byName = new Map<string, AgentToolDescriptor>();

  constructor(private readonly options: ToolExecutorRuntimeOptions) {
    const descriptors: readonly AgentToolDescriptor[] = options.descriptors ?? options.registry.list().map((descriptor): AgentToolDescriptor => ({
      name: descriptor.id,
      id: descriptor.id,
      version: descriptor.version,
      risk: descriptor.risk,
      summary: descriptor.summary,
    }));
    for (const descriptor of descriptors) {
      const registered = options.registry.get(descriptor.id, descriptor.version);
      if (!registered || registered.risk !== descriptor.risk) throw new ToolAdapterError('TOOL_FORBIDDEN');
      if (!descriptor.name || this.byName.has(descriptor.name)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
      const safeDescriptor: AgentToolDescriptor = Object.freeze({
        ...descriptor,
        ...(descriptor.inputSchema === undefined ? {} : { inputSchema: Object.freeze({ ...descriptor.inputSchema }) }),
      });
      this.byName.set(safeDescriptor.name, safeDescriptor);
    }
    this.descriptors = Object.freeze([...this.byName.values()]);
  }

  async execute(request: ToolRuntimeRequest): Promise<ToolRuntimeResult> {
    const descriptor = this.byName.get(request.descriptor.name);
    if (!descriptor || descriptor.id !== request.descriptor.id || descriptor.version !== request.descriptor.version) {
      throw new ToolAdapterError('TOOL_FORBIDDEN');
    }
    const workspaceRoot = this.options.resolveWorkspaceRoot(request);
    if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const output = await this.options.executor.execute({
      workspaceRoot,
      intent: this.options.createIntent({ ...request, descriptor }),
      sandbox: this.options.createSandboxRequest({ ...request, descriptor }),
      input: request.input,
      metadata: {
        runId: request.runId,
        turnId: request.turnId,
        callId: request.callId,
        descriptorRevision: descriptor.version,
      },
    }, request.signal);
    return { output };
  }

  async approve(request: ToolRuntimeRequest, ttlMs: number): Promise<void> {
    const descriptor = this.byName.get(request.descriptor.name);
    if (!descriptor || descriptor.id !== request.descriptor.id || descriptor.version !== request.descriptor.version) {
      throw new ToolAdapterError('TOOL_FORBIDDEN');
    }
    const workspaceRoot = this.options.resolveWorkspaceRoot(request);
    if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    this.options.executor.approve({
      workspaceRoot,
      intent: this.options.createIntent({ ...request, descriptor }),
      sandbox: this.options.createSandboxRequest({ ...request, descriptor }),
      input: request.input,
    }, ttlMs);
  }

  approvalDetails(request: ToolRuntimeRequest): ApprovalDetails | undefined {
    return this.options.approvalDetails?.(request);
  }
}

export interface McpToolExecutorRuntimeOptions {
  readonly snapshot: McpCapabilitySnapshot;
  readonly callPort: McpToolCallPort;
  readonly resolveWorkspaceRoot: (request: ToolRuntimeRequest) => string;
  readonly sandboxResolver?: SandboxResolver;
  readonly ledger?: McpExecutionLedger;
  readonly approvalDetails?: (request: ToolRuntimeRequest) => ApprovalDetails | undefined;
}

/**
 * Run-scoped MCP binding. It projects a verified capability snapshot into the
 * existing ToolExecutor boundary; it never owns policy, sandbox or scheduling
 * decisions and it cannot execute resources/prompts.
 */
export class McpToolExecutorRuntime implements ToolRuntime {
  readonly descriptors: readonly AgentToolDescriptor[];
  private readonly runtime: ToolExecutorRuntime;

  constructor(options: McpToolExecutorRuntimeOptions) {
    if (options.snapshot.health !== 'healthy-verified') throw new ToolAdapterError('TOOL_FORBIDDEN');
    const executable = options.snapshot.capabilities.filter((descriptor) => descriptor.kind === 'tool' && descriptor.executable === true);
    if (executable.length === 0) throw new ToolAdapterError('TOOL_FORBIDDEN');

    const registry = new ToolRegistry();
    const handlers = new ToolHandlerRegistry();
    const originals = new Map<string, McpCapabilityDescriptor>();
    const projected: AgentToolDescriptor[] = [];
    const ledger = options.ledger ?? new McpExecutionLedger();
    for (const descriptor of executable) {
      const id = descriptor.qualifiedName;
      if (originals.has(id)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
      const sandboxMode = mcpSandboxMode(descriptor);
      registry.register({
        id,
        version: descriptor.revision,
        risk: descriptor.risk,
        summary: descriptor.summary,
        supportedSandboxModes: [sandboxMode],
        ...(descriptor.inputSchema === undefined ? {} : { inputSchema: { ...descriptor.inputSchema } }),
      });
      originals.set(id, descriptor);
      handlers.register(new McpToolHandler(descriptor, options.callPort, ledger));
      projected.push({
        name: id,
        id,
        version: descriptor.revision,
        risk: descriptor.risk,
        summary: descriptor.summary,
        ...(descriptor.inputSchema === undefined ? {} : { inputSchema: { ...descriptor.inputSchema } }),
      });
    }
    this.descriptors = Object.freeze(projected);
    const executor = new ToolExecutor({
      registry,
      approvalPolicy: new ApprovalPolicy(registry),
      sandboxResolver: options.sandboxResolver ?? new SandboxResolver(),
      handlers,
    });
    this.runtime = new ToolExecutorRuntime({
      registry,
      executor,
      descriptors: this.descriptors,
      resolveWorkspaceRoot: options.resolveWorkspaceRoot,
      createIntent: (request) => {
        const original = originals.get(request.descriptor.id);
        if (!original) throw new ToolAdapterError('TOOL_FORBIDDEN');
        const sandboxMode = mcpSandboxMode(original);
        const networkAccess = original.networkAccess === 'enabled' ? 'enabled' : sandboxNetwork(request.config.sandbox);
        return {
          workspaceId: request.config.workspaceId,
          toolId: request.descriptor.id,
          toolVersion: request.descriptor.version,
          risk: request.descriptor.risk,
          taskTrust: request.config.taskTrust,
          sandboxMode,
          ...(sandboxMode === 'external-sandbox' && request.config.sandbox.mode === 'external-sandbox' ? { sandboxProvider: request.config.sandbox.provider } : {}),
          networkAccess,
          approvalPolicy: request.config.approval,
          policyRevision: `mcp-${options.snapshot.fingerprint}`,
          sessionId: request.config.createdBySessionId,
        };
      },
      createSandboxRequest: (request) => ({ taskTrust: request.config.taskTrust, policy: request.config.sandbox }),
      ...(options.approvalDetails ? { approvalDetails: options.approvalDetails } : {}),
    });
  }

  execute(request: ToolRuntimeRequest): Promise<ToolRuntimeResult> {
    return this.runtime.execute(request);
  }

  approve(request: ToolRuntimeRequest, ttlMs: number): Promise<void> {
    if (!this.runtime.approve) return Promise.reject(new ToolAdapterError('APPROVAL_REQUIRED'));
    return this.runtime.approve(request, ttlMs);
  }

  approvalDetails(request: ToolRuntimeRequest): ApprovalDetails | undefined {
    return this.runtime.approvalDetails(request);
  }
}

class McpToolHandler implements ToolHandler {
  readonly id: string;
  readonly version: string;

  constructor(
    private readonly descriptor: McpCapabilityDescriptor,
    private readonly callPort: McpToolCallPort,
    private readonly ledger: McpExecutionLedger,
  ) {
    this.id = descriptor.qualifiedName;
    this.version = descriptor.revision;
  }

  async execute(input: unknown, context: ToolHandlerContext): Promise<unknown> {
    const metadata = context.metadata;
    if (!metadata) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const result = await this.ledger.execute({
      runId: metadata.runId,
      turnId: metadata.turnId,
      callId: metadata.callId,
      descriptor: this.descriptor,
      input,
      signal: context.signal,
    }, (request) => this.callPort.call(request));
    return {
      source: 'mcp',
      serverId: this.descriptor.serverId,
      toolId: this.descriptor.id,
      revision: this.descriptor.revision,
      value: result,
    };
  }
}

function mcpSandboxMode(descriptor: McpCapabilityDescriptor): ToolSandboxMode {
  if (descriptor.sandboxMode === 'workspace-read') return 'read-only';
  if (descriptor.sandboxMode === 'workspace-write') return 'workspace-write';
  if (descriptor.sandboxMode === 'external-sandbox') return 'external-sandbox';
  throw new ToolAdapterError('TOOL_FORBIDDEN');
}

function sandboxNetwork(policy: SandboxPolicy): 'restricted' | 'enabled' {
  return 'network' in policy ? policy.network : 'restricted';
}

export interface FileSystemAdapterEntry {
  readonly name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface FileSystemAdapterFileSystem {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  readdir(path: string): Promise<readonly FileSystemAdapterEntry[]>;
}

export interface FileReadInput {
  path: string;
  maxBytes?: number;
}

export interface FileWriteInput {
  path: string;
  content: string;
  maxBytes?: number;
}

export class FileSystemToolAdapter implements ToolHandler {
  readonly id = 'filesystem.read';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileSystem: FileSystemAdapterFileSystem,
    private readonly defaults: { maxReadBytes?: number; maxWriteBytes?: number } = {},
  ) {}

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    if (this.id === 'filesystem.read') return this.read(input);
    throw new ToolAdapterError('TOOL_INPUT_INVALID');
  }

  private async read(input: unknown): Promise<unknown> {
    if (!isRecord(input) || typeof input.path !== 'string') throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const maxBytes = this.byteLimit(input.maxBytes, this.defaults.maxReadBytes ?? 1024 * 1024);
    const safePath = await this.resolvePath(input.path);
    let stats: { size: number; isFile(): boolean };
    try {
      stats = await this.fileSystem.stat(safePath);
    } catch {
      throw new ToolAdapterError('TARGET_UNAVAILABLE');
    }
    if (!stats.isFile()) throw new ToolAdapterError('TARGET_NOT_FILE');
    if (!Number.isSafeInteger(stats.size) || stats.size < 0 || stats.size > maxBytes) {
      throw new ToolAdapterError('FILE_TOO_LARGE');
    }
    let content: Uint8Array;
    try {
      content = await this.fileSystem.readFile(safePath);
    } catch {
      throw new ToolAdapterError('TARGET_UNAVAILABLE');
    }
    if (content.byteLength > maxBytes) throw new ToolAdapterError('FILE_TOO_LARGE');
    return { path: input.path, content: new TextDecoder().decode(content), bytes: content.byteLength };
  }

  private async resolvePath(value: string): Promise<string> {
    try {
      return await this.pathGuard.resolve(value);
    } catch (error) {
      if (error instanceof PathGuardError) throw new ToolAdapterError('PATH_GUARD');
      throw new ToolAdapterError('PATH_GUARD');
    }
  }

  private byteLimit(value: unknown, maximum: number): number {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if (value === undefined) return maximum;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    return value;
  }
}

export class FileSystemWriteToolAdapter implements ToolHandler {
  readonly id = 'filesystem.write';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileSystem: FileSystemAdapterFileSystem,
    private readonly defaults: { maxWriteBytes?: number } = {},
  ) {}

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input) || typeof input.path !== 'string' || typeof input.content !== 'string') {
      throw new ToolAdapterError('TOOL_INPUT_INVALID');
    }
    const maximum = this.defaults.maxWriteBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const content = new TextEncoder().encode(input.content);
    const requestedLimit = input.maxBytes;
    if (
      content.byteLength > maximum ||
      (requestedLimit !== undefined &&
        (typeof requestedLimit !== 'number' || !Number.isSafeInteger(requestedLimit) || requestedLimit <= 0 || content.byteLength > requestedLimit))
    ) {
      throw new ToolAdapterError('FILE_TOO_LARGE');
    }
    let safePath: string;
    try {
      safePath = await this.pathGuard.resolve(input.path);
    } catch {
      throw new ToolAdapterError('PATH_GUARD');
    }
    try {
      await this.fileSystem.writeFile(safePath, content);
    } catch {
      throw new ToolAdapterError('TOOL_FAILED');
    }
    return { path: input.path, bytes: content.byteLength };
  }
}

export interface ProcessRunRequest {
  argv: ValidatedArgv['argv'];
  shell: false;
  cwd: string;
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
  signal: AbortSignal;
}

export interface ProcessRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface ProcessRunner {
  run(request: ProcessRunRequest): Promise<ProcessRunResult>;
}

export class UnavailableProcessRunner implements ProcessRunner {
  async run(_request: ProcessRunRequest): Promise<never> {
    throw new ToolAdapterError('TOOL_EXECUTION_UNAVAILABLE');
  }
}

export interface ShellInput {
  argv: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export class ShellToolAdapter implements ToolHandler {
  readonly id = 'shell.exec';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly argvGuard: ArgvGuard,
    private readonly runner: ProcessRunner = new UnavailableProcessRunner(),
    private readonly defaults: { timeoutMs?: number; maxOutputBytes?: number } = {},
  ) {}

  async execute(input: unknown, context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input) || !Array.isArray(input.argv)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if (input.env !== undefined && !isEnvironmentRecord(input.env)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const argvOptions = input.env === undefined ? {} : { env: input.env };
    let argv: ValidatedArgv;
    try {
      argv = this.argvGuard.validate(input.argv, argvOptions);
    } catch (error) {
      if (error instanceof ArgvGuardError) throw new ToolAdapterError('ARGV_GUARD');
      throw new ToolAdapterError('ARGV_GUARD');
    }
    const timeoutMs = this.limit(input.timeoutMs, this.defaults.timeoutMs ?? 30_000);
    const maxOutputBytes = this.limit(input.maxOutputBytes, this.defaults.maxOutputBytes ?? 1024 * 1024);
    let cwd = context.workspaceRoot;
    if (input.cwd !== undefined) {
      if (typeof input.cwd !== 'string') throw new ToolAdapterError('TOOL_INPUT_INVALID');
      try {
        cwd = await this.pathGuard.resolve(input.cwd);
      } catch {
        throw new ToolAdapterError('PATH_GUARD');
      }
    }
    try {
      return await this.runner.run({
        argv: argv.argv,
        shell: false,
        cwd,
        env: argv.env,
        timeoutMs,
        maxOutputBytes,
        signal: context.signal,
      });
    } catch (error) {
      if (error instanceof ToolAdapterError) throw error;
      throw new ToolAdapterError('TOOL_FAILED');
    }
  }

  private limit(value: unknown, maximum: number): number {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if (value === undefined) return maximum;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    return value;
  }
}

export interface HostShellRunRequest {
  readonly workspaceRoot: string;
  readonly cwd?: string;
  readonly command: readonly string[];
  readonly allowShellMetacharacters?: boolean;
  readonly limits?: { readonly timeoutMs?: number; readonly maxOutputBytes?: number };
}

export interface HostShellRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

/** Structural port satisfied by HostRestrictedProcessRunner from @ready4vibe/sandbox-runtime. */
export interface HostShellRunner {
  run(request: HostShellRunRequest, signal?: AbortSignal): Promise<HostShellRunResult>;
}

export interface HostShellInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface HostShellToolAdapterOptions {
  readonly shell: string;
  readonly args: readonly string[];
  readonly maxCommandLength?: number;
  readonly defaults?: { timeoutMs?: number; maxOutputBytes?: number };
  readonly ceilings?: { timeoutMs?: number; maxOutputBytes?: number };
}

/**
 * Runs a raw host shell command string (pipes, redirects and `&&` work)
 * through the probed platform shell. Unlike ShellToolAdapter the command is
 * deliberately not passed through shell-metacharacter rejection; containment
 * comes from the injected host-restricted runner (workspace-confined cwd,
 * minimal environment, bounded limits, `shell:false` spawn).
 */
export class HostShellToolAdapter implements ToolHandler {
  readonly id = 'shell.exec';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly runner: HostShellRunner,
    private readonly options: HostShellToolAdapterOptions,
  ) {
    if (!options.shell || options.args.length === 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
  }

  async execute(input: unknown, context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input) || typeof input.command !== 'string') throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const command = input.command;
    const maxCommandLength = this.options.maxCommandLength ?? 8_000;
    if (command.trim().length === 0 || command.length > maxCommandLength) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const timeoutMs = this.limit(input.timeoutMs, this.options.defaults?.timeoutMs ?? 30_000, this.options.ceilings?.timeoutMs ?? 15 * 60 * 1_000);
    const maxOutputBytes = this.limit(input.maxOutputBytes, this.options.defaults?.maxOutputBytes ?? 1024 * 1024, this.options.ceilings?.maxOutputBytes ?? 50 * 1024 * 1024);
    let cwd = context.workspaceRoot;
    if (input.cwd !== undefined) {
      if (typeof input.cwd !== 'string') throw new ToolAdapterError('TOOL_INPUT_INVALID');
      try {
        cwd = await this.pathGuard.resolve(input.cwd);
      } catch {
        throw new ToolAdapterError('PATH_GUARD');
      }
    }
    try {
      const result = await this.runner.run({
        workspaceRoot: context.workspaceRoot,
        cwd,
        command: [this.options.shell, ...this.options.args, command],
        allowShellMetacharacters: true,
        limits: { timeoutMs, maxOutputBytes },
      }, context.signal);
      return { exitCode: result.exitCode ?? -1, stdout: result.stdout, stderr: result.stderr, truncated: result.truncated };
    } catch (error) {
      if (error instanceof ToolAdapterError) throw error;
      throw new ToolAdapterError('TOOL_FAILED');
    }
  }

  private limit(value: unknown, fallback: number, maximum: number): number {
    if (!Number.isSafeInteger(fallback) || fallback <= 0 || fallback > maximum) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    return value;
  }
}

export type GitToolId = 'git.status' | 'git.diff' | 'git.log';

export interface GitToolAdapterOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

/**
 * Fixed, read-only Git commands. The adapter deliberately has no argv input;
 * callers can only select the bounded staged/log options below.
 */
export class GitToolAdapter implements ToolHandler {
  readonly version = '1.0.0';

  constructor(
    readonly id: GitToolId,
    private readonly runner: ProcessRunner = new UnavailableProcessRunner(),
    private readonly defaults: GitToolAdapterOptions = {},
  ) {}

  async execute(input: unknown, context: ToolHandlerContext): Promise<unknown> {
    const parsed = this.parseInput(input);
    const argv = this.argv(parsed);
    const timeoutMs = this.limit(parsed.timeoutMs, this.defaults.timeoutMs ?? 15_000);
    const maxOutputBytes = this.limit(parsed.maxOutputBytes, this.defaults.maxOutputBytes ?? 2 * 1024 * 1024);
    try {
      const result = await this.runner.run({
        argv,
        shell: false,
        cwd: context.workspaceRoot,
        env: gitEnvironment(),
        timeoutMs,
        maxOutputBytes,
        signal: context.signal,
      });
      return {
        exitCode: result.exitCode,
        stdout: redactWorkspacePath(result.stdout, context.workspaceRoot),
        stderr: redactWorkspacePath(result.stderr, context.workspaceRoot),
        truncated: result.truncated,
      };
    } catch (error) {
      if (error instanceof ToolAdapterError) throw error;
      throw new ToolAdapterError('TOOL_FAILED');
    }
  }

  private parseInput(input: unknown): { staged?: boolean; limit?: number; timeoutMs?: number; maxOutputBytes?: number } {
    if (!isRecord(input)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const allowed = this.id === 'git.status' ? new Set(['timeoutMs', 'maxOutputBytes']) : this.id === 'git.diff' ? new Set(['staged', 'timeoutMs', 'maxOutputBytes']) : new Set(['limit', 'timeoutMs', 'maxOutputBytes']);
    if (Object.keys(input).some((key) => !allowed.has(key))) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if ('staged' in input && typeof input.staged !== 'boolean') throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if ('limit' in input && (typeof input.limit !== 'number' || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if ('timeoutMs' in input && (typeof input.timeoutMs !== 'number' || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if ('maxOutputBytes' in input && (typeof input.maxOutputBytes !== 'number' || !Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes < 1)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    return {
      ...('staged' in input && typeof input.staged === 'boolean' ? { staged: input.staged } : {}),
      ...('limit' in input && typeof input.limit === 'number' ? { limit: input.limit } : {}),
      ...('timeoutMs' in input && typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
      ...('maxOutputBytes' in input && typeof input.maxOutputBytes === 'number' ? { maxOutputBytes: input.maxOutputBytes } : {}),
    };
  }

  private argv(input: { staged?: boolean; limit?: number }): readonly string[] {
    if (this.id === 'git.status') return ['--no-pager', '--no-optional-locks', 'status', '--short', '--branch', '--untracked-files=normal'];
    if (this.id === 'git.diff') return ['--no-pager', '--no-optional-locks', 'diff', '--no-ext-diff', '--unified=3', ...(input.staged ? ['--cached'] : []), '--'];
    return ['--no-pager', '--no-optional-locks', 'log', '--oneline', '--decorate=short', '--max-count=' + String(input.limit ?? 20), '--'];
  }

  private limit(value: number | undefined, maximum: number): number {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if (value === undefined) return maximum;
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    return value;
  }
}

function gitEnvironment(): Readonly<Record<string, string>> {
  return {
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    LC_ALL: 'C',
  };
}

function redactWorkspacePath(value: string, workspaceRoot: string): string {
  if (!workspaceRoot) return value;
  const escaped = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  try { return value.replace(new RegExp(escaped, 'giu'), '[workspace]'); } catch { return value.split(workspaceRoot).join('[workspace]'); }
}

export function createSafeToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  return new ToolExecutor(options);
}

const WALK_IGNORED_DIRS = new Set(['.git', 'node_modules']);

interface WalkOptions {
  readonly maxDepth: number;
  readonly maxEntries: number;
}

/** Depth-bounded recursive listing under an already-resolved workspace base.
 * Symlinked entries are skipped so the walk cannot escape the PathGuard
 * boundary that resolved the base. */
async function walkWorkspace(
  fileSystem: FileSystemAdapterFileSystem,
  baseAbsolute: string,
  baseRelative: string,
  options: WalkOptions,
  visit: (entry: { relativePath: string; absolutePath: string; isDirectory: boolean }) => boolean | void,
): Promise<void> {
  let visited = 0;
  const walk = async (absolute: string, relative: string, depth: number): Promise<void> => {
    if (visited >= options.maxEntries) return;
    let entries: readonly FileSystemAdapterEntry[];
    try {
      entries = await fileSystem.readdir(absolute);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= options.maxEntries) return;
      if (entry.isSymbolicLink()) continue;
      const isDirectory = entry.isDirectory();
      if (isDirectory && WALK_IGNORED_DIRS.has(entry.name)) continue;
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const childAbsolute = `${absolute}/${entry.name}`;
      visited += 1;
      if (visit({ relativePath: childRelative, absolutePath: childAbsolute, isDirectory }) === false) return;
      if (isDirectory && depth < options.maxDepth) await walk(childAbsolute, childRelative, depth + 1);
    }
  };
  await walk(baseAbsolute, baseRelative, 0);
}

async function resolveWalkBase(pathGuard: PathGuard, workspaceRoot: string, value: unknown): Promise<{ absolute: string; relative: string }> {
  const raw = typeof value === 'string' && value.trim().length > 0 ? value.trim() : '.';
  // Models often send "/", "./src", or Windows separators; normalize to a workspace-relative path.
  const relative = raw.replace(/\\/gu, '/').replace(/^\.\//u, '').replace(/^\/+/u, '').replace(/\/$/u, '') || '.';
  // PathGuard.resolve('.') rejects the workspace root itself, so short-circuit it.
  if (relative === '.') return { absolute: workspaceRoot, relative: '' };
  try {
    const absolute = await pathGuard.resolve(relative);
    return { absolute, relative };
  } catch {
    throw new ToolAdapterError('PATH_GUARD');
  }
}

function boundedCount(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum) throw new ToolAdapterError('TOOL_INPUT_INVALID');
  return value;
}

/** `filesystem.list`: bounded directory listing for workspace orientation. */
export class FileSystemListToolAdapter implements ToolHandler {
  readonly id = 'filesystem.list';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileSystem: FileSystemAdapterFileSystem,
    private readonly workspaceRoot: string,
  ) {}

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input)) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const maxDepth = boundedCount(input.maxDepth, 2, 8);
    const maxEntries = boundedCount(input.maxEntries, 200, 1_000);
    const base = await resolveWalkBase(this.pathGuard, this.workspaceRoot, input.path);
    const lines: string[] = [];
    await walkWorkspace(this.fileSystem, base.absolute, base.relative, { maxDepth, maxEntries }, (entry) => {
      lines.push(entry.isDirectory ? `${entry.relativePath}/` : entry.relativePath);
    });
    return { path: typeof input.path === 'string' ? input.path : '.', entries: lines, truncated: lines.length >= maxEntries };
  }
}

/** `filesystem.search`: bounded regex content search across workspace files. */
export class FileSystemSearchToolAdapter implements ToolHandler {
  readonly id = 'filesystem.search';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileSystem: FileSystemAdapterFileSystem,
    private readonly workspaceRoot: string,
  ) {}

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input) || typeof input.pattern !== 'string' || input.pattern.length === 0 || input.pattern.length > 500) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const maxResults = boundedCount(input.maxResults, 50, 200);
    const maxFileBytes = boundedCount(input.maxFileBytes, 512 * 1024, 1024 * 1024);
    const maxDepth = boundedCount(input.maxDepth, 8, 12);
    let matcher: RegExp;
    try {
      matcher = new RegExp(input.pattern, input.caseSensitive === true ? 'u' : 'iu');
    } catch {
      throw new ToolAdapterError('TOOL_INPUT_INVALID');
    }
    const base = await resolveWalkBase(this.pathGuard, this.workspaceRoot, input.path);
    const matches: string[] = [];
    const files: { relativePath: string; absolutePath: string }[] = [];
    await walkWorkspace(this.fileSystem, base.absolute, base.relative, { maxDepth, maxEntries: 20_000 }, (entry) => {
      if (!entry.isDirectory) files.push({ relativePath: entry.relativePath, absolutePath: entry.absolutePath });
      return files.length < 20_000;
    });
    for (const file of files) {
      if (matches.length >= maxResults) break;
      let stats: { size: number; isFile(): boolean };
      try {
        stats = await this.fileSystem.stat(file.absolutePath);
      } catch {
        continue;
      }
      if (!stats.isFile() || stats.size > maxFileBytes) continue;
      let content: string;
      try {
        content = new TextDecoder().decode(await this.fileSystem.readFile(file.absolutePath));
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
        const line = lines[index] ?? '';
        matcher.lastIndex = 0;
        if (!matcher.test(line)) continue;
        matches.push(`${file.relativePath}:${index + 1}: ${line.length > 200 ? `${line.slice(0, 200)}…` : line}`);
      }
    }
    return { pattern: input.pattern, matches, truncated: matches.length >= maxResults };
  }
}

/** `filesystem.find`: bounded glob matching over workspace-relative paths. */
export class FileSystemFindToolAdapter implements ToolHandler {
  readonly id = 'filesystem.find';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileSystem: FileSystemAdapterFileSystem,
    private readonly workspaceRoot: string,
  ) {}

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input) || typeof input.pattern !== 'string' || input.pattern.length === 0 || input.pattern.length > 200) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const maxResults = boundedCount(input.maxResults, 100, 500);
    const maxDepth = boundedCount(input.maxDepth, 8, 12);
    const matcher = globToRegExp(input.pattern);
    if (!matcher) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const base = await resolveWalkBase(this.pathGuard, this.workspaceRoot, input.path);
    const byBasename = !input.pattern.includes('/');
    const matches: string[] = [];
    await walkWorkspace(this.fileSystem, base.absolute, base.relative, { maxDepth, maxEntries: 20_000 }, (entry) => {
      if (matches.length >= maxResults) return false;
      const candidate = byBasename ? (entry.relativePath.split('/').pop() ?? entry.relativePath) : entry.relativePath;
      if (matcher.test(candidate)) matches.push(entry.isDirectory ? `${entry.relativePath}/` : entry.relativePath);
      return undefined;
    });
    return { pattern: input.pattern, matches, truncated: matches.length >= maxResults };
  }
}

function globToRegExp(pattern: string): RegExp | undefined {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index] ?? '';
    if (char === '*') {
      if (pattern[index + 1] === '*') { source += '.*'; index += 2; }
      else { source += '[^/]*'; index += 1; }
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      index += 1;
    }
  }
  try {
    return new RegExp(`^${source}$`, 'u');
  } catch {
    return undefined;
  }
}

/** `filesystem.edit`: anchored single-occurrence replacement, the bounded
 * alternative to full-file rewrites for small targeted changes. */
export class FileSystemEditToolAdapter implements ToolHandler {
  readonly id = 'filesystem.edit';
  readonly version = '1.0.0';

  constructor(
    private readonly pathGuard: PathGuard,
    private readonly fileSystem: FileSystemAdapterFileSystem,
    private readonly defaults: { maxFileBytes?: number } = {},
  ) {}

  async execute(input: unknown, _context: ToolHandlerContext): Promise<unknown> {
    if (!isRecord(input) || typeof input.path !== 'string' || typeof input.oldText !== 'string' || typeof input.newText !== 'string' || input.oldText.length === 0) {
      throw new ToolAdapterError('TOOL_INPUT_INVALID');
    }
    const maximum = this.defaults.maxFileBytes ?? 1024 * 1024;
    let safePath: string;
    try {
      safePath = await this.pathGuard.resolve(input.path);
    } catch {
      throw new ToolAdapterError('PATH_GUARD');
    }
    let content: Uint8Array;
    try {
      const stats = await this.fileSystem.stat(safePath);
      if (!stats.isFile()) throw new ToolAdapterError('TARGET_NOT_FILE');
      if (stats.size > maximum) throw new ToolAdapterError('FILE_TOO_LARGE');
      content = await this.fileSystem.readFile(safePath);
    } catch (error) {
      if (error instanceof ToolAdapterError) throw error;
      throw new ToolAdapterError('TARGET_UNAVAILABLE');
    }
    const text = new TextDecoder().decode(content);
    const first = text.indexOf(input.oldText);
    if (first === -1) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    if (text.indexOf(input.oldText, first + 1) !== -1) throw new ToolAdapterError('TOOL_INPUT_INVALID');
    const next = text.slice(0, first) + input.newText + text.slice(first + input.oldText.length);
    const encoded = new TextEncoder().encode(next);
    if (encoded.byteLength > maximum) throw new ToolAdapterError('FILE_TOO_LARGE');
    try {
      await this.fileSystem.writeFile(safePath, encoded);
    } catch {
      throw new ToolAdapterError('TOOL_FAILED');
    }
    return { path: input.path, bytes: encoded.byteLength, replacements: 1 };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvironmentRecord(value: unknown): value is Readonly<Record<string, string | undefined>> {
  return isRecord(value) && Object.values(value).every((entry) => entry === undefined || typeof entry === 'string');
}

export type { SandboxPolicy, ToolSandboxMode };
export { validateExecutionLimits };
