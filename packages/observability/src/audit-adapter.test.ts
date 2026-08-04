import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '@ready4vibe/contracts';
import { AuditApplicationAdapter, type AuditEventWriter } from './audit-adapter.js';
import { sealAuditEvent, verifyAuditChain } from './index.js';

const base = {
  actor: 'user-session' as const,
  transport: 'lan' as const,
  action: 'settings.updated' as const,
  targetKind: 'settings' as const,
  targetId: 'settings_01',
  outcome: 'succeeded' as const,
  correlationId: 'corr_01',
};

function chainWriter(): { writer: AuditEventWriter; events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  const writer: AuditEventWriter = {
    appendBatch: async (batch) => {
      for (const draft of batch.auditEvents ?? []) {
        events.push(sealAuditEvent(draft, events.length + 1, events.at(-1)?.eventHash ?? null));
      }
      return { auditEvents: events.slice(-((batch.auditEvents ?? []).length)) };
    },
  };
  return { writer, events };
}

describe('AuditApplicationAdapter', () => {
  it('creates bounded drafts and preserves the existing audit hash chain', async () => {
    const { writer, events } = chainWriter();
    const adapter = new AuditApplicationAdapter(writer, { now: () => new Date('2026-08-04T00:00:00.000Z') });

    const first = await adapter.record(base);
    const second = await adapter.record({ ...base, action: 'run.completed', targetKind: 'run', targetId: 'run_01' });

    expect(first.status).toBe('recorded');
    expect(second.status).toBe('recorded');
    expect(first.draft).toMatchObject({ schemaVersion: 'ready4vibe_audit_event_v1', actor: 'user-session' });
    expect(verifyAuditChain(events)).toBe(true);
  });

  it('rejects secret-shaped or absolute-path details without calling the writer', async () => {
    const writer: AuditEventWriter = { appendBatch: vi.fn(async () => undefined) };
    const adapter = new AuditApplicationAdapter(writer);

    const result = await adapter.record({ ...base, safeDetails: { authorization: 'Bearer secret' } });
    const pathResult = await adapter.record({ ...base, safeDetails: { workspace: 'C:\\private\\workspace' } });

    expect(result.status).toBe('rejected');
    expect(result.errorCode).toBe('OBSERVABILITY_AUDIT_PRIVACY');
    expect(pathResult.status).toBe('rejected');
    expect(pathResult.errorCode).toBe('OBSERVABILITY_AUDIT_PRIVACY');
    expect(writer.appendBatch).not.toHaveBeenCalled();
  });

  it('returns degraded when the ledger writer fails and never throws into the action path', async () => {
    const writer: AuditEventWriter = {
      appendBatch: vi.fn(async () => { throw new Error('sqlite unavailable'); }),
    };
    const adapter = new AuditApplicationAdapter(writer);

    const result = await adapter.record(base);

    expect(result.status).toBe('degraded');
    expect(result.errorCode).toBe('OBSERVABILITY_AUDIT_WRITE_FAILED');
    expect(result.draft?.eventId).toMatch(/^audit_/u);
  });
});
