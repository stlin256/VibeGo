import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  createDeepSeekRunBinding,
  createHarnessToolRuntime,
  createProvider,
  exitCodeForHarnessSmokeStatus,
  parseHarnessSmokeArgs,
  runHarnessSmoke,
  safeHarnessErrorCode,
} from './smoke-harness.mjs';

const valid = {
  mode: 'interactive',
  provider: 'openai-compatible',
  endpoint: 'https://api.example.test/v1/chat/completions',
  model: 'deepseek-v4-flash',
  secretEnv: 'HARNESS_TEST_SECRET',
  scenario: 'text',
  thinkingMode: 'off',
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

test('parses the explicit DeepSeek harness provider boundary', () => {
  assert.deepEqual(parseHarnessSmokeArgs([
    '--provider', 'deepseek',
    '--mode', 'interactive',
    '--endpoint', 'https://api.example.test/v1/chat/completions',
    '--profile', 'openai-chat-completions',
    '--model', 'deepseek-v4-flash',
    '--secret-env', valid.secretEnv,
    '--thinking', 'auto',
    '--scenario', 'cancel',
    '--timeout-ms', '1200',
  ]), {
    ...valid,
    provider: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    thinkingMode: 'auto',
    scenario: 'cancel',
    timeoutMs: 1200,
  });
  assert.deepEqual(parseHarnessSmokeArgs([
    '--provider', 'deepseek',
    '--endpoint', valid.endpoint,
    '--profile', 'openai-chat-completions',
    '--model', valid.model,
    '--secret-env', valid.secretEnv,
    '--scenario', 'approval',
  ]).scenario, 'approval');
  assert.throws(() => parseHarnessSmokeArgs([
    '--provider', 'deepseek',
    '--endpoint', 'https://api.example.test/v1/chat/completions',
    '--profile', 'openai-responses',
    '--model', valid.model,
    '--secret-env', valid.secretEnv,
  ]), /profile/u);
  assert.throws(() => parseHarnessSmokeArgs([
    '--provider', 'deepseek',
    '--endpoint', 'https://api.example.test/v1/chat/completions',
    '--model', valid.model,
    '--secret-env', valid.secretEnv,
    '--api-key', 'secret',
  ]), /usage/u);
});

test('keeps the harness fixture ToolRuntime bounded and approval-aware', async () => {
  const tool = createHarnessToolRuntime('tool');
  assert.equal(tool.descriptors[0].risk, 'read');
  await expectToolResult(tool, { value: 'ready4vibe-tool-smoke' }, { echo: 'ready4vibe-tool-smoke' });
  await assert.rejects(() => tool.execute({ input: { value: 'sk-' + 'x'.repeat(32) } }), { code: 'TOOL_INPUT_INVALID' });

  const approvalTool = createHarnessToolRuntime('approval');
  assert.equal(approvalTool.descriptors[0].risk, 'write');
  await assert.rejects(() => approvalTool.execute({ input: { value: 'approved' } }), { code: 'APPROVAL_REQUIRED' });
  await approvalTool.approve({});
  await expectToolResult(approvalTool, { value: 'approved' }, { echo: 'approved' });
});

test('constructs DeepSeek provider with a secret-free config and no hidden endpoint path', async () => {
  let received;
  const provider = await createProvider({
    ...valid,
    provider: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    thinkingMode: 'auto',
  }, 'sk-' + 'x'.repeat(32), {
    modelDeepSeek: {
      DeepSeekProvider: class {
        constructor(options) {
          received = options;
        }
      },
    },
  });
  assert.ok(provider);
  assert.equal(received.config.endpoint, valid.endpoint);
  assert.equal(received.config.endpointProfile, 'openai-chat-completions');
  assert.equal(received.config.authRef, 'secret.deepseek.harness');
  assert.equal(received.config.toolCalling, 'disabled');
  assert.equal(received.apiKey, 'sk-' + 'x'.repeat(32));
  assert.doesNotMatch(JSON.stringify(received.config), /sk-|apiKey|authorization/iu);
});

test('captures a secret-free DeepSeek provider and run snapshot at the binding seam', () => {
  const provider = providerForHarnessEvents();
  const identity = { parse: (value) => value };
  const binding = createDeepSeekRunBinding({
    ...valid,
    provider: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    thinkingMode: 'auto',
  }, provider, { ModelProviderSnapshotSchema: identity, DeepSeekRunSnapshotSchema: identity });
  assert.equal(binding.snapshot.providerId, 'deepseek');
  assert.equal(binding.snapshot.endpointPolicy.baseUrl, valid.endpoint);
  assert.equal(binding.deepSeekSnapshot.configRevision, 'harness-deepseek-config');
  assert.equal(binding.deepSeekSnapshot.capabilityRevision, 'deepseek-provider-capability-unprobed');
  assert.doesNotMatch(JSON.stringify(binding), /sk-|apiKey|authorization|C:\\private/iu);
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
  assert.equal(observed.body.model.provider, 'openai-compatible');
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

test('DeepSeek provider mode uses the ordinary harness route and preserves snapshot metadata', async () => {
  const observed = { route: undefined, body: undefined };
  const runtime = fakeRuntime({ observed, mode: 'interactive' });
  const result = await runHarnessSmoke({
    ...valid,
    provider: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    thinkingMode: 'auto',
  }, {
    secretValue: () => 'sk-' + 'd'.repeat(32),
    provider: providerForHarnessEvents(),
    runtimeFactory: async () => runtime,
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.endpointProfile, 'openai-chat-completions');
  assert.deepEqual(result.providerSnapshot, {
    providerId: 'deepseek',
    descriptorRevision: 'harness-deepseek-config',
    configRevision: 'harness-deepseek-config',
    capabilityRevision: 'deepseek-provider-capability-unprobed',
  });
  assert.equal(observed.route, '/api/v1/runs');
  assert.equal(observed.body.model.provider, 'deepseek');
  assert.doesNotMatch(JSON.stringify(result), /sk-|api.example|ready4vibe-harness-smoke/iu);
});

test('preserves bounded DeepSeek provider errors through the harness SSE projection', async () => {
  const result = await runHarnessSmoke({
    ...valid,
    provider: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    thinkingMode: 'auto',
  }, {
    secretValue: () => 'sk-' + 'e'.repeat(32),
    provider: providerForHarnessEvents(),
    runtimeFactory: async () => fakeRuntime({ failed: true, failedCode: 'DEEPSEEK_HTTP_401', mode: 'interactive' }),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'DEEPSEEK_HTTP_401');
});

test('DeepSeek thinking high remains blocked without a ready capability snapshot', async () => {
  const result = await runHarnessSmoke({
    ...valid,
    provider: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    thinkingMode: 'high',
  }, {
    secretValue: () => 'sk-' + 'h'.repeat(32),
    modelDeepSeek: {
      DeepSeekProvider: class {
        constructor() { throw Object.assign(new Error('unsupported'), { code: 'DEEPSEEK_THINKING_UNSUPPORTED' }); }
      },
    },
    runtimeFactory: async () => { throw new Error('must not construct runtime'); },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.errorCode, 'DEEPSEEK_THINKING_UNSUPPORTED');
});

test('explicit harness cancellation uses the daemon cancel route and never replays the provider', async () => {
  const observed = { route: undefined, body: undefined, cancelled: false };
  const result = await runHarnessSmoke({ ...valid, scenario: 'cancel' }, {
    secretValue: () => 'sk-' + 'c'.repeat(32),
    provider: providerForHarnessEvents(),
    runtimeFactory: async () => fakeRuntime({ observed, mode: 'interactive', delayed: true, delayMs: 150 }),
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.runStatus, 'cancelled');
  assert.equal(result.errorCode, undefined);
  assert.equal(observed.cancelled, true);
});

test('tool scenario requires tool evidence and approval scenario completes the bounded broker round-trip', async () => {
  const toolObserved = { route: undefined, body: undefined };
  const toolResult = await runHarnessSmoke({ ...valid, scenario: 'tool' }, {
    secretValue: () => 'sk-' + 't'.repeat(32),
    provider: providerForToolHarnessEvents(false),
    runtimeFactory: async () => fakeRuntime({ observed: toolObserved, mode: 'interactive', tool: true }),
  });
  assert.equal(toolResult.status, 'healthy');
  assert.equal(toolResult.eventTypes['tool.requested'], 1);
  assert.equal(toolResult.eventTypes['tool.completed'], 1);
  assert.equal(toolResult.toolEvidence.status, 'completed');
  assert.equal(toolObserved.body.limits.maxTurns, 2);
  assert.equal(toolObserved.body.approval, 'on-request');

  const approvalObserved = { route: undefined, body: undefined, approvalId: undefined };
  const approvalResult = await runHarnessSmoke({ ...valid, scenario: 'approval' }, {
    secretValue: () => 'sk-' + 'a'.repeat(32),
    provider: providerForToolHarnessEvents(true),
    runtimeFactory: async () => fakeRuntime({ observed: approvalObserved, mode: 'interactive', tool: true, approval: true }),
  });
  assert.equal(approvalResult.status, 'healthy');
  assert.equal(approvalResult.eventTypes['approval.required'], 1);
  assert.equal(approvalResult.eventTypes['approval.decided'], 1);
  assert.equal(approvalResult.toolEvidence.status, 'completed');
  assert.equal(approvalObserved.approvalId, 'ap_harness0001');
});

test('exit codes and safe error mapping are stable', () => {
  assert.equal(exitCodeForHarnessSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForHarnessSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForHarnessSmokeStatus('timeout'), 3);
  assert.equal(exitCodeForHarnessSmokeStatus('cancelled'), 3);
  assert.equal(exitCodeForHarnessSmokeStatus('failed'), 1);
  assert.equal(safeHarnessErrorCode({ code: 'MODEL_HTTP_429', message: 'secret at C:\\private' }), 'MODEL_HTTP_429');
  assert.equal(safeHarnessErrorCode({ code: 'DEEPSEEK_HTTP_401', message: 'secret at C:\\private' }), 'DEEPSEEK_HTTP_401');
  assert.equal(safeHarnessErrorCode(new Error('secret at C:\\private')), 'HARNESS_FAILED');
});

function fakeRuntime({ observed, mode, goal = false, failed = false, failedCode = 'MODEL_HTTP_401', delayed = false, delayMs = 1_000, tool = false, approval = false }) {
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
    if (request.method === 'POST' && url.pathname === '/api/v1/runs/run_harness0001/cancel') {
      observed.cancelled = true;
      return json(response, 202, { runId: 'run_harness0001', status: 'cancelling' });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/runs/run_harness0001/approve') {
      const body = JSON.parse(await readBody(request));
      observed.approvalId = body.approvalId;
      return json(response, 202, { runId: 'run_harness0001', approvalId: body.approvalId, status: 'accepted' });
    }
    if (url.pathname === '/api/v1/runs/run_harness0001/events') {
      if (delayed) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
      const terminal = failed
        ? { type: 'run.failed', payload: { code: failedCode, safeMessage: 'credentials rejected' } }
        : observed.cancelled
          ? { type: 'run.cancelled', payload: { reason: 'user-cancelled-during-model' } }
        : { type: 'run.completed', payload: { summary: 'raw provider output', exitReason: 'model-completed' } };
      const events = [
        { type: 'run.created', payload: {
          config: { userMessage: 'ready4vibe-harness-smoke sk-raw' },
          ...(observed.body?.model?.provider === 'deepseek' ? {
            modelSnapshot: { providerId: 'deepseek', descriptorRevision: 'harness-deepseek-config' },
            deepSeekSnapshot: { providerId: 'deepseek', configRevision: 'harness-deepseek-config', capabilityRevision: 'deepseek-provider-capability-unprobed' },
          } : {}),
        } },
        ...(tool ? [
          { type: 'tool.requested', payload: { callId: 'call_harness0001', toolId: 'echo', risk: approval ? 'write' : 'read', argumentBytes: 18 } },
          ...(approval ? [
            { type: 'approval.required', payload: { approvalId: 'ap_harness0001', callId: 'call_harness0001', toolId: 'echo', risk: 'write' } },
            { type: 'approval.decided', payload: { approvalId: 'ap_harness0001', callId: 'call_harness0001', decision: 'allow' } },
          ] : []),
          { type: 'tool.completed', payload: { callId: 'call_harness0001', toolId: 'echo', success: true, bytes: 32 } },
        ] : []),
        { type: 'model.usage', payload: { inputTokens: 4, outputTokens: 2 } },
        terminal,
      ];
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      return response.end();
    }
    if (url.pathname === '/api/v1/runs/run_harness0001') {
      return json(response, 200, { status: failed ? 'failed' : observed.cancelled ? 'cancelled' : 'completed' });
    }
    return json(response, 404, { error: { code: 'NOT_FOUND' } });
  });
  return {
    server,
    ...(goal ? { goalId: 'goal_harness01', todoId: 'todo_harness01', expectedControlRevision: 3, turnKey: 'turn_harness_1', requestId: 'request_harness_1' } : {}),
    ...(goal ? { goalOutcome: async () => ({ status: 'validated', todoStatus: 'done', totalSpent: 1, eventTypes: { 'quota.consumed': 1 } }) } : {}),
  };
}

function providerForHarnessEvents() {
  return {
    id: 'deepseek',
    capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
    async *stream() {
      yield { type: 'text-delta', text: 'ok' };
      yield { type: 'usage', inputTokens: 2, outputTokens: 1 };
      yield { type: 'completed', finishReason: 'stop' };
    },
  };
}

function providerForToolHarnessEvents(approval) {
  return {
    id: 'deepseek',
    capabilities: { streaming: true, toolCalls: true, structuredOutput: false },
    async *stream() {
      yield { type: 'tool-call-delta', callId: 'call_harness0001', name: 'echo', argumentsChunk: JSON.stringify({ value: approval ? 'approved' : 'ready4vibe-tool-smoke' }) };
      yield { type: 'completed', finishReason: 'tool-calls' };
    },
  };
}

async function expectToolResult(tool, request, expected) {
  const result = await tool.execute({ input: request });
  assert.deepEqual(result.output, expected);
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
