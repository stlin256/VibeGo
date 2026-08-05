import assert from 'node:assert/strict';
import test from 'node:test';

import {
  baseConfig,
  exitCodeForRecoverySmokeStatus,
  parseRecoverySmokeArgs,
  runRecoverySmoke,
  safeRecoverySmokeErrorCode,
} from './smoke-recovery.mjs';

test('parses bounded recovery smoke modes and rejects unsafe values', () => {
  assert.deepEqual(parseRecoverySmokeArgs(['--mode', 'recovery', '--timeout-ms', '500']), { mode: 'recovery', timeoutMs: 500 });
  assert.deepEqual(parseRecoverySmokeArgs([], { VIBEGO_RECOVERY_SMOKE_MODE: 'concurrency', VIBEGO_RECOVERY_SMOKE_TIMEOUT_MS: '700' }), { mode: 'concurrency', timeoutMs: 700 });
  assert.throws(() => parseRecoverySmokeArgs(['--mode', 'shell']), /concurrency/u);
  assert.throws(() => parseRecoverySmokeArgs(['--timeout-ms', '99']), /timeout/u);
});

test('reports injected healthy application evidence without raw run data', async () => {
  const result = await runRecoverySmoke({ mode: 'both', timeoutMs: 500 }, {
    runtimeFactory: async () => ({
      run: async () => ({
        status: 'healthy',
        concurrency: { status: 'healthy', maxConcurrent: 2, completedRuns: 2, overlapped: true, queuedCancelled: true, inFlightCancelled: true, terminalEvents: 3 },
        recovery: { status: 'healthy', marked: 1, secondMarked: 0, recoveryEvents: 1, providerCallsAfterRecovery: 0, idempotent: true },
      }),
    }),
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.concurrency.maxConcurrent, 2);
  assert.equal(result.recovery.idempotent, true);
  assert.doesNotMatch(JSON.stringify(result), /C:\\private|sk-|token|secret|raw transcript|run_recovery_restart_1/iu);
});

test('keeps blocked and timeout statuses distinct', async () => {
  const blocked = await runRecoverySmoke({ mode: 'recovery', timeoutMs: 500 }, {
    runtimeFactory: async () => ({ run: async () => ({ status: 'blocked', errorCode: 'RECOVERY_DEPENDENCY_BLOCKED' }) }),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.errorCode, 'RECOVERY_DEPENDENCY_BLOCKED');

  const timeout = await runRecoverySmoke({ mode: 'recovery', timeoutMs: 100 }, {
    runtimeFactory: async () => ({ run: async () => new Promise(() => undefined) }),
  });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.errorCode, 'RECOVERY_SMOKE_TIMEOUT');
});

test('keeps exit/error mappings bounded and config values deterministic', () => {
  assert.equal(exitCodeForRecoverySmokeStatus('healthy'), 0);
  assert.equal(exitCodeForRecoverySmokeStatus('blocked'), 2);
  assert.equal(exitCodeForRecoverySmokeStatus('timeout'), 3);
  assert.equal(exitCodeForRecoverySmokeStatus('failed'), 1);
  assert.equal(safeRecoverySmokeErrorCode({ code: 'RECOVERY_DEPENDENCY_BLOCKED', message: 'C:\\secret' }), 'RECOVERY_DEPENDENCY_BLOCKED');
  assert.equal(safeRecoverySmokeErrorCode(new Error('C:\\secret')), 'RECOVERY_SMOKE_FAILED');
  assert.equal(baseConfig('recovery_workspace_one').taskTrust, 'trusted-workspace');
  assert.equal(baseConfig('recovery_workspace_one').sandbox.mode, 'read-only');
});
