import { isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { ArgvGuard, ArgvGuardError } from '@ready4vibe/execution';

export type ContainerRuntime = 'docker' | 'podman';
export type SandboxRuntimeName = ContainerRuntime | 'vm';
export type SandboxNetwork = 'restricted' | 'enabled';

export type SandboxRuntimeErrorCode =
  | 'RUNTIME_UNAVAILABLE'
  | 'RUNTIME_UNSUPPORTED'
  | 'IMAGE_INVALID'
  | 'WORKSPACE_INVALID'
  | 'WRITABLE_ROOT_INVALID'
  | 'ARGV_INVALID'
  | 'ENV_NOT_ALLOWED'
  | 'ENV_INVALID'
  | 'NETWORK_INVALID'
  | 'RESOURCE_INVALID'
  | 'MOUNT_PATH_INVALID';

export class SandboxRuntimeError extends Error {
  constructor(readonly code: SandboxRuntimeErrorCode, message = 'The sandbox runtime request was rejected.') {
    super(message);
    this.name = 'SandboxRuntimeError';
  }
}

export interface SandboxRuntimeLimits {
  readonly maxMemoryBytes?: number;
  readonly maxCpuMillis?: number;
  readonly maxPids?: number;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface SandboxLaunchRequest {
  readonly runtime: SandboxRuntimeName;
  readonly image: string;
  readonly allowMutableImageTag?: boolean;
  readonly workspaceRoot: string;
  readonly writableRoots?: readonly string[];
  readonly network: SandboxNetwork;
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly envAllowlist?: readonly string[];
  readonly limits?: SandboxRuntimeLimits;
}

export interface SandboxLaunchPlan {
  readonly runtime: ContainerRuntime;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly limits: Required<Pick<SandboxRuntimeLimits, 'timeoutMs' | 'maxOutputBytes'>>;
}

export interface SandboxExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

export interface SandboxProcessRunner {
  run(plan: SandboxLaunchPlan, signal?: AbortSignal): Promise<SandboxExecutionResult>;
}

const DIGEST_IMAGE = /^[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}$/u;
const MUTABLE_IMAGE = /^[A-Za-z0-9][A-Za-z0-9./_:@-]{0,255}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const PATH_CONTROL = /[\u0000-\u001F\u007F\r\n]/u;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PIDS = 256;

export function buildContainerLaunchPlan(request: SandboxLaunchRequest): SandboxLaunchPlan {
  if (request.runtime === 'vm') throw new SandboxRuntimeError('RUNTIME_UNSUPPORTED', 'VM sandbox runtime is not wired yet.');
  assertImage(request.image, request.allowMutableImageTag === true);
  const workspaceRoot = assertWorkspaceRoot(request.workspaceRoot);
  const writableRoots = assertWritableRoots(workspaceRoot, request.writableRoots ?? []);
  const env = validateEnv(request.env ?? {}, request.envAllowlist ?? []);
  const command = validateCommand(request.command);
  if (request.network !== 'restricted' && request.network !== 'enabled') {
    throw new SandboxRuntimeError('NETWORK_INVALID', 'Sandbox network mode is invalid.');
  }
  const limits = validateLimits(request.limits ?? {});
  const workspaceWritable = writableRoots.has(workspaceRoot);
  const argv: string[] = [
    request.runtime,
    'run',
    '--rm',
    '--init',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit',
    String(limits.maxPids),
    '--network',
    request.network === 'restricted' ? 'none' : 'bridge',
  ];
  if (request.limits?.maxMemoryBytes !== undefined) argv.push('--memory', `${request.limits.maxMemoryBytes}b`);
  if (request.limits?.maxCpuMillis !== undefined) argv.push('--cpus', formatCpus(request.limits.maxCpuMillis));
  for (const key of Object.keys(env).sort()) argv.push('--env', key);
  argv.push('--mount', mountArg(workspaceRoot, '/workspace', workspaceWritable));
  for (const root of [...writableRoots].sort()) {
    if (root === workspaceRoot) continue;
    argv.push('--mount', mountArg(root, `/workspace/${relative(workspaceRoot, root).split(sep).join('/')}`, true));
  }
  argv.push(request.image, ...command);
  return Object.freeze({
    runtime: request.runtime,
    argv: Object.freeze(argv),
    env: Object.freeze({ ...env }),
    limits: Object.freeze({ timeoutMs: limits.timeoutMs, maxOutputBytes: limits.maxOutputBytes }),
  });
}

export class ExternalSandboxExecutor {
  constructor(private readonly runner?: SandboxProcessRunner) {}

  async execute(request: SandboxLaunchRequest, signal?: AbortSignal): Promise<SandboxExecutionResult> {
    const plan = buildContainerLaunchPlan(request);
    if (!this.runner) throw new SandboxRuntimeError('RUNTIME_UNAVAILABLE', 'No sandbox process runner is configured.');
    return this.runner.run(plan, signal);
  }
}

function assertImage(image: string, allowMutable: boolean): void {
  if (typeof image !== 'string' || image.length === 0 || PATH_CONTROL.test(image)) throw new SandboxRuntimeError('IMAGE_INVALID', 'Sandbox image reference is invalid.');
  if (DIGEST_IMAGE.test(image)) return;
  if (allowMutable && MUTABLE_IMAGE.test(image)) return;
  throw new SandboxRuntimeError('IMAGE_INVALID', 'Sandbox image must use an immutable sha256 digest unless mutable tags are explicitly enabled.');
}

function assertWorkspaceRoot(value: string): string {
  if (typeof value !== 'string' || !isAbsolute(value) || PATH_CONTROL.test(value)) throw new SandboxRuntimeError('WORKSPACE_INVALID', 'Sandbox workspace root must be an absolute path.');
  const root = resolve(value);
  if (root === parse(root).root || root.includes(',')) throw new SandboxRuntimeError('WORKSPACE_INVALID', 'Sandbox workspace root is too broad or cannot be mounted safely.');
  return root;
}

function assertWritableRoots(workspaceRoot: string, values: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(values) || values.length > 32) throw new SandboxRuntimeError('WRITABLE_ROOT_INVALID', 'Writable root list exceeds its limit.');
  const roots = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || !isAbsolute(value) || PATH_CONTROL.test(value) || value.includes(',')) {
      throw new SandboxRuntimeError('WRITABLE_ROOT_INVALID', 'Writable root must be a safe absolute path.');
    }
    const root = resolve(value);
    const rest = relative(workspaceRoot, root);
    if (isAbsolute(rest) || rest === '..' || rest.startsWith(`..${sep}`)) {
      throw new SandboxRuntimeError('WRITABLE_ROOT_INVALID', 'Writable root must remain within the workspace.');
    }
    roots.add(root);
  }
  return roots;
}

function validateCommand(command: readonly string[]): readonly string[] {
  if (!Array.isArray(command) || command.length === 0) throw new SandboxRuntimeError('ARGV_INVALID', 'Sandbox command cannot be empty.');
  try {
    return new ArgvGuard({ shell: false, maxArgs: 128, maxArgBytes: 64 * 1024 }).validate(command).argv;
  } catch (error) {
    if (error instanceof ArgvGuardError) throw new SandboxRuntimeError('ARGV_INVALID', 'Sandbox command contains disallowed process input.');
    throw new SandboxRuntimeError('ARGV_INVALID');
  }
}

function validateEnv(env: Readonly<Record<string, string | undefined>>, allowlist: readonly string[]): Readonly<Record<string, string>> {
  if (!Array.isArray(allowlist) || allowlist.length > 64 || allowlist.some((key) => typeof key !== 'string' || !ENV_NAME.test(key))) {
    throw new SandboxRuntimeError('ENV_INVALID', 'Sandbox environment allowlist is invalid.');
  }
  const allowed = new Set(allowlist);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!allowed.has(key)) throw new SandboxRuntimeError('ENV_NOT_ALLOWED', 'Sandbox environment key is not allowlisted.');
    if (value === undefined) continue;
    if (!ENV_NAME.test(key) || typeof value !== 'string' || PATH_CONTROL.test(value)) throw new SandboxRuntimeError('ENV_INVALID', 'Sandbox environment value is invalid.');
    result[key] = value;
  }
  return result;
}

function validateLimits(limits: SandboxRuntimeLimits): SandboxRuntimeLimits & { maxPids: number; timeoutMs: number; maxOutputBytes: number } {
  const maxPids = limits.maxPids ?? DEFAULT_MAX_PIDS;
  const timeoutMs = limits.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = limits.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!positiveInteger(maxPids) || maxPids > 4_096 || !positiveInteger(timeoutMs) || timeoutMs > 30 * 60 * 1_000 || !positiveInteger(maxOutputBytes) || maxOutputBytes > 50 * 1024 * 1024) {
    throw new SandboxRuntimeError('RESOURCE_INVALID', 'Sandbox execution limits are invalid.');
  }
  if (limits.maxMemoryBytes !== undefined && (!positiveInteger(limits.maxMemoryBytes) || limits.maxMemoryBytes > 64 * 1024 * 1024 * 1024)) {
    throw new SandboxRuntimeError('RESOURCE_INVALID', 'Sandbox memory limit is invalid.');
  }
  if (limits.maxCpuMillis !== undefined && (!positiveInteger(limits.maxCpuMillis) || limits.maxCpuMillis > 64_000)) {
    throw new SandboxRuntimeError('RESOURCE_INVALID', 'Sandbox CPU limit is invalid.');
  }
  return { ...limits, maxPids, timeoutMs, maxOutputBytes };
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function formatCpus(maxCpuMillis: number): string {
  const value = maxCpuMillis / 1_000;
  return value.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '');
}

function mountArg(source: string, destination: string, writable: boolean): string {
  if (source.includes(',') || destination.includes(',') || !destination.startsWith('/workspace')) {
    throw new SandboxRuntimeError('MOUNT_PATH_INVALID', 'Sandbox mount path cannot be represented safely.');
  }
  return `type=bind,src=${source},dst=${destination},${writable ? 'rw' : 'readonly'}`;
}
