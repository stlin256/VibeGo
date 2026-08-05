import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  exitCodeForHarnessSmokeStatus,
  parseHarnessSmokeArgs,
  runHarnessSmoke,
  safeHarnessErrorCode,
} from './smoke-harness.mjs';

const valid = {
  mode: 'interactive',
  endpoint: 'https://api.example.test/v1/chat/completions',
  model: 'deepseek-v4-flash',
  secretEnv: 'HARNESS_TEST_SECRET',
  timeoutMs: 500,
};

test('parses explicit mode and provider references without accepting secret-shaped values', () => {
  assert.deepEqual(parseHarnessSmokeArgs([
    '--mode', 'governed',
    '--endpoint', valid.endpoint,
    '--model', valid.model,
    '--secret-env', valid.secretEnv,
    '--timeout-ms', '900',
  ]), { ...valid, mode: 'governed', timeoutMs: 900 });
  assert.deepEqual(parseHarnessSmokeArgs([], {
    VIBEGO_HARNESS_SMOKE_MODE: 'interactive',
    VIBEGO_MODEL_SMOKE_ENDPOINT: valid.endpoint,
    VIBEGO_MODEL_SMOKE_MODEL: valid.model,
    VIBEGO_MODEL_SMOKE_SECRET_ENV: valid.secretEnv,
    VIBEGO_HARNESS_SMOKE_TIMEOUT_MS: '700',
  }), { ...valid, timeoutMs: 700 });
  assert.throws(() => parseHarnessSmokeArgs(['--mode', 'full-host']), /interactive or governed/u);
  assert.throws(() => parseHarnessSmokeArgs(['--endpoint', 'http://api.example.test/v1/chat/completions']), /HTTPS/u);
  assert.throws(() => parseHarnessSmokeArgs(['--model', 'sk-' + 'x'.repeat(24)]), /model/u);
  assert.throws(() => parseHarnessSmokeArgs(['--secret-env', 'sk-secret']), /secret-env/u);
});

test('missing configuration is blocked before runtime construction', async () => {
  let constructed = false;
  const result = await runHarnessSmoke({ mode: 'interactive', timeoutMs: 500 }, {
    runtimeFactory: async () => { constructed = true; throw new Error('must not construct'); },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.errorCode, 'HARNESS_CONFIG_MISSING');
  assert.equal(constructed, false);
  assert.doesNotMatch(JSON.stringify(result), /HARNESS_TEST_SECRET|sk-|ready4vibe-harness-smoke/iu);
});

test('interactive smoke uses the ordinary route and returns only bounded SSE evidence', async () => {
  const observed = { route: undefined, body: undefined };
  const runtime = fakeRuntime({ observed, mode: 'interactive' });
  const result = await runHarnessSmoke(valid, {
    secretValue: () => 'sk-' + 'x'.repeat(32),
    provider: { id: 'injected-provider' },
    runtimeFactory: async () => runtime,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.runStatus, 'completed');
  assert.equal(result.eventTypes['run.created'], 1);
  assert.equal(result.eventTypes['model.usage'], 1);
  assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 2 });
  assert.equal(observed.route, '/api/v1/runs');
  assert.equal(observed.body.runMode, undefined);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /HARNESS_TEST_SECRET|sk-|ready4vibe-harness-smoke|C:\\private|raw provider output/iu);
});

test('governed smoke uses explicit admission route and waits for validated quota outcome', async () => {
  const observed = { route: undefined, body: undefined };
  const runtime = fakeRuntime({ observed, mode: 'governed', goal: true });
  const result = await runHarnessSmoke({ ...valid, mode: 'governed' }, {
    secretValue: () => 'sk-' + 'y'.repeat(32),
    provider: { id: 'injected-provider' },
    runtimeFactory: async () => runtime,
  });

  assert.equal(result.status, 'healthy');
  assert.equal(result.goal.status, 'validated');
  assert.equal(result.goal.todoStatus, 'done');
  assert.equal(result.goal.totalSpent, 1);
  assert.equal(observed.route, '/api/v1/runs/governed');
  assert.equal(observed.body.runMode, 'governed');
  assert.equal(observed.body.goalId, 'goal_harness01');
  assert.equal(observed.body.expectedControlRevision, 3);
  assert.doesNotMatch(JSON.stringify(result), /sk-|prompt|header|absolute|HARNESS_TEST_SECRET/iu);
});

test('provider/run failure and timeout stay bounded and never expose raw payloads', async () => {
  const failed = await runHarnessSmoke(valid, {
    secretValue: () => 'sk-' + 'z'.repeat(32),
    provider: { id: 'injected-provider' },
    runtimeFactory: async () => fakeRuntime({ failed: true, mode: 'interactive' }),
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'MODEL_HTTP_401');
  assert.doesNotMatch(JSON.stringify(failed), /credentials|sk-|raw provider output|ready4vibe-harness-smoke/iu);

  const timedOut = await runHarnessSmoke({ ...valid, timeoutMs: 100 }, {
    secretValue: () => 'sk-' + 'q'.repeat(32),
    provider: { id: 'injected-provider' },
    runtimeFactory: async () => fakeRuntime({ delayed: true, mode: 'interactive' }),
  });
  assert.equal(timedOut.status, 'timeout');
  assert.equal(timedOut.errorCode, 'HARNESS_SSE_TIMEOUT');
});

test('exit codes and safe error mapping are stable', () => {
  assert.equal(exitCodeForHarnessSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForHarnessSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForHarnessSmokeStatus('timeout'), 3);
  assert.equal(exitCodeForHarnessSmokeStatus('failed'), 1);
  assert.equal(safeHarnessErrorCode({ code: 'MODEL_HTTP_429', message: 'secret at C:\\private' }), 'MODEL_HTTP_429');
  assert.equal(safeHarnessErrorCode(new Error('secret at C:\\private')), 'HARNESS_FAILED');
});

function fakeRuntime({ observed, mode, goal = false, failed = false, delayed = false }) {
  observed ??= {};
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/health') {
      return json(response, 200, { status: 'ok', service: 'ready4vibe-daemon' });
    }
    if (request.method === 'POST' && (url.pathname === '/api/v1/runs' || url.pathname === '/api/v1/runs/governed')) {
      observed.route = url.pathname;
      observed.body = JSON.parse(await readBody(request));
      return json(response, 202, { runId: 'run_harness0001', status: 'queued' });
    }
    if (url.pathname === '/api/v1/runs/run_harness0001/events') {
      if (delayed) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
      const terminal = failed
        ? { type: 'run.failed', payload: { code: 'MODEL_HTTP_401', safeMessage: 'credentials rejected' } }
        : { type: 'run.completed', payload: { summary: 'raw provider output', exitReason: 'model-completed' } };
      const events = [
        { type: 'run.created', payload: { config: { userMessage: 'ready4vibe-harness-smoke sk-raw' } } },
        { type: 'model.usage', payload: { inputTokens: 4, outputTokens: 2 } },
        terminal,
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      return response.end();
    }
    if (url.pathname === '/api/v1/runs/run_harness0001') {
      return json(response, 200, { status: failed ? 'failed' : 'completed' });
    }
    return json(response, 404, { error: { code: 'NOT_FOUND' } });
  });
  return {
    server,
    ...(goal ? { goalId: 'goal_harness01', todoId: 'todo_harness01', expectedControlRevision: 3, turnKey: 'turn_harness_1', requestId: 'request_harness_1' } : {}),
    ...(goal ? { goalOutcome: async () => ({ status: 'validated', todoStatus: 'done', totalSpent: 1, eventTypes: { 'quota.consumed': 1 } }) } : {}),
  };
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolveBody) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
  });
}
