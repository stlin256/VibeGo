import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const USAGE = 'usage: pnpm smoke:harness -- --mode <interactive|governed> --endpoint <https://provider.example/v1/chat/completions> --model <model-id> --secret-env <ENV_VAR> [--timeout-ms <100..30000>]';
const MODEL_PROVIDER_ID = 'openai-compatible';
const DEFAULT_TIMEOUT_MS = 15_000;
const SMOKE_WORKSPACE_ID = 'harness_workspace';
const SMOKE_SESSION_ID = 'harness_session';
const SMOKE_AGENT_ID = 'harness_agent';
const SMOKE_GOAL_ID = 'goal_harness01';
const SMOKE_TODO_ID = 'todo_harness01';
const SMOKE_TURN_KEY = 'turn_harness_1';
const SMOKE_REQUEST_ID = 'request_harness_1';
const ENV_MODE = 'VIBEGO_HARNESS_SMOKE_MODE';
const ENV_ENDPOINT = 'VIBEGO_MODEL_SMOKE_ENDPOINT';
const ENV_MODEL = 'VIBEGO_MODEL_SMOKE_MODEL';
const ENV_SECRET = 'VIBEGO_MODEL_SMOKE_SECRET_ENV';
const ENV_TIMEOUT = 'VIBEGO_HARNESS_SMOKE_TIMEOUT_MS';

export function parseHarnessSmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'interactive';
  let endpoint = environment[ENV_ENDPOINT];
  let model = environment[ENV_MODEL];
  let secretEnv = environment[ENV_SECRET];
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode' || argument === '--endpoint' || argument === '--model' || argument === '--secret-env' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--mode') mode = value;
      else if (argument === '--endpoint') endpoint = value;
      else if (argument === '--model') model = value;
      else if (argument === '--secret-env') secretEnv = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }

  if (mode !== 'interactive' && mode !== 'governed') throw new Error('mode must be interactive or governed');
  if (endpoint !== undefined) endpoint = validateEndpoint(endpoint);
  if (model !== undefined) model = validateModel(model);
  if (secretEnv !== undefined) secretEnv = validateSecretEnv(secretEnv);
  return Object.freeze({
    mode,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(model === undefined ? {} : { model }),
    ...(secretEnv === undefined ? {} : { secretEnv }),
    timeoutMs: validateTimeout(timeoutMs),
  });
}

export function exitCodeForHarnessSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'timeout') return 3;
  return 1;
}

export function safeHarnessErrorCode(error, fallback = 'HARNESS_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^(?:HARNESS|MODEL|RUN)_[A-Z0-9_]{1,64}$/u.test(code) ? code : fallback;
}

/**
 * Run one explicit daemon-to-agent smoke. The default runtime is loaded only
 * when this function is invoked from the CLI; tests inject a runtime factory
 * and never construct providers, child processes, or network clients.
 */
export async function runHarnessSmoke(options, dependencies = {}) {
  const now = dependencies.now ?? (() => Date.now());
  const startedAt = now();
  const secretValue = dependencies.secretValue
    ? dependencies.secretValue(options.secretEnv)
    : options.secretEnv ? process.env[options.secretEnv] : undefined;

  if (!options.endpoint || !options.model || !options.secretEnv) {
    return report(options, 'blocked', elapsedMs(startedAt, now()), undefined, undefined, undefined, 'HARNESS_CONFIG_MISSING');
  }
  if (typeof secretValue !== 'string' || secretValue.length === 0 || secretValue.length > 4_096 || /[\r\n]/u.test(secretValue)) {
    return report(options, 'blocked', elapsedMs(startedAt, now()), undefined, undefined, undefined, 'HARNESS_SECRET_MISSING');
  }

  let runtime;
  try {
    const provider = dependencies.provider ?? await createProvider(options, secretValue, dependencies);
    runtime = dependencies.runtimeFactory
      ? await dependencies.runtimeFactory({ options, provider })
      : await createDefaultRuntime(options, provider);
  } catch {
    return report(options, 'failed', elapsedMs(startedAt, now()), undefined, undefined, undefined, 'HARNESS_RUNTIME_INIT');
  }

  let address;
  try {
    address = await listenEphemeral(runtime.server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
    const health = await requestJson(fetchImpl, `${baseUrl}/health`, { method: 'GET' }, options.timeoutMs);
    if (health.status !== 200 || !isHealthReady(health.body)) {
      return report(options, 'failed', elapsedMs(startedAt, now()), undefined, undefined, undefined, 'HARNESS_DAEMON_UNREADY');
    }

    const input = buildRunInput(options, runtime);
    const route = options.mode === 'governed' ? '/api/v1/runs/governed' : '/api/v1/runs';
    const started = await requestJson(fetchImpl, `${baseUrl}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }, options.timeoutMs);
    if (started.status !== 202 || !isRunStartResponse(started.body)) {
      return report(options, started.status === 401 || started.status === 403 ? 'blocked' : 'failed', elapsedMs(startedAt, now()), undefined, undefined, undefined, safeHttpErrorCode(started.status, started.body));
    }

    const runId = started.body.runId;
    const events = await readSse(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events`, options.timeoutMs);
    const snapshot = await requestJson(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}`, { method: 'GET' }, options.timeoutMs);
    const finalStatus = readRunStatus(snapshot.body, events);
    const goal = options.mode === 'governed'
      ? await waitForGoalOutcome(runtime, options.timeoutMs, now)
      : undefined;
    const providerError = events.errorCode ?? readSafeRunError(snapshot.body);
    const hasTerminalEvent = events.events.some((event) => event.type === 'run.completed');
    const runHealthy = finalStatus === 'completed' && hasTerminalEvent && providerError === undefined;
    const goalHealthy = options.mode !== 'governed' || goal?.status === 'validated';
    return report(
      options,
      events.timedOut ? 'timeout' : runHealthy && goalHealthy ? 'healthy' : 'failed',
      elapsedMs(startedAt, now()),
      runId,
      events,
      goal,
      events.timedOut ? 'HARNESS_SSE_TIMEOUT' : providerError ?? (goalHealthy ? undefined : 'HARNESS_GOAL_VALIDATION_FAILED'),
      finalStatus,
    );
  } catch (error) {
    if (error?.code === 'HARNESS_TIMEOUT') {
      return report(options, 'timeout', elapsedMs(startedAt, now()), undefined, undefined, undefined, 'HARNESS_TIMEOUT');
    }
    return report(options, 'failed', elapsedMs(startedAt, now()), undefined, undefined, undefined, safeHarnessErrorCode(error));
  } finally {
    await closeRuntime(runtime);
  }
}

function report(options, status, elapsed, runId, events, goal, errorCode, finalStatus) {
  const result = {
    schemaVersion: 'harness-smoke/v1',
    mode: options.mode,
    provider: MODEL_PROVIDER_ID,
    model: options.model ?? null,
    status,
    elapsedMs: elapsed,
    ...(runId ? { runId } : {}),
    ...(finalStatus ? { runStatus: finalStatus } : {}),
    eventTypes: countEventTypes(events?.events ?? []),
    usage: {
      inputTokens: boundedUsage(events?.inputTokens),
      outputTokens: boundedUsage(events?.outputTokens),
    },
    ...(goal ? {
      goal: {
        status: goal.status,
        todoStatus: goal.todoStatus ?? null,
        totalSpent: boundedUsage(goal.totalSpent),
        eventTypes: goal.eventTypes ?? {},
      },
    } : {}),
  };
  if (errorCode) result.errorCode = errorCode;
  return Object.freeze(result);
}

function buildRunInput(options, runtime) {
  const config = {
    workspaceId: SMOKE_WORKSPACE_ID,
    userMessage: 'Reply with exactly the word ready4vibe-harness-smoke.',
    model: { provider: MODEL_PROVIDER_ID, name: options.model },
    taskTrust: 'trusted-workspace',
    sandbox: { mode: 'read-only', network: 'restricted' },
    approval: 'on-request',
    limits: {
      maxTurns: 1,
      maxWallTimeMs: options.timeoutMs,
      maxModelInputTokens: 256,
      maxModelOutputTokens: 64,
      maxToolCalls: 1,
      maxOutputBytes: 4_096,
      maxContextBytes: 16_384,
    },
    createdBySessionId: SMOKE_SESSION_ID,
    clientRequestId: `client_harness_${options.mode}`,
  };
  if (options.mode === 'interactive') return config;
  return {
    ...config,
    runMode: 'governed',
    goalId: runtime.goalId,
    todoId: runtime.todoId,
    expectedControlRevision: runtime.expectedControlRevision,
    agentId: SMOKE_AGENT_ID,
    turnKey: runtime.turnKey ?? SMOKE_TURN_KEY,
    requestId: runtime.requestId ?? SMOKE_REQUEST_ID,
  };
}

async function createProvider(options, secretValue, dependencies) {
  const modelOpenAi = dependencies.modelOpenAi ?? await import('../packages/model-openai/dist/index.js');
  return new modelOpenAi.OpenAICompatibleProvider({
    id: MODEL_PROVIDER_ID,
    endpoint: options.endpoint,
    apiKey: secretValue,
  });
}

export async function createDefaultRuntime(options, provider) {
  const [contracts, storage, schedulerPackage, goalControl, daemon, runManagerPackage, goalAdmissionPackage, goalWritebackPackage] = await Promise.all([
    import('../packages/contracts/dist/index.js'),
    import('../packages/storage/dist/index.js'),
    import('../packages/scheduler/dist/index.js'),
    import('../packages/goal-control/dist/index.js'),
    import('../apps/daemon/dist/server.js'),
    import('../apps/daemon/dist/run-manager.js'),
    import('../apps/daemon/dist/goal-admission.js'),
    import('../apps/daemon/dist/goal-writeback.js'),
  ]);
  const eventStore = new storage.InMemoryEventStore();
  const goalStore = new goalControl.InMemoryGoalControlEventStore();
  await seedGoal(goalStore, goalControl, contracts);
  const scheduler = new schedulerPackage.Scheduler(contracts.DEFAULT_SCHEDULER_POLICY);
  const runManager = new runManagerPackage.RunManager({
    eventStore,
    scheduler,
    modelProvider: provider,
    workspaceExists: (workspaceId) => workspaceId === SMOKE_WORKSPACE_ID,
  });
  const capabilitySnapshot = createCapabilitySnapshot(contracts);
  const goalControlWriter = new goalControl.GoalControlV1WriteService(goalStore, { producer: 'harness-smoke' });
  const verifier = {
    async verify(input) {
      return {
        status: 'validated',
        verifierId: 'harness_fixture_verifier',
        verifierRevision: 1,
        summary: `Harness terminal ${input.terminal.type} was observed.`,
        refs: { runId: input.run.runId, eventIds: [input.terminal.id] },
      };
    },
  };
  let goalAdmission;
  const goalWriteback = new goalWritebackPackage.GoalRunWritebackService({
    goalStore,
    runManager,
    goalControl: goalControlWriter,
    verifier,
    admitGoverned: (input, runOptions) => goalAdmission.admit(input, runOptions),
  });
  goalAdmission = new goalAdmissionPackage.GoalAdmissionService({
    goalStore,
    runManager,
    capabilitySnapshotForRun: () => capabilitySnapshot,
    workspace: { exists: (workspaceId) => workspaceId === SMOKE_WORKSPACE_ID },
    scheduler: runManager.scheduler,
    goalControl: goalControlWriter,
    registerBinding: (binding) => { goalWriteback.registerBinding(binding); },
    quotaPolicy: { enabled: true, units: 1, reservationTtlMs: Math.max(options.timeoutMs, 30_000) },
    approval: () => ({ ready: true, revision: 'harness-approval-1' }),
    sandbox: () => ({ ready: true, revision: 'harness-sandbox-1' }),
  });
  const server = daemon.createDaemonServer({
    host: '127.0.0.1',
    transportMode: 'loopback',
    storageKind: 'memory',
    runManager,
    goalAdmissionService: goalAdmission,
    goalRunWriteback: goalWriteback,
  });
  return {
    server,
    goalId: SMOKE_GOAL_ID,
    todoId: SMOKE_TODO_ID,
    expectedControlRevision: goalStore.lastSequence(SMOKE_GOAL_ID),
    turnKey: SMOKE_TURN_KEY,
    requestId: SMOKE_REQUEST_ID,
    goalOutcome: async () => readGoalOutcome(goalStore, goalControl, SMOKE_GOAL_ID, SMOKE_TODO_ID),
    close: async () => { goalWriteback.close(); },
  };
}

async function seedGoal(store, goalControl, contracts) {
  const now = new Date();
  const recordedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1_000).toISOString();
  const goal = {
    goalId: SMOKE_GOAL_ID,
    title: 'Harness smoke Goal',
    objective: 'Exercise the explicit governed harness path.',
    workspaceId: SMOKE_WORKSPACE_ID,
    status: 'active',
    controlRevision: 0,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    schemaVersion: 1,
  };
  const todo = {
    todoId: SMOKE_TODO_ID,
    goalId: SMOKE_GOAL_ID,
    role: 'agent',
    status: 'open',
    taskClass: 'advancement',
    title: 'Complete the harness smoke',
    priority: 1,
  };
  const events = [
    goalControl.createGoalEvent({ eventId: 'gevt_harness01', goalId: SMOKE_GOAL_ID, eventType: 'goal.created', recordedAt, producer: 'harness-smoke', privacy: 'local_private', refs: {}, payload: { goal } }),
    goalControl.createGoalEvent({ eventId: 'gevt_harness02', goalId: SMOKE_GOAL_ID, eventType: 'todo.added', recordedAt, producer: 'harness-smoke', privacy: 'local_private', refs: { todoId: SMOKE_TODO_ID }, payload: { todo } }),
    goalControl.createGoalEvent({ eventId: 'gevt_harness03', goalId: SMOKE_GOAL_ID, eventType: 'todo.claimed', recordedAt, producer: 'harness-smoke', privacy: 'local_private', refs: { todoId: SMOKE_TODO_ID }, payload: {
      todoId: SMOKE_TODO_ID,
      claimedBy: SMOKE_AGENT_ID,
      claimTokenHash: 'a'.repeat(64),
      claimedAt: recordedAt,
      claimExpiresAt: expiresAt,
    } }),
  ];
  events.forEach((event, index) => store.seedLegacy({ ...event, appendSequence: index + 1 }));
  void contracts;
}

function createCapabilitySnapshot(contracts) {
  const updatedAt = new Date().toISOString();
  const profile = {
    schemaVersion: 'ready4vibe_capability_profile_v1',
    profileId: 'workspace-coding',
    transportMode: 'loopback',
    workspaceId: SMOKE_WORKSPACE_ID,
    modelMode: 'configured',
    filesystemMode: 'off',
    shellMode: 'off',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalMode: 'on-request',
    policyRevision: 'harness-policy-1',
    requiresAcknowledgement: false,
    updatedAt,
  };
  return contracts.CapabilityProfileRunSnapshotSchema.parse({
    schemaVersion: 'ready4vibe_capability_profile_run_snapshot_v1',
    profileRevision: 'harness-profile-1',
    policyRevision: 'harness-policy-1',
    status: 'ready',
    reasonCode: 'PROFILE_READY',
    requestedProfile: profile,
    effectiveProfile: profile,
    capturedAt: updatedAt,
  });
}

async function readGoalOutcome(store, goalControl, goalId, todoId) {
  const events = await store.read(goalId);
  const projection = new goalControl.GoalControlProjectionBuilder().build(events);
  const eventTypes = countGoalEventTypes(events);
  const todo = projection.todos.find((candidate) => candidate.todoId === todoId);
  const status = todo?.status === 'done' && projection.quota.totalSpent === 1 ? 'validated' : 'pending';
  return { status, todoStatus: todo?.status, totalSpent: projection.quota.totalSpent, eventTypes };
}

async function waitForGoalOutcome(runtime, timeoutMs, now) {
  if (!runtime.goalOutcome) return { status: 'pending', eventTypes: {} };
  const deadline = now() + timeoutMs;
  let latest;
  while (now() < deadline) {
    latest = await runtime.goalOutcome();
    if (latest.status !== 'pending') return latest;
    await delay(20);
  }
  return latest ?? { status: 'pending', eventTypes: {} };
}

async function readSse(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'text/event-stream' }, signal: controller.signal });
    if (!response.ok || !response.body) return { events: [], timedOut: false, errorCode: `HARNESS_SSE_HTTP_${response.status}` };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedBytes = 0;
    const events = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let errorCode;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        receivedBytes += next.value?.byteLength ?? 0;
        if (receivedBytes > 256 * 1024 || events.length > 512) {
          return { events, timedOut: false, errorCode: 'HARNESS_SSE_LIMIT' };
        }
        buffer += decoder.decode(next.value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/u);
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const parsed = parseSseFrame(frame);
          if (!parsed) continue;
          events.push(parsed);
          if (parsed.type === 'model.usage') {
            inputTokens += safeTokenValue(parsed.payload?.inputTokens);
            outputTokens += safeTokenValue(parsed.payload?.outputTokens);
          }
          if (parsed.type === 'run.failed') errorCode = safeEventErrorCode(parsed.payload?.code);
        }
      }
      buffer += decoder.decode();
      const trailing = parseSseFrame(buffer);
      if (trailing) events.push(trailing);
    } finally {
      reader.releaseLock();
    }
    return { events, timedOut: false, inputTokens, outputTokens, ...(errorCode ? { errorCode } : {}) };
  } catch (error) {
    if (controller.signal.aborted) return { events: [], timedOut: true };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseSseFrame(frame) {
  let eventType;
  let data;
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith('event:')) eventType = line.slice(6).trim();
    if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  if (!eventType || !data || !/^[a-z][a-z0-9._-]{1,63}$/u.test(eventType)) return undefined;
  let payload;
  try { payload = JSON.parse(data)?.payload; } catch { return { type: eventType }; }
  if (eventType === 'model.usage') {
    return {
      type: eventType,
      payload: {
        ...(Number.isSafeInteger(payload?.inputTokens) ? { inputTokens: payload.inputTokens } : {}),
        ...(Number.isSafeInteger(payload?.outputTokens) ? { outputTokens: payload.outputTokens } : {}),
      },
    };
  }
  if (eventType === 'model.completed') {
    return { type: eventType, payload: { finishReason: typeof payload?.finishReason === 'string' ? payload.finishReason : undefined } };
  }
  if (eventType === 'run.failed') return { type: eventType, payload: { code: safeEventErrorCode(payload?.code) } };
  return { type: eventType };
}

async function requestJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    let body;
    try { body = await response.json(); } catch { body = undefined; }
    return { status: response.status, body };
  } catch (error) {
    if (controller.signal.aborted) throw Object.assign(new Error('request timed out'), { code: 'HARNESS_TIMEOUT' });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isHealthReady(value) {
  return typeof value === 'object' && value !== null && (value.status === 'ok' || value.status === 'degraded') && value.service === 'ready4vibe-daemon';
}

function isRunStartResponse(value) {
  return typeof value === 'object' && value !== null && typeof value.runId === 'string' && /^run_[A-Za-z0-9_-]{8,128}$/u.test(value.runId);
}

function readRunStatus(value, events) {
  if (typeof value === 'object' && value !== null && typeof value.status === 'string') return value.status;
  if (events.events.some((event) => event.type === 'run.completed')) return 'completed';
  if (events.events.some((event) => event.type === 'run.cancelled')) return 'cancelled';
  return events.events.some((event) => event.type === 'run.failed') ? 'failed' : 'unknown';
}

function readSafeRunError(value) {
  if (typeof value !== 'object' || value === null || value.status !== 'failed') return undefined;
  return 'HARNESS_RUN_FAILED';
}

function safeHttpErrorCode(status, body) {
  const code = body?.error?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(code) ? `HARNESS_HTTP_${status}_${code}`.slice(0, 80) : `HARNESS_HTTP_${status}`;
}

function safeEventErrorCode(value) {
  return typeof value === 'string' && /^(?:MODEL|RUN|HARNESS)_[A-Z0-9_]{1,64}$/u.test(value) ? value : 'HARNESS_RUN_FAILED';
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) {
    if (!event || typeof event.type !== 'string') continue;
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function countGoalEventTypes(events) {
  const counts = {};
  for (const event of events) {
    if (!event || typeof event.eventType !== 'string') continue;
    counts[event.eventType] = (counts[event.eventType] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function boundedUsage(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : null;
}

function safeTokenValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : 0;
}

function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2_048) throw new Error('endpoint is invalid');
  let url;
  try { url = new URL(value); } catch { throw new Error('endpoint is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname === '/' || url.pathname.length < 2) throw new Error('endpoint must be an explicit HTTPS provider path');
  return value;
}

function validateModel(value) {
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u.test(value) || /(?:sk-[A-Za-z0-9]{20,}|api[_-]?key|token|secret|password|bearer)/iu.test(value)) throw new Error('model is invalid');
  return value;
}

function validateSecretEnv(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(value)) throw new Error('secret-env reference is invalid');
  return value;
}

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) throw new Error('timeout is invalid');
  return value;
}

async function listenEphemeral(server) {
  if (server.listening) return server.address();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('daemon did not expose an address');
  return address;
}

async function closeRuntime(runtime) {
  if (!runtime) return;
  try { await runtime.close?.(); } catch { /* best effort */ }
  if (runtime.server?.listening) {
    await new Promise((resolveClose) => runtime.server.close(() => resolveClose()));
  }
}

function elapsedMs(startedAt, endedAt) {
  return Math.max(0, Math.min(120_000, Math.trunc(endedAt - startedAt)));
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseHarnessSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      const result = await runHarnessSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForHarnessSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
