import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForPermissionSmokeStatus,
  parsePermissionSmokeArgs,
  runPermissionSmoke,
  safePermissionSmokeErrorCode,
} from './smoke-permissions.mjs';

test('parses bounded permission smoke modes and rejects unknown values', () => {
  assert.deepEqual(parsePermissionSmokeArgs(['--mode', 'full-host', '--timeout-ms', '500']), { mode: 'full-host', timeoutMs: 500 });
  assert.deepEqual(parsePermissionSmokeArgs([], { VIBEGO_PERMISSION_SMOKE_MODE: 'workspace-coding', VIBEGO_PERMISSION_SMOKE_TIMEOUT_MS: '700' }), { mode: 'workspace-coding', timeoutMs: 700 });
  assert.throws(() => parsePermissionSmokeArgs(['--mode', 'host']), /workspace-coding/u);
  assert.throws(() => parsePermissionSmokeArgs(['--timeout-ms', '99']), /timeout/u);
});

test('reports injected healthy fixtures with bounded redacted evidence', async () => {
  const result = await runPermissionSmoke({ mode: 'both', timeoutMs: 500 }, {
    runtimeFactory: async () => ({
      run: async () => ({
        status: 'healthy',
        platform: 'win32',
        modeResults: {
          workspaceCoding: { status: 'healthy', reasonCode: 'PROFILE_READY' },
          fullHost: { status: 'healthy', reasonCode: 'PROFILE_READY', processExitCode: 0, cancelled: true, revoked: true, expired: true },
        },
      }),
    }),
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.modes.workspaceCoding.reasonCode, 'PROFILE_READY');
  assert.equal(result.modes.fullHost.cancelled, true);
  assert.doesNotMatch(JSON.stringify(result), /C:\\private|sk-|token|secret|raw argv|ready4vibe-permission-smoke/iu);
});

test('keeps blocked and timeout outcomes distinct and never falls back', async () => {
  const blocked = await runPermissionSmoke({ mode: 'full-host', timeoutMs: 500 }, {
    runtimeFactory: async () => ({ run: async () => ({ status: 'blocked', errorCode: 'CAPABILITY_UNAVAILABLE', modeResults: { fullHost: { status: 'blocked', reasonCode: 'CAPABILITY_UNAVAILABLE' } } }) }),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.errorCode, 'CAPABILITY_UNAVAILABLE');

  const timeout = await runPermissionSmoke({ mode: 'full-host', timeoutMs: 100 }, {
    runtimeFactory: async () => ({ run: async () => new Promise(() => undefined) }),
  });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.errorCode, 'PERMISSION_SMOKE_TIMEOUT');
});

test('maps only stable error codes', () => {
  assert.equal(exitCodeForPermissionSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForPermissionSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForPermissionSmokeStatus('timeout'), 3);
  assert.equal(exitCodeForPermissionSmokeStatus('failed'), 1);
  assert.equal(safePermissionSmokeErrorCode({ code: 'CAPABILITY_UNAVAILABLE', message: 'C:\\private secret' }), 'CAPABILITY_UNAVAILABLE');
  assert.equal(safePermissionSmokeErrorCode(new Error('C:\\private secret')), 'PERMISSION_SMOKE_FAILED');
});
