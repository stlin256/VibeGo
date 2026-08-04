import { describe, expect, it, vi } from 'vitest';
import type { ModelUsageRecord, PricingRule } from '@ready4vibe/contracts';
import {
  PricingCatalog,
  ProviderUsageLifecycleAdapter,
  type ProviderUsageLifecycleWriter,
} from './index.js';

const at = '2026-08-05T00:00:00.000Z';
const runId = 'run_usage_lifecycle_01';

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    schemaVersion: 'ready4vibe_pricing_rule_v1',
    pricingRevision: 'price_usage_01',
    providerId: 'deepseek',
    modelPattern: 'deepseek-*',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    currency: 'USD',
    source: 'user-configured',
    inputMicrosPerMillionTokens: '1000000',
    outputMicrosPerMillionTokens: '2000000',
    ...overrides,
  };
}

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'ready4vibe_provider_usage_observation_v1',
    usageId: 'usage_lifecycle_01',
    runId,
    turnId: 'turn_01',
    requestId: 'request_01',
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    requestModel: 'deepseek-v4-flash',
    pricingModel: 'deepseek-v4-flash',
    attempt: 1,
    startedAt: at,
    completedAt: '2026-08-05T00:00:01.000Z',
    latencyMs: 1_000,
    timeToFirstByteMs: 120,
    status: 'completed',
    tokens: { input: 10, output: 3 },
    tokenAccuracy: 'reported',
    inputTokenSemantics: 'fresh',
    dataSource: 'provider-usage',
    sourceRevision: 'provider_rev_01',
    ...overrides,
  };
}

function writerFixture(): { writer: ProviderUsageLifecycleWriter; batches: ModelUsageRecord[][]; fail: (value: boolean) => void } {
  const batches: ModelUsageRecord[][] = [];
  let shouldFail = false;
  const writer: ProviderUsageLifecycleWriter = {
    appendBatch: vi.fn(async (batch) => {
      if (shouldFail) throw new Error('ledger unavailable');
      batches.push([...(batch.modelUsages ?? [])]);
    }),
  };
  return { writer, batches, fail: (value) => { shouldFail = value; } };
}

function adapterFixture(): { adapter: ProviderUsageLifecycleAdapter; batches: ModelUsageRecord[][]; fail: (value: boolean) => void } {
  const fixture = writerFixture();
  const adapter = new ProviderUsageLifecycleAdapter({
    writer: fixture.writer,
    pricingCatalog: new PricingCatalog([rule()]),
  });
  return { adapter, ...fixture };
}

describe('ProviderUsageLifecycleAdapter', () => {
  it('normalizes usage, preserves latency/TTFT and applies an immutable pricing revision', async () => {
    const { adapter, batches } = adapterFixture();
    const result = await adapter.record(observation());

    expect(result.status).toBe('recorded');
    expect(result.records[0]).toMatchObject({
      usageId: 'usage_lifecycle_01',
      latencyMs: 1_000,
      timeToFirstByteMs: 120,
      cost: { currency: 'USD', amountMicros: '16', accuracy: 'exact', pricingRevision: 'price_usage_01' },
    });
    expect(result.unknownDimensions).toEqual([]);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]?.cost?.pricingRevision).toBe('price_usage_01');
  });

  it('keeps estimated and unknown token accuracy explicit in cost', async () => {
    const { adapter } = adapterFixture();
    const estimated = await adapter.record(observation({ usageId: 'usage_estimated', tokenAccuracy: 'estimated' }));
    const unknown = await adapter.record(observation({ usageId: 'usage_unknown', tokenAccuracy: 'unknown' }));

    expect(estimated.records[0]?.cost?.accuracy).toBe('estimated');
    expect(unknown.records[0]?.cost?.accuracy).toBe('unknown');
  });

  it('returns unknown dimensions rather than fabricating zero for missing pricing', async () => {
    const fixture = writerFixture();
    const adapter = new ProviderUsageLifecycleAdapter({ writer: fixture.writer });
    const result = await adapter.record(observation({ usageId: 'usage_unpriced' }));

    expect(result.status).toBe('recorded');
    expect(result.records[0]).not.toHaveProperty('cost');
    expect(result.unknownDimensions).toEqual(['usage_unpriced:input', 'usage_unpriced:output']);
  });

  it('preserves partial provider failure counters without replaying a request', async () => {
    const { adapter, batches } = adapterFixture();
    const result = await adapter.record(observation({
      usageId: 'usage_partial_failure',
      completedAt: undefined,
      latencyMs: undefined,
      status: 'failed',
      tokens: { output: 2 },
      timeToFirstByteMs: 80,
    }));

    expect(result.status).toBe('recorded');
    expect(result.records[0]).toMatchObject({ status: 'failed', tokens: { output: 2 }, timeToFirstByteMs: 80 });
    expect(result.records[0]).not.toHaveProperty('completedAt');
    expect(batches).toHaveLength(1);
  });

  it('reconciles complementary provider/run-event facts before pricing', async () => {
    const { adapter, batches } = adapterFixture();
    const provider = observation({ usageId: 'usage_provider', tokens: { input: 10 }, dataSource: 'provider-usage' });
    const replay = observation({ usageId: 'usage_replay', tokens: { output: 3 }, dataSource: 'run-event' });
    const result = await adapter.recordBatch([replay, provider]);

    expect(result.status).toBe('recorded');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ dataSource: 'reconciled', tokens: { input: 10, output: 3 }, cost: { amountMicros: '16' } });
    expect(result.records[0]?.usageId).toMatch(/^reconciled_[a-f0-9]{32}$/u);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });

  it('makes identical usage delivery a no-op and changed facts a conflict', async () => {
    const { adapter, batches } = adapterFixture();
    const input = observation();

    expect((await adapter.record(input)).status).toBe('recorded');
    expect((await adapter.record({ ...input })).status).toBe('noop');
    expect((await adapter.record(observation({ tokens: { input: 11, output: 3 } }))).status).toBe('conflict');
    expect(batches).toHaveLength(1);
  });

  it('keeps retry attempts separate and writer failure fail-soft', async () => {
    const { adapter, batches, fail } = adapterFixture();
    fail(true);
    expect((await adapter.record(observation({ usageId: 'usage_retry_1' }))).status).toBe('degraded');
    fail(false);
    expect((await adapter.record(observation({ usageId: 'usage_retry_1' }))).status).toBe('recorded');
    expect((await adapter.record(observation({ usageId: 'usage_retry_2', attempt: 2, requestId: 'request_02', turnId: 'turn_02' }))).status).toBe('recorded');
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch[0]?.attempt)).toEqual([1, 2]);
  });

  it('rejects raw provider payloads, secrets and absolute paths before writing', async () => {
    const { adapter, batches } = adapterFixture();
    const raw = await adapter.record({ ...observation(), rawResponse: { body: 'secret=sk-' + 'x'.repeat(24) } });
    const path = await adapter.record({ ...observation({ usageId: 'usage_path' }), providerId: 'C:\\private\\provider' });

    expect(raw.status).toBe('rejected');
    expect(raw.errorCode).toBe('OBSERVABILITY_USAGE_PRIVACY');
    expect(path.status).toBe('rejected');
    expect(path.errorCode).toBe('OBSERVABILITY_USAGE_PRIVACY');
    expect(batches).toHaveLength(0);
  });

  it('serializes concurrent identical delivery and rejects concurrent changed facts', async () => {
    let release!: () => void;
    const batches: ModelUsageRecord[][] = [];
    const writer: ProviderUsageLifecycleWriter = {
      appendBatch: vi.fn(async (batch) => {
        await new Promise<void>((resolve) => { release = resolve; });
        batches.push([...(batch.modelUsages ?? [])]);
      }),
    };
    const adapter = new ProviderUsageLifecycleAdapter({ writer, pricingCatalog: new PricingCatalog([rule()]) });
    const input = observation({ usageId: 'usage_concurrent' });
    const first = adapter.record(input);
    await Promise.resolve();
    expect((await adapter.record(observation({ usageId: 'usage_concurrent', tokens: { input: 12, output: 3 } }))).status).toBe('conflict');
    const second = adapter.record({ ...input });
    release();
    expect((await first).status).toBe('recorded');
    expect((await second).status).toBe('noop');
    expect(batches).toHaveLength(1);
  });
});
