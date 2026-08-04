import { randomUUID } from 'node:crypto';
import {
  AuditEventSchema,
  type AuditEvent,
} from '@ready4vibe/contracts';
import type { AuditEventDraft } from './index.js';

const ZERO_HASH = '0'.repeat(64);

export interface AuditEventWriter {
  readonly appendBatch: (batch: { readonly auditEvents?: readonly AuditEventDraft[] }) => Promise<unknown>;
}

export type AuditEventInput = Omit<AuditEventDraft, 'schemaVersion' | 'eventId' | 'at'> & {
  readonly eventId?: string;
  readonly at?: string;
};

export interface AuditApplicationAdapterOptions {
  readonly now?: () => Date;
  readonly eventId?: () => string;
}

export type AuditRecordStatus = 'recorded' | 'rejected' | 'degraded';

export interface AuditRecordResult {
  readonly status: AuditRecordStatus;
  readonly draft?: AuditEventDraft;
  readonly event?: AuditEvent;
  readonly errorCode?: 'OBSERVABILITY_AUDIT_PRIVACY' | 'OBSERVABILITY_AUDIT_INVALID' | 'OBSERVABILITY_AUDIT_WRITE_FAILED';
}

/**
 * Application boundary for audit writes. The ledger remains responsible for
 * appendSequence, canonical hash chaining, idempotency, and durable storage.
 */
export class AuditApplicationAdapter {
  private readonly writer: AuditEventWriter;
  private readonly now: () => Date;
  private readonly eventId: () => string;

  constructor(writer: AuditEventWriter, options: AuditApplicationAdapterOptions = {}) {
    this.writer = writer;
    this.now = options.now ?? (() => new Date());
    this.eventId = options.eventId ?? (() => `audit_${randomUUID().replaceAll('-', '')}`);
  }

  async record(input: AuditEventInput): Promise<AuditRecordResult> {
    let draft: AuditEventDraft;
    try {
      draft = createAuditEventDraft(input, this.now, this.eventId);
    } catch (error) {
      return {
        status: 'rejected',
        errorCode: isPrivacyError(error) ? 'OBSERVABILITY_AUDIT_PRIVACY' : 'OBSERVABILITY_AUDIT_INVALID',
      };
    }

    try {
      const result = await this.writer.appendBatch({ auditEvents: [draft] });
      const event = readWrittenEvent(result);
      return { status: 'recorded', draft, ...(event === undefined ? {} : { event }) };
    } catch {
      return { status: 'degraded', draft, errorCode: 'OBSERVABILITY_AUDIT_WRITE_FAILED' };
    }
  }
}

export function createAuditEventDraft(
  input: AuditEventInput,
  now: () => Date = () => new Date(),
  eventId: () => string = () => `audit_${randomUUID().replaceAll('-', '')}`,
): AuditEventDraft {
  const at = input.at ?? now().toISOString();
  const candidate = AuditEventSchema.parse({
    ...input,
    schemaVersion: 'ready4vibe_audit_event_v1',
    eventId: input.eventId ?? eventId(),
    at,
    appendSequence: 1,
    previousHash: null,
    eventHash: ZERO_HASH,
  });
  const { appendSequence: _appendSequence, previousHash: _previousHash, eventHash: _eventHash, ...draft } = candidate;
  return draft;
}

function readWrittenEvent(value: unknown): AuditEvent | undefined {
  if (typeof value !== 'object' || value === null || !('auditEvents' in value)) return undefined;
  const events = (value as { auditEvents?: unknown }).auditEvents;
  if (!Array.isArray(events) || events.length === 0) return undefined;
  const candidate = events[0];
  try {
    return AuditEventSchema.parse(candidate);
  } catch {
    return undefined;
  }
}

function isPrivacyError(error: unknown): boolean {
  return error instanceof Error && /secret|absolute path/iu.test(error.message);
}
