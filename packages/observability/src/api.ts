import {
  AuditEventSchema,
  ModelUsageRecordSchema,
  ObservabilityAuditResponseSchema,
  ObservabilityMetricSchema,
  ObservabilityPricingResponseSchema,
  ObservabilityRangeSchema,
  ObservabilityRunUsageSchema,
  ObservabilityTimeseriesSchema,
  ObservabilityUsageSummarySchema,
  PricingRuleSchema,
  ToolUsageRecordSchema,
  type AuditEvent,
  type ModelUsageRecord,
  type ObservabilityAuditResponse,
  type ObservabilityMetric,
  type ObservabilityPricingResponse,
  type ObservabilityRange,
  type ObservabilityRunUsage,
  type ObservabilityTimeseries,
  type ObservabilityTimeseriesPoint,
  type ObservabilityUsageSummary,
  type ResourceSample,
  type ToolUsageRecord,
  type PricingRule,
} from '@ready4vibe/contracts';
const HOUR_MS = 3_600_000;
const RANGE_MS: Record<ObservabilityRange, number> = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS, '30d': 30 * 24 * HOUR_MS };
const MAX_AUDIT_EVENTS = 100;

export interface ObservabilityProjectionClock {
  readonly now?: () => Date;
}

export function buildUsageSummary(
  records: readonly ModelUsageRecord[],
  tools: readonly ToolUsageRecord[],
  samples: readonly ResourceSample[],
  range: ObservabilityRange,
  clock: ObservabilityProjectionClock = {},
): ObservabilityUsageSummary {
  const window = resolveWindow(range, clock);
  const modelRecords = records.map((value) => ModelUsageRecordSchema.parse(value)).filter((value) => inWindow(value.startedAt, window));
  const toolRecords = tools.map((value) => ToolUsageRecordSchema.parse(value)).filter((value) => inWindow(value.startedAt, window));
  const resourceSamples = samples.map((value) => value).filter((value) => inWindow(value.sampledAt, window));
  const latest = [...resourceSamples].sort((left, right) => Date.parse(right.sampledAt) - Date.parse(left.sampledAt))[0];
  const cost = summarizeCost(modelRecords);
  return ObservabilityUsageSummarySchema.parse({
    schemaVersion: 'ready4vibe_observability_api_v1',
    status: 'ready',
    generatedAt: window.to,
    range,
    from: window.from,
    to: window.to,
    modelAttempts: modelRecords.length,
    modelRequests: new Set(modelRecords.map((value) => value.requestId)).size,
    toolCalls: toolRecords.length,
    tokens: {
      input: summarizeDimension(modelRecords, 'input'),
      output: summarizeDimension(modelRecords, 'output'),
      cachedInput: summarizeDimension(modelRecords, 'cachedInput'),
      reasoning: summarizeDimension(modelRecords, 'reasoning'),
    },
    resources: {
      sampleCount: resourceSamples.length,
      droppedSampleCount: sumBounded(resourceSamples.map((value) => value.droppedSampleCount)),
      ...(latest === undefined ? {} : { latest: latestResource(latest) }),
    },
    cost,
  });
}

export function buildUsageTimeseries(
  records: readonly ModelUsageRecord[],
  samples: readonly ResourceSample[],
  metric: ObservabilityMetric,
  range: ObservabilityRange,
  clock: ObservabilityProjectionClock = {},
): ObservabilityTimeseries {
  const window = resolveWindow(range, clock);
  const parsedMetric = ObservabilityMetricSchema.parse(metric);
  const modelRecords = records.map((value) => ModelUsageRecordSchema.parse(value)).filter((value) => inWindow(value.startedAt, window));
  const resourceSamples = samples.filter((value) => inWindow(value.sampledAt, window));
  const buckets = new Map<number, Bucket>();
  const add = (timestamp: string): Bucket => {
    const milliseconds = Date.parse(timestamp);
    const start = window.start + Math.floor((milliseconds - window.start) / HOUR_MS) * HOUR_MS;
    const existing = buckets.get(start) ?? { sampleCount: 0, cpu: [], memory: [], disk: [], inputs: [], outputs: [], costs: [], accuracies: [] };
    buckets.set(start, existing);
    return existing;
  };
  if (parsedMetric === 'cpu' || parsedMetric === 'memory' || parsedMetric === 'disk') {
    for (const sample of resourceSamples) {
      const bucket = add(sample.sampledAt);
      bucket.sampleCount += 1;
      bucket.accuracies.push(sample.accuracy);
      if (sample.cpu?.milliPercent !== undefined) bucket.cpu.push(sample.cpu.milliPercent);
      if (sample.memory?.rssBytes !== undefined) bucket.memory.push(sample.memory.rssBytes);
      if (sample.disk?.freeBytes !== undefined) bucket.disk.push(sample.disk.freeBytes);
    }
  } else {
    for (const record of modelRecords) {
      const bucket = add(record.startedAt);
      bucket.sampleCount += 1;
      bucket.accuracies.push(record.tokenAccuracy);
      if (record.tokens.input !== undefined) bucket.inputs.push(record.tokens.input);
      if (record.tokens.output !== undefined) bucket.outputs.push(record.tokens.output);
      if (record.cost?.amountMicros !== undefined) bucket.costs.push(record.cost.amountMicros);
      if (record.cost?.accuracy === 'unknown') bucket.accuracies.push('unknown');
    }
  }
  const points: ObservabilityTimeseriesPoint[] = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, 744)
    .map(([start, bucket]) => {
      const point: ObservabilityTimeseriesPoint = {
        bucketStart: new Date(start).toISOString(),
        bucketEnd: new Date(start + HOUR_MS).toISOString(),
        sampleCount: bucket.sampleCount,
        accuracy: combineAccuracy(bucket.accuracies),
        ...(parsedMetric === 'cpu' && bucket.cpu.length > 0 ? { cpuMilliPercent: average(bucket.cpu) } : {}),
        ...(parsedMetric === 'memory' && bucket.memory.length > 0 ? { rssBytes: latestDecimal(bucket.memory) } : {}),
        ...(parsedMetric === 'disk' && bucket.disk.length > 0 ? { diskFreeBytes: latestDecimal(bucket.disk) } : {}),
        ...(parsedMetric === 'tokens' && bucket.inputs.length > 0 ? { inputTokens: sumBounded(bucket.inputs) } : {}),
        ...(parsedMetric === 'tokens' && bucket.outputs.length > 0 ? { outputTokens: sumBounded(bucket.outputs) } : {}),
        ...(parsedMetric === 'cost' && bucket.costs.length > 0 ? { costMicros: sumDecimal(bucket.costs) } : {}),
      };
      return point;
    });
  return ObservabilityTimeseriesSchema.parse({
    schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: window.to,
    range, metric: parsedMetric, points, droppedSampleCount: sumBounded(resourceSamples.map((value) => value.droppedSampleCount)),
  });
}

export function buildRunUsage(
  runId: string,
  records: readonly ModelUsageRecord[],
  tools: readonly ToolUsageRecord[],
  clock: ObservabilityProjectionClock = {},
): ObservabilityRunUsage {
  const modelUsages = records.map((value) => ModelUsageRecordSchema.parse(value)).filter((value) => value.runId === runId);
  const toolUsages = tools.map((value) => ToolUsageRecordSchema.parse(value)).filter((value) => value.runId === runId);
  return ObservabilityRunUsageSchema.parse({
    schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: isoNow(clock), runId,
    modelUsages, toolUsages,
    tokens: {
      input: summarizeDimension(modelUsages, 'input'), output: summarizeDimension(modelUsages, 'output'),
      cachedInput: summarizeDimension(modelUsages, 'cachedInput'), reasoning: summarizeDimension(modelUsages, 'reasoning'),
    },
  });
}

export function buildAuditResponse(
  events: readonly AuditEvent[],
  after: number,
  filters: { readonly action?: string; readonly outcome?: string } = {},
  clock: ObservabilityProjectionClock = {},
): ObservabilityAuditResponse {
  if (!Number.isSafeInteger(after) || after < 0 || after > 1_000_000_000_000) throw new Error('audit cursor is outside the bounded range');
  const parsed = events.map((value) => AuditEventSchema.parse(value))
    .filter((value) => filters.action === undefined || value.action === filters.action)
    .filter((value) => filters.outcome === undefined || value.outcome === filters.outcome)
    .sort((left, right) => right.appendSequence - left.appendSequence);
  const eligible = parsed.filter((value) => after === 0 || value.appendSequence < after).slice(0, MAX_AUDIT_EVENTS);
  const nextAfter = eligible.length === MAX_AUDIT_EVENTS ? eligible.at(-1)!.appendSequence : null;
  return {
    schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: isoNow(clock),
    after, nextAfter, events: eligible,
  };
}

export function buildPricingResponse(rules: readonly PricingRule[], clock: ObservabilityProjectionClock = {}): ObservabilityPricingResponse {
  return ObservabilityPricingResponseSchema.parse({
    schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: isoNow(clock),
    rules: rules.map((value) => PricingRuleSchema.parse(value)).slice(0, 256),
  });
}

interface Window {
  readonly start: number;
  readonly from: string;
  readonly to: string;
}

interface Bucket {
  sampleCount: number;
  cpu: number[];
  memory: string[];
  disk: string[];
  inputs: number[];
  outputs: number[];
  costs: string[];
  accuracies: string[];
}

function resolveWindow(range: ObservabilityRange, clock: ObservabilityProjectionClock): Window {
  const parsedRange = ObservabilityRangeSchema.parse(range);
  const now = clock.now?.() ?? new Date();
  const end = now.getTime();
  if (!Number.isFinite(end)) throw new Error('projection clock is invalid');
  const start = end - RANGE_MS[parsedRange];
  return { start, from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}

function isoNow(clock: ObservabilityProjectionClock): string {
  const value = clock.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) throw new Error('projection clock is invalid');
  return value.toISOString();
}

function inWindow(value: string, window: Window): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= window.start && timestamp <= Date.parse(window.to);
}

function summarizeDimension(records: readonly ModelUsageRecord[], key: 'input' | 'output' | 'cachedInput' | 'reasoning') {
  let total = 0;
  let knownRecords = 0;
  for (const record of records) {
    const value = record.tokens[key];
    if (value === undefined) continue;
    total = sumSafe(total, value);
    knownRecords += 1;
  }
  return { total: knownRecords === 0 ? null : total, knownRecords, unknownRecords: records.length - knownRecords };
}

function summarizeCost(records: readonly ModelUsageRecord[]) {
  const costs = records.map((value) => value.cost).filter((value): value is NonNullable<ModelUsageRecord['cost']> => value !== undefined);
  if (costs.length === 0) return { currency: null, amountMicros: null, accuracy: 'not-applicable' as const };
  const currencies = new Set(costs.map((value) => value.currency));
  const accuracy = costs.some((value) => value.accuracy === 'unknown') ? 'unknown' as const : costs.some((value) => value.accuracy === 'estimated') ? 'estimated' as const : 'exact' as const;
  return { currency: currencies.size === 1 ? costs[0]!.currency : null, amountMicros: currencies.size === 1 ? sumDecimal(costs.map((value) => value.amountMicros)) : null, accuracy: currencies.size === 1 ? accuracy : 'unknown' as const };
}

function latestResource(sample: ResourceSample) {
  return {
    sampledAt: sample.sampledAt,
    accuracy: sample.accuracy,
    ...(sample.cpu?.milliPercent === undefined ? {} : { cpuMilliPercent: sample.cpu.milliPercent }),
    ...(sample.memory?.rssBytes === undefined ? {} : { rssBytes: sample.memory.rssBytes }),
    ...(sample.memory?.hostAvailableBytes === undefined ? {} : { hostAvailableBytes: sample.memory.hostAvailableBytes }),
    ...(sample.disk?.freeBytes === undefined ? {} : { diskFreeBytes: sample.disk.freeBytes }),
  };
}

function combineAccuracy(values: readonly string[]): 'reported' | 'measured' | 'estimated' | 'unknown' | 'not-applicable' {
  if (values.length === 0) return 'not-applicable';
  if (values.includes('unknown')) return 'unknown';
  if (values.includes('estimated')) return 'estimated';
  if (values.includes('measured')) return 'measured';
  return 'reported';
}

function average(values: readonly number[]): number {
  return Math.min(1_000_000_000_000, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
}

function latestDecimal(values: readonly string[]): string {
  return values.at(-1)!;
}

function sumDecimal(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += BigInt(value);
    if (total > 999_999_999_999_999_999_999_999_999_999n) throw new Error('projection decimal exceeded bound');
  }
  return total.toString();
}

function sumBounded(values: readonly number[]): number {
  return values.reduce((sum, value) => sumSafe(sum, value), 0);
}

function sumSafe(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value > 1_000_000_000_000) throw new Error('projection counter exceeded bound');
  return value;
}
