import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArgvGuard, ArgvGuardError, PathGuard, PathGuardError, validateExecutionLimits } from './index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ready4vibe-execution-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('PathGuard', () => {
  it('accepts an existing file and a new file under a real parent', async () => {
    const root = await workspace();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'main.ts'), 'export {}');
    const guard = new PathGuard(root);
    await expect(guard.resolve('src/main.ts')).resolves.toBe(await import('node:fs/promises').then(({ realpath }) => realpath(join(root, 'src', 'main.ts'))));
    await expect(guard.resolve('src/new.ts')).resolves.toBe(join(root, 'src', 'new.ts'));
  });

  it('rejects traversal, absolute, Windows, UNC and NUL paths', async () => {
    const guard = new PathGuard(await workspace());
    for (const value of ['../outside', 'src/../../outside', '/etc/passwd', 'C:\\Windows\\system32', '\\\\server\\share', 'src/\u0000x']) {
      await expect(guard.resolve(value)).rejects.toBeInstanceOf(PathGuardError);
    }
    await expect(guard.resolve('C:relative')).rejects.toMatchObject({ code: 'WINDOWS_PATH' });
  });

  it('rejects symlink escapes for existing paths and new children', async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(root, 'link'), 'junction');
    const guard = new PathGuard(root);
    await expect(guard.resolve('link/secret.txt')).rejects.toMatchObject({ code: 'SYMLINK_ESCAPE' });
    await expect(guard.resolve('link/new.txt')).rejects.toMatchObject({ code: 'SYMLINK_ESCAPE' });
  });
});

describe('ArgvGuard', () => {
  it('returns shell=false and never inherits an environment by default', () => {
    const validated = new ArgvGuard().validate(['node', 'script.js']);
    expect(validated).toEqual({ argv: ['node', 'script.js'], shell: false, env: {} });
  });

  it('enforces argv, shell-character and environment allowlist boundaries', () => {
    const guard = new ArgvGuard({ allowedEnv: ['PATH', 'LANG'] });
    expect(guard.validate(['node'], { env: { PATH: '/usr/bin' } }).env).toEqual({ PATH: '/usr/bin' });
    expect(() => guard.validate([])).toThrowError(new ArgvGuardError('ARGV_EMPTY'));
    expect(() => guard.validate(['sh', '-c', 'echo ok; rm -rf /'])).toThrowError(new ArgvGuardError('SHELL_METACHARACTER'));
    expect(() => guard.validate(['node'], { shell: true })).toThrowError(new ArgvGuardError('SHELL_DISABLED'));
    expect(() => guard.validate(['node'], { env: { HOME: '/tmp' } })).toThrowError(new ArgvGuardError('ENV_NOT_ALLOWED'));
    expect(() => guard.validate(['node', 'a\u0000b'])).toThrowError(new ArgvGuardError('NUL_BYTE'));
  });

  it('allows explicitly safe shell characters only as an opt-in validation mode', () => {
    const validated = new ArgvGuard().validate(['grep', 'a|b'], { allowShellMetacharacters: true });
    expect(validated.argv).toEqual(['grep', 'a|b']);
  });

  it('validates executor-owned limits independently from model input', () => {
    expect(validateExecutionLimits({ timeoutMs: 1_000, maxOutputBytes: 10_000 })).toEqual({ timeoutMs: 1_000, maxOutputBytes: 10_000 });
    expect(() => validateExecutionLimits({ timeoutMs: 0, maxOutputBytes: 10 })).toThrowError(new ArgvGuardError('LIMIT_INVALID'));
  });
});
