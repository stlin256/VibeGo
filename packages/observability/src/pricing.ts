import {
  CostItemSchema,
  ModelUsageRecordSchema,
  PricingRuleSchema,
  type CostItem,
  type ModelUsageRecord,
  type PricingRule,
} from '@ready4vibe/contracts';

const MILLION = 1_000_000n;
const TOKEN_DIMENSIONS = [
  { key: 'input', itemCode: 'input', rateField: 'inputMicrosPerMillionTokens' },
  { key: 'output', itemCode: 'output', rateField: 'outputMicrosPerMillionTokens' },
  { key: 'cachedInput', itemCode: 'cache-read', rateField: 'cachedInputMicrosPerMillionTokens' },
  { key: 'cacheCreation', itemCode: 'cache-write', rateField: 'cacheCreationMicrosPerMillionTokens' },
  { key: 'reasoning', itemCode: 'reasoning', rateField: 'reasoningMicrosPerMillionTokens' },
  { key: 'toolInput', itemCode: 'other', rateField: 'toolInputMicrosPerMillionTokens' },
  { key: 'toolOutput', itemCode: 'other', rateField: 'toolOutputMicrosPerMillionTokens' },
  { key: 'audioInput', itemCode: 'audio', rateField: 'audioInputMicrosPerMillionTokens' },
  { key: 'audioOutput', itemCode: 'audio', rateField: 'audioOutputMicrosPerMillionTokens' },
  { key: 'acceptedPrediction', itemCode: 'prediction', rateField: 'acceptedPredictionMicrosPerMillionTokens' },
  { key: 'rejectedPrediction', itemCode: 'prediction', rateField: 'rejectedPredictionMicrosPerMillionTokens' },
] as const;
type TokenDimension = typeof TOKEN_DIMENSIONS[number];

export class PricingRuleConflictError extends Error {
  readonly code = 'PRICING_RULE_CONFLICT';

  constructor(readonly identity: string) {
    super('A pricing rule identity was already registered with different content.');
    this.name = 'PricingRuleConflictError';
  }
}

export class PricingCalculationError extends Error {
  readonly code = 'PRICING_CALCULATION_ERROR';

  constructor(message: string) {
    super(message);
    this.name = 'PricingCalculationError';
  }
}

export class PricingCatalog {
  private readonly rules = new Map<string, { value: PricingRule; fingerprint: string }>();

  constructor(initial: readonly unknown[] = []) {
    for (const rule of initial) this.register(rule);
  }

  register(input: unknown): PricingRule {
    const parsed = PricingRuleSchema.parse(input);
    const identity = pricingIdentity(parsed);
    const fingerprint = canonicalJson(parsed);
    const existing = this.rules.get(identity);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new PricingRuleConflictError(identity);
      return clone(existing.value);
    }
    const stored = deepFreeze(clone(parsed));
    this.rules.set(identity, { value: stored, fingerprint });
    return clone(stored);
  }

  find(providerId: string, pricingModel: string, at: string, pricingRevision?: string): PricingRule | undefined {
    const timestamp = Date.parse(at);
    if (!Number.isFinite(timestamp)) throw new PricingCalculationError('Pricing lookup timestamp must be ISO formatted.');
    const candidates = [...this.rules.values()]
      .map(({ value }) => value)
      .filter((rule) => rule.providerId === providerId)
      .filter((rule) => pricingRevision === undefined || rule.pricingRevision === pricingRevision)
      .filter((rule) => Date.parse(rule.effectiveFrom) <= timestamp)
      .filter((rule) => matchesModel(rule.modelPattern, pricingModel));
    candidates.sort((left, right) => {
      const specificity = patternSpecificity(right.modelPattern) - patternSpecificity(left.modelPattern);
      if (specificity !== 0) return specificity;
      const effective = Date.parse(right.effectiveFrom) - Date.parse(left.effectiveFrom);
      return effective || compareText(right.pricingRevision, left.pricingRevision);
    });
    const selected = candidates[0];
    return selected ? clone(selected) : undefined;
  }

  list(): readonly PricingRule[] {
    return Object.freeze([...this.rules.values()]
      .map(({ value }) => clone(value))
      .sort((left, right) => compareText(pricingIdentity(left), pricingIdentity(right))));
  }
}

export interface PricingCalculationOptions {
  readonly at?: string;
  readonly pricingRevision?: string;
}

export interface PricingProjection {
  readonly cost: ModelUsageRecord['cost'] | undefined;
  readonly pricingRevision: string | null;
  readonly unknownDimensions: readonly string[];
}

export function calculateModelUsageCost(input: unknown, catalog: PricingCatalog, options: PricingCalculationOptions = {}): PricingProjection {
  const record = ModelUsageRecordSchema.parse(input);
  const pricingModel = record.pricingModel ?? record.model;
  const rule = catalog.find(record.providerId, pricingModel, options.at ?? record.startedAt, options.pricingRevision);
  const presentDimensions = TOKEN_DIMENSIONS.filter(({ key }) => record.tokens[key] !== undefined);
  if (!rule) {
    return freezeProjection({ cost: undefined, pricingRevision: null, unknownDimensions: presentDimensions.map(({ key }) => key) });
  }

  const unknownDimensions: string[] = [];
  const items: CostItem[] = [];
  const mode = rule.mode ?? (rule.tiers ? 'tiered' : rule.flatFeeMicros !== undefined ? 'flat-fee' : 'per-unit');
  if (mode === 'flat-fee') {
    items.push(CostItemSchema.parse({ itemCode: 'flat-fee', subtotalMicros: rule.flatFeeMicros }));
  } else {
    for (const dimension of presentDimensions) {
      const definition = TOKEN_DIMENSIONS.find(({ key }) => key === dimension.key)!;
      const units = record.tokens[definition.key]!;
      const rate = rule[definition.rateField];
      if (mode === 'per-unit') {
        if (rate === undefined) {
          unknownDimensions.push(definition.key);
          continue;
        }
        items.push(CostItemSchema.parse({
          itemCode: definition.itemCode,
          quantity: units,
          unitMicrosPerMillionTokens: rate,
          subtotalMicros: perMillion(units, rate),
        }));
        continue;
      }
      const tiered = calculateTieredItem(definition.itemCode, units, rule.tiers!);
      if (!tiered.complete) unknownDimensions.push(definition.key);
      items.push(tiered.item);
    }
  }

  if (items.length === 0) return freezeProjection({ cost: undefined, pricingRevision: rule.pricingRevision, unknownDimensions });
  const amountMicros = items.reduce((total, item) => addDecimal(total, item.subtotalMicros), '0');
  const cost = {
    currency: rule.currency,
    amountMicros,
    accuracy: unknownDimensions.length === 0 ? 'exact' as const : 'unknown' as const,
    pricingRevision: rule.pricingRevision,
    items,
  };
  return freezeProjection({ cost: cost as ModelUsageRecord['cost'], pricingRevision: rule.pricingRevision, unknownDimensions });
}

/** Creates a new record projection; the historical input object is never mutated. */
export function applyPricingToModelUsage(input: unknown, catalog: PricingCatalog, options: PricingCalculationOptions = {}): ModelUsageRecord {
  const record = ModelUsageRecordSchema.parse(input);
  const projection = calculateModelUsageCost(record, catalog, options);
  if (projection.cost === undefined) return deepFreeze(clone(record));
  return deepFreeze(clone(ModelUsageRecordSchema.parse({ ...record, cost: projection.cost })));
}

function calculateTieredItem(itemCode: CostItem['itemCode'], units: number, tiers: PricingRule['tiers']): { item: CostItem; complete: boolean } {
  if (!tiers || tiers.length === 0) throw new PricingCalculationError('Tiered pricing requires at least one tier.');
  let remaining = units;
  let lowerBound = 0;
  const tierBreakdown: NonNullable<CostItem['tierBreakdown']> = [];
  let subtotalMicros = '0';
  for (const tier of tiers) {
    if (remaining === 0) break;
    const capacity = tier.upTo === undefined ? remaining : Math.max(0, tier.upTo - lowerBound);
    const consumed = Math.min(remaining, capacity);
    if (consumed > 0) {
      const subtotal = perMillion(consumed, tier.unitMicrosPerMillionTokens);
      tierBreakdown.push({ ...(tier.upTo === undefined ? {} : { upTo: tier.upTo }), units: consumed, subtotalMicros: subtotal });
      subtotalMicros = addDecimal(subtotalMicros, subtotal);
      remaining -= consumed;
    }
    if (tier.upTo !== undefined) lowerBound = tier.upTo;
  }
  const item = CostItemSchema.parse({ itemCode, quantity: units, subtotalMicros, tierBreakdown });
  return { item, complete: remaining === 0 };
}

function perMillion(units: number, microsPerMillion: string): string {
  return ((BigInt(units) * BigInt(microsPerMillion)) / MILLION).toString();
}

function addDecimal(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function pricingIdentity(rule: PricingRule): string {
  return [rule.providerId, rule.modelPattern, rule.effectiveFrom, rule.pricingRevision].join('\u0000');
}

function matchesModel(pattern: string, model: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*');
  return new RegExp(`^${escaped}$`, 'u').test(model);
}

function patternSpecificity(pattern: string): number {
  return pattern.replace(/\*/gu, '').length;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => compareText(left, right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new PricingCalculationError('Pricing value is not canonical JSON.');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function freezeProjection(value: PricingProjection): PricingProjection {
  return deepFreeze({
    cost: value.cost === undefined ? undefined : clone(value.cost),
    pricingRevision: value.pricingRevision,
    unknownDimensions: [...value.unknownDimensions],
  });
}
