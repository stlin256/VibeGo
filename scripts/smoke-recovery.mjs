import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:recovery -- [--mode <concurrency|recovery|both>] [--timeout-ms <100..30000>]';
const DEFAULT_TIMEOUT_MS = 10_000;
const ENV_MODE = 'VIBEGO_RECOVERY_SMOKE_MODE';
const ENV_TIMEOUT = 'VIBEGO_RECOVERY_SMOKE_TIMEOUT_MS';

export function parseRecoverySmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'both';
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--mode') mode = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }
  if (mode !== 'concurrency' && mode !== 'recovery' && mode !== 'both') throw new Error('mode must be concurrency, recovery or both');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('timeout is invalid');
  return Object.freeze({ mode, timeoutMs });
}

export function exitCodeForRecoverySmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'timeout') return 3;
  return 1;
}

export function safeRecoverySmokeErrorCode(error, fallback = 'RECOVERY_SMOKE_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^RECOVERY_[A-Z0-9_]{1,63}$/u.test(code) ? code : fallback;
}

/**
 * Exercises existing RunManager/Scheduler/AgentLoop ports with a deterministic
 * provider. Dependencies are injectable so unit tests never spawn or access
 * the daemon runtime.
 */
export async function runRecoverySmoke(options, dependencies = {}) {
  const startedAt = Date.now();
  let runtime;
  try {
    runtime = dependencies.runtimeFactory
      ? await dependencies.runtimeFactory(options)
      : await createDefaultRuntime();
    const outcome = await withTimeout(runtime.run(options.mode, options.timeoutMs), options.timeoutMs);
    return report(options, outcome, Date.now() - startedAt);
  } catch (error) {
    if (error?.code === 'RECOVERY_SMOKE_TIMEOUT') return report(options, { status: 'timeout', errorCode: 'RECOVERY_SMOKE_TIMEOUT' }, Date.now() - startedAt);
    return report(options, { status: 'failed', errorCode: safeRecoverySmokeErrorCode(error) }, Date.now() - startedAt);
  } finally {
    try { await runtime?.close?.(); } catch { /* bounded fixture cleanup is best effort */ }
  }
}

function report(options, outcome, elapsedMs) {
  const safeOutcome = outcome && typeof outcome === 'object' ? outcome : {};
  const result = {
    schemaVersion: 'recovery-smoke/v1',
    mode: options.mode,
    status: safeStatus(safeOutcome.status),
    elapsedMs: boundedElapsed(elapsedMs),
    ...(safeModeResult(safeOutcome.concurrency, 'concurrency') ? { concurrency: safeModeResult(safeOutcome.concurrency, 'concurrency') } : {}),
    ...(safeModeResult(safeOutcome.recovery, 'recovery') ? { recovery: safeModeResult(safeOutcome.recovery, 'recovery') } : {}),
  };
  const errorCode = safeCode(safeOutcome.errorCode);
  if (errorCode) result.errorCode = errorCode;
  return Object.freeze(result);
}

function safeModeResult(value, kind) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = { status: safeStatus(value.status) };
  for (const key of ['maxConcurrent', 'completedRuns', 'terminalEvents', 'recoveryEvents', 'marked', 'secondMarked', 'providerCallsAfterRecovery']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 10_000) result[key] = value[key];
  }
  for (const key of ['overlapped', 'queuedCancelled', 'inFlightCancelled', 'idempotent']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (kind === 'concurrency' && result.maxConcurrent === undefined) return undefined;
  if (kind === 'recovery' && result.recoveryEvents === undefined) return undefined;
  return Object.freeze(result);
}

function safeStatus(value) {
  return value === 'healthy' || value === 'blocked' || value === 'timeout' || value === 'failed' ? value : 'failed';
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : undefined;
}

function boundedElapsed(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(120_000, Math.trunc(value))) : 0;
}

async function createDefaultRuntime() {
  const [contracts, storage, schedulerPackage, runManagerPackage] = await Promise.all([
    import('../packages/contracts/dist/index.js'),
    import('../packages/storage/dist/index.js'),
    import('../packages/scheduler/dist/index.js'),
    import('../apps/daemon/dist/run-manager.js'),
  ]);
  const provider = new FixtureModelProvider();

  function manager(maxActiveRuns = 2, model = provider, eventStore = new storage.InMemoryEventStore()) {
    return new runManagerPackage.RunManager({
      eventStore,
      scheduler: new schedulerPackage.Scheduler({ ...contracts.DEFAULT_SCHEDULER_POLICY, maxActiveRuns }),
      modelProvider: model,
      workspaceExists: (workspaceId) => /^recovery_workspace_[a-z0-9_-]+$/u.test(workspaceId),
    });
  }

  async function run(mode) {
    const outcome = {};
    if (mode === 'concurrency' || mode === 'both') outcome.concurrency = await runConcurrency(manager, provider);
    if (mode === 'recovery' || mode === 'both') outcome.recovery = await runRecovery(manager, provider, storage);
    const values = Object.values(outcome);
    return { status: values.every((value) => value.status === 'healthy') ? 'healthy' : 'failed', ...outcome };
  }

  return { run, close: async () => undefined };
}

async function runConcurrency(managerFactory, provider) {
  provider.reset();
  const manager = managerFactory(2, provider);
  const first = await manager.start(baseConfig('recovery_workspace_one'), { runId: 'run_recovery_parallel_1' });
  const second = await manager.start(baseConfig('recovery_workspace_two'), { runId: 'run_recovery_parallel_2' });
  const completions = await Promise.all([waitForCompletion(manager, first.runId), waitForCompletion(manager, second.runId)]);
  const concurrent = provider.maxConcurrent;

  const cancellationProvider = new FixtureModelProvider({ delayMs: 1_000 });
  const cancellationManager = managerFactory(1, cancellationProvider);
  const active = await cancellationManager.start(baseConfig('recovery_workspace_cancel'), { runId: 'run_recovery_cancel_1' });
  await waitUntil(() => cancellationProvider.requests.length >= 1, 2_000);
  const queued = await cancellationManager.start(baseConfig('recovery_workspace_queued'), { runId: 'run_recovery_cancel_2' });
  const queuedCancelled = await cancellationManager.cancel(queued.runId);
  const inFlightCancelled = await cancellationManager.cancel(active.runId);
  const cancelled = await Promise.all([waitForCompletion(cancellationManager, active.runId), waitForCompletion(cancellationManager, queued.runId)]);
  const terminalEvents = (await cancellationManager.readEvents(active.runId)).filter((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).length
    + (await cancellationManager.readEvents(queued.runId)).filter((event) => ['run.completed', 'run.failed', 'run.cancelled'].includes(event.type)).length;

  return {
    status: completions.every((result) => result?.status === 'completed') && concurrent >= 2 && queuedCancelled === 'accepted' && inFlightCancelled === 'accepted'
      && cancelled.every((result) => result?.status === 'cancelled') ? 'healthy' : 'failed',
    maxConcurrent: concurrent,
    completedRuns: completions.filter((result) => result?.status === 'completed').length,
    overlapped: concurrent >= 2,
    queuedCancelled: queuedCancelled === 'accepted' && cancelled[1]?.status === 'cancelled',
    inFlightCancelled: inFlightCancelled === 'accepted' && cancelled[0]?.status === 'cancelled',
    terminalEvents,
  };
}

async function runRecovery(managerFactory, provider, storage) {
  provider.reset();
  const eventStore = new storage.InMemoryEventStore();
  const manager = managerFactory(2, provider, eventStore);
  const runId = 'run_recovery_restart_1';
  await eventStore.append({ runId, type: 'run.created', source: 'user', correlationId: 'corr_recovery_smoke', payload: { config: baseConfig('recovery_workspace_restart') } });
  await eventStore.append({ runId, type: 'run.status', source: 'system', correlationId: 'corr_recovery_smoke', payload: { from: 'created', to: 'executing' } });
  const first = await manager.recoverAfterRestart();
  const second = await manager.recoverAfterRestart();
  const events = await eventStore.read(runId);
  const snapshot = await manager.snapshot(runId);
  const recoveryEvents = events.filter((event) => event.type === 'run.needs_recovery').length;
  const healthy = first.marked === 1 && second.marked === 0 && recoveryEvents === 1 && snapshot?.status === 'needs-recovery' && provider.requests.length === 0;
  return {
    status: healthy ? 'healthy' : 'failed',
    marked: first.marked,
    secondMarked: second.marked,
    recoveryEvents,
    providerCallsAfterRecovery: provider.requests.length,
    idempotent: second.marked === 0 && recoveryEvents === 1,
  };
}

export function baseConfig(workspaceId, overrides = {}) {
  return {
    workspaceId,
    userMessage: 'recovery smoke fixture',
    model: { provider: 'fake', name: 'recovery-fixture' },
    taskTrust: 'trusted-workspace',
    sandbox: { mode: 'read-only', network: 'restricted' },
    approval: 'on-request',
    limits: {
      maxTurns: 1,
      maxWallTimeMs: 5_000,
      maxModelInputTokens: 64,
      maxModelOutputTokens: 64,
      maxToolCalls: 1,
      maxOutputBytes: 256,
      maxContextBytes: 4_096,
    },
    createdBySessionId: 'recovery-smoke-session',
    clientRequestId: `recovery-smoke-${workspaceId}`,
    ...overrides,
  };
}

export class FixtureModelProvider {
  id = 'recovery-fixture-model';
  capabilities = { streaming: true, toolCalls: false, structuredOutput: false };
  requests = [];
  active = 0;
  maxConcurrent = 0;
  constructor({ delayMs = 60 } = {}) { this.delayMs = delayMs; }
  delayMs;

  reset() {
    this.requests.length = 0;
    this.active = 0;
    this.maxConcurrent = 0;
  }

  async *stream(request, signal) {
    this.requests.push({ runId: request.metadata.runId });
    this.active += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.active);
    try {
      await delayWithAbort(this.delayMs, signal);
      if (signal.aborted) return;
      yield { type: 'text-delta', text: 'recovery-fixture-ok' };
      yield { type: 'completed', finishReason: 'stop' };
    } finally {
      this.active -= 1;
    }
  }
}

async function waitForCompletion(manager, runId, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const completion = manager.completion(runId);
    if (completion) return completion;
    await delay(10);
  }
  return undefined;
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(10);
  }
  return false;
}

function delayWithAbort(ms, signal) {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms);
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); resolveDelay(); };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('recovery smoke timed out'), { code: 'RECOVERY_SMOKE_TIMEOUT' })), timeoutMs);
  });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseRecoverySmokeArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${USAGE}\n`);
    else {
      const result = await runRecoverySmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForRecoverySmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
