import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:deepseek-search -- --mode <fixture|live> [--authorize --endpoint <https://provider.example/v1/responses> --model <model-id> --secret-env <ENV_VAR> --timeout-ms <100..30000>]';
const QUERY = 'bounded fixture query';
const LIVE_QUERY = 'What is the current status of the VibeGo project?';
const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/responses';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 10_000;
const ENV_MODE = 'VIBEGO_DEEPSEEK_SEARCH_SMOKE_MODE';
const ENV_AUTHORIZE = 'VIBEGO_DEEPSEEK_SEARCH_SMOKE_AUTHORIZE';
const ENV_ENDPOINT = 'VIBEGO_DEEPSEEK_SEARCH_SMOKE_ENDPOINT';
const ENV_MODEL = 'VIBEGO_DEEPSEEK_SEARCH_SMOKE_MODEL';
const ENV_SECRET = 'VIBEGO_DEEPSEEK_SEARCH_SMOKE_SECRET_ENV';
const ENV_TIMEOUT = 'VIBEGO_DEEPSEEK_SEARCH_SMOKE_TIMEOUT_MS';

export function parseDeepSeekSearchSmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'fixture';
  let authorize = environment[ENV_AUTHORIZE] === '1';
  let endpoint = environment[ENV_ENDPOINT] ?? DEFAULT_ENDPOINT;
  let model = environment[ENV_MODEL] ?? DEFAULT_MODEL;
  let secretEnv = environment[ENV_SECRET];
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--authorize') {
      authorize = true;
      continue;
    }
    if (argument === '--mode') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      mode = value;
      index += 1;
      continue;
    }
    if (argument === '--endpoint' || argument === '--model' || argument === '--secret-env' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--endpoint') endpoint = value;
      else if (argument === '--model') model = value;
      else if (argument === '--secret-env') secretEnv = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }
  if (mode === 'fixture') return Object.freeze({ mode });
  if (mode !== 'live') throw new Error('mode must be fixture or live');
  if (!authorize) throw new Error('live mode requires explicit --authorize');
  if (typeof secretEnv !== 'string' || secretEnv.length === 0) throw new Error('live mode requires --secret-env');
  return Object.freeze({
    mode,
    authorize: true,
    endpoint: validateEndpoint(endpoint),
    endpointProfile: 'openai-responses',
    model: validateModel(model),
    secretEnv: validateSecretEnv(secretEnv),
    timeoutMs: validateTimeout(timeoutMs),
  });
}

export function exitCodeForDeepSeekSearchSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'cancelled' || status === 'timeout') return 3;
  return 1;
}

/**
 * Run the provider-owned search application-port fixture. It never creates a
 * provider, daemon listener, scheduler, tool runtime, credential or network
 * client. The service and executor are injectable so this remains repeatable.
 */
export async function runDeepSeekSearchSmoke(options = { mode: 'fixture' }, dependencies = {}) {
  if (options.mode === 'live') return runLiveDeepSeekSearchSmoke(options, dependencies);
  const service = dependencies.service ?? await createFixtureService(dependencies);
  const cases = [
    ['ready', { network: 'enabled', approvalGranted: true }, { kind: 'valid' }],
    ['denied', { network: 'restricted', approvalGranted: true }, { kind: 'valid' }],
    ['malformed', { network: 'enabled', approvalGranted: true }, { kind: 'malformed' }],
    ['cancelled', { network: 'enabled', approvalGranted: true }, { kind: 'cancelled' }],
  ];
  const results = [];
  for (const [name, gate, input] of cases) {
    const controller = new AbortController();
    if (input.kind === 'cancelled') controller.abort();
    const request = input.kind === 'malformed'
      ? { schemaVersion: 'deepseek-provider-search-request/v1', query: QUERY, extra: true }
      : {
        schemaVersion: 'deepseek-provider-search-request/v1',
        query: QUERY,
        maxItems: 4,
        maxBytes: 2_048,
      };
    const result = await service.search(request, gate, controller.signal);
    const expected = name === 'ready' ? result.status === 'ready' && result.items.length === 1
      : name === 'denied' ? result.status === 'degraded' && result.reasonCode === 'DEEPSEEK_SEARCH_DEGRADED'
        : name === 'malformed' ? result.status === 'degraded' && result.reasonCode === 'DEEPSEEK_SEARCH_PROTOCOL_INVALID'
          : result.status === 'degraded' && result.reasonCode === 'DEEPSEEK_SEARCH_CANCELLED';
    results.push({ name, expected, status: result.status, reasonCode: result.reasonCode ?? null, itemCount: Math.min(32, result.items.length), contextBytes: boundedCount(result.projection?.bytes) });
  }
  const healthy = results.every((entry) => entry.expected);
  return Object.freeze({
    schemaVersion: 'deepseek-search-smoke/v1',
    mode: options.mode,
    status: healthy ? 'healthy' : 'failed',
    cases: results,
  });
}

/**
 * Run one explicitly authorized, capability-probed provider-owned search.
 * The live path is intentionally independent from the daemon and never
 * persists the runtime credential or raw provider response.
 */
async function runLiveDeepSeekSearchSmoke(options, dependencies) {
  const now = dependencies.now ?? (() => Date.now());
  const startedAt = now();
  const secretValue = dependencies.secretValue
    ? await dependencies.secretValue(options.secretEnv)
    : process.env[options.secretEnv];
  if (typeof secretValue !== 'string' || secretValue.length === 0 || secretValue.length > 4_096 || /[\r\n]/u.test(secretValue)) {
    return liveReport(options, 'blocked', startedAt, now, undefined, undefined, undefined, 'DEEPSEEK_CREDENTIAL_REQUIRED');
  }

  const config = {
    schemaVersion: 'deepseek-provider/v1',
    providerId: 'deepseek',
    endpointProfile: 'openai-responses',
    endpoint: options.endpoint,
    model: options.model,
    authRef: 'secret.deepseek.search.smoke',
    thinkingMode: 'off',
    toolCalling: 'disabled',
    webSearch: 'provider-owned',
    reviewer: 'off',
    timeoutMs: options.timeoutMs,
    maxRetries: 0,
    maxOutputTokens: 256,
    revision: 'deepseek-search-smoke-config',
    updatedAt: new Date().toISOString(),
  };

  let probe;
  try {
    const modelDeepSeek = dependencies.modelDeepSeek ?? await import('../packages/model-deepseek/dist/index.js');
    probe = dependencies.probe
      ? await dependencies.probe({ config, apiKey: secretValue, timeoutMs: options.timeoutMs })
      : await modelDeepSeek.probeDeepSeek({
        config,
        apiKey: secretValue,
        timeoutMs: options.timeoutMs,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
      });
    if (probe?.status !== 'ready' || !probe.capabilities?.webSearch) {
      return liveReport(options, 'blocked', startedAt, now, probe?.status, probe?.latencyMs, undefined, 'DEEPSEEK_SEARCH_CAPABILITY_REQUIRED');
    }

    const capability = probe.capabilities;
    const provider = dependencies.provider ?? (dependencies.providerFactory
      ? await dependencies.providerFactory({ config, capability, apiKey: secretValue })
      : new modelDeepSeek.DeepSeekProvider({
        config,
        capability,
        apiKey: secretValue,
        ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
    }));
    const service = dependencies.service ?? await createLiveService(dependencies, config, capability, provider);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
    try {
      const result = await service.search({
        schemaVersion: 'deepseek-provider-search-request/v1',
        query: LIVE_QUERY,
        maxItems: 4,
        maxBytes: 8_192,
      }, { network: 'enabled', approvalGranted: true }, controller.signal);
      if (timedOut) return liveReport(options, 'timeout', startedAt, now, probe.status, probe.latencyMs, result, 'DEEPSEEK_SEARCH_TIMEOUT');
      if (result.status === 'ready') {
        return liveReport(options, 'healthy', startedAt, now, probe.status, probe.latencyMs, result, undefined);
      }
      const reasonCode = typeof result.reasonCode === 'string' ? result.reasonCode : 'DEEPSEEK_SEARCH_DEGRADED';
      return liveReport(options, reasonCode === 'DEEPSEEK_SEARCH_CANCELLED' ? 'cancelled' : reasonCode === 'DEEPSEEK_SEARCH_TIMEOUT' ? 'timeout' : 'failed', startedAt, now, probe.status, probe.latencyMs, result, reasonCode);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const code = safeSearchErrorCode(error);
    return liveReport(options, code === 'DEEPSEEK_SEARCH_CANCELLED' ? 'cancelled' : code === 'DEEPSEEK_SEARCH_TIMEOUT' ? 'timeout' : 'failed', startedAt, now, probe?.status, probe?.latencyMs, undefined, code);
  }
}

async function createLiveService(dependencies, config, capability, provider) {
  const daemon = dependencies.daemon ?? await import('../apps/daemon/dist/deepseek-capability-runtime.js');
  return new daemon.DeepSeekApplicationCapabilityService({
    modelSnapshot: {
      schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
      providerId: 'deepseek',
      model: config.model,
      pricingModel: config.model,
      descriptorRevision: config.revision,
      endpointPolicy: { kind: 'explicit-url', baseUrl: config.endpoint },
      capabilities: { streaming: true, toolCalls: false, structuredOutput: false, reasoning: capability.reasoning, promptCaching: false, audioInput: false, audioOutput: false },
      capturedAt: capability.capturedAt,
    },
    deepSeekSnapshot: {
      schemaVersion: 'deepseek-provider-run/v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-responses',
      endpoint: config.endpoint,
      model: config.model,
      thinkingMode: 'off',
      toolCalling: 'disabled',
      webSearch: 'provider-owned',
      reviewer: 'off',
      configRevision: config.revision,
      capabilityRevision: capability.descriptorRevision,
      capturedAt: capability.capturedAt,
    },
    capabilitySnapshot: capability,
  }, { maxContextBytes: 8_192, maxContextItems: 4, maxContextTokens: 1_024, searchExecutor: provider });
}

function liveReport(options, status, startedAt, now, probeStatus, probeLatencyMs, result, errorCode) {
  const projectionBytes = result?.projection?.bytes;
  const report = {
    schemaVersion: 'deepseek-search-smoke/v1',
    mode: 'live',
    provider: 'deepseek',
    endpointProfile: options.endpointProfile,
    model: options.model,
    status,
    elapsedMs: boundedElapsed(startedAt, now()),
    probeStatus: probeStatus === 'ready' || probeStatus === 'degraded' || probeStatus === 'blocked' ? probeStatus : null,
    probeLatencyMs: boundedMetric(probeLatencyMs),
    itemCount: boundedCount(result?.items?.length),
    contextBytes: boundedCount(projectionBytes),
  };
  return Object.freeze(errorCode ? { ...report, errorCode: safeSearchErrorCode({ code: errorCode }) } : report);
}

function safeSearchErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^DEEPSEEK(?:_HTTP_[0-9]+|_[A-Z0-9_]{1,64})$/u.test(code) ? code : 'DEEPSEEK_SEARCH_DEGRADED';
}

function boundedElapsed(startedAt, endedAt) {
  return Math.max(0, Math.min(120_000, Math.trunc(endedAt - startedAt)));
}

function boundedMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 120_000 ? value : null;
}

async function createFixtureService(dependencies) {
  const daemon = dependencies.daemon ?? await import('../apps/daemon/dist/deepseek-capability-runtime.js');
  const executor = dependencies.executor ?? {
    async search(request) {
      if (request.query !== QUERY) throw new Error('unexpected fixture query');
      return {
        schemaVersion: 'deepseek-provider-search/v1',
        query: QUERY,
        items: [{
          schemaVersion: 'deepseek-provider-search-item/v1',
          source: 'retrieval',
          trust: 'untrusted',
          referenceId: 'fixture-ref-1',
          title: 'Fixture result',
          snippet: 'Bounded provider-owned retrieval fixture.',
          url: 'https://example.com/fixture',
        }],
        truncated: false,
      };
    },
  };
  return new daemon.DeepSeekApplicationCapabilityService({
    modelSnapshot: {
      schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      pricingModel: 'deepseek-v4-flash',
      descriptorRevision: 'fixture-config-1',
      endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://api.deepseek.com/v1/responses' },
      capabilities: { streaming: true, toolCalls: false, structuredOutput: false, reasoning: false, promptCaching: false, audioInput: false, audioOutput: false },
      capturedAt: '2026-08-06T00:00:00.000Z',
    },
    deepSeekSnapshot: {
      schemaVersion: 'deepseek-provider-run/v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-responses',
      endpoint: 'https://api.deepseek.com/v1/responses',
      model: 'deepseek-v4-flash',
      thinkingMode: 'off',
      toolCalling: 'disabled',
      webSearch: 'provider-owned',
      reviewer: 'off',
      configRevision: 'fixture-config-1',
      capabilityRevision: 'fixture-capability-1',
      capturedAt: '2026-08-06T00:00:00.000Z',
    },
    capabilitySnapshot: {
      schemaVersion: 'deepseek-provider-capability/v1',
      providerId: 'deepseek',
      endpointProfile: 'openai-responses',
      model: 'deepseek-v4-flash',
      descriptorRevision: 'fixture-capability-1',
      capturedAt: '2026-08-06T00:00:00.000Z',
      status: 'ready',
      streaming: true,
      toolCalls: false,
      structuredOutput: false,
      reasoning: false,
      usage: true,
      webSearch: true,
      contextLimit: 'unknown',
      outputLimit: 1_024,
      degradedReason: null,
    },
  }, { maxContextBytes: 2_048, maxContextItems: 4, maxContextTokens: 512, searchExecutor: executor });
}

function boundedCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 32 * 1024 ? value : 0;
}

function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2_048) throw new Error('endpoint is invalid');
  let url;
  try { url = new URL(value); } catch { throw new Error('endpoint is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('endpoint must be a credential-free HTTPS URL');
  const pathname = url.pathname.replace(/\/+$/u, '');
  if (!pathname.endsWith('/responses')) throw new Error('live search requires an explicit Responses endpoint');
  return value;
}

function validateModel(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value) || /(?:sk-|api[_-]?key|token|secret|password|bearer)/iu.test(value)) throw new Error('model is invalid');
  return value;
}

function validateSecretEnv(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(value)) throw new Error('secret-env reference is invalid');
  return value;
}

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) throw new Error('timeout is invalid');
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseDeepSeekSearchSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      const result = await runDeepSeekSearchSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForDeepSeekSearchSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
