import { lstat as defaultLstat, realpath as defaultRealpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export type PathGuardErrorCode =
  | 'EMPTY_PATH'
  | 'NUL_BYTE'
  | 'ABSOLUTE_PATH'
  | 'WINDOWS_PATH'
  | 'PATH_TRAVERSAL'
  | 'ROOT_UNAVAILABLE'
  | 'TARGET_UNAVAILABLE'
  | 'SYMLINK_ESCAPE'
  | 'PARENT_UNAVAILABLE';

export class PathGuardError extends Error {
  constructor(readonly code: PathGuardErrorCode) {
    super('The requested path is outside the permitted workspace boundary.');
    this.name = 'PathGuardError';
  }
}

export interface PathGuardFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>;
}

const defaultFileSystem: PathGuardFileSystem = {
  realpath: defaultRealpath,
  lstat: defaultLstat,
};

export class PathGuard {
  constructor(private readonly workspaceRoot: string, private readonly fileSystem: PathGuardFileSystem = defaultFileSystem) {
    if (!workspaceRoot || workspaceRoot.includes('\u0000')) throw new PathGuardError('ROOT_UNAVAILABLE');
  }

  async resolve(relativePath: string): Promise<string> {
    const normalized = this.normalizeRelativePath(relativePath);
    let root: string;
    try {
      root = await this.fileSystem.realpath(this.workspaceRoot);
    } catch {
      throw new PathGuardError('ROOT_UNAVAILABLE');
    }

    const candidate = resolve(root, ...normalized.split('/'));
    this.assertWithin(root, candidate);

    try {
      const existing = await this.fileSystem.realpath(candidate);
      if (!this.isWithin(root, existing)) throw new PathGuardError('SYMLINK_ESCAPE');
      return existing;
    } catch (error) {
      if (error instanceof PathGuardError) throw error;
      try {
        const link = await this.fileSystem.lstat(candidate);
        if (link.isSymbolicLink()) throw new PathGuardError('SYMLINK_ESCAPE');
      } catch (lstatError) {
        if (lstatError instanceof PathGuardError) throw lstatError;
        // A missing target is allowed only when its real parent can be checked.
      }
    }

    const parent = dirname(candidate);
    let realParent: string;
    try {
      realParent = await this.fileSystem.realpath(parent);
    } catch {
      throw new PathGuardError('PARENT_UNAVAILABLE');
    }
    if (!this.isWithin(root, realParent)) throw new PathGuardError('SYMLINK_ESCAPE');
    return resolve(realParent, candidate.slice(parent.length + 1));
  }

  private normalizeRelativePath(value: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new PathGuardError('EMPTY_PATH');
    if (value.includes('\u0000')) throw new PathGuardError('NUL_BYTE');

    const portable = value.replaceAll('\\', '/');
    if (portable.startsWith('/') || isAbsolute(value) || portable.startsWith('//')) {
      throw new PathGuardError('ABSOLUTE_PATH');
    }
    if (/^[A-Za-z]:($|\/)/u.test(portable) || /^[A-Za-z]:/u.test(portable)) {
      throw new PathGuardError('WINDOWS_PATH');
    }

    const parts = portable.split('/');
    if (parts.some((part) => part === '..')) throw new PathGuardError('PATH_TRAVERSAL');
    const filtered = parts.filter((part) => part.length > 0 && part !== '.');
    if (filtered.length === 0) throw new PathGuardError('EMPTY_PATH');
    return filtered.join('/');
  }

  private assertWithin(root: string, candidate: string): void {
    if (!this.isWithin(root, candidate)) throw new PathGuardError('PATH_TRAVERSAL');
  }

  private isWithin(root: string, candidate: string): boolean {
    const rest = relative(root, candidate);
    return rest === '' || (!isAbsolute(rest) && rest !== '..' && !rest.startsWith(`..${sep}`));
  }
}

export type ArgvGuardErrorCode =
  | 'ARGV_EMPTY'
  | 'ARGV_INVALID'
  | 'NUL_BYTE'
  | 'CONTROL_CHARACTER'
  | 'SHELL_DISABLED'
  | 'SHELL_METACHARACTER'
  | 'ENV_NOT_ALLOWED'
  | 'ENV_INVALID'
  | 'LIMIT_INVALID';

export class ArgvGuardError extends Error {
  constructor(readonly code: ArgvGuardErrorCode) {
    super('The process input is not permitted.');
    this.name = 'ArgvGuardError';
  }
}

export interface ArgvGuardOptions {
  allowedEnv?: readonly string[] | ReadonlySet<string>;
  env?: Readonly<Record<string, string | undefined>>;
  shell?: boolean;
  allowShellMetacharacters?: boolean;
  maxArgs?: number;
  maxArgBytes?: number;
}

export interface ValidatedArgv {
  readonly argv: readonly string[];
  readonly shell: false;
  readonly env: Readonly<Record<string, string>>;
}

const SHELL_METACHARACTER = /[;&|<>`$()]/u;

export class ArgvGuard {
  constructor(private readonly defaults: ArgvGuardOptions = {}) {}

  validate(argv: readonly string[], options: ArgvGuardOptions = {}): ValidatedArgv {
    const config = this.mergeOptions(options);
    if (config.shell === true) throw new ArgvGuardError('SHELL_DISABLED');
    if (!Array.isArray(argv) || argv.length === 0) throw new ArgvGuardError('ARGV_EMPTY');
    const maxArgs = config.maxArgs ?? 128;
    const maxArgBytes = config.maxArgBytes ?? 64 * 1024;
    if (!Number.isSafeInteger(maxArgs) || maxArgs <= 0 || !Number.isSafeInteger(maxArgBytes) || maxArgBytes <= 0) {
      throw new ArgvGuardError('LIMIT_INVALID');
    }
    if (argv.length > maxArgs) throw new ArgvGuardError('ARGV_INVALID');

    const allowShellMetacharacters = config.allowShellMetacharacters === true;
    const validatedArgv: string[] = [];
    for (const value of argv) {
      if (typeof value !== 'string') throw new ArgvGuardError('ARGV_INVALID');
      if (value.includes('\u0000')) throw new ArgvGuardError('NUL_BYTE');
      if (/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F\r\n]/u.test(value)) {
        throw new ArgvGuardError('CONTROL_CHARACTER');
      }
      if (!allowShellMetacharacters && SHELL_METACHARACTER.test(value)) {
        throw new ArgvGuardError('SHELL_METACHARACTER');
      }
      if (Buffer.byteLength(value) > maxArgBytes) throw new ArgvGuardError('ARGV_INVALID');
      validatedArgv.push(value);
    }

    const allowedEnv = this.toAllowedEnv(config.allowedEnv);
    const validatedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env ?? {})) {
      if (!allowedEnv.has(key)) throw new ArgvGuardError('ENV_NOT_ALLOWED');
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) throw new ArgvGuardError('ENV_INVALID');
      if (value === undefined) continue;
      if (value.includes('\u0000')) throw new ArgvGuardError('NUL_BYTE');
      if (/[\r\n]/u.test(value)) throw new ArgvGuardError('CONTROL_CHARACTER');
      validatedEnv[key] = value;
    }

    return {
      argv: Object.freeze(validatedArgv),
      shell: false,
      env: Object.freeze(validatedEnv),
    };
  }

  private mergeOptions(options: ArgvGuardOptions): ArgvGuardOptions {
    return {
      ...this.defaults,
      ...options,
      ...(options.allowedEnv === undefined && this.defaults.allowedEnv !== undefined ? { allowedEnv: this.defaults.allowedEnv } : {}),
      ...(options.env === undefined && this.defaults.env !== undefined ? { env: this.defaults.env } : {}),
    };
  }

  private toAllowedEnv(value: ArgvGuardOptions['allowedEnv']): ReadonlySet<string> {
    if (value === undefined) return new Set();
    return value instanceof Set ? value : new Set(value);
  }
}

export interface ExecutionLimits {
  timeoutMs: number;
  maxOutputBytes: number;
}

export function validateExecutionLimits(limits: ExecutionLimits): ExecutionLimits {
  if (
    !Number.isSafeInteger(limits.timeoutMs) ||
    limits.timeoutMs <= 0 ||
    !Number.isSafeInteger(limits.maxOutputBytes) ||
    limits.maxOutputBytes <= 0
  ) {
    throw new ArgvGuardError('LIMIT_INVALID');
  }
  return { timeoutMs: limits.timeoutMs, maxOutputBytes: limits.maxOutputBytes };
}
