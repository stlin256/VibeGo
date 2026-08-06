import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:deepseek -- --endpoint <https://provider.example/v1/chat/completions> --profile <openai-chat-completions|openai-responses|anthropic-messages> --model <model-id> --secret-env <ENV_VAR> [--scenario <text|reasoning|cancel|timeout>] [--thinking <off|auto|high|max>] [--timeout-ms <100..30000>]';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PROFILE = 'openai-chat-completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_SCENARIO = 'text';
const ENV_ENDPOINT = 'VIBEGO_DEEPSEEK_SMOKE_ENDPOINT';
const ENV_PROFILE = 'VIBEGO_DEEPSEEK_SMOKE_PROFILE';
const ENV_MODEL = 'VIBEGO_DEEPSEEK_SMOKE_MODEL';
const ENV_SECRET = 'VIBEGO_DEEPSEEK_SMOKE_SECRET_ENV';
const ENV_SCENARIO = 'VIBEGO_DEEPSEEK_SMOKE_SCENARIO';
const ENV_THINKING = 'VIBEGO_DEEPSEEK_SMOKE_THINKING';
const ENV_TIMEOUT = 'VIBEGO_DEEPSEEK_SMOKE_TIMEOUT_MS';

export function parseDeepSeekSmokeArgs(argv, environment = process.env) {
  let endpoint = environment[ENV_ENDPOINT];
  let endpointProfile = environment[ENV_PROFILE] ?? DEFAULT_PROFILE;
  let model = environment[ENV_MODEL] ?? DEFAULT_MODEL;
  let secretEnv = environment[ENV_SECRET];
  let scenario = environment[ENV_SCENARIO] ?? DEFAULT_SCENARIO;
  let thinkingMode = environment[ENV_THINKING] ?? 'off';
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--endpoint' || argument === '--profile' || argument === '--model' || argument === '--secret-env' || argument === '--scenario' || argument === '--thinking' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--endpoint') endpoint = value;
      else if (argument === '--profile') endpointProfile = value;
      else if (argument === '--model') model = value;
      else if (argument === '--secret-env') secretEnv = value;
      else if (argument === '--scenario') scenario = value;
      else if (argument === '--thinking') thinkingMode = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }

  if (typeof endpoint !== 'string' || endpoint.length === 0) throw new Error('endpoint is required');
  if (typeof secretEnv !== 'string' || secretEnv.length === 0) throw new Error('secret-env is required');
  if (scenario === 'reasoning' && thinkingMode !== 'high' && thinkingMode !== 'max') {
    throw new Error('reasoning scenario requires --thinking high or --thinking max');
  }
  return Object.freeze({
    endpoint: validateEndpoint(endpoint, endpointProfile),
    endpointProfile: validateProfile(endpointProfile),
    model: validateModel(model),
    secretEnv: validateSecretEnv(secretEnv),
    scenario: validateScenario(scenario),
    thinkingMode: validateThinking(thinkingMode),
    timeoutMs: validateTimeout(timeoutMs),
  });
}

export function exitCodeForDeepSeekSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'blocked') return 2;
  if (status === 'timeout' || status === 'cancelled') return 3;
  return 1;
}

export function safeDeepSeekSmokeErrorCode(error, fallback = 'DEEPSEEK_SMOKE_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^DEEPSEEK_[A-Z0-9_]{1,64}$/u.test(code) ? code : fallback;
}

/**
 * Run one bounded adapter smoke. No daemon, scheduler, settings store or
 * event ledger is created here; dependencies are injectable for fixtures.
 */
export async function runDeepSeekSmoke(options, dependencies = {}) {
  const now = dependencies.now ?? (() => Date.now());
  const startedAt = now();
  const secretValue = dependencies.secretValue
    ? dependencies.secretValue(options.secretEnv)
    : process.env[options.secretEnv];
  if (typeof secretValue !== 'string' || secretValue.length === 0 || secretValue.length > 4_096 || /[\r\n]/u.test(secretValue)) {
    return report(options, 'blocked', elapsedMs(startedAt, now()), undefined, undefined, 'DEEPSEEK_CREDENTIAL_REQUIRED');
  }

  const config = buildConfig(options);
  let modelDeepSeek;
  let probe;
  if (options.scenario === 'reasoning') {
    try {
      probe = dependencies.probe
        ? await dependencies.probe({ config, apiKey: secretValue, timeoutMs: options.timeoutMs })
        : await (modelDeepSeek ??= await import('../packages/model-deepseek/dist/index.js')).probeDeepSeek({
            config,
            apiKey: secretValue,
            timeoutMs: options.timeoutMs,
            ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}),
          });
    } catch (error) {
      const code = safeDeepSeekSmokeErrorCode(error, error?.message === 'DEEPSEEK_THINKING_UNSUPPORTED' ? 'DEEPSEEK_THINKING_UNSUPPORTED' : 'DEEPSEEK_SMOKE_PROBE_FAILED');
      return report(options, statusForProbeError(code), elapsedMs(startedAt, now()), undefined, undefined, code, probe);
    }
    if (!hasReadyReasoningCapability(probe, options)) {
      const code = probe?.status === 'ready' ? 'DEEPSEEK_THINKING_UNSUPPORTED' : safeDeepSeekProbeErrorCode(probe, 'DEEPSEEK_THINKING_UNSUPPORTED');
      return report(options, statusForProbeError(code), elapsedMs(startedAt, now()), undefined, undefined, code, probe);
    }
  }

  let provider;
  try {
    if (dependencies.provider) provider = dependencies.provider;
    else if (dependencies.providerFactory) provider = await dependencies.providerFactory({ options, config, capability: probe?.capabilities, secretValue });
    else {
      modelDeepSeek ??= await import('../packages/model-deepseek/dist/index.js');
      provider = new modelDeepSeek.DeepSeekProvider({ config, capability: probe?.capabilities, apiKey: secretValue, ...(dependencies.fetchImpl ? { fetchImpl: dependencies.fetchImpl } : {}) });
    }
  } catch (error) {
    const code = safeDeepSeekSmokeErrorCode(error, error?.message === 'DEEPSEEK_THINKING_UNSUPPORTED' ? 'DEEPSEEK_THINKING_UNSUPPORTED' : 'DEEPSEEK_SMOKE_PROVIDER_INIT');
    return report(options, code === 'DEEPSEEK_THINKING_UNSUPPORTED' ? 'blocked' : 'failed', elapsedMs(startedAt, now()), undefined, undefined, code, probe);
  }

  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const cancelTimer = options.scenario === 'cancel' ? setTimeout(() => {
    cancelled = true;
    controller.abort();
  }, Math.min(100, Math.max(10, Math.trunc(options.timeoutMs / 4)))) : undefined;
  const events = [];
  let firstTokenMs;
  try {
    const request = {
      model: options.model,
      messages: [{ role: 'user', content: 'Reply with exactly the word ready4vibe-smoke.' }],
      tools: [],
      budget: { maxInputTokens: 128, maxOutputTokens: 32 },
      metadata: { runId: 'deepseek-smoke-run', turnId: 'deepseek-smoke-turn', requestId: 'deepseek-smoke-request' },
    };
    for await (const event of provider.stream(request, controller.signal)) {
      if (isPrivateReasoningEvent(event)) continue;
      if (event?.type === 'text-delta' || event?.type === 'tool-call-delta') firstTokenMs ??= elapsedMs(startedAt, now());
      events.push(event);
      if (event?.type === 'error') {
        const code = safeDeepSeekSmokeErrorCode(event, 'DEEPSEEK_SMOKE_FAILED');
        return report(options, statusForError(code), elapsedMs(startedAt, now()), firstTokenMs, events, code, probe);
      }
    }
    if (timedOut) return report(options, 'timeout', elapsedMs(startedAt, now()), firstTokenMs, events, 'DEEPSEEK_TIMEOUT', probe);
    if (cancelled) return report(options, 'cancelled', elapsedMs(startedAt, now()), firstTokenMs, events, 'DEEPSEEK_CANCELLED', probe);
    const completed = events.find((event) => event?.type === 'completed');
    if (!completed) return report(options, 'failed', elapsedMs(startedAt, now()), firstTokenMs, events, 'DEEPSEEK_STREAM_DISCONNECTED', probe);
    return report(options, 'healthy', elapsedMs(startedAt, now()), firstTokenMs, events, undefined, probe);
  } catch (error) {
    if (timedOut) return report(options, 'timeout', elapsedMs(startedAt, now()), firstTokenMs, events, 'DEEPSEEK_TIMEOUT', probe);
    if (cancelled) return report(options, 'cancelled', elapsedMs(startedAt, now()), firstTokenMs, events, 'DEEPSEEK_CANCELLED', probe);
    return report(options, 'failed', elapsedMs(startedAt, now()), firstTokenMs, events, safeDeepSeekSmokeErrorCode(error), probe);
  } finally {
    clearTimeout(timeoutTimer);
    if (cancelTimer !== undefined) clearTimeout(cancelTimer);
  }
}

function buildConfig(options) {
  return {
    schemaVersion: 'deepseek-provider/v1',
    providerId: 'deepseek',
    endpointProfile: options.endpointProfile,
    endpoint: options.endpoint,
    model: options.model,
    authRef: 'secret.deepseek.smoke',
    thinkingMode: options.thinkingMode,
    toolCalling: 'disabled',
    webSearch: 'off',
    reviewer: 'off',
    timeoutMs: options.timeoutMs,
    maxRetries: 0,
    maxOutputTokens: 32,
    revision: 'deepseek-smoke-config',
    updatedAt: new Date().toISOString(),
  };
}

function report(options, status, elapsed, firstTokenMs, events = [], errorCode, probe) {
  const usage = events.filter((event) => event?.type === 'usage').at(-1);
  const completed = events.find((event) => event?.type === 'completed');
  const result = {
    schemaVersion: 'deepseek-smoke/v1',
    provider: 'deepseek',
    endpointProfile: options.endpointProfile,
    model: options.model,
    scenario: options.scenario,
    thinkingMode: options.thinkingMode,
    status,
    elapsedMs: elapsed,
    firstTokenMs: firstTokenMs ?? null,
    finishReason: completed?.finishReason ?? null,
    eventTypes: countEventTypes(events),
    usage: {
      inputTokens: boundedUsage(usage?.inputTokens),
      outputTokens: boundedUsage(usage?.outputTokens),
    },
  };
  if (options.scenario === 'reasoning') {
    result.probeStatus = probe?.status === 'ready' || probe?.status === 'degraded' || probe?.status === 'blocked' ? probe.status : null;
    result.probeLatencyMs = boundedMetric(probe?.latencyMs);
  }
  if (errorCode) result.errorCode = errorCode;
  return Object.freeze(result);
}

function countEventTypes(events) {
  const counts = {};
  for (const event of events) {
    const type = typeof event?.type === 'string' && /^[a-z-]{1,64}$/u.test(event.type) ? event.type : 'unknown';
    counts[type] = Math.min(1_000, (counts[type] ?? 0) + 1);
  }
  return counts;
}

function isPrivateReasoningEvent(event) {
  return typeof event?.type === 'string' && /(?:reasoning|thought)/iu.test(event.type);
}

function boundedUsage(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000 ? value : null;
}

function statusForError(code) {
  if (code === 'DEEPSEEK_TIMEOUT') return 'timeout';
  if (code === 'DEEPSEEK_CANCELLED') return 'cancelled';
  if (code === 'DEEPSEEK_CREDENTIAL_REQUIRED' || code === 'DEEPSEEK_THINKING_UNSUPPORTED') return 'blocked';
  return 'failed';
}

function statusForProbeError(code) {
  if (code === 'DEEPSEEK_TIMEOUT') return 'timeout';
  if (code === 'DEEPSEEK_CANCELLED') return 'cancelled';
  return 'blocked';
}

function safeDeepSeekProbeErrorCode(probe, fallback) {
  const code = probe && typeof probe === 'object' ? probe.errorCode : undefined;
  return typeof code === 'string' && /^DEEPSEEK_[A-Z0-9_]{1,64}$/u.test(code) ? code : fallback;
}

function hasReadyReasoningCapability(probe, options) {
  const capability = probe?.capabilities;
  return probe?.status === 'ready'
    && capability?.status === 'ready'
    && capability.providerId === 'deepseek'
    && capability.endpointProfile === options.endpointProfile
    && capability.model === options.model
    && capability.reasoning === true;
}

function boundedMetric(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 120_000 ? value : null;
}

function validateEndpoint(value, profile) {
  if (value.length > 2_048) throw new Error('endpoint is too long');
  let url;
  try { url = new URL(value); } catch { throw new Error('endpoint is invalid'); }
  if (url.protocol !== 'https:') throw new Error('endpoint must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('endpoint must not contain credentials, query or fragment');
  const pathname = url.pathname.replace(/\/+$/u, '');
  const expected = profile === 'openai-responses' ? '/responses' : profile === 'anthropic-messages' ? '/messages' : '/chat/completions';
  if (!pathname.endsWith(expected)) throw new Error('endpoint path does not match profile');
  return value;
}

function validateProfile(value) {
  if (value !== 'openai-chat-completions' && value !== 'openai-responses' && value !== 'anthropic-messages') throw new Error('profile is invalid');
  return value;
}

function validateModel(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value) || /(?:sk-[A-Za-z0-9]{20,}|api[_-]?key|token|secret|password|bearer)/iu.test(value)) throw new Error('model is invalid');
  return value;
}

function validateSecretEnv(value) {
  if (value.length > 128 || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(value)) throw new Error('secret-env reference is invalid');
  return value;
}

function validateScenario(value) {
  if (value !== 'text' && value !== 'reasoning' && value !== 'cancel' && value !== 'timeout') throw new Error('scenario is invalid');
  return value;
}

function validateThinking(value) {
  if (value !== 'off' && value !== 'auto' && value !== 'high' && value !== 'max') throw new Error('thinking mode is invalid');
  return value;
}

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) throw new Error('timeout is invalid');
  return value;
}

function elapsedMs(startedAt, endedAt) {
  return Math.max(0, Math.min(120_000, Math.trunc(endedAt - startedAt)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseDeepSeekSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
    } else {
      const result = await runDeepSeekSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForDeepSeekSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
