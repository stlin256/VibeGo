import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForDeepSeekSearchSmokeStatus,
  parseDeepSeekSearchSmokeArgs,
  runDeepSeekSearchSmoke,
} from './smoke-deepseek-search.mjs';

test('keeps fixture mode default and requires explicit authorization for live mode', () => {
  assert.deepEqual(parseDeepSeekSearchSmokeArgs(['--mode', 'fixture']), { mode: 'fixture' });
  assert.deepEqual(parseDeepSeekSearchSmokeArgs(['--help']), { help: true });
  assert.throws(() => parseDeepSeekSearchSmokeArgs(['--mode', 'live', '--secret-env', 'READY4VIBE_KEY']), /authorize/u);
  assert.deepEqual(parseDeepSeekSearchSmokeArgs([
    '--mode', 'live', '--authorize', '--endpoint', 'https://api.example.test/v1/responses',
    '--model', 'deepseek-v4-flash', '--secret-env', 'READY4VIBE_KEY', '--timeout-ms', '1200',
  ]), {
    mode: 'live', authorize: true, endpoint: 'https://api.example.test/v1/responses',
    endpointProfile: 'openai-responses', model: 'deepseek-v4-flash', secretEnv: 'READY4VIBE_KEY', timeoutMs: 1_200,
  });
  assert.throws(() => parseDeepSeekSearchSmokeArgs(['--mode', 'live', '--authorize', '--endpoint', 'https://api.example.test/v1/chat/completions', '--secret-env', 'READY4VIBE_KEY']), /Responses/u);
  assert.throws(() => parseDeepSeekSearchSmokeArgs(['--mode', 'live', '--authorize', '--secret-env', 'sk-secret']), /secret-env/u);
  assert.throws(() => parseDeepSeekSearchSmokeArgs(['--api-key', 'sk-secret']), /usage/u);
});

test('covers ready, denied, malformed and cancelled application-port cases', async () => {
  const report = await runDeepSeekSearchSmoke({ mode: 'fixture' }, {
    service: {
      async search(request, gate, signal) {
        if (signal.aborted) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_CANCELLED', items: [] };
        if (gate.network !== 'enabled') return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_DEGRADED', items: [] };
        if ('extra' in request) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_PROTOCOL_INVALID', items: [] };
        if (request.query !== 'bounded fixture query') return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_PROTOCOL_INVALID', items: [] };
        return { status: 'ready', reasonCode: 'DEEPSEEK_SEARCH_READY', items: [{ id: 'deepseek-search:fixture-ref-1' }], projection: { bytes: 64 } };
      },
    },
  });
  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.cases.map((entry) => entry.name), ['ready', 'denied', 'malformed', 'cancelled']);
  assert.ok(report.cases.every((entry) => entry.expected));
  assert.doesNotMatch(JSON.stringify(report), /api[_-]?key|authorization|sk-|example\.com|fixture query/iu);
});

test('keeps exit status bounded', () => {
  assert.equal(exitCodeForDeepSeekSearchSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForDeepSeekSearchSmokeStatus('failed'), 1);
  assert.equal(exitCodeForDeepSeekSearchSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForDeepSeekSearchSmokeStatus('timeout'), 3);
});

test('blocks live mode before probe when the runtime credential is missing', async () => {
  let calls = 0;
  const options = parseDeepSeekSearchSmokeArgs([
    '--mode', 'live', '--authorize', '--endpoint', 'https://api.example.test/v1/responses',
    '--secret-env', 'READY4VIBE_KEY',
  ]);
  const report = await runDeepSeekSearchSmoke(options, {
    secretValue: () => undefined,
    probe: async () => { calls += 1; throw new Error('must not probe'); },
  });
  assert.equal(calls, 0);
  assert.equal(report.status, 'blocked');
  assert.equal(report.errorCode, 'DEEPSEEK_CREDENTIAL_REQUIRED');
  assert.doesNotMatch(JSON.stringify(report), /api\.example|READY4VIBE_KEY|secret/iu);
});

test('requires a ready provider-owned search capability before live execution', async () => {
  const options = parseDeepSeekSearchSmokeArgs([
    '--mode', 'live', '--authorize', '--endpoint', 'https://api.example.test/v1/responses',
    '--secret-env', 'READY4VIBE_KEY',
  ]);
  let searches = 0;
  const report = await runDeepSeekSearchSmoke(options, {
    secretValue: () => 'runtime-secret',
    probe: async () => ({ status: 'ready', latencyMs: 4, capabilities: { webSearch: false } }),
    service: { async search() { searches += 1; return { status: 'ready', items: [], projection: { bytes: 0 } }; } },
  });
  assert.equal(searches, 0);
  assert.equal(report.status, 'blocked');
  assert.equal(report.errorCode, 'DEEPSEEK_SEARCH_CAPABILITY_REQUIRED');
  assert.doesNotMatch(JSON.stringify(report), /runtime-secret|api\.example|bounded provider/iu);
});

test('keeps a healthy live result bounded and uses explicit approval/network inputs', async () => {
  const options = parseDeepSeekSearchSmokeArgs([
    '--mode', 'live', '--authorize', '--endpoint', 'https://api.example.test/v1/responses',
    '--secret-env', 'READY4VIBE_KEY',
  ]);
  let received;
  const report = await runDeepSeekSearchSmoke(options, {
    secretValue: () => 'runtime-secret',
    probe: async () => ({ status: 'ready', latencyMs: 7, capabilities: { webSearch: true, reasoning: false, capturedAt: '2026-08-06T00:00:00.000Z', descriptorRevision: 'probe-1' } }),
    provider: {},
    service: { async search(request, gate) { received = { request, gate }; return { status: 'ready', items: [{ id: 'deepseek-search:one' }], projection: { bytes: 128 } }; } },
    now: (() => { let value = 100; return () => (value += 25); })(),
  });
  assert.equal(report.status, 'healthy');
  assert.equal(report.itemCount, 1);
  assert.equal(report.contextBytes, 128);
  assert.deepEqual(received.gate, { network: 'enabled', approvalGranted: true });
  assert.equal(received.request.maxItems, 4);
  assert.equal(received.request.maxBytes, 8_192);
  assert.doesNotMatch(JSON.stringify(report), /api\.example|runtime-secret|current status|bounded fixture/iu);
});

test('composes the real application port in live mode without a daemon listener', async () => {
  const options = parseDeepSeekSearchSmokeArgs([
    '--mode', 'live', '--authorize', '--endpoint', 'https://api.example.test/v1/responses',
    '--secret-env', 'READY4VIBE_KEY',
  ]);
  const capability = {
    schemaVersion: 'deepseek-provider-capability/v1', providerId: 'deepseek',
    endpointProfile: 'openai-responses', model: options.model, descriptorRevision: 'deepseek-search-smoke-config',
    capturedAt: '2026-08-06T00:00:00.000Z', status: 'ready', streaming: true, toolCalls: false,
    structuredOutput: false, reasoning: false, usage: true, webSearch: true,
    contextLimit: 'unknown', outputLimit: 256, degradedReason: null,
  };
  const report = await runDeepSeekSearchSmoke(options, {
    secretValue: () => 'runtime-secret',
    probe: async () => ({ status: 'ready', latencyMs: 5, capabilities: capability }),
    provider: {
      async search() {
        return {
          schemaVersion: 'deepseek-provider-search/v1', query: 'What is the current status of the VibeGo project?',
          items: [{ schemaVersion: 'deepseek-provider-search-item/v1', source: 'retrieval', trust: 'untrusted', referenceId: 'live-fixture-1', title: 'Bounded result', snippet: 'Fixture-backed application composition.', url: 'https://example.com/bounded' }],
          truncated: false,
        };
      },
    },
  });
  assert.equal(report.status, 'healthy');
  assert.equal(report.itemCount, 1);
  assert.equal(report.contextBytes > 0, true);
  assert.doesNotMatch(JSON.stringify(report), /api\.example|runtime-secret|VibeGo project|example\.com/iu);
});
