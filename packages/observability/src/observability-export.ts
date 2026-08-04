import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AuditEventSchema,
  ModelUsageRecordSchema,
  PricingRuleSchema,
  ResourceSampleSchema,
  ToolUsageRecordSchema,
  UsageRollupSchema,
  findObservabilityPrivacyViolations,
  type AuditEvent,
  type ModelUsageRecord,
  type PricingRule,
  type ResourceSample,
  type ToolUsageRecord,
  type UsageRollup,
} from '@ready4vibe/contracts';
import { canonicalObservabilityJson, verifyAuditChain } from './index.js';

const EXPORT_SCHEMA_VERSION = 'ready4vibe_observability_export_v1' as const;
const REDACTION_VERSION = 'contract-bounded-v1' as const;
const HEX_64 = /^[a-f0-9]{64}$/u;
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

const ExportContentSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  source: z.literal('local-observability-ledger'),
  redaction: z.literal(REDACTION_VERSION),
  modelUsages: z.array(ModelUsageRecordSchema).max(4_096),
  toolUsages: z.array(ToolUsageRecordSchema).max(4_096),
  resourceSamples: z.array(ResourceSampleSchema).max(16_384),
  auditEvents: z.array(AuditEventSchema).max(4_096),
  rollups: z.array(UsageRollupSchema).max(4_096).optional(),
  pricingRules: z.array(PricingRuleSchema).max(4_096).optional(),
}).strict();

export const ObservabilityExportBundleSchema = ExportContentSchema.extend({
  checksum: z.string().regex(HEX_64),
}).strict();

export type ObservabilityExportBundle = z.infer<typeof ObservabilityExportBundleSchema>;
export type ObservabilityExportContent = z.infer<typeof ExportContentSchema>;

export interface ObservabilityExportInput {
  readonly exportedAt?: string;
  readonly modelUsages?: readonly ModelUsageRecord[];
  readonly toolUsages?: readonly ToolUsageRecord[];
  readonly resourceSamples?: readonly ResourceSample[];
  readonly auditEvents?: readonly AuditEvent[];
  readonly rollups?: readonly UsageRollup[];
  readonly pricingRules?: readonly PricingRule[];
}
export class ObservabilityExportError extends Error {
  constructor(readonly code: 'OBSERVABILITY_EXPORT_INVALID' | 'OBSERVABILITY_EXPORT_PRIVACY' | 'OBSERVABILITY_EXPORT_CHECKSUM' | 'OBSERVABILITY_EXPORT_AUDIT_CHAIN' | 'OBSERVABILITY_EXPORT_TOO_LARGE', message: string) {
    super(message);
    this.name = 'ObservabilityExportError';
  }
}

export interface ObservabilityExportVerification {
  readonly status: 'valid' | 'invalid' | 'degraded';
  readonly checksum?: string;
  readonly errorCode?: ObservabilityExportError['code'];
}

/** Creates an explicit local export; it never writes, uploads or mutates a ledger. */
export function createObservabilityExport(input: ObservabilityExportInput, now: () => Date = () => new Date()): ObservabilityExportBundle {
  const content = parseAndSortContent({
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: input.exportedAt ?? now().toISOString(),
    source: 'local-observability-ledger',
    redaction: REDACTION_VERSION,
    modelUsages: [...(input.modelUsages ?? [])],
    toolUsages: [...(input.toolUsages ?? [])],
    resourceSamples: [...(input.resourceSamples ?? [])],
    auditEvents: [...(input.auditEvents ?? [])],
    ...(input.rollups === undefined ? {} : { rollups: [...input.rollups] }),
    ...(input.pricingRules === undefined ? {} : { pricingRules: [...input.pricingRules] }),
  });
  assertAuditChain(content.auditEvents);
  const checksum = fingerprintContent(content);
  const bundle = ObservabilityExportBundleSchema.parse({ ...content, checksum });
  assertExportSize(bundle);
  return deepFreeze(bundle);
}

/** Verifies schema, redaction, checksum and the complete audit chain. */
export function verifyObservabilityExport(input: unknown): ObservabilityExportVerification {
  try {
    const bundle = ObservabilityExportBundleSchema.parse(input);
    assertExportSize(bundle);
    const { checksum, ...content } = bundle;
    if (fingerprintContent(content) !== checksum) return { status: 'invalid', errorCode: 'OBSERVABILITY_EXPORT_CHECKSUM' };
    assertAuditChain(bundle.auditEvents);
    return { status: 'valid', checksum };
  } catch (error) {
    if (error instanceof ObservabilityExportError) {
      return { status: error.code === 'OBSERVABILITY_EXPORT_AUDIT_CHAIN' ? 'degraded' : 'invalid', errorCode: error.code };
    }
    return { status: 'invalid', errorCode: 'OBSERVABILITY_EXPORT_INVALID' };
  }
}

/** Validates an explicit import and returns immutable facts for a caller-owned writer. */
export function importObservabilityExport(input: unknown): ObservabilityExportContent {
  const verification = verifyObservabilityExport(input);
  if (verification.status !== 'valid') throw new ObservabilityExportError(verification.errorCode ?? 'OBSERVABILITY_EXPORT_INVALID', 'Observability export failed verification.');
  const bundle = ObservabilityExportBundleSchema.parse(input);
  const { checksum: _checksum, ...content } = bundle;
  return deepFreeze(content);
}

function parseAndSortContent(input: unknown): ObservabilityExportContent {
  try {
    if (findObservabilityPrivacyViolations(input).length > 0) throw new ObservabilityExportError('OBSERVABILITY_EXPORT_PRIVACY', 'Observability export contains forbidden privacy data.');
    const parsed = ExportContentSchema.parse(input);
    const sorted = {
      ...parsed,
      modelUsages: [...parsed.modelUsages].sort((left, right) => compareText(left.usageId, right.usageId)),
      toolUsages: [...parsed.toolUsages].sort((left, right) => compareText(left.usageId, right.usageId)),
      resourceSamples: [...parsed.resourceSamples].sort((left, right) => compareText(left.sampleId, right.sampleId)),
      auditEvents: [...parsed.auditEvents].sort((left, right) => left.appendSequence - right.appendSequence || compareText(left.eventId, right.eventId)),
      ...(parsed.rollups === undefined ? {} : { rollups: [...parsed.rollups].sort((left, right) => compareText(left.rollupId, right.rollupId)) }),
      ...(parsed.pricingRules === undefined ? {} : { pricingRules: [...parsed.pricingRules].sort((left, right) => pricingIdentity(left).localeCompare(pricingIdentity(right))) }),
    };
    return ExportContentSchema.parse(sorted);
  } catch (error) {
    if (error instanceof ObservabilityExportError) throw error;
    throw new ObservabilityExportError('OBSERVABILITY_EXPORT_INVALID', 'Observability export failed bounded contract validation.');
  }
}

function assertAuditChain(events: readonly AuditEvent[]): void {
  if (events.length > 0 && !verifyAuditChain(events)) throw new ObservabilityExportError('OBSERVABILITY_EXPORT_AUDIT_CHAIN', 'Observability audit chain failed verification.');
}

function assertExportSize(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (!encoded || encoded.length > MAX_EXPORT_BYTES) throw new ObservabilityExportError('OBSERVABILITY_EXPORT_TOO_LARGE', 'Observability export exceeded its bounded size.');
}

function fingerprintContent(value: ObservabilityExportContent): string {
  return createHash('sha256').update(canonicalObservabilityJson(value), 'utf8').digest('hex');
}

function pricingIdentity(rule: PricingRule): string {
  return [rule.providerId, rule.modelPattern, rule.effectiveFrom, rule.pricingRevision].join('\u0000');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
