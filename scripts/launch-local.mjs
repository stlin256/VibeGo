import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(MODULE_PATH), '..');
const DAEMON_ENTRY = join('apps', 'daemon', 'dist', 'main.js');
const WEB_ENTRY = join('apps', 'web', 'dist', 'index.html');
const PNPM_MARKER = join('node_modules', '.modules.yaml');

const USAGE = [
  'usage: pnpm launch [-- --skip-install] [-- --skip-build] [-- --no-open] [-- --host <host>] [-- --port <port>]',
  '',
  'Bootstraps a source checkout and starts VibeGo through the Host launcher.',
  'All state stays inside the repository; nothing is installed system-wide.',
].join('\n');

export class LaunchLocalError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LaunchLocalError';
    this.code = code;
  }
}

export function parseLaunchLocalArgs(argv, environment = process.env) {
  const result = {
    skipInstall: environment.VIBEGO_LAUNCH_SKIP_INSTALL === '1',
    skipBuild: environment.VIBEGO_LAUNCH_SKIP_BUILD === '1',
    open: environment.VIBEGO_LAUNCH_NO_OPEN !== '1',
    host: environment.READY4VIBE_HOST,
    port: environment.READY4VIBE_PORT,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') return Object.freeze({ ...result, help: true });
    if (argument === '--skip-install') { result.skipInstall = true; continue; }
    if (argument === '--skip-build') { result.skipBuild = true; continue; }
    if (argument === '--no-open') { result.open = false; continue; }
    if (argument === '--host' || argument === '--port') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new LaunchLocalError('LAUNCH_ARGUMENT_INVALID', USAGE);
      if (argument === '--host') result.host = value;
      else result.port = value;
      index += 1;
      continue;
    }
    throw new LaunchLocalError('LAUNCH_ARGUMENT_INVALID', USAGE);
  }
  return Object.freeze(result);
}

async function pathExists(path, fsApi) {
  try {
    await fsApi.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide which bootstrap steps are needed. Pure decision logic: the file
 * probes are injectable so tests never touch the real checkout.
 */
export async function planBootstrap(options, fsApi = { access }, repoRoot = REPO_ROOT) {
  const steps = [];
  if (!options.skipInstall && !await pathExists(join(repoRoot, PNPM_MARKER), fsApi)) steps.push('install');
  const daemonBuilt = await pathExists(join(repoRoot, DAEMON_ENTRY), fsApi);
  const webBuilt = await pathExists(join(repoRoot, WEB_ENTRY), fsApi);
  if (!options.skipBuild && (!daemonBuilt || !webBuilt)) steps.push('build');
  return Object.freeze(steps);
}

function execFileBounded(execFileImpl, command, args, options) {
  return new Promise((resolvePromise, reject) => {
    execFileImpl(command, args, { windowsHide: true, ...options }, (error, stdout) => {
      if (error) reject(error);
      else resolvePromise(stdout);
    });
  });
}

function quoteWindowsArg(value) {
  return /[\s"&|<>^*]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

/**
 * pnpm/corepack are .cmd shims on Windows, which cannot be spawned directly
 * without a shell. Wrap them through ComSpec exactly like
 * scripts/verification-evidence.mjs does; all other commands keep plain
 * argv form with shell disabled.
 */
export function platformInvocation(command, args, environment = process.env, platform = process.platform) {
  if (platform === 'win32' && (command === 'pnpm' || command === 'corepack')) {
    return Object.freeze({
      command: environment.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', [`${command}.cmd`, ...args].map(quoteWindowsArg).join(' ')],
    });
  }
  return Object.freeze({ command, args });
}

/**
 * Locate a pnpm runner. Prefers a pnpm already on PATH; otherwise activates
 * the packageManager-pinned pnpm via the corepack shipped with Node. Both
 * stay process-local; .cmd shims are wrapped through ComSpec on Windows.
 */
export async function resolvePnpm(deps = {}) {
  const execFileImpl = deps.execFileImpl ?? nodeExecFile;
  const environment = deps.environment ?? process.env;
  const pinned = deps.pinnedPnpm ?? readPinnedPnpm(deps.packageJson ?? null);
  const pnpmProbe = platformInvocation('pnpm', ['--version'], environment);
  try {
    await execFileBounded(execFileImpl, pnpmProbe.command, pnpmProbe.args, { env: environment });
    return Object.freeze({ command: 'pnpm', via: 'path' });
  } catch {
    // fall through to corepack
  }
  try {
    const enable = platformInvocation('corepack', ['enable'], environment);
    await execFileBounded(execFileImpl, enable.command, enable.args, { env: environment });
    if (pinned) {
      const prepare = platformInvocation('corepack', ['prepare', pinned, '--activate'], environment);
      await execFileBounded(execFileImpl, prepare.command, prepare.args, { env: environment });
    }
    await execFileBounded(execFileImpl, pnpmProbe.command, pnpmProbe.args, { env: environment });
    return Object.freeze({ command: 'pnpm', via: 'corepack' });
  } catch (error) {
    throw new LaunchLocalError('LAUNCH_PNPM_UNAVAILABLE', 'pnpm is unavailable and corepack activation failed; install pnpm or re-run with a network connection', error);
  }
}

function readPinnedPnpm(packageJson) {
  const declared = packageJson?.packageManager;
  return typeof declared === 'string' && /^pnpm@\d+\.\d+\.\d+$/u.test(declared) ? declared : null;
}

function spawnStep(spawnImpl, command, args, repoRoot, environment, label, onLog) {
  return new Promise((resolvePromise, reject) => {
    onLog(`[launch] ${label}...`);
    const child = spawnImpl(command, args, { cwd: repoRoot, env: environment, stdio: 'inherit', windowsHide: false });
    child.on('error', (error) => reject(new LaunchLocalError('LAUNCH_STEP_SPAWN_FAILED', `${label} failed to start`, error)));
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new LaunchLocalError('LAUNCH_STEP_FAILED', `${label} exited with code ${code}`));
    });
  });
}

export async function runLaunchLocal(options, deps = {}) {
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const environment = deps.environment ?? process.env;
  const spawnImpl = deps.spawnImpl ?? nodeSpawn;
  const onLog = deps.onLog ?? ((line) => process.stdout.write(`${line}\n`));
  const pnpm = await resolvePnpm({ ...deps.pnpmDeps, environment });

  for (const step of await planBootstrap(options, deps.fsApi, repoRoot)) {
    if (step === 'install') {
      const invocation = platformInvocation(pnpm.command, ['install', '--frozen-lockfile'], environment);
      await spawnStep(spawnImpl, invocation.command, invocation.args, repoRoot, environment, 'install dependencies', onLog);
    }
    if (step === 'build') {
      const invocation = platformInvocation(pnpm.command, ['build'], environment);
      await spawnStep(spawnImpl, invocation.command, invocation.args, repoRoot, environment, 'build workspace', onLog);
    }
  }

  const launcherArgs = [join(repoRoot, 'scripts', 'host-launcher.mjs'), '--daemon', join(repoRoot, DAEMON_ENTRY)];
  if (options.host) launcherArgs.push('--host', options.host);
  if (options.port) launcherArgs.push('--port', options.port);
  if (options.open) launcherArgs.push('--open');
  onLog('[launch] starting VibeGo Host (Ctrl+C to stop)');
  const nodePath = deps.nodePath ?? process.execPath;
  const child = spawnImpl(nodePath, launcherArgs, { cwd: repoRoot, env: environment, stdio: 'inherit', windowsHide: false });
  return new Promise((resolvePromise, reject) => {
    child.on('error', (error) => reject(new LaunchLocalError('LAUNCH_DAEMON_SPAWN_FAILED', 'Host launcher failed to start', error)));
    child.on('exit', (code) => resolvePromise(Object.freeze({ status: 'stopped', exitCode: code ?? 0 })));
  });
}

export function safeLaunchLocalErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^LAUNCH_[A-Z0-9_]{1,64}$/u.test(code) ? code : 'LAUNCH_FAILED';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(MODULE_PATH)) {
  try {
    const options = parseLaunchLocalArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
    } else {
      await runLaunchLocal(options);
    }
  } catch (error) {
    process.stderr.write(`${safeLaunchLocalErrorCode(error)}: ${error?.message ?? error}\n`);
    process.exitCode = 2;
  }
}
