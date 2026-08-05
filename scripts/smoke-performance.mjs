import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:performance -- [--mode <application|resources|both>] [--runs <2..4>] [--timeout-ms <100..30000>]';
const ENV_MODE = 'VIBEGO_PERFORMANCE_SMOKE_MODE';
const ENV_RUNS = 'VIBEGO_PERFORMANCE_SMOKE_RUNS';
const ENV_TIMEOUT = 'VIBEGO_PERFORMANCE_SMOKE_TIMEOUT_MS';
const DEFAULT_TIMEOUT_MS = 10_000;

export function parsePerformanceSmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'both';
  let runs = Number(environment[ENV_RUNS] ?? 2);
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode' || argument === '--runs' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--mode') mode = value;
      else if (argument === '--runs') runs = Number(value);
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }
  if (mode !== 'application' && mode !== 'resources' && mode !== 'both') throw new Error('mode must be application, resources or both');
  if (!Number.isSafeInteger(runs) || runs < 2 || runs > 4) throw new Error('runs must be between 2 and 4');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('timeout is invalid');
  return Object.freeze({ mode, runs, timeoutMs });
}

export function exitCodeForPerformanceSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'timeout') return 3;
  return 1;
}

export function safePerformanceSmokeErrorCode(error, fallback = 'PERFORMANCE_SMOKE_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^PERFORMANCE_[A-Z0-9_]{1,63}$/u.test(code) ? code : fallback;
}

/**
 * Runs only fixed local fixtures. The default runtime uses the existing
 * RunManager/Scheduler and ResourceCollector; no user workspace or provider
 * credential is consulted.
 */
export async function runPerformanceSmoke(options, dependencies = {}) {
  const startedAt = Date.now();
  let runtime;
  try {
    runtime = dependencies.runtimeFactory
      ? await dependencies.runtimeFactory(options)
      : await createDefaultRuntime();
    const outcome = await withTimeout(runtime.run(options), options.timeoutMs);
    return report(options, outcome, Date.now() - startedAt);
  } catch (error) {
    const status = error?.code === 'PERFORMANCE_SMOKE_TIMEOUT' ? 'timeout' : 'failed';
    return report(options, { status, errorCode: safePerformanceSmokeErrorCode(error) }, Date.now() - startedAt);
  } finally {
    try { await runtime?.close?.(); } catch { /* fixture cleanup is bounded and best effort */ }
  }
}

function report(options, outcome, elapsedMs) {
  const safeOutcome = outcome && typeof outcome === 'object' ? outcome : {};
  const result = {
    schemaVersion: 'performance-smoke/v1',
    mode: options.mode,
    runs: options.runs,
    status: safeStatus(safeOutcome.status),
    elapsedMs: boundedElapsed(elapsedMs),
    ...(safeApplication(safeOutcome.application) ? { application: safeApplication(safeOutcome.application) } : {}),
    ...(safeResources(safeOutcome.resources) ? { resources: safeResources(safeOutcome.resources) } : {}),
  };
  const errorCode = safeCode(safeOutcome.errorCode);
  if (errorCode) result.errorCode = errorCode;
  return Object.freeze(result);
}

function safeApplication(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = { status: safeStatus(value.status) };
  for (const key of ['requestedRuns', 'completedRuns', 'maxConcurrent', 'p95LatencyMs', 'terminalEvents']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 100_000) result[key] = value[key];
  }
  if (typeof value.overlapped === 'boolean') result.overlapped = value.overlapped;
  return Object.freeze(result);
}

function safeResources(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = { status: safeStatus(value.status) };
  for (const key of ['sampleCount', 'droppedSampleCount', 'writerBatches']) {
    if (Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= 100_000) result[key] = value[key];
  }
  if (typeof value.state === 'string' && ['ready', 'degraded', 'stopped', 'running'].includes(value.state)) result.state = value.state;
  if (typeof value.rssBytes === 'string' && /^\d{1,20}$/u.test(value.rssBytes)) result.rssBytes = value.rssBytes;
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

export async function createDefaultRuntime() {
  const [contracts, storage, schedulerPackage, runManagerPackage, observability] = await Promise.all([
    import('../packages/contracts/dist/index.js'),
    import('../packages/storage/dist/index.js'),
    import('../packages/scheduler/dist/index.js'),
    import('../apps/daemon/dist/run-manager.js'),
    import('../packages/observability/dist/index.js'),
  ]);
  const { baseConfig, FixtureModelProvider } = await import('./smoke-recovery.mjs');
  // Keep the fixture long enough to prove overlap even on a busy Windows
  // checkout, while remaining far below the bounded smoke timeout.
  const provider = new FixtureModelProvider({ delayMs: 100 });

  function manager(maxActiveRuns, model = provider) {
    return new runManagerPackage.RunManager({
      eventStore: new storage.InMemoryEventStore(),
      scheduler: new schedulerPackage.Scheduler({ ...contracts.DEFAULT_SCHEDULER_POLICY, maxActiveRuns }),
      modelProvider: model,
      workspaceExists: (workspaceId) => /^performance_workspace_[a-z0-9_-]+$/u.test(workspaceId),
    });
  }

  return {
    async run(options) {
      const outcome = {};
      if (options.mode === 'application' || options.mode === 'both') outcome.application = await runApplication(manager, provider, options, baseConfig);
      if (options.mode === 'resources' || options.mode === 'both') outcome.resources = await runResources(observability.ResourceCollector);
      const values = Object.values(outcome);
      return { status: values.length > 0 && values.every((value) => value.status === 'healthy') ? 'healthy' : 'failed', ...outcome };
    },
    close: async () => undefined,
  };
}

async function runApplication(managerFactory, provider, options, baseConfig) {
  provider.reset();
  const manager = managerFactory(Math.min(options.runs, 4));
  const runIds = [];
  for (let index = 0; index < options.runs; index += 1) {
    const workspaceId = `performance_workspace_${index + 1}`;
    const started = await manager.start(baseConfig(workspaceId, {
      clientRequestId: `performance-smoke-${index + 1}`,
      userMessage: 'performance smoke fixture',
    }), { runId: `run_performance_${index + 1}` });
    runIds.push(started.runId);
  }
  const completions = await Promise.all(runIds.map((runId) => waitForCompletion(manager, runId, options.timeoutMs)));
  const latencies = completions.filter((value) => value !== undefined).map((value) => value.elapsedMs).sort((left, right) => left - right);
  const completedRuns = completions.filter((value) => value?.status === 'completed').length;
  const expectedOverlap = Math.min(options.runs, 2);
  const healthy = completedRuns === options.runs && provider.maxConcurrent >= expectedOverlap;
  return {
    status: healthy ? 'healthy' : 'failed',
    requestedRuns: options.runs,
    completedRuns,
    maxConcurrent: provider.maxConcurrent,
    overlapped: provider.maxConcurrent >= expectedOverlap,
    p95LatencyMs: percentile(latencies, 0.95),
    terminalEvents: completedRuns,
  };
}

async function runResources(ResourceCollector) {
  const samples = [];
  const writer = { appendBatch: async ({ resourceSamples = [] }) => { samples.push(...resourceSamples); } };
  const collector = new ResourceCollector({ writer, profile: 'idle', scope: 'daemon', queueCapacity: 4, maxBatchSize: 2, flushTimeoutMs: 500 });
  const first = await collector.sampleOnce();
  const second = await collector.sampleOnce();
  await collector.flush();
  const status = collector.status();
  const latest = samples.at(-1);
  const healthy = first.status === 'queued' && second.status === 'queued' && samples.length === 2 && status.droppedSampleCount === 0;
  return {
    status: healthy ? 'healthy' : 'failed',
    sampleCount: samples.length,
    droppedSampleCount: status.droppedSampleCount,
    writerBatches: samples.length > 0 ? 1 : 0,
    state: status.state,
    ...(latest?.memory?.rssBytes ? { rssBytes: latest.memory.rssBytes } : {}),
  };
}

async function waitForCompletion(manager, runId, timeoutMs) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() < deadline) {
    const completion = manager.completion(runId);
    if (completion) return { ...completion, elapsedMs: boundedElapsed(Date.now() - startedAt) };
    await delay(10);
  }
  return undefined;
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return Math.max(0, Math.min(120_000, Math.trunc(values[index] ?? 0)));
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('performance smoke timed out'), { code: 'PERFORMANCE_SMOKE_TIMEOUT' })), timeoutMs);
  });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parsePerformanceSmokeArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${USAGE}\n`);
    else {
      const result = await runPerformanceSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForPerformanceSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
