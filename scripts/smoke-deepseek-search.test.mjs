import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForDeepSeekSearchSmokeStatus,
  parseDeepSeekSearchSmokeArgs,
  runDeepSeekSearchSmoke,
} from './smoke-deepseek-search.mjs';

test('accepts only the explicit fixture mode and rejects endpoint/key arguments', () => {
  assert.deepEqual(parseDeepSeekSearchSmokeArgs(['--mode', 'fixture']), { mode: 'fixture' });
  assert.deepEqual(parseDeepSeekSearchSmokeArgs(['--help']), { help: true });
  assert.throws(() => parseDeepSeekSearchSmokeArgs(['--mode', 'live']), /fixture/u);
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
});
