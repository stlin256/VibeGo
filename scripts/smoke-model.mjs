import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:model -- --endpoint <https://provider.example/v1/chat/completions> --model <model-id> --secret-env <ENV_VAR> [--timeout-ms <100..30000>]';
const MODEL_ID = 'openai-compatible';
const SMOKE_PROMPT = 'Reply with exactly the word ready4vibe-smoke.';
const REQUEST_IDS = Object.freeze({ runId: 'smoke_model_run', turnId: 'smoke_model_turn', requestId: 'smoke_model_request' });
const ENV_ENDPOINT = 'VIBEGO_MODEL_SMOKE_ENDPOINT';
const ENV_MODEL = 'VIBEGO_MODEL_SMOKE_MODEL';
const ENV_SECRET = 'VIBEGO_MODEL_SMOKE_SECRET_ENV';
const ENV_TIMEOUT = 'VIBEGO_MODEL_SMOKE_TIMEOUT_MS';

export function parseModelSmokeArgs(argv, environment = process.env) {
  let endpoint = environment[ENV_ENDPOINT];
  let model = environment[ENV_MODEL];
  let secretEnv = environment[ENV_SECRET];
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? 5_000);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
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

  if (typeof endpoint !== 'string' || endpoint.length === 0) throw new Error('endpoint is required');
  if (typeof model !== 'string' || model.length === 0) throw new Error('model is required');
  if (typeof secretEnv !== 'string' || secretEnv.length === 0) throw new Error('secret-env is required');
  return Object.freeze({ endpoint: validateEndpoint(endpoint), model: validateModel(model), secretEnv: validateSecretEnv(secretEnv), timeoutMs: validateTimeout(timeoutMs) });
}

export function exitCodeForModelSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'unavailable') return 2;
  if (status === 'timeout') return 3;
  if (status === 'config-error') return 4;
  return 1;
}

export function safeModelSmokeErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^MODEL_[A-Z0-9_]{1,64}$/u.test(code) ? code : 'MODEL_SMOKE_FAILED';
}

/**
 * Executes one explicit, redacted model request. The caller must provide the
 * endpoint/model/secret-env options; no file, settings store or daemon is
 * consulted. Dependencies are injectable so tests never contact a network.
 */
export async function runModelSmoke(options, dependencies = {}) {
  const startedAt = dependencies.now?.() ?? Date.now();
  const now = dependencies.now ?? (() => Date.now());
  const secretValue = dependencies.secretValue ? dependencies.secretValue(options.secretEnv) : process.env[options.secretEnv];
  if (typeof secretValue !== 'string' || secretValue.length === 0 || secretValue.length > 4_096 || /[\r\n]/u.test(secretValue)) {
    return report(options, 'config-error', 0, undefined, undefined, 'MODEL_SMOKE_SECRET_MISSING');
  }

  let provider;
  let replayModelEvents = dependencies.replayModelEvents;
  try {
    if (dependencies.provider) {
      provider = dependencies.provider;
    } else if (dependencies.providerFactory) {
      provider = dependencies.providerFactory(secretValue);
      if (!replayModelEvents) {
        const modelOpenAi = dependencies.modelOpenAi ?? await import('../packages/model-openai/dist/index.js');
        replayModelEvents = modelOpenAi.replayModelEvents;
      }
    } else {
      const modelOpenAi = dependencies.modelOpenAi ?? await import('../packages/model-openai/dist/index.js');
      provider = new modelOpenAi.OpenAICompatibleProvider({ id: MODEL_ID, endpoint: options.endpoint, apiKey: secretValue });
      replayModelEvents ??= modelOpenAi.replayModelEvents;
    }
  } catch {
    return report(options, 'unavailable', elapsedMs(startedAt, now()), undefined, undefined, 'MODEL_SMOKE_PROVIDER_INIT');
  }

  if (typeof replayModelEvents !== 'function') {
    return report(options, 'failed', elapsedMs(startedAt, now()), undefined, undefined, 'MODEL_SMOKE_REPLAY_UNAVAILABLE');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const events = [];
  try {
    const request = {
      model: options.model,
      messages: [{ role: 'user', content: SMOKE_PROMPT, source: 'user', trust: 'trusted' }],
      tools: [],
      budget: { maxInputTokens: 128, maxOutputTokens: 32 },
      metadata: REQUEST_IDS,
    };
    for await (const event of provider.stream(request, controller.signal)) {
      if (timedOut) return report(options, 'timeout', elapsedMs(startedAt, now()), undefined, undefined, 'MODEL_SMOKE_TIMEOUT');
      if (event?.type === 'error') {
        const errorCode = safeModelSmokeErrorCode(event);
        return report(options, statusForError(errorCode), elapsedMs(startedAt, now()), undefined, undefined, errorCode);
      }
      events.push(event);
    }
    if (timedOut || controller.signal.aborted) return report(options, 'timeout', elapsedMs(startedAt, now()), undefined, undefined, 'MODEL_SMOKE_TIMEOUT');
    let replay;
    try {
      replay = replayModelEvents(events);
    } catch (error) {
      return report(options, 'failed', elapsedMs(startedAt, now()), undefined, undefined, safeModelSmokeErrorCode(error));
    }
    if (!replay || typeof replay !== 'object' || !replay.finishReason) {
      return report(options, 'failed', elapsedMs(startedAt, now()), undefined, undefined, 'MODEL_SMOKE_NO_TERMINAL');
    }
    return report(options, 'healthy', elapsedMs(startedAt, now()), replay.finishReason, replay.usage);
  } catch (error) {
    if (timedOut || controller.signal.aborted) return report(options, 'timeout', elapsedMs(startedAt, now()), undefined, undefined, 'MODEL_SMOKE_TIMEOUT');
    return report(options, statusForError(safeModelSmokeErrorCode(error)), elapsedMs(startedAt, now()), undefined, undefined, safeModelSmokeErrorCode(error));
  } finally {
    clearTimeout(timer);
  }
}

function validateEndpoint(value) {
  if (value.length > 2_048) throw new Error('endpoint is too long');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('endpoint is invalid');
  }
  if (url.protocol !== 'https:') throw new Error('endpoint must use HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('endpoint must not contain credentials, query or fragment');
  if (url.pathname === '/' || url.pathname.length < 2) throw new Error('endpoint must be a complete provider path');
  return value;
}

function validateModel(value) {
  if (value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,255}$/u.test(value) || /(?:sk-[A-Za-z0-9]{20,}|api[_-]?key|token|secret|password|bearer)/iu.test(value)) {
    throw new Error('model is invalid');
  }
  return value;
}

function validateSecretEnv(value) {
  if (value.length > 128 || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(value)) throw new Error('secret-env reference is invalid');
  return value;
}

function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 100 || value > 30_000) throw new Error('timeout is invalid');
  return value;
}

function statusForError(code) {
  if (code === 'MODEL_SMOKE_TIMEOUT') return 'timeout';
  if (code === 'MODEL_NETWORK_ERROR' || code === 'MODEL_SMOKE_PROVIDER_INIT' || /MODEL_(?:EMPTY_BODY|STREAM_ERROR|HTTP_5\d\d)$/u.test(code)) return 'unavailable';
  return 'failed';
}

function report(options, status, elapsed, finishReason, usage, errorCode) {
  const result = {
    schemaVersion: 'model-smoke/v1',
    provider: MODEL_ID,
    model: options.model,
    status,
    elapsedMs: elapsed,
    finishReason: finishReason ?? null,
    usage: {
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    },
  };
  if (errorCode) result.errorCode = errorCode;
  return Object.freeze(result);
}

function elapsedMs(startedAt, endedAt) {
  return Math.max(0, Math.min(120_000, Math.trunc(endedAt - startedAt)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseModelSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
    } else {
      const result = await runModelSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForModelSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
