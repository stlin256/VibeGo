import { describe, expect, it } from 'vitest';
import type { ModelUsageRecord, PricingRule } from '@ready4vibe/contracts';
import {
  PricingCatalog,
  PricingRuleConflictError,
  applyPricingToModelUsage,
  calculateModelUsageCost,
} from './pricing.js';

const at = '2026-08-04T00:00:00.000Z';

const record: ModelUsageRecord = {
  schemaVersion: 'ready4vibe_model_usage_v1',
  usageId: 'usage_price_01',
  runId: 'run_price_01',
  turnId: 'turn_price_01',
  requestId: 'request_price_01',
  providerId: 'deepseek',
  model: 'deepseek-v4-flash',
  requestModel: 'deepseek-v4-flash',
  pricingModel: 'deepseek-v4-flash',
  attempt: 1,
  startedAt: at,
  completedAt: '2026-08-04T00:00:01.000Z',
  status: 'completed',
  tokens: { input: 10, output: 3, cachedInput: 2, reasoning: 1, audioInput: 4 },
  tokenAccuracy: 'reported',
  inputTokenSemantics: 'fresh',
  dataSource: 'provider-usage',
};

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    schemaVersion: 'ready4vibe_pricing_rule_v1',
    pricingRevision: 'price_01',
    providerId: 'deepseek',
    modelPattern: 'deepseek-*',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    currency: 'USD',
    source: 'user-configured',
    inputMicrosPerMillionTokens: '1000000',
    outputMicrosPerMillionTokens: '2000000',
    cachedInputMicrosPerMillionTokens: '500000',
    reasoningMicrosPerMillionTokens: '3000000',
    audioInputMicrosPerMillionTokens: '250000',
    ...overrides,
  };
}

describe('pricing catalog and cost projection', () => {
  it('calculates per-unit cost with integer micros and dimension items', () => {
    const catalog = new PricingCatalog([rule()]);
    const projection = calculateModelUsageCost(record, catalog);
    expect(projection.pricingRevision).toBe('price_01');
    expect(projection.unknownDimensions).toEqual([]);
    expect(projection.cost).toMatchObject({ currency: 'USD', amountMicros: '21', accuracy: 'exact', pricingRevision: 'price_01' });
    expect(projection.cost?.items?.map((item) => item.itemCode)).toEqual(['input', 'output', 'cache-read', 'reasoning', 'audio']);
    expect(applyPricingToModelUsage(record, catalog).cost?.amountMicros).toBe('21');
    expect(record.cost).toBeUndefined();
  });

  it('supports flat-fee and tiered rules without floating point rounding', () => {
    const flatCatalog = new PricingCatalog([rule({ mode: 'flat-fee', flatFeeMicros: '250', inputMicrosPerMillionTokens: undefined, outputMicrosPerMillionTokens: undefined, cachedInputMicrosPerMillionTokens: undefined, reasoningMicrosPerMillionTokens: undefined, audioInputMicrosPerMillionTokens: undefined })]);
    expect(calculateModelUsageCost(record, flatCatalog).cost).toMatchObject({ amountMicros: '250', items: [{ itemCode: 'flat-fee', subtotalMicros: '250' }] });

    const tieredCatalog = new PricingCatalog([rule({ mode: 'tiered', tiers: [{ upTo: 1_000, unitMicrosPerMillionTokens: '1000000' }, { unitMicrosPerMillionTokens: '500000' }], inputMicrosPerMillionTokens: undefined, outputMicrosPerMillionTokens: undefined, cachedInputMicrosPerMillionTokens: undefined, reasoningMicrosPerMillionTokens: undefined, audioInputMicrosPerMillionTokens: undefined })]);
    const tiered = calculateModelUsageCost({ ...record, tokens: { input: 1_500 } }, tieredCatalog);
    expect(tiered.cost).toMatchObject({ amountMicros: '1250', items: [{ itemCode: 'input', subtotalMicros: '1250' }] });
    expect(tiered.cost?.items?.[0]?.tierBreakdown).toEqual([
      { upTo: 1_000, units: 1_000, subtotalMicros: '1000' },
      { units: 500, subtotalMicros: '250' },
    ]);
  });

  it('selects effective and explicitly requested historical revisions', () => {
    const catalog = new PricingCatalog([
      rule({ pricingRevision: 'price_old', effectiveFrom: '2026-01-01T00:00:00.000Z', inputMicrosPerMillionTokens: '1000000', outputMicrosPerMillionTokens: undefined, cachedInputMicrosPerMillionTokens: undefined, reasoningMicrosPerMillionTokens: undefined, audioInputMicrosPerMillionTokens: undefined }),
      rule({ pricingRevision: 'price_new', effectiveFrom: '2026-08-01T00:00:00.000Z', inputMicrosPerMillionTokens: '2000000', outputMicrosPerMillionTokens: undefined, cachedInputMicrosPerMillionTokens: undefined, reasoningMicrosPerMillionTokens: undefined, audioInputMicrosPerMillionTokens: undefined }),
    ]);
    expect(calculateModelUsageCost({ ...record, tokens: { input: 10 } }, catalog).pricingRevision).toBe('price_new');
    expect(calculateModelUsageCost({ ...record, tokens: { input: 10 } }, catalog, { at: '2026-03-01T00:00:00.000Z' }).pricingRevision).toBe('price_old');
    expect(calculateModelUsageCost({ ...record, tokens: { input: 10 } }, catalog, { pricingRevision: 'price_old' }).pricingRevision).toBe('price_old');
  });

  it('returns unknown rather than zero for missing price and rejects rule conflicts', () => {
    const unknown = calculateModelUsageCost(record, new PricingCatalog());
    expect(unknown.cost).toBeUndefined();
    expect(unknown.unknownDimensions).toContain('input');
    expect(applyPricingToModelUsage(record, new PricingCatalog())).not.toHaveProperty('cost');

    const catalog = new PricingCatalog([rule()]);
    expect(() => catalog.register({ ...rule(), inputMicrosPerMillionTokens: '2000000' })).toThrow(PricingRuleConflictError);
  });
});
