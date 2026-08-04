import { once } from 'node:events';
import { chmod, lstat, mkdir, open, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute as nativeIsAbsolute, join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_DIR = dirname(MODULE_PATH);
const DEFAULT_READY_TIMEOUT_MS = 15_000;
const MIN_READY_TIMEOUT_MS = 500;
const MAX_READY_TIMEOUT_MS = 120_000;
const MAX_LAN_URLS = 8;
const PID_FILE_NAME = '.vibego-launcher.pid';
const SAFE_HOSTS = new Set(['127.0.0.1', '::1', '0.0.0.0', '::']);
const SHELL_FRAGMENT = /[\u0000-\u001F\u007F;&|<>`$]/u;
const SECRET_ENV_NAME = /(api[_-]?key|token|secret|password|private[_-]?key)/iu;

export class LauncherError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LauncherError';
    this.code = code;
  }
}

/**
 * Parse the intentionally small launcher CLI. Values are passed to child
 * processes as argv/env fields; no shell command line is ever constructed.
 */
export function parseLauncherArgs(argv, environment = process.env, platform = process.platform) {
  const args = [...argv];
  const result = {
    daemonPath: environment.READY4VIBE_DAEMON_ENTRY
      ? validateAbsolutePath(environment.READY4VIBE_DAEMON_ENTRY, platform, 'READY4VIBE_DAEMON_ENTRY')
      : undefined,
    dataDir: environment.READY4VIBE_DATA_DIR
      ? validateAbsolutePath(environment.READY4VIBE_DATA_DIR, platform, 'READY4VIBE_DATA_DIR')
      : undefined,
    host: environment.READY4VIBE_HOST ?? '127.0.0.1',
    port: parsePort(environment.READY4VIBE_PORT ?? '0', 'READY4VIBE_PORT'),
    open: false,
    readyTimeoutMs: parseReadyTimeout(environment.READY4VIBE_READY_TIMEOUT_MS ?? String(DEFAULT_READY_TIMEOUT_MS)),
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--open') {
      result.open = true;
      continue;
    }
    const [flag, inlineValue] = splitFlag(arg);
    if (!flag || !new Set(['--daemon', '--data-dir', '--host', '--port', '--ready-timeout-ms']).has(flag)) {
      throw new LauncherError('LAUNCHER_USAGE', `unknown launcher argument: ${arg}`);
    }
    const value = inlineValue ?? args[++index];
    if (value === undefined || value.startsWith('--')) {
      throw new LauncherError('LAUNCHER_USAGE', `${flag} requires a value`);
    }
    if (flag === '--daemon') result.daemonPath = validateAbsolutePath(value, platform, '--daemon');
    if (flag === '--data-dir') result.dataDir = validateAbsolutePath(value, platform, '--data-dir');
    if (flag === '--host') result.host = value;
    if (flag === '--port') result.port = parsePort(value, '--port');
    if (flag === '--ready-timeout-ms') result.readyTimeoutMs = parseReadyTimeout(value);
  }

  validateHost(result.host, environment);
  if (!result.help) {
    result.daemonPath ??= defaultDaemonPath(platform);
    result.dataDir ??= resolveUserDataDir(environment, platform);
    result.daemonPath = validateAbsolutePath(result.daemonPath, platform, '--daemon');
    result.dataDir = validateAbsolutePath(result.dataDir, platform, '--data-dir');
  }
  return Object.freeze(result);
}

export function resolveUserDataDir(environment = process.env, platform = process.platform) {
  const pathApi = pathApiFor(platform);
  const home = environment.HOME;
  if (platform === 'win32') {
    const base = environment.LOCALAPPDATA ?? environment.APPDATA;
    if (!base) throw new LauncherError('DATA_DIR_UNAVAILABLE', 'LOCALAPPDATA is required on Windows.');
    return validateAbsolutePath(pathApi.join(base, 'VibeGo'), platform, 'LOCALAPPDATA');
  }
  if (!home || !pathApi.isAbsolute(home)) {
    throw new LauncherError('DATA_DIR_UNAVAILABLE', 'HOME is required to resolve the per-user data directory.');
  }
  if (platform === 'darwin') return pathApi.join(home, 'Library', 'Application Support', 'VibeGo');
  return pathApi.join(environment.XDG_STATE_HOME ?? pathApi.join(home, '.local', 'state'), 'vibego');
}

export function defaultDaemonPath(platform = process.platform) {
  const pathApi = pathApiFor(platform);
  // The repository layout is the development fallback. Release bundles pass
  // an explicit READY4VIBE_DAEMON_ENTRY or --daemon path.
  return pathApi.resolve(MODULE_DIR, '..', 'apps', 'daemon', 'dist', 'main.js');
}

export function parsePort(value, label = 'port') {
  if (!/^\d{1,5}$/u.test(String(value))) throw new LauncherError('INVALID_PORT', `${label} must be an integer from 0 to 65535.`);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new LauncherError('INVALID_PORT', `${label} must be an integer from 0 to 65535.`);
  return port;
}

export function parseReadyTimeout(value) {
  if (!/^\d{1,6}$/u.test(String(value))) throw new LauncherError('INVALID_READY_TIMEOUT', `ready timeout must be ${MIN_READY_TIMEOUT_MS}-${MAX_READY_TIMEOUT_MS} ms.`);
  const timeout = Number(value);
  if (timeout < MIN_READY_TIMEOUT_MS || timeout > MAX_READY_TIMEOUT_MS) {
    throw new LauncherError('INVALID_READY_TIMEOUT', `ready timeout must be ${MIN_READY_TIMEOUT_MS}-${MAX_READY_TIMEOUT_MS} ms.`);
  }
  return timeout;
}

export function validateHost(value, environment = process.env) {
  if (!SAFE_HOSTS.has(value)) throw new LauncherError('INVALID_HOST', 'host must be 127.0.0.1, ::1, 0.0.0.0 or ::.');
  if ((value === '0.0.0.0' || value === '::') && environment.READY4VIBE_ALLOW_LAN !== '1') {
    throw new LauncherError('LAN_DISABLED', 'LAN binding is disabled; set READY4VIBE_ALLOW_LAN=1 explicitly.');
  }
  return value;
}

export function validateAbsolutePath(value, platform, label) {
  const text = String(value);
  if (!text || SHELL_FRAGMENT.test(text)) throw new LauncherError('INVALID_PATH', `${label} contains an unsafe path value.`);
  const pathApi = pathApiFor(platform);
  if (!pathApi.isAbsolute(text)) throw new LauncherError('INVALID_PATH', `${label} must be an absolute path.`);
  return text;
}

export function pathApiFor(platform) {
  return platform === 'win32'
    ? { join: win32.join, resolve: win32.resolve, isAbsolute: win32.isAbsolute }
    : { join: posix.join, resolve: posix.resolve, isAbsolute: posix.isAbsolute };
}

export async function ensureDataDirectory(dataDir, fsApi = defaultFsApi()) {
  if (!nativeIsAbsolute(dataDir) && !win32.isAbsolute(dataDir)) throw new LauncherError('INVALID_PATH', 'data directory must be absolute.');
  try {
    await fsApi.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const info = await fsApi.lstat(dataDir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new LauncherError('DATA_DIR_UNSAFE', 'data directory must be a real directory.');
    // Windows ignores POSIX mode bits; on Unix this makes the owner-only
    // intent explicit and is verified by the launcher fixture.
    await fsApi.chmod(dataDir, 0o700).catch((error) => {
      if (process.platform !== 'win32') throw new LauncherError('DATA_DIR_UNSAFE', 'could not restrict data directory permissions.', error);
    });
    return dataDir;
  } catch (error) {
    if (error instanceof LauncherError) throw error;
    throw new LauncherError('DATA_DIR_UNAVAILABLE', 'could not prepare the per-user data directory.', error);
  }
}

export async function acquirePidLease(dataDir, dependencies = {}) {
  const fsApi = dependencies.fsApi ?? defaultFsApi();
  const pid = dependencies.pid ?? process.pid;
  const isPidAlive = dependencies.isPidAlive ?? defaultIsPidAlive;
  const pidFile = join(dataDir, PID_FILE_NAME);
  const lease = JSON.stringify({ pid, startedAt: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fsApi.open(pidFile, 'wx', 0o600);
      await handle.writeFile(lease, 'utf8');
      await handle.close();
      return Object.freeze({ pidFile, lease });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw new LauncherError('PID_LEASE_UNAVAILABLE', 'could not create the launcher PID lease.', error);
      let previous;
      try {
        previous = JSON.parse(await fsApi.readFile(pidFile, 'utf8'));
      } catch {
        previous = undefined;
      }
      if (Number.isInteger(previous?.pid) && await isPidAlive(previous.pid)) {
        throw new LauncherError('LAUNCHER_ALREADY_RUNNING', 'another VibeGo Host is already running for this data directory.');
      }
      await fsApi.unlink(pidFile).catch((unlinkError) => {
        if (unlinkError?.code !== 'ENOENT') throw new LauncherError('PID_LEASE_UNAVAILABLE', 'could not remove a stale launcher PID lease.', unlinkError);
      });
    }
  }
  throw new LauncherError('PID_LEASE_UNAVAILABLE', 'could not acquire the launcher PID lease.');
}

export async function releasePidLease(lease, fsApi = defaultFsApi()) {
  if (!lease) return;
  try {
    const current = await fsApi.readFile(lease.pidFile, 'utf8');
    if (current === lease.lease) await fsApi.unlink(lease.pidFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new LauncherError('PID_LEASE_RELEASE_FAILED', 'could not release the launcher PID lease.', error);
  }
}

export async function reservePort(host, requestedPort = 0, netApi = {}) {
  const createServer = netApi.createServer ?? createNetServer;
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(new LauncherError('PORT_UNAVAILABLE', 'the requested host/port is unavailable.', error));
    };
    const onListening = () => {
      server.off('error', onError);
      resolvePromise();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, host);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : requestedPort;
  return Object.freeze({
    port,
    async release() {
      if (!server.listening) return;
      await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    },
  });
}

export async function findFreePort(host = '127.0.0.1', netApi = {}) {
  const reservation = await reservePort(host, 0, netApi);
  const port = reservation.port;
  await reservation.release();
  return port;
}

export async function waitForListeningPort({ host, port, timeoutMs, isStopped, probe = probeTcpPort, sleep = delay }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (isStopped?.()) throw new LauncherError('DAEMON_EXITED_BEFORE_READY', 'daemon exited before the Host URL became ready.', lastError);
    try {
      if (await probe(host, port)) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(Math.min(100, Math.max(10, deadline - Date.now())));
  }
  throw new LauncherError('DAEMON_NOT_READY', 'daemon did not become ready before the timeout.', lastError);
}

export function probeTcpPort(host, port) {
  return new Promise((resolvePromise) => {
    // `net.createConnection` is required lazily to keep the module easy to
    // fixture; the global import is avoided so tests can inject `probe`.
    import('node:net').then(({ createConnection }) => {
      const connection = createConnection({ host, port });
      const finish = (ready) => {
        connection.destroy();
        resolvePromise(ready);
      };
      connection.once('connect', () => finish(true));
      connection.once('error', () => finish(false));
      connection.setTimeout(250, () => finish(false));
    }).catch(() => resolvePromise(false));
  });
}

export function buildHostUrls({ host, port, tls = false, interfaces = networkInterfaces() }) {
  const scheme = tls ? 'https' : 'http';
  if (host === '127.0.0.1' || host === '::1') return [`${scheme}://${formatHost(host)}:${port}/`];
  const urls = [];
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if (entry.internal || !entry.address) continue;
      const address = entry.address;
      const formatted = entry.family === 'IPv6' || entry.family === 6 ? `[${address}]` : address;
      const url = `${scheme}://${formatted}:${port}/`;
      if (!urls.includes(url)) urls.push(url);
      if (urls.length >= MAX_LAN_URLS) return urls;
    }
  }
  return urls.length > 0 ? urls : [`${scheme}://${formatHost(host)}:${port}/`];
}

export function redactLauncherLog(line, sensitiveValues = []) {
  let output = String(line);
  for (const value of sensitiveValues) {
    if (typeof value === 'string' && value.length >= 4) output = output.split(value).join('[REDACTED]');
  }
  output = output
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED]')
    .replace(/\bBearer\s+[^\s,;&]+/giu, 'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password|private[_-]?key|authorization)\s*[:=]\s*)([^\s,;&]+)/giu, '$1[REDACTED]')
    .replace(/([?&](?:token|access_token|api[_-]?key|key|secret|password)=)[^&\s]+/giu, '$1[REDACTED]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]+/gu, '[PATH]')
    .replace(/(^|[\s"'(])\/(?:[^\/\s"'()]\/?)*[^\/\s"'()]*/gu, '$1[PATH]');
  return output;
}

export function buildChildEnvironment(environment, { host, port, dataDir }) {
  return {
    ...environment,
    READY4VIBE_HOST: host,
    READY4VIBE_PORT: String(port),
    READY4VIBE_DATA_DIR: dataDir,
  };
}

export async function terminateProcessTree(child, {
  platform = process.platform,
  graceMs = 2_000,
  processApi = process,
  execFile = execFilePromise,
  waitForExit = waitForChildExit,
} = {}) {
  const pid = Number(child?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    try { child.kill?.('SIGTERM'); } catch { /* force cleanup below */ }
    if (await waitForExit(child, graceMs)) return;
    await execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => undefined);
    await waitForExit(child, graceMs);
    return;
  }
  try { processApi.kill(-pid, 'SIGTERM'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  if (await waitForExit(child, graceMs)) return;
  try { processApi.kill(-pid, 'SIGKILL'); } catch (error) { if (error?.code !== 'ESRCH') throw error; }
  await waitForExit(child, graceMs);
}

export function waitForChildExit(child, timeoutMs = 2_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolvePromise) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.('exit', onExit);
      child.off?.('error', onError);
      resolvePromise(value);
    };
    const onExit = () => settle(true);
    const onError = () => settle(false);
    const timer = setTimeout(() => settle(false), timeoutMs);
    child.once?.('exit', onExit);
    child.once?.('error', onError);
  });
}

export async function openHostUrl(url, platform = process.platform, spawnProcess = nodeSpawn) {
  const command = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawnProcess(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref?.();
  return true;
}

export class HostLauncher {
  constructor(options = {}) {
    this.config = Object.freeze({ ...options });
    this.platform = options.platform ?? process.platform;
    this.environment = options.environment ?? process.env;
    this.fsApi = options.fsApi ?? defaultFsApi();
    this.processApi = options.processApi ?? process;
    this.spawnProcess = options.spawnProcess ?? nodeSpawn;
    this.execFile = options.execFile ?? execFilePromise;
    this.netApi = options.netApi ?? {};
    this.networkInterfaces = options.networkInterfaces ?? networkInterfaces;
    this.onLog = options.onLog ?? ((line) => process.stdout.write(`${line}\n`));
    this.openBrowser = options.openBrowser ?? ((url) => openHostUrl(url, this.platform, this.spawnProcess));
    this.sleep = options.sleep ?? delay;
    this.child = undefined;
    this.lease = undefined;
    this.port = undefined;
    this.lastExit = undefined;
  }

  async start() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      throw new LauncherError('LAUNCHER_ALREADY_RUNNING', 'this VibeGo Host launcher is already running.');
    }
    const config = normalizeLauncherConfig(this.config, this.environment, this.platform);
    await ensureDataDirectory(config.dataDir, this.fsApi);
    this.lease = await acquirePidLease(config.dataDir, {
      fsApi: this.fsApi,
      pid: this.processApi.pid ?? process.pid,
      ...(this.config.isPidAlive ? { isPidAlive: this.config.isPidAlive } : {}),
    });
    let reservation;
    let child;
    try {
      reservation = await reservePort(config.host, config.port, this.netApi);
      this.port = reservation.port;
      await reservation.release();
      const childEnvironment = buildChildEnvironment(this.environment, {
        host: config.host,
        port: this.port,
        dataDir: config.dataDir,
      });
      const daemonPath = await resolveDaemonEntry(config.daemonPath, this.fsApi);
      child = this.spawnProcess(process.execPath, [daemonPath], {
        cwd: config.cwd ?? process.cwd(),
        env: childEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: this.platform !== 'win32',
        windowsHide: true,
      });
      this.child = child;
      child.once?.('exit', (code, signal) => {
        this.lastExit = Object.freeze({
          code: typeof code === 'number' ? code : null,
          signal: typeof signal === 'string' ? signal : null,
          status: code === 0 ? 'stopped' : 'failed',
        });
        if (this.child === child) {
          this.child = undefined;
          void this.releaseLease().catch(() => undefined);
        }
      });
      const sensitiveValues = Object.entries(this.environment)
        .filter(([name, value]) => SECRET_ENV_NAME.test(name) && typeof value === 'string')
        .map(([, value]) => value);
      attachChildOutput(child.stdout, 'daemon', (line) => this.onLog(redactLauncherLog(line, sensitiveValues)));
      attachChildOutput(child.stderr, 'daemon', (line) => this.onLog(redactLauncherLog(line, sensitiveValues)));
      let startupError;
      child.once?.('error', (error) => { startupError = error; });
      await waitForListeningPort({
        host: config.host,
        port: this.port,
        timeoutMs: config.readyTimeoutMs,
        isStopped: () => {
          if (startupError) throw new LauncherError('DAEMON_START_FAILED', 'daemon process could not be started.', startupError);
          return child.exitCode !== null || child.signalCode !== null;
        },
        sleep: this.sleep,
      });
      const tls = config.tls;
      const urls = buildHostUrls({ host: config.host, port: this.port, tls, interfaces: this.networkInterfaces() });
      const result = Object.freeze({
        pid: child.pid,
        host: config.host,
        port: this.port,
        url: urls[0],
        urls,
        tls,
        dataDir: config.dataDir,
      });
      this.onLog(`VibeGo Host ready at ${result.url}`);
      this.onLog('Open the URL and complete pairing in the Web interface; no credentials are printed.');
      if (config.open) await this.openBrowser(result.url).catch((error) => this.onLog(`Browser open unavailable: ${redactLauncherLog(error?.message ?? error)}`));
      return result;
    } catch (error) {
      if (child) {
        await terminateProcessTree(child, { platform: this.platform, processApi: this.processApi, execFile: this.execFile, waitForExit: waitForChildExit }).catch(() => undefined);
      }
      await this.releaseLease().catch(() => undefined);
      throw error instanceof LauncherError ? error : new LauncherError('DAEMON_START_FAILED', 'daemon could not be started.', error);
    }
  }

  async stop() {
    const child = this.child;
    this.child = undefined;
    if (child) await terminateProcessTree(child, { platform: this.platform, processApi: this.processApi, execFile: this.execFile, waitForExit: waitForChildExit });
    await this.releaseLease();
    return Object.freeze({ stopped: true, ...(this.lastExit ? { exit: this.lastExit } : {}) });
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async waitUntilExit() {
    const child = this.child;
    if (!child) return this.lastExit;
    await waitForChildExitIndefinitely(child);
    return this.lastExit;
  }

  async releaseLease() {
    const lease = this.lease;
    this.lease = undefined;
    if (lease) await releasePidLease(lease, this.fsApi);
  }

  get status() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) return 'running';
    return this.lastExit?.status ?? 'stopped';
  }
}

export function normalizeLauncherConfig(options, environment = process.env, platform = process.platform) {
  const parsed = options.daemonPath ? options : parseLauncherArgs([], environment, platform);
  const daemonPath = validateAbsolutePath(parsed.daemonPath, platform, '--daemon');
  const dataDir = validateAbsolutePath(parsed.dataDir, platform, '--data-dir');
  const host = validateHost(parsed.host ?? '127.0.0.1', environment);
  const port = parsePort(String(parsed.port ?? 0), '--port');
  const readyTimeoutMs = parseReadyTimeout(String(parsed.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS));
  return Object.freeze({
    daemonPath,
    dataDir,
    host,
    port,
    readyTimeoutMs,
    open: parsed.open === true,
    tls: environment.READY4VIBE_TLS_ENABLED === '1' || ((host === '0.0.0.0' || host === '::') && environment.READY4VIBE_ALLOW_INSECURE_LAN !== '1'),
    ...(parsed.cwd ? { cwd: validateAbsolutePath(parsed.cwd, platform, '--cwd') } : {}),
  });
}

async function resolveDaemonEntry(daemonPath, fsApi) {
  try {
    const resolved = await fsApi.realpath(daemonPath);
    const info = await fsApi.stat(resolved);
    if (!info.isFile()) throw new Error('not a file');
    return resolved;
  } catch (error) {
    throw new LauncherError('DAEMON_ENTRY_UNAVAILABLE', 'daemon entry file is unavailable.', error);
  }
}

function attachChildOutput(stream, prefix, onLine) {
  if (!stream) return;
  const reader = createInterface({ input: stream });
  reader.on('line', (line) => onLine(`[${prefix}] ${line}`));
}

function splitFlag(value) {
  const separator = value.indexOf('=');
  if (separator < 0) return [value, undefined];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function formatHost(host) {
  return host.includes(':') ? `[${host}]` : host;
}

function defaultFsApi() {
  return { mkdir, lstat, chmod, open, readFile, unlink, realpath, stat };
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function execFilePromise(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    nodeExecFile(command, args, options, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolvePromise({ stdout, stderr });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForSignal(launcher) {
  await new Promise((resolvePromise) => {
    const onSignal = () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      resolvePromise();
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
  await launcher.stop();
}

function waitForChildExitIndefinitely(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const onExit = () => {
      child.off?.('exit', onExit);
      resolvePromise();
    };
    child.once?.('exit', onExit);
  });
}

function usage() {
  return [
    'Usage: node scripts/host-launcher.mjs [options]',
    '',
    '  --daemon <absolute-js-entry>       daemon entry (or READY4VIBE_DAEMON_ENTRY)',
    '  --data-dir <absolute-directory>    per-user data directory',
    '  --host <127.0.0.1|::1|0.0.0.0|::>  loopback by default; LAN needs READY4VIBE_ALLOW_LAN=1',
    '  --port <0-65535>                   0 discovers a free port',
    '  --ready-timeout-ms <500-120000>    bounded readiness timeout',
    '  --open                             explicitly open the Host URL',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(MODULE_PATH)) {
  try {
    const options = parseLauncherArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
    } else {
      const launcher = new HostLauncher(options);
      await launcher.start();
      const outcome = await Promise.race([
        waitForSignal(launcher).then(() => 'signal'),
        launcher.waitUntilExit().then(() => 'exit'),
      ]);
      if (outcome === 'exit' && launcher.lastExit?.status === 'failed') process.exitCode = 1;
    }
  } catch (error) {
    const code = error instanceof LauncherError ? error.code : 'LAUNCHER_FAILED';
    process.stderr.write(`${code}: ${redactLauncherLog(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  }
}
