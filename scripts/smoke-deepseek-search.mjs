import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:deepseek-search -- --mode fixture';
const QUERY = 'bounded fixture query';

export function parseDeepSeekSearchSmokeArgs(argv, environment = process.env) {
  let mode = environment.VIBEGO_DEEPSEEK_SEARCH_SMOKE_MODE ?? 'fixture';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      mode = value;
      index += 1;
      continue;
    }
    throw new Error(USAGE);
  }
  if (mode !== 'fixture') throw new Error('only the explicit fixture mode is supported');
  return Object.freeze({ mode });
}

export function exitCodeForDeepSeekSearchSmokeStatus(status) {
  return status === 'healthy' ? 0 : 1;
}

/**
 * Run the provider-owned search application-port fixture. It never creates a
 * provider, daemon listener, scheduler, tool runtime, credential or network
 * client. The service and executor are injectable so this remains repeatable.
 */
export async function runDeepSeekSearchSmoke(options = { mode: 'fixture' }, dependencies = {}) {
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
