import { realpath as defaultRealpath } from 'node:fs/promises';
import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { posix, win32 } from 'node:path';
import { ArgvGuard, ArgvGuardError } from '@ready4vibe/execution';

export type HostRestrictedProcessErrorCode =
  | 'WORKSPACE_INVALID'
  | 'CWD_INVALID'
  | 'CWD_OUTSIDE_WORKSPACE'
  | 'SYMLINK_ESCAPE'
  | 'ARGV_INVALID'
  | 'ENV_NOT_ALLOWED'
  | 'ENV_INVALID'
  | 'RESOURCE_INVALID'
  | 'PROCESS_START_FAILED';

export class HostRestrictedProcessError extends Error {
  constructor(readonly code: HostRestrictedProcessErrorCode) {
    super('The host-restricted process request was rejected.');
    this.name = 'HostRestrictedProcessError';
  }
}

export interface HostProcessLimits {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface HostProcessLaunchRequest {
  readonly workspaceRoot: string;
  readonly cwd?: string;
  readonly command: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly envAllowlist?: readonly string[];
  readonly limits?: HostProcessLimits;
}

export interface HostProcessPlan {
  readonly argv: readonly string[];
  readonly shell: false;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly limits: Required<HostProcessLimits>;
}

export interface HostProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

export type HostProcessSpawnFunction = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
export type HostProcessRealpath = (path: string) => Promise<string>;
export type HostProcessTerminateTree = (child: ChildProcess) => void;

export interface HostRestrictedProcessRunnerOptions {
  readonly spawn?: HostProcessSpawnFunction;
  readonly realpath?: HostProcessRealpath;
  readonly terminateTree?: HostProcessTerminateTree;
  readonly baseEnv?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
const MAX_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const MAX_ARGS = 128;
const MAX_ARG_BYTES = 64 * 1024;
const MAX_ENV_KEYS = 64;
const CONTROL_TEXT = /[\u0000-\u001F\u007F\r\n]/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SECRET_ENV_NAME = /(?:^|_)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token|bearer)(?:_|$)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;

const defaultSpawnFunction: HostProcessSpawnFunction = (command, args, options) => defaultSpawn(command, args, options);

/**
 * Build a host-process plan without starting a process. `realpath` is injected
 * so symlink and path-boundary tests never touch an arbitrary user workspace.
 */
export async function buildHostProcessPlan(
  request: HostProcessLaunchRequest,
  realpath: HostProcessRealpath = defaultRealpath,
  options: Pick<HostRestrictedProcessRunnerOptions, 'platform'> = {},
): Promise<HostProcessPlan> {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? win32 : posix;
  const root = validateWorkspacePath(request.workspaceRoot, pathApi);
  const realRoot = await resolveRealPath(root, realpath, 'WORKSPACE_INVALID');
  const normalizedRoot = validateResolvedWorkspace(realRoot, pathApi);
  const requestedCwd = request.cwd ?? root;
  const cwd = validateCwdPath(requestedCwd, pathApi);
  assertCwdWithinWorkspace(cwd, normalizedRoot, pathApi);
  const realCwd = await resolveRealPath(cwd, realpath, 'CWD_INVALID');
  const normalizedCwd = validateResolvedCwd(realCwd, normalizedRoot, pathApi);

  const envAllowlist = request.envAllowlist ?? [];
  if (!Array.isArray(envAllowlist) || envAllowlist.length > MAX_ENV_KEYS || envAllowlist.some((key) => typeof key !== 'string' || !ENV_NAME.test(key))) {
    throw new HostRestrictedProcessError('ENV_INVALID');
  }
  if (request.env !== undefined) {
    if (typeof request.env !== 'object' || request.env === null || Array.isArray(request.env)) throw new HostRestrictedProcessError('ENV_INVALID');
    const allowedEnv = new Set(envAllowlist);
    for (const [key, value] of Object.entries(request.env)) {
      if (!allowedEnv.has(key) || SECRET_ENV_NAME.test(key)) throw new HostRestrictedProcessError('ENV_NOT_ALLOWED');
      if (value !== undefined && (typeof value !== 'string' || CONTROL_TEXT.test(value) || SECRET_VALUE.test(value))) throw new HostRestrictedProcessError('ENV_INVALID');
    }
  }
  let validated;
  try {
    validated = new ArgvGuard({ shell: false, maxArgs: MAX_ARGS, maxArgBytes: MAX_ARG_BYTES }).validate(request.command, {
      env: request.env ?? {},
      allowedEnv: envAllowlist,
    });
  } catch (error) {
    if (error instanceof ArgvGuardError && error.code === 'ENV_NOT_ALLOWED') throw new HostRestrictedProcessError('ENV_NOT_ALLOWED');
    if (error instanceof ArgvGuardError && error.code === 'ENV_INVALID') throw new HostRestrictedProcessError('ENV_INVALID');
    throw new HostRestrictedProcessError('ARGV_INVALID');
  }
  for (const key of Object.keys(validated.env)) {
    if (SECRET_ENV_NAME.test(key)) throw new HostRestrictedProcessError('ENV_NOT_ALLOWED');
  }

  const timeoutMs = request.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = request.limits?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0 || maxOutputBytes > MAX_OUTPUT_BYTES) {
    throw new HostRestrictedProcessError('RESOURCE_INVALID');
  }

  return Object.freeze({
    argv: Object.freeze([...validated.argv]),
    shell: false,
    cwd: normalizedCwd,
    env: Object.freeze({ ...validated.env }),
    limits: Object.freeze({ timeoutMs, maxOutputBytes }),
  });
}

/**
 * Executes a previously validated host-restricted plan. The runner is not
 * registered by the daemon in this phase; callers must inject it explicitly.
 */
export class HostRestrictedProcessRunner {
  private readonly spawn: HostProcessSpawnFunction;
  private readonly realpath: HostProcessRealpath;
  private readonly terminateTree: HostProcessTerminateTree;
  private readonly baseEnv: Readonly<Record<string, string | undefined>>;
  private readonly platform: NodeJS.Platform;

  constructor(options: HostRestrictedProcessRunnerOptions = {}) {
    this.spawn = options.spawn ?? defaultSpawnFunction;
    this.realpath = options.realpath ?? defaultRealpath;
    this.platform = options.platform ?? process.platform;
    this.terminateTree = options.terminateTree ?? ((child) => defaultTerminateTree(child, this.platform));
    this.baseEnv = options.baseEnv ?? process.env;
  }

  async run(request: HostProcessLaunchRequest, signal?: AbortSignal): Promise<HostProcessResult> {
    if (signal?.aborted) return cancelledResult();
    const plan = await buildHostProcessPlan(request, this.realpath, { platform: this.platform });
    if (signal?.aborted) return cancelledResult();
    const executable = plan.argv[0];
    if (executable === undefined) throw new HostRestrictedProcessError('ARGV_INVALID');
    const args = [...plan.argv.slice(1)];
    const env = this.minimalEnv(plan.env);
    return new Promise((resolveResult, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawn(executable, args, {
          shell: false,
          windowsHide: true,
          cwd: plan.cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
        });
      } catch {
        reject(new HostRestrictedProcessError('PROCESS_START_FAILED'));
        return;
      }

      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;

      const terminate = (): void => {
        if (settled) return;
        try {
          this.terminateTree(child);
        } catch {
          try { child.kill(); } catch { /* best effort */ }
        }
      };
      const append = (target: Buffer[], value: unknown): void => {
        if (settled) return;
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
        const remaining = plan.limits.maxOutputBytes - outputBytes;
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
        signal?.removeEventListener('abort', onAbort);
        resolveResult({
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          truncated,
          timedOut,
          cancelled,
        });
      };
      const onAbort = (): void => {
        if (settled) return;
        cancelled = true;
        terminate();
      };

      child.stdout?.on('data', (chunk: Buffer | string) => append(stdout, chunk));
      child.stderr?.on('data', (chunk: Buffer | string) => append(stderr, chunk));
      child.once('error', () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new HostRestrictedProcessError('PROCESS_START_FAILED'));
      });
      child.once('close', (exitCode: number | null) => settle(exitCode));
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        terminate();
      }, plan.limits.timeoutMs);
    });
  }

  private minimalEnv(planEnv: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    if (this.baseEnv.PATH !== undefined) env.PATH = this.baseEnv.PATH;
    if (this.baseEnv.SystemRoot !== undefined) env.SystemRoot = this.baseEnv.SystemRoot;
    for (const [key, value] of Object.entries(planEnv)) env[key] = value;
    return env;
  }
}

async function resolveRealPath(pathValue: string, realpath: HostProcessRealpath, code: 'WORKSPACE_INVALID' | 'CWD_INVALID'): Promise<string> {
  try {
    const result = await realpath(pathValue);
    if (typeof result !== 'string' || result.length === 0 || CONTROL_TEXT.test(result)) throw new Error('invalid realpath');
    return result;
  } catch {
    throw new HostRestrictedProcessError(code);
  }
}

function validateWorkspacePath(value: string, pathApi: typeof posix | typeof win32): string {
  if (typeof value !== 'string' || CONTROL_TEXT.test(value) || !pathApi.isAbsolute(value)) throw new HostRestrictedProcessError('WORKSPACE_INVALID');
  const normalized = pathApi.resolve(value);
  if (pathApi.parse(normalized).root === normalized) throw new HostRestrictedProcessError('WORKSPACE_INVALID');
  return normalized;
}

function validateResolvedWorkspace(value: string, pathApi: typeof posix | typeof win32): string {
  if (!pathApi.isAbsolute(value) || CONTROL_TEXT.test(value)) throw new HostRestrictedProcessError('WORKSPACE_INVALID');
  const normalized = pathApi.resolve(value);
  if (pathApi.parse(normalized).root === normalized) throw new HostRestrictedProcessError('WORKSPACE_INVALID');
  return normalized;
}

function validateCwdPath(value: string, pathApi: typeof posix | typeof win32): string {
  if (typeof value !== 'string' || CONTROL_TEXT.test(value) || !pathApi.isAbsolute(value)) throw new HostRestrictedProcessError('CWD_INVALID');
  return pathApi.resolve(value);
}

function assertCwdWithinWorkspace(value: string, workspaceRoot: string, pathApi: typeof posix | typeof win32): void {
  const rest = pathApi.relative(workspaceRoot, value);
  if (pathApi.isAbsolute(rest) || rest === '..' || rest.startsWith(`..${pathApi.sep}`)) throw new HostRestrictedProcessError('CWD_OUTSIDE_WORKSPACE');
}

function validateResolvedCwd(value: string, workspaceRoot: string, pathApi: typeof posix | typeof win32): string {
  if (!pathApi.isAbsolute(value) || CONTROL_TEXT.test(value)) throw new HostRestrictedProcessError('CWD_INVALID');
  const normalized = pathApi.resolve(value);
  const rest = pathApi.relative(workspaceRoot, normalized);
  if (pathApi.isAbsolute(rest) || rest === '..' || rest.startsWith(`..${pathApi.sep}`)) throw new HostRestrictedProcessError('SYMLINK_ESCAPE');
  return normalized;
}

function defaultTerminateTree(child: ChildProcess, platform: NodeJS.Platform): void {
  if (platform === 'win32' && child.pid !== undefined) {
    try {
      const killer = defaultSpawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.unref?.();
    } catch {
      // Fall through to the direct kill as a best effort.
    }
  }
  try {
    child.kill(platform === 'win32' ? undefined : 'SIGTERM');
  } catch {
    // The close event or a later caller will settle the run.
  }
}

function cancelledResult(): HostProcessResult {
  return { exitCode: null, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: true };
}
