import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const USAGE = 'usage: pnpm smoke:harness -- --mode <interactive|governed> --provider <openai-compatible|deepseek> --endpoint <https://provider.example/v1/chat/completions> --model <model-id> --secret-env <ENV_VAR> [--profile <openai-chat-completions|openai-responses|anthropic-messages>] [--thinking <off|auto|high|max>] [--scenario <text|tool|approval|cancel|timeout|context-limit>] [--timeout-ms <100..30000>]';
const DEFAULT_PROVIDER_ID = 'openai-compatible';
const DEEPSEEK_PROVIDER_ID = 'deepseek';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_SCENARIO = 'text';
const DEFAULT_THINKING = 'off';
const DEFAULT_DEEPSEEK_PROFILE = 'openai-chat-completions';
const SMOKE_WORKSPACE_ID = 'harness_workspace';
const SMOKE_SESSION_ID = 'harness_session';
const SMOKE_AGENT_ID = 'harness_agent';
const SMOKE_GOAL_ID = 'goal_harness01';
const SMOKE_TODO_ID = 'todo_harness01';
const SMOKE_TURN_KEY = 'turn_harness_1';
const SMOKE_REQUEST_ID = 'request_harness_1';
const ENV_MODE = 'VIBEGO_HARNESS_SMOKE_MODE';
const ENV_PROVIDER = 'VIBEGO_HARNESS_SMOKE_PROVIDER';
const ENV_ENDPOINT = 'VIBEGO_MODEL_SMOKE_ENDPOINT';
const ENV_MODEL = 'VIBEGO_MODEL_SMOKE_MODEL';
const ENV_SECRET = 'VIBEGO_MODEL_SMOKE_SECRET_ENV';
const ENV_PROFILE = 'VIBEGO_DEEPSEEK_SMOKE_PROFILE';
const ENV_SCENARIO = 'VIBEGO_HARNESS_SMOKE_SCENARIO';
const ENV_THINKING = 'VIBEGO_HARNESS_SMOKE_THINKING';
const ENV_TIMEOUT = 'VIBEGO_HARNESS_SMOKE_TIMEOUT_MS';

export function parseHarnessSmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'interactive';
  let provider = environment[ENV_PROVIDER] ?? DEFAULT_PROVIDER_ID;
  let endpoint = environment[ENV_ENDPOINT];
  let model = environment[ENV_MODEL];
  let secretEnv = environment[ENV_SECRET];
  let endpointProfile = environment[ENV_PROFILE];
  let scenario = environment[ENV_SCENARIO] ?? DEFAULT_SCENARIO;
  let thinkingMode = environment[ENV_THINKING] ?? DEFAULT_THINKING;
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode' || argument === '--provider' || argument === '--endpoint' || argument === '--model' || argument === '--secret-env' || argument === '--profile' || argument === '--scenario' || argument === '--thinking' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--mode') mode = value;
      else if (argument === '--provider') provider = value;
      else if (argument === '--endpoint') endpoint = value;
      else if (argument === '--model') model = value;
      else if (argument === '--secret-env') secretEnv = value;
      else if (argument === '--profile') endpointProfile = value;
      else if (argument === '--scenario') scenario = value;
      else if (argument === '--thinking') thinkingMode = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }

  if (mode !== 'interactive' && mode !== 'governed') throw new Error('mode must be interactive or governed');
  if (provider !== DEFAULT_PROVIDER_ID && provider !== DEEPSEEK_PROVIDER_ID) throw new Error('provider must be openai-compatible or deepseek');
  if (provider === DEEPSEEK_PROVIDER_ID) endpointProfile = validateDeepSeekProfile(endpointProfile ?? DEFAULT_DEEPSEEK_PROFILE);
  else if (endpointProfile !== undefined) throw new Error('profile is only valid for the DeepSeek provider');
  scenario = validateHarnessScenario(scenario);
  thinkingMode = validateHarnessThinking(thinkingMode);
  if (endpoint !== undefined) endpoint = provider === DEEPSEEK_PROVIDER_ID
    ? validateDeepSeekEndpoint(endpoint, endpointProfile)
    : validateEndpoint(endpoint);
  if (model !== undefined) model = validateModel(model);
  if (secretEnv !== undefined) secretEnv = validateSecretEnv(secretEnv);
  return Object.freeze({
    mode,
    provider,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(model === undefined ? {} : { model }),
    ...(secretEnv === undefined ? {} : { secretEnv }),
    ...(endpointProfile === undefined ? {} : { endpointProfile }),
    scenario,
    thinkingMode,
    timeoutMs: validateTimeout(timeoutMs),
  });
}

export function exitCodeForHarnessSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'timeout' || status === 'cancelled') return 3;
  return 1;
}

export function safeHarnessErrorCode(error, fallback = 'HARNESS_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^(?:CONTEXT|DEEPSEEK|HARNESS|MODEL|RUN)_[A-Z0-9_]{1,64}$/u.test(code) ? code : fallback;
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
      : await createDefaultRuntime(options, provider, dependencies);
  } catch (error) {
    const providerError = safeHarnessErrorCode(error, 'HARNESS_RUNTIME_INIT');
    return report(options, providerError === 'DEEPSEEK_THINKING_UNSUPPORTED' ? 'blocked' : 'failed', elapsedMs(startedAt, now()), undefined, undefined, undefined, providerError);
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
    let approvalSubmitted = false;
    const cancelTimer = options.scenario === 'cancel'
      ? setTimeout(() => { void requestJson(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }, options.timeoutMs).catch(() => undefined); }, Math.min(100, Math.max(10, Math.trunc(options.timeoutMs / 4))))
      : undefined;
    const events = await readSse(
      fetchImpl,
      `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events`,
      options.timeoutMs,
      options.scenario === 'approval'
        ? async (event) => {
          const approvalId = event.type === 'approval.required' ? event.payload?.approvalId : undefined;
          if (!approvalId) return undefined;
          if (approvalSubmitted) return 'HARNESS_APPROVAL_REPLAY';
          approvalSubmitted = true;
          try {
            const approval = await requestJson(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/approve`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ approvalId, decision: 'allow' }),
            }, options.timeoutMs);
            return approval.status === 202 ? undefined : 'HARNESS_APPROVAL_FAILED';
          } catch {
            return 'HARNESS_APPROVAL_FAILED';
          }
        }
        : undefined,
    );
    if (cancelTimer !== undefined) clearTimeout(cancelTimer);
    const snapshot = await requestJson(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(runId)}`, { method: 'GET' }, options.timeoutMs);
    const finalStatus = readRunStatus(snapshot.body, events);
    const goal = options.mode === 'governed'
      ? await waitForGoalOutcome(runtime, options.timeoutMs, now)
      : undefined;
    const providerError = events.errorCode ?? events.approvalErrorCode ?? readSafeRunError(snapshot.body);
    const expectedContextLimit = options.scenario === 'context-limit';
    const expectedTerminalEvent = options.scenario === 'cancel'
      ? 'run.cancelled'
      : expectedContextLimit ? 'run.failed' : 'run.completed';
    const hasTerminalEvent = events.events.some((event) => event.type === expectedTerminalEvent);
    const expectedStatus = options.scenario === 'cancel'
      ? 'cancelled'
      : expectedContextLimit ? 'failed' : 'completed';
    const runHealthy = expectedContextLimit
      ? finalStatus === expectedStatus && hasTerminalEvent && providerError === 'CONTEXT_BUDGET_EXCEEDED'
      : finalStatus === expectedStatus && hasTerminalEvent && providerError === undefined;
    const goalHealthy = options.mode !== 'governed' || goal?.status === 'validated';
    const toolEvidence = summarizeToolEvidence(events.events);
    const toolRequired = options.scenario === 'tool' || options.scenario === 'approval';
    const toolHealthy = !toolRequired || toolEvidence.status === 'completed' && (options.scenario !== 'approval' || toolEvidence.approvalDecided > 0);
    const reportedToolEvidence = toolRequired || toolEvidence.requested > 0 ? toolEvidence : undefined;
    const toolError = toolRequired && !toolHealthy
      ? toolEvidence.status === 'not-used' ? 'HARNESS_TOOL_NOT_USED' : 'HARNESS_TOOL_FAILED'
      : undefined;
    const terminalStatus = events.timedOut
      ? 'timeout'
      : options.scenario === 'cancel' && finalStatus === 'cancelled'
        ? 'cancelled'
        : runHealthy && goalHealthy && toolHealthy ? 'healthy' : 'failed';
    return report(
      options,
      terminalStatus,
      elapsedMs(startedAt, now()),
      runId,
      events,
      goal,
      events.timedOut
        ? 'HARNESS_SSE_TIMEOUT'
        : providerError ?? (goalHealthy ? undefined : 'HARNESS_GOAL_VALIDATION_FAILED') ?? toolError,
      finalStatus,
      reportedToolEvidence,
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

function report(options, status, elapsed, runId, events, goal, errorCode, finalStatus, toolEvidence) {
  const result = {
    schemaVersion: 'harness-smoke/v1',
    mode: options.mode,
    provider: options.provider ?? DEFAULT_PROVIDER_ID,
    ...(options.endpointProfile ? { endpointProfile: options.endpointProfile } : {}),
    scenario: options.scenario ?? DEFAULT_SCENARIO,
    thinkingMode: options.thinkingMode ?? DEFAULT_THINKING,
    model: options.model ?? null,
    status,
    elapsedMs: elapsed,
    ...(runId ? { runId } : {}),
    ...(finalStatus ? { runStatus: finalStatus } : {}),
    ...(events?.providerSnapshot ? { providerSnapshot: events.providerSnapshot } : {}),
    ...(toolEvidence ? { toolEvidence } : {}),
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
  const provider = options.provider ?? DEFAULT_PROVIDER_ID;
  const toolScenario = options.scenario === 'tool' || options.scenario === 'approval';
  const config = {
    workspaceId: SMOKE_WORKSPACE_ID,
    userMessage: toolScenario
      ? 'Call the echo tool with the value ready4vibe-tool-smoke, then reply with exactly the word ready4vibe-harness-smoke.'
      : 'Reply with exactly the word ready4vibe-harness-smoke.',
    model: { provider, name: options.model },
    taskTrust: 'trusted-workspace',
    sandbox: { mode: 'read-only', network: 'restricted' },
    approval: 'on-request',
    limits: {
      maxTurns: toolScenario ? 2 : 1,
      maxWallTimeMs: options.timeoutMs,
      maxModelInputTokens: 256,
      maxModelOutputTokens: 64,
      maxToolCalls: toolScenario ? 1 : 1,
      maxOutputBytes: 4_096,
      maxContextBytes: options.scenario === 'context-limit' ? 1 : 16_384,
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

export async function createProvider(options, secretValue, dependencies = {}) {
  const provider = options.provider ?? DEFAULT_PROVIDER_ID;
  if (provider === DEEPSEEK_PROVIDER_ID) {
    const modelDeepSeek = dependencies.modelDeepSeek ?? await import('../packages/model-deepseek/dist/index.js');
    const endpointProfile = validateDeepSeekProfile(options.endpointProfile ?? DEFAULT_DEEPSEEK_PROFILE);
    const config = {
      schemaVersion: 'deepseek-provider/v1',
      providerId: 'deepseek',
      endpointProfile,
      endpoint: validateDeepSeekEndpoint(options.endpoint, endpointProfile),
      model: options.model,
      authRef: 'secret.deepseek.harness',
      thinkingMode: options.thinkingMode ?? DEFAULT_THINKING,
      toolCalling: options.scenario === 'tool' || options.scenario === 'approval' ? 'enabled' : 'disabled',
      webSearch: 'off',
      reviewer: 'off',
      timeoutMs: options.timeoutMs,
      maxRetries: 0,
      maxOutputTokens: 64,
      revision: 'harness-deepseek-config',
      updatedAt: new Date().toISOString(),
    };
    return new modelDeepSeek.DeepSeekProvider({ config, apiKey: secretValue, ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}) });
  }
  const modelOpenAi = dependencies.modelOpenAi ?? await import('../packages/model-openai/dist/index.js');
  return new modelOpenAi.OpenAICompatibleProvider({
    id: DEFAULT_PROVIDER_ID,
    endpoint: options.endpoint,
    apiKey: secretValue,
  });
}

/**
 * A deliberately tiny fixture runtime for the explicit tool/approval smoke
 * scenarios. It is not a production filesystem, shell or sandbox adapter.
 */
export function createHarnessToolRuntime(scenario = 'tool') {
  if (scenario !== 'tool' && scenario !== 'approval') throw new Error('HARNESS_TOOL_SCENARIO_INVALID');
  let approved = scenario !== 'approval';
  const descriptor = Object.freeze({
    name: 'echo',
    id: 'harness.echo',
    version: '1',
    risk: scenario === 'approval' ? 'write' : 'read',
    summary: 'Return one bounded value without filesystem or network access.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { value: { type: 'string', maxLength: 128 } },
      required: ['value'],
    },
  });
  return {
    descriptors: [descriptor],
    async execute(request) {
      if (scenario === 'approval' && !approved) throw Object.assign(new Error('approval required'), { code: 'APPROVAL_REQUIRED' });
      const value = request?.input?.value;
      if (typeof value !== 'string' || value.length === 0 || value.length > 128 || /[\r\n\u0000]/u.test(value) || /(?:sk-[A-Za-z0-9]{20,}|api[_-]?key|token|secret|password|authorization|bearer)/iu.test(value)) {
        throw Object.assign(new Error('tool input invalid'), { code: 'TOOL_INPUT_INVALID' });
      }
      return { output: { echo: value } };
    },
    async approve() {
      approved = true;
    },
    approvalDetails() {
      return { summary: 'Allow the bounded harness echo tool once.' };
    },
  };
}

export async function createDefaultRuntime(options, provider, dependencies = {}) {
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
  const modelBindingForRun = options.provider === DEEPSEEK_PROVIDER_ID
    ? () => createDeepSeekRunBinding(options, provider, contracts)
    : undefined;
  const toolRuntime = dependencies.toolRuntime
    ?? (options.scenario === 'tool' || options.scenario === 'approval' ? createHarnessToolRuntime(options.scenario) : undefined);
  const runManager = new runManagerPackage.RunManager({
    eventStore,
    scheduler,
    modelProvider: provider,
    ...(modelBindingForRun ? { modelBindingForRun } : {}),
    ...(toolRuntime ? { toolRuntimeForRun: () => toolRuntime } : {}),
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

export function createDeepSeekRunBinding(options, provider, contracts) {
  const endpointProfile = validateDeepSeekProfile(options.endpointProfile ?? DEFAULT_DEEPSEEK_PROFILE);
  const endpoint = validateDeepSeekEndpoint(options.endpoint, endpointProfile);
  const model = options.model;
  const capturedAt = new Date().toISOString();
  const modelSnapshot = contracts.ModelProviderSnapshotSchema.parse({
    schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
    providerId: DEEPSEEK_PROVIDER_ID,
    model,
    pricingModel: model,
    descriptorRevision: 'harness-deepseek-config',
    endpointPolicy: { kind: 'explicit-url', baseUrl: endpoint },
    capabilities: {
      streaming: provider.capabilities.streaming,
      toolCalls: provider.capabilities.toolCalls,
      structuredOutput: provider.capabilities.structuredOutput,
      reasoning: false,
      promptCaching: false,
      audioInput: false,
      audioOutput: false,
    },
    authRef: 'secret.deepseek.harness',
    capturedAt,
  });
  const deepSeekSnapshot = contracts.DeepSeekRunSnapshotSchema.parse({
    schemaVersion: 'deepseek-provider-run/v1',
    providerId: DEEPSEEK_PROVIDER_ID,
    endpointProfile,
    endpoint,
    model,
    thinkingMode: options.thinkingMode ?? DEFAULT_THINKING,
    toolCalling: options.scenario === 'tool' || options.scenario === 'approval' ? 'enabled' : 'disabled',
    webSearch: 'off',
    reviewer: 'off',
    configRevision: 'harness-deepseek-config',
    capabilityRevision: 'deepseek-provider-capability-unprobed',
    capturedAt,
  });
  return { provider, snapshot: modelSnapshot, deepSeekSnapshot };
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

async function readSse(fetchImpl, url, timeoutMs, onEvent) {
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
    let providerSnapshot;
    let approvalErrorCode;
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
          if (parsed.providerSnapshot) providerSnapshot = parsed.providerSnapshot;
          if (onEvent) {
            const callbackCode = await onEvent(parsed);
            if (callbackCode) approvalErrorCode = callbackCode;
          }
        }
      }
      buffer += decoder.decode();
      const trailing = parseSseFrame(buffer);
      if (trailing) events.push(trailing);
    } finally {
      reader.releaseLock();
    }
    return { events, timedOut: false, inputTokens, outputTokens, ...(providerSnapshot ? { providerSnapshot } : {}), ...(errorCode ? { errorCode } : {}), ...(approvalErrorCode ? { approvalErrorCode } : {}) };
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
  if (eventType === 'approval.required') return { type: eventType, payload: { approvalId: boundedApprovalId(payload?.approvalId) } };
  if (eventType === 'approval.decided') return { type: eventType, payload: { approvalId: boundedApprovalId(payload?.approvalId), decision: boundedDecision(payload?.decision) } };
  if (eventType === 'tool.completed') return { type: eventType, payload: { success: payload?.success === true, code: boundedToolCode(payload?.code) } };
  if (eventType === 'run.created') return { type: eventType, providerSnapshot: readProviderSnapshot(payload) };
  if (eventType === 'model.requested') return { type: eventType, providerSnapshot: readProviderSnapshot(payload) };
  return { type: eventType };
}

function readProviderSnapshot(payload) {
  const model = payload?.modelSnapshot;
  const deepSeek = payload?.deepSeekSnapshot;
  const providerId = typeof model?.providerId === 'string' && /^[a-z][a-z0-9-]{1,63}$/u.test(model.providerId)
    ? model.providerId
    : typeof deepSeek?.providerId === 'string' && /^[a-z][a-z0-9-]{1,63}$/u.test(deepSeek.providerId)
      ? deepSeek.providerId
      : undefined;
  const descriptorRevision = boundedRevision(model?.descriptorRevision);
  const configRevision = boundedRevision(deepSeek?.configRevision);
  const capabilityRevision = boundedRevision(deepSeek?.capabilityRevision);
  if (!providerId && !descriptorRevision && !configRevision && !capabilityRevision) return undefined;
  return {
    ...(providerId ? { providerId } : {}),
    ...(descriptorRevision ? { descriptorRevision } : {}),
    ...(configRevision ? { configRevision } : {}),
    ...(capabilityRevision ? { capabilityRevision } : {}),
  };
}

function boundedRevision(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) ? value : undefined;
}

function boundedApprovalId(value) {
  return typeof value === 'string' && /^ap_[A-Za-z0-9_-]{8,128}$/u.test(value) ? value : undefined;
}

function boundedDecision(value) {
  return value === 'allow' || value === 'deny' || value === 'expired' ? value : undefined;
}

function boundedToolCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : undefined;
}

function summarizeToolEvidence(events) {
  const requested = events.filter((event) => event.type === 'tool.requested').length;
  const completed = events.filter((event) => event.type === 'tool.completed');
  const approvalRequired = events.filter((event) => event.type === 'approval.required').length;
  const approvalDecided = events.filter((event) => event.type === 'approval.decided' && event.payload?.decision === 'allow').length;
  const lastCompleted = completed.at(-1);
  const status = lastCompleted?.payload?.success === true
    ? 'completed'
    : lastCompleted
      ? 'failed'
      : 'not-used';
  return { status, requested, completed: completed.length, approvalRequired, approvalDecided };
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
  return typeof value === 'string' && /^(?:CONTEXT|DEEPSEEK|MODEL|RUN|HARNESS)_[A-Z0-9_]{1,64}$/u.test(value) ? value : 'HARNESS_RUN_FAILED';
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

function validateDeepSeekProfile(value) {
  if (value !== 'openai-chat-completions' && value !== 'openai-responses' && value !== 'anthropic-messages') throw new Error('profile is invalid');
  return value;
}

function validateDeepSeekEndpoint(value, profile) {
  const endpoint = validateEndpoint(value);
  const pathname = new URL(endpoint).pathname.replace(/\/+$/u, '');
  const expected = profile === 'openai-responses' ? '/responses' : profile === 'anthropic-messages' ? '/messages' : '/chat/completions';
  if (!pathname.endsWith(expected)) throw new Error('profile endpoint path does not match profile');
  return endpoint;
}

function validateHarnessScenario(value) {
  if (value !== 'text' && value !== 'tool' && value !== 'approval' && value !== 'cancel' && value !== 'timeout' && value !== 'context-limit') throw new Error('scenario must be text, tool, approval, cancel or context-limit');
  return value;
}

function validateHarnessThinking(value) {
  if (value !== 'off' && value !== 'auto' && value !== 'high' && value !== 'max') throw new Error('thinking mode is invalid');
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
