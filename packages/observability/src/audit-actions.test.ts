import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, ModelUsageRecord, ResourceSample, ToolUsageRecord } from '@ready4vibe/contracts';
import {
  ObservabilityAuditApplicationService,
  ObservabilityExportError,
  canonicalObservabilityJson,
  createObservabilityExport,
  importObservabilityExport,
  sealAuditEvent,
  verifyAuditChain,
  verifyObservabilityExport,
  type AuditApplicationActionInput,
  type AuditEventWriter,
} from './index.js';

const at = '2026-08-05T00:00:00.000Z';

function chainWriter(): { writer: AuditEventWriter; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  const writer: AuditEventWriter = {
    appendBatch: async (batch) => {
      const drafts = batch.auditEvents ?? [];
      const written = drafts.map((draft, index) => sealAuditEvent(draft, events.length + index + 1, events.at(-1)?.eventHash ?? null));
      events.push(...written);
      return { auditEvents: written };
    },
  };
  return { writer, events };
}

function actionBase(overrides: Partial<Omit<AuditApplicationActionInput, 'action' | 'targetKind'>> = {}): Omit<AuditApplicationActionInput, 'action' | 'targetKind'> {
  return {
    actor: 'user-session',
    transport: 'lan',
    correlationId: 'corr_audit_01',
    outcome: 'succeeded',
    ...overrides,
  };
}

function usage(id: string): ModelUsageRecord {
  return {
    schemaVersion: 'ready4vibe_model_usage_v1',
    usageId: id,
    runId: 'run_export_01',
    turnId: `turn_${id}`,
    requestId: `request_${id}`,
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    requestModel: 'deepseek-v4-flash',
    pricingModel: 'deepseek-v4-flash',
    attempt: 1,
    startedAt: at,
    completedAt: at,
    status: 'completed',
    tokens: { input: 10, output: 3 },
    tokenAccuracy: 'reported',
    inputTokenSemantics: 'fresh',
    dataSource: 'provider-usage',
  };
}

function sample(id: string): ResourceSample {
  return {
    schemaVersion: 'ready4vibe_resource_sample_v1',
    sampleId: id,
    sampledAt: at,
    scope: 'run',
    runId: 'run_export_01',
    source: 'node',
    accuracy: 'measured',
    cpu: { milliPercent: 100 },
    memory: { rssBytes: '1024' },
    samplingIntervalMs: 5_000,
    droppedSampleCount: 0,
  };
}

function tool(id: string): ToolUsageRecord {
  return {
    schemaVersion: 'ready4vibe_tool_usage_v1',
    usageId: id,
    runId: 'run_export_01',
    turnId: `turn_${id}`,
    callId: `call_${id}`,
    toolId: 'fixture.read',
    attempt: 1,
    startedAt: at,
    completedAt: at,
    durationMs: 2,
    status: 'completed',
    risk: 'read',
    runtime: 'host-restricted',
    accuracy: 'measured',
  };
}

function exportedAudits(): AuditEvent[] {
  const first = sealAuditEvent({
    schemaVersion: 'ready4vibe_audit_event_v1',
    eventId: 'audit_export_01',
    at,
    actor: 'user-session',
    transport: 'lan',
    action: 'settings.updated',
    targetKind: 'settings',
    targetId: 'settings_01',
    outcome: 'succeeded',
    correlationId: 'corr_export_01',
  }, 1, null);
  const second = sealAuditEvent({
    schemaVersion: 'ready4vibe_audit_event_v1',
    eventId: 'audit_export_02',
    at,
    actor: 'system',
    transport: 'loopback',
    action: 'usage.exported',
    targetKind: 'export',
    targetId: 'export_01',
    outcome: 'succeeded',
    correlationId: 'corr_export_02',
  }, 2, first.eventHash);
  return [first, second];
}

describe('ObservabilityAuditApplicationService', () => {
  it('records settings, approval, sandbox and provider actions on one hash chain', async () => {
    const { writer, events } = chainWriter();
    const service = new ObservabilityAuditApplicationService(writer, { now: () => new Date(at) });

    expect((await service.settings({ ...actionBase(), eventId: 'audit_settings', targetId: 'settings_01' })).status).toBe('recorded');
    expect((await service.approval({ ...actionBase(), action: 'approval.decided', targetKind: 'tool', targetId: 'tool_01', eventId: 'audit_approval' })).status).toBe('recorded');
    expect((await service.sandbox({ ...actionBase(), targetId: 'sandbox_01', eventId: 'audit_sandbox' })).status).toBe('recorded');
    expect((await service.provider({ ...actionBase(), action: 'provider.degraded', targetId: 'model_01', eventId: 'audit_provider' })).status).toBe('recorded');
    expect(events).toHaveLength(4);
    expect(verifyAuditChain(events)).toBe(true);
  });

  it('rejects action/target mismatches and privacy-shaped details before the writer', async () => {
    const writer: AuditEventWriter = { appendBatch: vi.fn(async () => undefined) };
    const service = new ObservabilityAuditApplicationService(writer);
    const mismatch = await service.record({ ...actionBase(), action: 'settings.updated', targetKind: 'model', targetId: 'model_01' });
    const secret = await service.settings({ ...actionBase(), targetId: 'settings_01', safeDetails: { note: 'authorization: Bearer secret' } });

    expect(mismatch).toMatchObject({ status: 'rejected', errorCode: 'OBSERVABILITY_AUDIT_INVALID' });
    expect(secret).toMatchObject({ status: 'rejected', errorCode: 'OBSERVABILITY_AUDIT_PRIVACY' });
    expect(writer.appendBatch).not.toHaveBeenCalled();
  });

  it('fails soft when the audit writer is unavailable', async () => {
    const writer: AuditEventWriter = { appendBatch: vi.fn(async () => { throw new Error('offline'); }) };
    const service = new ObservabilityAuditApplicationService(writer);
    expect((await service.provider({ ...actionBase(), action: 'model.configured', targetId: 'model_01' })).status).toBe('degraded');
  });
});

describe('observability explicit export/import', () => {
  const content = {
    modelUsages: [usage('usage_b'), usage('usage_a')],
    toolUsages: [tool('tool_b'), tool('tool_a')],
    resourceSamples: [sample('sample_b'), sample('sample_a')],
    auditEvents: exportedAudits(),
  } as const;

  it('sorts deterministically, checksums and imports validated facts without writing', () => {
    const first = createObservabilityExport(content, () => new Date(at));
    const second = createObservabilityExport({ ...content, modelUsages: [...content.modelUsages].reverse(), resourceSamples: [...content.resourceSamples].reverse() }, () => new Date(at));

    expect(first).toEqual(second);
    expect(verifyObservabilityExport(first)).toMatchObject({ status: 'valid', checksum: first.checksum });
    const imported = importObservabilityExport(first);
    expect(imported.modelUsages.map((record) => record.usageId)).toEqual(['usage_a', 'usage_b']);
    expect(Object.isFrozen(imported)).toBe(true);
  });

  it('detects body tampering, checksum tampering and an invalid audit chain', () => {
    const bundle = createObservabilityExport(content, () => new Date(at));
    expect(verifyObservabilityExport({ ...bundle, modelUsages: [usage('usage_tampered')] })).toMatchObject({ status: 'invalid', errorCode: 'OBSERVABILITY_EXPORT_CHECKSUM' });
    expect(verifyObservabilityExport({ ...bundle, checksum: 'f'.repeat(64) })).toMatchObject({ status: 'invalid', errorCode: 'OBSERVABILITY_EXPORT_CHECKSUM' });
    const invalidAudit = { ...bundle, auditEvents: [{ ...bundle.auditEvents[1]!, appendSequence: 1, previousHash: null }] };
    const { checksum: _checksum, ...invalidContent } = invalidAudit;
    const invalidWithChecksum = {
      ...invalidContent,
      checksum: createHash('sha256').update(canonicalObservabilityJson(invalidContent), 'utf8').digest('hex'),
    };
    expect(verifyObservabilityExport(invalidWithChecksum)).toMatchObject({ status: 'degraded', errorCode: 'OBSERVABILITY_EXPORT_AUDIT_CHAIN' });
  });

  it('rejects raw payloads, secrets, paths and oversized bundles', () => {
    expect(() => createObservabilityExport({ ...content, modelUsages: [{ ...usage('usage_raw'), rawResponse: { body: 'secret=sk-' + 'x'.repeat(24) } } as never] }, () => new Date(at))).toThrow(ObservabilityExportError);
    expect(() => createObservabilityExport({ ...content, resourceSamples: [{ ...sample('sample_path'), disk: { volumeClass: 'workspace-volume', volumeId: 'C:\\private\\workspace' } } as never] }, () => new Date(at))).toThrow(ObservabilityExportError);
    expect(() => createObservabilityExport({ ...content, resourceSamples: Array.from({ length: 16_385 }, (_, index) => sample(`sample_${index}`)) }, () => new Date(at))).toThrow(ObservabilityExportError);
  });
});
