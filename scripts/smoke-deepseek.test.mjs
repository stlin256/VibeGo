import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForDeepSeekSmokeStatus,
  parseDeepSeekSmokeArgs,
  runDeepSeekSmoke,
  safeDeepSeekSmokeErrorCode,
} from './smoke-deepseek.mjs';

const validOptions = {
  endpoint: 'https://api.example.test/v1/chat/completions',
  endpointProfile: 'openai-chat-completions',
  model: 'deepseek-v4-flash',
  secretEnv: 'READY4VIBE_DEEPSEEK_API_KEY',
  scenario: 'text',
  thinkingMode: 'off',
  timeoutMs: 1_000,
};

function providerFor(events, onCall = () => undefined) {
  return {
    async *stream(request, signal) {
      onCall(request, signal);
      for (const event of events) {
        if (signal.aborted) return;
        yield event;
      }
    },
  };
}

test('parses explicit complete endpoint/profile and rejects key-shaped CLI input', () => {
  assert.deepEqual(parseDeepSeekSmokeArgs([
    '--endpoint', validOptions.endpoint,
    '--profile', validOptions.endpointProfile,
    '--model', validOptions.model,
    '--secret-env', validOptions.secretEnv,
    '--scenario', 'cancel',
    '--thinking', 'auto',
    '--timeout-ms', '1200',
  ]), { ...validOptions, scenario: 'cancel', thinkingMode: 'auto', timeoutMs: 1_200 });
  assert.deepEqual(parseDeepSeekSmokeArgs(['--help']), { help: true });
  assert.throws(() => parseDeepSeekSmokeArgs(['--endpoint', 'http://api.example.test/v1/chat/completions', '--model', 'm', '--secret-env', validOptions.secretEnv]), /HTTPS/u);
  assert.throws(() => parseDeepSeekSmokeArgs(['--endpoint', `${validOptions.endpoint}?key=secret`, '--model', 'm', '--secret-env', validOptions.secretEnv]), /query/u);
  assert.throws(() => parseDeepSeekSmokeArgs(['--endpoint', validOptions.endpoint, '--profile', 'openai-responses', '--model', 'm', '--secret-env', validOptions.secretEnv]), /profile/u);
  assert.throws(() => parseDeepSeekSmokeArgs(['--endpoint', validOptions.endpoint, '--model', 'm', '--secret-env', 'sk-secret']), /secret-env/u);
  assert.throws(() => parseDeepSeekSmokeArgs(['--endpoint', validOptions.endpoint, '--model', 'm', '--secret-env', validOptions.secretEnv, '--api-key', 'secret']), /usage/u);
});

test('returns bounded healthy evidence with no prompt, key, endpoint or raw output', async () => {
  const report = await runDeepSeekSmoke(validOptions, {
    secretValue: () => 'sk-' + 'x'.repeat(32),
    provider: providerFor([
      { type: 'text-delta', text: 'ready4vibe-smoke' },
      { type: 'usage', inputTokens: 11, outputTokens: 2 },
      { type: 'completed', finishReason: 'stop' },
    ]),
    now: (() => { let value = 1_000; return () => (value += 25); })(),
  });
  assert.deepEqual(report, {
    schemaVersion: 'deepseek-smoke/v1', provider: 'deepseek', endpointProfile: validOptions.endpointProfile, model: validOptions.model, scenario: 'text', thinkingMode: 'off', status: 'healthy', elapsedMs: 50, firstTokenMs: 25, finishReason: 'stop', eventTypes: { 'text-delta': 1, usage: 1, completed: 1 }, usage: { inputTokens: 11, outputTokens: 2 },
  });
  assert.doesNotMatch(JSON.stringify(report), /api\.example|READY4VIBE_DEEPSEEK_API_KEY|sk-|ready4vibe-smoke/iu);
});

test('blocks before provider construction when the secret is missing', async () => {
  let called = false;
  const report = await runDeepSeekSmoke(validOptions, { secretValue: () => undefined, providerFactory: () => { called = true; throw new Error('must not construct'); } });
  assert.equal(called, false);
  assert.deepEqual(report, { schemaVersion: 'deepseek-smoke/v1', provider: 'deepseek', endpointProfile: validOptions.endpointProfile, model: validOptions.model, scenario: 'text', thinkingMode: 'off', status: 'blocked', elapsedMs: 0, firstTokenMs: null, finishReason: null, eventTypes: {}, usage: { inputTokens: null, outputTokens: null }, errorCode: 'DEEPSEEK_CREDENTIAL_REQUIRED' });
});

test('maps provider/auth errors without raw error text or retrying', async () => {
  let calls = 0;
  const report = await runDeepSeekSmoke(validOptions, {
    secretValue: () => 'sk-' + 'y'.repeat(32),
    provider: providerFor([{ type: 'text-delta', text: 'partial' }, { type: 'error', code: 'DEEPSEEK_HTTP_401', retryable: false, safeMessage: 'secret provider body' }], () => { calls += 1; }),
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.errorCode, 'DEEPSEEK_HTTP_401');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(report), /secret|sk-|partial|api\.example/iu);
});

test('distinguishes explicit cancellation and timeout', async () => {
  const pending = {
    async *stream(_request, signal) {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    },
  };
  const cancelled = await runDeepSeekSmoke({ ...validOptions, scenario: 'cancel', timeoutMs: 200 }, { secretValue: () => 'sk-' + 'z'.repeat(32), provider: pending });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.errorCode, 'DEEPSEEK_CANCELLED');
  const timeout = await runDeepSeekSmoke({ ...validOptions, scenario: 'timeout', timeoutMs: 100 }, { secretValue: () => 'sk-' + 'z'.repeat(32), provider: pending });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.errorCode, 'DEEPSEEK_TIMEOUT');
});

test('keeps status/error codes and exit codes bounded', () => {
  assert.equal(exitCodeForDeepSeekSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForDeepSeekSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForDeepSeekSmokeStatus('timeout'), 3);
  assert.equal(exitCodeForDeepSeekSmokeStatus('cancelled'), 3);
  assert.equal(exitCodeForDeepSeekSmokeStatus('failed'), 1);
  assert.equal(safeDeepSeekSmokeErrorCode({ code: 'DEEPSEEK_HTTP_429', message: 'secret at C:\\private' }), 'DEEPSEEK_HTTP_429');
  assert.equal(safeDeepSeekSmokeErrorCode(new Error('secret at C:\\private')), 'DEEPSEEK_SMOKE_FAILED');
});
