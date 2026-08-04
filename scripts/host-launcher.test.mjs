import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  HostLauncher,
  LauncherError,
  acquirePidLease,
  buildHostUrls,
  buildChildEnvironment,
  ensureDataDirectory,
  findFreePort,
  parseLauncherArgs,
  redactLauncherLog,
  releasePidLease,
  resolveUserDataDir,
  terminateProcessTree,
} from './host-launcher.mjs';

const temporaryRoots = [];

test.afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('parses bounded arguments and preserves loopback/LAN safety gates', () => {
  const options = parseLauncherArgs([
    '--daemon', 'C:\\VibeGo\\daemon.mjs',
    '--data-dir', 'C:\\Users\\tester\\AppData\\Local\\VibeGo',
    '--host', '127.0.0.1',
    '--port', '0',
    '--ready-timeout-ms', '5000',
    '--open',
  ], {}, 'win32');
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.port, 0);
  assert.equal(options.readyTimeoutMs, 5000);
  assert.equal(options.open, true);
  assert.throws(() => parseLauncherArgs(['--host', '0.0.0.0'], {}, 'win32'), (error) => error.code === 'LAN_DISABLED');
  assert.throws(() => parseLauncherArgs(['--daemon', 'C:\\VibeGo\\bad;entry.mjs'], {}, 'win32'), (error) => error.code === 'INVALID_PATH');
  assert.throws(() => parseLauncherArgs(['--port', '70000'], {}, 'win32'), (error) => error.code === 'INVALID_PORT');
});

test('resolves per-user data directories for all supported host fixtures', () => {
  assert.equal(resolveUserDataDir({ LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }, 'win32'), 'C:\\Users\\tester\\AppData\\Local\\VibeGo');
  assert.equal(resolveUserDataDir({ HOME: '/Users/tester' }, 'darwin'), '/Users/tester/Library/Application Support/VibeGo');
  assert.equal(resolveUserDataDir({ HOME: '/home/tester' }, 'linux'), '/home/tester/.local/state/vibego');
  assert.equal(resolveUserDataDir({ HOME: '/home/tester', XDG_STATE_HOME: '/var/state/tester' }, 'linux'), '/var/state/tester/vibego');
});

test('creates an owner-only data directory and discovers a disposable port', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibego-launcher-permissions-'));
  temporaryRoots.push(root);
  const dataDir = join(root, 'data');
  await ensureDataDirectory(dataDir);
  if (process.platform !== 'win32') assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  const port = await findFreePort('127.0.0.1');
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
});

test('redacts secret-shaped values and absolute paths before forwarding child logs', () => {
  const line = 'API_KEY=sk-1234567890 path=C:\\Users\\tester\\VibeGo token=secret-token https://host.test/?access_token=abc123';
  const redacted = redactLauncherLog(line, ['sk-1234567890', 'secret-token']);
  assert.doesNotMatch(redacted, /sk-1234567890|secret-token|C:\\Users\\tester/u);
  assert.match(redacted, /\[REDACTED\]/u);
  assert.match(redacted, /\[PATH\]/u);
  assert.match(redacted, /access_token=\[REDACTED\]/u);
});

test('PID lease rejects live owners and removes only stale owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibego-launcher-lease-'));
  temporaryRoots.push(root);
  const live = await acquirePidLease(root, { pid: 1234, isPidAlive: async () => true });
  await releasePidLease(live);
  const stale = await acquirePidLease(root, { pid: 1235, isPidAlive: async () => false });
  assert.equal(JSON.parse(await readFile(stale.pidFile, 'utf8')).pid, 1235);
  await assert.rejects(
    acquirePidLease(root, { pid: 1236, isPidAlive: async () => true }),
    (error) => error.code === 'LAUNCHER_ALREADY_RUNNING',
  );
  await releasePidLease(stale);
});

test('builds bounded loopback/LAN URL projections and child environment', () => {
  assert.deepEqual(buildHostUrls({ host: '127.0.0.1', port: 8787 }), ['http://127.0.0.1:8787/']);
  assert.deepEqual(buildHostUrls({ host: '0.0.0.0', port: 8787, tls: true, interfaces: {
    ethernet: [{ address: '192.168.1.9', family: 'IPv4', internal: false }],
    loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  } }), ['https://192.168.1.9:8787/']);
  assert.deepEqual(buildChildEnvironment({ READY4VIBE_MODEL_API_KEY: 'out-of-band' }, {
    host: '127.0.0.1', port: 43123, dataDir: 'C:\\Users\\tester\\VibeGo',
  }), {
    READY4VIBE_MODEL_API_KEY: 'out-of-band',
    READY4VIBE_HOST: '127.0.0.1',
    READY4VIBE_PORT: '43123',
    READY4VIBE_DATA_DIR: 'C:\\Users\\tester\\VibeGo',
  });
});

test('uses Unix process groups and Windows taskkill fallback without shell composition', async () => {
  const unixKills = [];
  let unixAlive = true;
  const unixChild = { pid: 321, exitCode: null, signalCode: null };
  await terminateProcessTree(unixChild, {
    platform: 'linux',
    graceMs: 1,
    processApi: { kill: (pid, signal) => { unixKills.push([pid, signal]); unixAlive = false; unixChild.exitCode = 0; } },
    waitForExit: async () => !unixAlive,
  });
  assert.deepEqual(unixKills, [[-321, 'SIGTERM']]);

  const windowsCalls = [];
  const windowsChild = { pid: 654, exitCode: null, signalCode: null, kill: () => undefined };
  await terminateProcessTree(windowsChild, {
    platform: 'win32',
    graceMs: 1,
    waitForExit: async () => false,
    execFile: async (command, args, options) => windowsCalls.push([command, args, options]),
  });
  assert.deepEqual(windowsCalls, [['taskkill.exe', ['/PID', '654', '/T', '/F'], { windowsHide: true }]]);
});

test('starts, reports, restarts and stops a disposable daemon without writing secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vibego-launcher-lifecycle-'));
  temporaryRoots.push(root);
  const daemon = join(root, 'fixture-daemon.mjs');
  await writeFile(daemon, [
    "import { createServer } from 'node:http';",
    "const port = Number(process.env.READY4VIBE_PORT);",
    "const server = createServer((request, response) => { response.writeHead(200); response.end('ready4vibe'); });",
    "server.listen(port, process.env.READY4VIBE_HOST, () => console.log('fixture listening secret=sk-fixture-secret path=' + process.env.READY4VIBE_DATA_DIR));",
    "process.once('SIGTERM', () => server.close(() => process.exit(0)));",
  ].join('\n'), 'utf8');
  const logs = [];
  const launcher = new HostLauncher({
    daemonPath: resolve(daemon),
    dataDir: join(root, 'data'),
    host: '127.0.0.1',
    port: 0,
    readyTimeoutMs: 5000,
    environment: { ...process.env, READY4VIBE_MODEL_API_KEY: 'sk-fixture-secret' },
    onLog: (line) => logs.push(line),
    sleep: (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(milliseconds, 20))),
  });
  const first = await launcher.start();
  assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/u);
  assert.equal((await (await fetch(first.url)).text()), 'ready4vibe');
  assert.ok(logs.some((line) => line.includes('VibeGo Host ready')));
  assert.ok(logs.every((line) => !line.includes('sk-fixture-secret') && !line.includes(first.dataDir)));
  const second = await launcher.restart();
  assert.notEqual(second.port, undefined);
  await launcher.stop();
  await assert.rejects(fetch(second.url), /fetch failed/u);
});
