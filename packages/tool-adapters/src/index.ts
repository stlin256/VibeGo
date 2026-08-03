import type { AgentToolDescriptor, ToolRuntime, ToolRuntimeRequest, ToolRuntimeResult } from '@ready4vibe/agent';
import type { SandboxPolicy } from '@ready4vibe/contracts';
import {
  ArgvGuard,
  ArgvGuardError,
  PathGuard,
  PathGuardError,
  type ValidatedArgv,
  validateExecutionLimits,
} from '@ready4vibe/execution';
import { ApprovalPolicy, type ToolIntent } from '@ready4vibe/policy';
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
}

export interface ToolHandlerContext {
  readonly workspaceRoot: string;
  readonly intent: ToolIntent;
  readonly sandbox: ResolvedSandbox;
  readonly signal: AbortSignal;
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
      });
    } catch (error) {
      if (error instanceof SandboxUnavailableError || error instanceof ToolAdapterError) throw error;
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
}

export interface FileSystemAdapterFileSystem {
  stat(path: string): Promise<{ size: number; isFile(): boolean }>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
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

export function createSafeToolExecutor(options: ToolExecutorOptions): ToolExecutor {
  return new ToolExecutor(options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEnvironmentRecord(value: unknown): value is Readonly<Record<string, string | undefined>> {
  return isRecord(value) && Object.values(value).every((entry) => entry === undefined || typeof entry === 'string');
}

export type { SandboxPolicy, ToolSandboxMode };
export { validateExecutionLimits };
