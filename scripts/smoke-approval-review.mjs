import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  ApprovalReviewRequestSchema,
  ApprovalReviewerSnapshotSchema,
  ModelProviderSnapshotSchema,
} from '../packages/contracts/dist/index.js';
import { SameAsRunApprovalReviewer } from '../packages/agent/dist/index.js';

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 5_000;
const ENV_ENDPOINT = 'VIBEGO_APPROVAL_REVIEW_SMOKE_ENDPOINT';
const ENV_MODEL = 'VIBEGO_APPROVAL_REVIEW_SMOKE_MODEL';
const ENV_SECRET = 'VIBEGO_APPROVAL_REVIEW_SMOKE_SECRET_ENV';
const ENV_TIMEOUT = 'VIBEGO_APPROVAL_REVIEW_SMOKE_TIMEOUT_MS';
const USAGE = 'usage: pnpm smoke:approval-review -- --authorize [--endpoint <https://provider.example/v1/chat/completions>] --model <model-id> --secret-env <ENV_VAR> [--timeout-ms <250..5000>]';

export function parseApprovalReviewSmokeArgs(argv, environment = process.env) {
  let authorize = false;
  let endpoint = environment[ENV_ENDPOINT] ?? DEFAULT_ENDPOINT;
  let model = environment[ENV_MODEL] ?? DEFAULT_MODEL;
  let secretEnv = environment[ENV_SECRET];
  let timeoutMs = Number(environment[ENV_TIMEOUT] ?? DEFAULT_TIMEOUT_MS);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--authorize') { authorize = true; continue; }
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
  if (!authorize) throw new Error('explicit --authorize is required for live reviewer smoke');
  if (typeof secretEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(secretEnv)) throw new Error('secret-env is required and must be an environment variable name');
  return Object.freeze({ authorize, endpoint: validateEndpoint(endpoint), model: validateModel(model), secretEnv, timeoutMs: validateTimeout(timeoutMs) });
}

export async function runApprovalReviewSmoke(options, dependencies = {}) {
  const startedAt = dependencies.now?.() ?? Date.now();
  if (!options.authorize) return report(options, 'blocked', null, null, 'APPROVAL_REVIEW_AUTH_REQUIRED', { inputTokens: null, outputTokens: null });
  const secretValue = dependencies.secretValue
    ? await dependencies.secretValue(options.secretEnv)
    : process.env[options.secretEnv];
  if (typeof secretValue !== 'string' || secretValue.length === 0 || secretValue.length > 4_096 || /[\r\n]/u.test(secretValue)) {
    return report(options, 'blocked', null, null, 'APPROVAL_REVIEW_SECRET_MISSING', { inputTokens: null, outputTokens: null });
  }

  let provider;
  try {
    provider = dependencies.provider;
    if (!provider && dependencies.providerFactory) provider = await dependencies.providerFactory({ options, secretValue });
    if (!provider) {
      const modelDeepSeek = await import('../packages/model-deepseek/dist/index.js');
      provider = new modelDeepSeek.DeepSeekProvider({
        config: {
          schemaVersion: 'deepseek-provider/v1', providerId: 'deepseek', endpointProfile: 'openai-chat-completions', endpoint: options.endpoint,
          model: options.model, authRef: 'secret.approval-review.smoke', thinkingMode: 'off', toolCalling: 'disabled', webSearch: 'off', reviewer: 'off',
          timeoutMs: options.timeoutMs, maxRetries: 0, maxOutputTokens: 512, revision: 'approval-review-smoke', updatedAt: new Date().toISOString(),
        },
        apiKey: secretValue,
      });
    }
  } catch {
    return report(options, 'failed', elapsedMs(startedAt, dependencies.now?.() ?? Date.now()), null, 'APPROVAL_REVIEW_PROVIDER_INIT', { inputTokens: null, outputTokens: null });
  }

  const usage = { inputTokens: null, outputTokens: null };
  const countedProvider = {
    id: provider.id,
    capabilities: provider.capabilities,
    async *stream(request, signal) {
      for await (const event of provider.stream(request, signal)) {
        if (event?.type === 'usage') {
          if (Number.isSafeInteger(event.inputTokens) && event.inputTokens >= 0) usage.inputTokens = Math.min(10_000_000, event.inputTokens);
          if (Number.isSafeInteger(event.outputTokens) && event.outputTokens >= 0) usage.outputTokens = Math.min(10_000_000, event.outputTokens);
        }
        yield event;
      }
    },
  };
  const capturedAt = new Date(startedAt).toISOString();
  const modelSnapshot = ModelProviderSnapshotSchema.parse({
    schemaVersion: 'ready4vibe_model_provider_snapshot_v1', providerId: provider.id, model: options.model, pricingModel: 'unknown', descriptorRevision: 'approval-review-smoke',
    endpointPolicy: { kind: 'explicit-url', baseUrl: options.endpoint }, capabilities: { streaming: true, toolCalls: false, structuredOutput: false, reasoning: false, promptCaching: false, audioInput: false, audioOutput: false },
    authRef: 'secret.approval-review.smoke', capturedAt,
  });
  const reviewerSnapshot = ApprovalReviewerSnapshotSchema.parse({
    schemaVersion: 'llm-approval/v1', reviewerSource: 'same-as-run', dedicatedProfileId: null, providerId: provider.id, modelId: options.model,
    descriptorRevision: 'approval-review-smoke', policyRevision: 'approval-policy-smoke', reviewerRevision: 'approval-review-smoke', posture: 'advisory-low-risk',
    limits: { maxLatencyMs: options.timeoutMs, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs: 0 }, status: 'ready', capturedAt,
  });
  const reviewer = new SameAsRunApprovalReviewer({ provider: countedProvider, modelSnapshot, reviewerSnapshot });
  const request = buildSmokeRequest(startedAt, options.timeoutMs);
  try {
    const decision = await reviewer.review(request, new AbortController().signal);
    const status = decision.decision === 'unavailable' ? 'failed' : 'healthy';
    return report(options, status, decision.latencyMs, decision.decision, decision.reasonCode, usage);
  } catch {
    return report(options, 'failed', elapsedMs(startedAt, dependencies.now?.() ?? Date.now()), 'unavailable', 'provider-unavailable', usage);
  }
}

function buildSmokeRequest(startedAt, timeoutMs) {
  const argumentFingerprint = sha256('approval-review-smoke-argument');
  const approvalKeyFingerprint = sha256(`approval-review-smoke:${argumentFingerprint}`);
  return ApprovalReviewRequestSchema.parse({
    schemaVersion: 'llm-approval/v1', reviewId: 'review_smoke_1', runId: 'run_review_smoke', turnId: 'turn_review_smoke', correlationId: 'call_review_smoke',
    approvalKey: `approval.v1.${approvalKeyFingerprint}`, approvalKeyFingerprint, workspaceId: 'workspace_review_smoke',
    tool: { toolId: 'filesystem.read', toolVersion: '1.0.0', operationClass: 'read', risk: 'read-only', summary: 'Read a bounded workspace item.', argumentFingerprint, argumentLabels: ['argument-bytes:32'] },
    taskTrust: 'trusted-workspace', permission: { profileId: 'workspace-coding', profileRevision: 'profile-smoke', status: 'ready', approvalPosture: 'bounded-auto', effectiveScope: 'run' },
    sandbox: { mode: 'workspace-write', provider: null, status: 'ready', network: 'restricted' }, network: 'restricted', policyRevision: 'approval-policy-smoke', reviewerRevision: 'approval-review-smoke',
    deadlineAt: new Date(startedAt + timeoutMs).toISOString(),
  });
}

function report(options, status, latencyMs, decision, reasonCode, usage) {
  const output = { schemaVersion: 'llm-approval-smoke/v1', provider: 'deepseek', model: options.model, status, decision, reasonCode, latencyMs: boundedLatency(latencyMs), usage };
  return Object.freeze(output);
}

function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function boundedLatency(value) { return value === null ? 0 : Math.max(0, Math.min(120_000, Number.isSafeInteger(value) ? value : 120_000)); }
function elapsedMs(startedAt, endedAt) { return Math.max(0, Math.min(120_000, Math.trunc(endedAt - startedAt))); }
function validateEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) throw new Error('endpoint is invalid');
  let url;
  try { url = new URL(value); } catch { throw new Error('endpoint is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/+$/u, '').endsWith('/chat/completions')) throw new Error('endpoint must be an HTTPS chat-completions URL without credentials, query or fragment');
  return value;
}
function validateModel(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(value) || /(?:sk-|api[_-]?key|token|secret|password|bearer)/iu.test(value)) throw new Error('model is invalid');
  return value;
}
function validateTimeout(value) {
  if (!Number.isSafeInteger(value) || value < 250 || value > 5_000) throw new Error('timeout must be between 250 and 5000 milliseconds');
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseApprovalReviewSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
    } else {
      const result = await runApprovalReviewSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.status === 'healthy' ? 0 : result.status === 'blocked' ? 2 : 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'approval reviewer smoke failed'}\n${USAGE}\n`);
    process.exitCode = 2;
  }
}
