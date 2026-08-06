import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLaunchLocalArgs,
  planBootstrap,
  platformInvocation,
  resolvePnpm,
  runLaunchLocal,
  safeLaunchLocalErrorCode,
  LaunchLocalError,
} from './launch-local.mjs';

test('parses defaults, flags, environment and rejects unknown arguments', () => {
  const parsed = parseLaunchLocalArgs([], {});
  assert.deepEqual({ skipInstall: parsed.skipInstall, skipBuild: parsed.skipBuild, open: parsed.open }, { skipInstall: false, skipBuild: false, open: true });
  const flags = parseLaunchLocalArgs(['--skip-install', '--skip-build', '--no-open', '--host', '127.0.0.1', '--port', '8787'], {});
  assert.equal(flags.skipInstall, true);
  assert.equal(flags.skipBuild, true);
  assert.equal(flags.open, false);
  assert.equal(flags.host, '127.0.0.1');
  assert.equal(flags.port, '8787');
  assert.equal(parseLaunchLocalArgs([], { VIBEGO_LAUNCH_SKIP_INSTALL: '1', VIBEGO_LAUNCH_NO_OPEN: '1' }).open, false);
  assert.equal(parseLaunchLocalArgs(['--help'], {}).help, true);
  assert.throws(() => parseLaunchLocalArgs(['--unknown'], {}), (error) => error.code === 'LAUNCH_ARGUMENT_INVALID');
  assert.throws(() => parseLaunchLocalArgs(['--host'], {}), (error) => error.code === 'LAUNCH_ARGUMENT_INVALID');
});

function stubFs(existing) {
  return { access: async (path) => { if (!existing.some((entry) => path.endsWith(entry))) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } } };
}

test('plans install and build only when markers are missing', async () => {
  assert.deepEqual(await planBootstrap({ skipInstall: false, skipBuild: false }, stubFs([])), ['install', 'build']);
  assert.deepEqual(await planBootstrap({ skipInstall: false, skipBuild: false }, stubFs(['.modules.yaml', 'main.js', 'index.html'])), []);
  assert.deepEqual(await planBootstrap({ skipInstall: false, skipBuild: false }, stubFs(['.modules.yaml', 'main.js'])), ['build']);
  assert.deepEqual(await planBootstrap({ skipInstall: true, skipBuild: true }, stubFs([])), []);
});

function stubExecFile(outcomes) {
  const calls = [];
  const impl = (command, args, _options, callback) => {
    calls.push([command, ...args]);
    const outcome = outcomes.shift() ?? { fail: false };
    callback(outcome.fail ? new Error('unavailable') : null, '11.9.0');
  };
  return { impl, calls };
}

test('resolves pnpm from PATH, via corepack, or fails closed', async () => {
  const onPath = stubExecFile([{ fail: false }]);
  assert.equal((await resolvePnpm({ execFileImpl: onPath.impl, environment: {} })).via, 'path');

  const viaCorepack = stubExecFile([{ fail: true }, { fail: false }, { fail: false }, { fail: false }]);
  const resolved = await resolvePnpm({ execFileImpl: viaCorepack.impl, environment: {}, nodePath: '/runtime/node', packageJson: { packageManager: 'pnpm@11.9.0' } });
  assert.equal(resolved.via, 'corepack');
  assert.ok(viaCorepack.calls.some((call) => call.join(' ').includes('prepare pnpm@11.9.0')));

  const broken = stubExecFile([{ fail: true }, { fail: true }]);
  await assert.rejects(() => resolvePnpm({ execFileImpl: broken.impl, environment: {}, nodePath: '/runtime/node' }), (error) => error.code === 'LAUNCH_PNPM_UNAVAILABLE');
});

test('runs install, build and the host launcher in order without a shell', async () => {
  const spawned = [];
  const spawnImpl = (command, args, options) => {
    spawned.push({ command, args: [...args], shell: options.shell ?? false, cwd: options.cwd });
    const listeners = {};
    return { on: (event, handler) => { listeners[event] = handler; if (event === 'exit') queueMicrotask(() => handler(0)); } };
  };
  const logs = [];
  const result = await runLaunchLocal(
    { skipInstall: false, skipBuild: false, open: true, host: undefined, port: undefined },
    {
      repoRoot: '/repo',
      environment: {},
      spawnImpl,
      onLog: (line) => logs.push(line),
      fsApi: stubFs([]),
      nodePath: '/runtime/node',
      pnpmDeps: { execFileImpl: stubExecFile([{ fail: false }]).impl },
    },
  );
  assert.equal(result.status, 'stopped');
  const installInvocation = platformInvocation('pnpm', ['install', '--frozen-lockfile'], {});
  const buildInvocation = platformInvocation('pnpm', ['build'], {});
  assert.deepEqual({ command: spawned[0].command, args: spawned[0].args }, { command: installInvocation.command, args: installInvocation.args });
  assert.deepEqual({ command: spawned[1].command, args: spawned[1].args }, { command: buildInvocation.command, args: buildInvocation.args });
  const launcher = spawned.at(-1);
  assert.equal(launcher.args[0].replaceAll('\\', '/'), '/repo/scripts/host-launcher.mjs');
  assert.ok(launcher.args.includes('--daemon'));
  assert.ok(launcher.args.includes('--open'));
  assert.ok(launcher.args.some((arg) => arg.endsWith('main.js')));
  assert.ok(spawned.every((call) => call.shell === false && call.cwd === '/repo'));
});

test('fails closed when a bootstrap step exits non-zero', async () => {
  const spawnImpl = () => {
    const listeners = {};
    return { on: (event, handler) => { listeners[event] = handler; if (event === 'exit') queueMicrotask(() => handler(1)); } };
  };
  await assert.rejects(
    () => runLaunchLocal(
      { skipInstall: false, skipBuild: true, open: false },
      {
        repoRoot: '/repo',
        environment: {},
        spawnImpl,
        onLog: () => {},
        fsApi: stubFs(['main.js', 'index.html']),
        nodePath: '/runtime/node',
        pnpmDeps: { execFileImpl: stubExecFile([{ fail: false }]).impl },
      },
    ),
    (error) => error.code === 'LAUNCH_STEP_FAILED',
  );
});

test('maps unknown errors to a stable code', () => {
  assert.equal(safeLaunchLocalErrorCode(new LaunchLocalError('LAUNCH_STEP_FAILED', 'x')), 'LAUNCH_STEP_FAILED');
  assert.equal(safeLaunchLocalErrorCode(new Error('plain')), 'LAUNCH_FAILED');
  assert.equal(safeLaunchLocalErrorCode({ code: 'not-a-code' }), 'LAUNCH_FAILED');
});
