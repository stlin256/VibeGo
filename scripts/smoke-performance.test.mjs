import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForPerformanceSmokeStatus,
  parsePerformanceSmokeArgs,
  runPerformanceSmoke,
  safePerformanceSmokeErrorCode,
} from './smoke-performance.mjs';

test('parses only bounded performance smoke modes and limits', () => {
  assert.deepEqual(parsePerformanceSmokeArgs(['--mode', 'application', '--runs', '3', '--timeout-ms', '1200']), { mode: 'application', runs: 3, timeoutMs: 1200 });
  assert.deepEqual(parsePerformanceSmokeArgs([], { VIBEGO_PERFORMANCE_SMOKE_MODE: 'resources', VIBEGO_PERFORMANCE_SMOKE_RUNS: '2', VIBEGO_PERFORMANCE_SMOKE_TIMEOUT_MS: '900' }), { mode: 'resources', runs: 2, timeoutMs: 900 });
  assert.throws(() => parsePerformanceSmokeArgs(['--mode', 'stress']), /application, resources or both/u);
  assert.throws(() => parsePerformanceSmokeArgs(['--runs', '1']), /between 2 and 4/u);
  assert.throws(() => parsePerformanceSmokeArgs(['--timeout-ms', '99']), /timeout/u);
});

test('reports injected healthy application/resource evidence without secrets or paths', async () => {
  const result = await runPerformanceSmoke({ mode: 'both', runs: 2, timeoutMs: 1_000 }, {
    runtimeFactory: async () => ({
      run: async () => ({
        status: 'healthy',
        application: { status: 'healthy', requestedRuns: 2, completedRuns: 2, maxConcurrent: 2, overlapped: true, p95LatencyMs: 42, terminalEvents: 2 },
        resources: { status: 'healthy', sampleCount: 2, droppedSampleCount: 0, writerBatches: 1, state: 'ready', rssBytes: '123456' },
      }),
    }),
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.application.maxConcurrent, 2);
  assert.equal(result.resources.sampleCount, 2);
  assert.doesNotMatch(JSON.stringify(result), /sk-|C:\\private|api[_-]?key|private key/iu);
});

test('maps blocked and timeout outcomes without fallback', async () => {
  const blocked = await runPerformanceSmoke({ mode: 'application', runs: 2, timeoutMs: 1_000 }, {
    runtimeFactory: async () => ({ run: async () => ({ status: 'blocked', errorCode: 'PERFORMANCE_PROVIDER_BLOCKED' }) }),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.errorCode, 'PERFORMANCE_PROVIDER_BLOCKED');

  const timeout = await runPerformanceSmoke({ mode: 'resources', runs: 2, timeoutMs: 100 }, {
    runtimeFactory: async () => ({ run: async () => new Promise(() => undefined) }),
  });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.errorCode, 'PERFORMANCE_SMOKE_TIMEOUT');
});

test('keeps exit/error mappings bounded', () => {
  assert.equal(exitCodeForPerformanceSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForPerformanceSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForPerformanceSmokeStatus('timeout'), 3);
  assert.equal(exitCodeForPerformanceSmokeStatus('failed'), 1);
  assert.equal(safePerformanceSmokeErrorCode({ code: 'PERFORMANCE_RESOURCE_DEGRADED', message: 'C:\\private secret' }), 'PERFORMANCE_RESOURCE_DEGRADED');
  assert.equal(safePerformanceSmokeErrorCode(new Error('C:\\private secret')), 'PERFORMANCE_SMOKE_FAILED');
});
