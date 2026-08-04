import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForModelSmokeStatus,
  parseModelSmokeArgs,
  runModelSmoke,
  safeModelSmokeErrorCode,
} from './smoke-model.mjs';

const validOptions = {
  endpoint: 'https://api.example.test/v1/chat/completions',
  model: 'deepseek-v4-flash',
  secretEnv: 'READY4VIBE_MODEL_API_KEY',
  timeoutMs: 1_000,
};

function providerFor(events, onCall = () => undefined) {
  return {
    id: 'openai-compatible',
    capabilities: { streaming: true, toolCalls: true, structuredOutput: false },
    async *stream(request, signal) {
      onCall(request, signal);
      for (const event of events) {
        if (signal.aborted) return;
        yield event;
      }
    },
  };
}

function replay(events) {
  const usage = events.find((event) => event.type === 'usage');
  const completed = events.find((event) => event.type === 'completed');
  return {
    text: events.filter((event) => event.type === 'text-delta').map((event) => event.text).join(''),
    finishReason: completed?.finishReason,
    usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined,
  };
}

test('parses explicit endpoint, model and secret-env reference only', () => {
  assert.deepEqual(parseModelSmokeArgs([
    '--endpoint', validOptions.endpoint,
    '--model', validOptions.model,
    '--secret-env', validOptions.secretEnv,
    '--timeout-ms', '1200',
  ]), { ...validOptions, timeoutMs: 1_200 });
  assert.deepEqual(parseModelSmokeArgs(['--help']), { help: true });
  assert.deepEqual(parseModelSmokeArgs([], {
    VIBEGO_MODEL_SMOKE_ENDPOINT: validOptions.endpoint,
    VIBEGO_MODEL_SMOKE_MODEL: validOptions.model,
    VIBEGO_MODEL_SMOKE_SECRET_ENV: validOptions.secretEnv,
    VIBEGO_MODEL_SMOKE_TIMEOUT_MS: '900',
  }), { ...validOptions, timeoutMs: 900 });
});

test('rejects missing or unsafe endpoint/model/secret reference', () => {
  assert.throws(() => parseModelSmokeArgs([]), /endpoint.*required/iu);
  assert.throws(() => parseModelSmokeArgs(['--endpoint', 'http://api.example.test/v1/chat/completions', '--model', 'm', '--secret-env', validOptions.secretEnv]), /HTTPS/u);
  assert.throws(() => parseModelSmokeArgs(['--endpoint', `${validOptions.endpoint}?key=secret`, '--model', 'm', '--secret-env', validOptions.secretEnv]), /query/u);
  assert.throws(() => parseModelSmokeArgs(['--endpoint', validOptions.endpoint, '--model', 'sk-' + 'x'.repeat(24), '--secret-env', validOptions.secretEnv]), /model/u);
  assert.throws(() => parseModelSmokeArgs(['--endpoint', validOptions.endpoint, '--model', 'm', '--secret-env', 'sk-secret']), /secret-env/u);
  assert.throws(() => parseModelSmokeArgs(['--endpoint', validOptions.endpoint, '--model', 'm', '--secret-env', validOptions.secretEnv, '--timeout-ms', '99']), /timeout/u);
  assert.throws(() => parseModelSmokeArgs(['--endpoint', validOptions.endpoint, '--model', 'm', '--secret-env', validOptions.secretEnv, '--api-key', 'secret']), /usage/u);
});

test('returns a bounded healthy report with nullable usage and no secret-shaped fields', async () => {
  const secret = 'sk-' + 'x'.repeat(32);
  const report = await runModelSmoke(validOptions, {
    secretValue: () => secret,
    provider: providerFor([
      { type: 'text-delta', text: 'ready4vibe-smoke' },
      { type: 'usage', inputTokens: 11, outputTokens: 2 },
      { type: 'completed', finishReason: 'stop' },
    ]),
    replayModelEvents: replay,
    now: (() => { let value = 1_000; return () => (value += 25); })(),
  });

  assert.deepEqual(report, {
    schemaVersion: 'model-smoke/v1',
    provider: 'openai-compatible',
    model: validOptions.model,
    status: 'healthy',
    elapsedMs: 25,
    finishReason: 'stop',
    usage: { inputTokens: 11, outputTokens: 2 },
  });
  assert.doesNotMatch(JSON.stringify(report), /api\.example|READY4VIBE_MODEL_API_KEY|sk-|ready4vibe-smoke/iu);
});

test('missing secret fails before provider construction and returns no secret value', async () => {
  let called = false;
  const report = await runModelSmoke(validOptions, {
    secretValue: () => undefined,
    providerFactory: () => {
      called = true;
      throw new Error('provider must not be constructed');
    },
  });
  assert.deepEqual(report, {
    schemaVersion: 'model-smoke/v1',
    provider: 'openai-compatible',
    model: validOptions.model,
    status: 'config-error',
    elapsedMs: 0,
    finishReason: null,
    usage: { inputTokens: null, outputTokens: null },
    errorCode: 'MODEL_SMOKE_SECRET_MISSING',
  });
  assert.equal(called, false);
});

test('maps auth/provider errors to stable redacted reports and never retries a partial stream', async () => {
  let calls = 0;
  const report = await runModelSmoke(validOptions, {
    secretValue: () => 'sk-' + 'y'.repeat(32),
    provider: providerFor([
      { type: 'text-delta', text: 'partial' },
      { type: 'error', code: 'MODEL_HTTP_401', retryable: false, safeMessage: 'provider rejected credentials' },
    ], () => { calls += 1; }),
    replayModelEvents: replay,
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.errorCode, 'MODEL_HTTP_401');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(report), /credential|sk-|provider\.example|partial/iu);
});

test('maps transport failure to unavailable and timeout to timeout without raw errors', async () => {
  const unavailable = await runModelSmoke(validOptions, {
    secretValue: () => 'sk-' + 'z'.repeat(32),
    provider: providerFor([{ type: 'error', code: 'MODEL_NETWORK_ERROR', retryable: true, safeMessage: 'not reachable' }]),
    replayModelEvents: replay,
    now: () => 1_000,
  });
  assert.deepEqual(unavailable, {
    schemaVersion: 'model-smoke/v1',
    provider: 'openai-compatible',
    model: validOptions.model,
    status: 'unavailable',
    elapsedMs: 0,
    finishReason: null,
    usage: { inputTokens: null, outputTokens: null },
    errorCode: 'MODEL_NETWORK_ERROR',
  });

  const timeout = await runModelSmoke({ ...validOptions, timeoutMs: 100 }, {
    secretValue: () => 'sk-' + 'z'.repeat(32),
    provider: {
      id: 'openai-compatible',
      capabilities: { streaming: true, toolCalls: true, structuredOutput: false },
      async *stream(_request, signal) {
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      },
    },
    replayModelEvents: replay,
  });
  assert.equal(timeout.status, 'timeout');
  assert.equal(timeout.errorCode, 'MODEL_SMOKE_TIMEOUT');
  assert.doesNotMatch(JSON.stringify(timeout), /sk-|api\.example|stack/iu);
});

test('keeps exit codes and error codes bounded', () => {
  assert.equal(exitCodeForModelSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForModelSmokeStatus('failed'), 1);
  assert.equal(exitCodeForModelSmokeStatus('unavailable'), 2);
  assert.equal(exitCodeForModelSmokeStatus('timeout'), 3);
  assert.equal(exitCodeForModelSmokeStatus('config-error'), 4);
  assert.equal(safeModelSmokeErrorCode({ code: 'MODEL_HTTP_429', message: 'secret at C:\\private' }), 'MODEL_HTTP_429');
  assert.equal(safeModelSmokeErrorCode(new Error('secret at C:\\private')), 'MODEL_SMOKE_FAILED');
});
