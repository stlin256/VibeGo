import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  ApprovalReviewEventDraftSchema,
  ApprovalReviewEventSchema,
  type ApprovalReviewEvent,
  type ApprovalReviewEventDraft,
  type ApprovalReviewEventStore,
} from '@ready4vibe/contracts';

const MAX_READ_LIMIT = 1_000;

export class ApprovalReviewEventConflictError extends Error {
  readonly code: 'APPROVAL_REVIEW_EVENT_CONFLICT' | 'APPROVAL_REVIEW_IDEMPOTENCY_CONFLICT';

  constructor(code: 'APPROVAL_REVIEW_EVENT_CONFLICT' | 'APPROVAL_REVIEW_IDEMPOTENCY_CONFLICT', readonly key: string) {
    super(code === 'APPROVAL_REVIEW_EVENT_CONFLICT'
      ? 'An approval review event id was already used with different content.'
      : 'An approval review idempotency key was already used with different content.');
    this.name = 'ApprovalReviewEventConflictError';
    this.code = code;
  }
}

export class SqliteApprovalReviewEventStoreError extends Error {
  readonly code = 'APPROVAL_REVIEW_EVENT_STORAGE_ERROR';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteApprovalReviewEventStoreError';
  }
}

type StoredEntry = {
  readonly event: ApprovalReviewEvent;
  readonly fingerprint: string;
  readonly semanticFingerprint: string;
};

/** Deterministic JSON used for reviewer-event conflict checks. */
export function canonicalApprovalReviewEventJson(value: unknown): string {
  if (value === undefined) throw new SqliteApprovalReviewEventStoreError('value is not JSON serializable');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new SqliteApprovalReviewEventStoreError('value is not JSON serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalApprovalReviewEventJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalApprovalReviewEventJson(record[key])}`).join(',')}}`;
}

export function fingerprintApprovalReviewEventDraft(input: ApprovalReviewEventDraft, includeEventId = true): string {
  const { eventId: _eventId, ...withoutEventId } = input;
  const value = includeEventId ? input : withoutEventId;
  return createHash('sha256').update(canonicalApprovalReviewEventJson(value), 'utf8').digest('hex');
}

/** Deterministic in-memory implementation used by daemon and storage tests. */
export class InMemoryApprovalReviewEventStore implements ApprovalReviewEventStore {
  private readonly byEventId = new Map<string, StoredEntry>();
  private readonly byIdempotencyKey = new Map<string, StoredEntry>();
  private readonly events: ApprovalReviewEvent[] = [];
  private nextAppendSequence = 1;
  private closed = false;

  async append(input: ApprovalReviewEventDraft): Promise<ApprovalReviewEvent> {
    const values = await this.appendBatch([input]);
    return values[0]!;
  }

  async appendBatch(inputs: readonly ApprovalReviewEventDraft[]): Promise<readonly ApprovalReviewEvent[]> {
    this.ensureOpen();
    if (inputs.length === 0) return [];
    const parsed = inputs.map((input) => ApprovalReviewEventDraftSchema.parse(input));
    const plannedByEventId = new Map<string, StoredEntry>();
    const plannedByKey = new Map<string, StoredEntry>();
    const planned: StoredEntry[] = [];
    const result: ApprovalReviewEvent[] = [];
    let nextSequence = this.nextAppendSequence;
    for (const draft of parsed) {
      const fingerprint = fingerprintApprovalReviewEventDraft(draft, true);
      const semanticFingerprint = fingerprintApprovalReviewEventDraft(draft, false);
      const existing = this.byEventId.get(draft.eventId) ?? plannedByEventId.get(draft.eventId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new ApprovalReviewEventConflictError('APPROVAL_REVIEW_EVENT_CONFLICT', draft.eventId);
        result.push(existing.event);
        continue;
      }
      const existingKey = this.byIdempotencyKey.get(draft.idempotencyKey) ?? plannedByKey.get(draft.idempotencyKey);
      if (existingKey) {
        if (existingKey.semanticFingerprint !== semanticFingerprint) throw new ApprovalReviewEventConflictError('APPROVAL_REVIEW_IDEMPOTENCY_CONFLICT', draft.idempotencyKey);
        result.push(existingKey.event);
        continue;
      }
      const event = ApprovalReviewEventSchema.parse({ ...draft, appendSequence: nextSequence++ });
      const entry = { event, fingerprint, semanticFingerprint } satisfies StoredEntry;
      planned.push(entry);
      plannedByEventId.set(event.eventId, entry);
      plannedByKey.set(event.idempotencyKey, entry);
      result.push(event);
    }
    for (const entry of planned) {
      this.events.push(entry.event);
      this.byEventId.set(entry.event.eventId, entry);
      this.byIdempotencyKey.set(entry.event.idempotencyKey, entry);
    }
    this.nextAppendSequence = nextSequence;
    return Object.freeze(result);
  }

  async read(runId: string, afterSequence = 0, limit = MAX_READ_LIMIT): Promise<readonly ApprovalReviewEvent[]> {
    this.ensureOpen();
    validateReadOptions(afterSequence, limit);
    return Object.freeze(this.events.filter((event) => event.runId === runId && event.appendSequence > afterSequence).slice(0, limit));
  }

  close(): void {
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) throw new SqliteApprovalReviewEventStoreError('approval review event store is closed');
  }
}

type EventRow = {
  event_id: string;
  idempotency_key: string;
  append_sequence: number;
  fingerprint: string;
  semantic_fingerprint: string;
  run_id: string;
  at: string;
  payload_json: string;
};

/** Durable reviewer projection. It owns only `approval_review_events`. */
export class SqliteApprovalReviewEventStore implements ApprovalReviewEventStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string | URL) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS approval_review_events (
        event_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        append_sequence INTEGER NOT NULL UNIQUE CHECK (append_sequence > 0),
        fingerprint TEXT NOT NULL,
        semantic_fingerprint TEXT NOT NULL,
        run_id TEXT NOT NULL,
        at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS approval_review_events_run_seq_idx
        ON approval_review_events (run_id, append_sequence);
    `);
  }

  async append(input: ApprovalReviewEventDraft): Promise<ApprovalReviewEvent> {
    const values = await this.appendBatch([input]);
    return values[0]!;
  }

  async appendBatch(inputs: readonly ApprovalReviewEventDraft[]): Promise<readonly ApprovalReviewEvent[]> {
    this.ensureOpen();
    if (inputs.length === 0) return [];
    const parsed = inputs.map((input) => ApprovalReviewEventDraftSchema.parse(input));
    return this.transaction(() => {
      const plannedByEventId = new Map<string, StoredEntry>();
      const plannedByKey = new Map<string, StoredEntry>();
      const planned: StoredEntry[] = [];
      const result: ApprovalReviewEvent[] = [];
      let nextSequence = this.nextAppendSequence();
      for (const draft of parsed) {
        const fingerprint = fingerprintApprovalReviewEventDraft(draft, true);
        const semanticFingerprint = fingerprintApprovalReviewEventDraft(draft, false);
        const existing = this.findByEventId(draft.eventId) ?? plannedByEventId.get(draft.eventId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new ApprovalReviewEventConflictError('APPROVAL_REVIEW_EVENT_CONFLICT', draft.eventId);
          result.push(existing.event);
          continue;
        }
        const existingKey = this.findByIdempotencyKey(draft.idempotencyKey) ?? plannedByKey.get(draft.idempotencyKey);
        if (existingKey) {
          if (existingKey.semanticFingerprint !== semanticFingerprint) throw new ApprovalReviewEventConflictError('APPROVAL_REVIEW_IDEMPOTENCY_CONFLICT', draft.idempotencyKey);
          result.push(existingKey.event);
          continue;
        }
        const event = ApprovalReviewEventSchema.parse({ ...draft, appendSequence: nextSequence++ });
        const entry = { event, fingerprint, semanticFingerprint } satisfies StoredEntry;
        planned.push(entry);
        plannedByEventId.set(event.eventId, entry);
        plannedByKey.set(event.idempotencyKey, entry);
        result.push(event);
      }
      for (const entry of planned) this.insert(entry);
      return Object.freeze(result);
    });
  }

  async read(runId: string, afterSequence = 0, limit = MAX_READ_LIMIT): Promise<readonly ApprovalReviewEvent[]> {
    this.ensureOpen();
    validateReadOptions(afterSequence, limit);
    const rows = this.database.prepare(`
      SELECT event_id, idempotency_key, append_sequence, fingerprint,
             semantic_fingerprint, run_id, at, payload_json
      FROM approval_review_events
      WHERE run_id = ? AND append_sequence > ?
      ORDER BY append_sequence ASC
      LIMIT ?
    `).all(runId, afterSequence, limit) as unknown as EventRow[];
    return Object.freeze(rows.map((row) => this.fromRow(row)));
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private nextAppendSequence(): number {
    const row = this.database.prepare('SELECT COALESCE(MAX(append_sequence), 0) AS last_sequence FROM approval_review_events').get() as unknown as { last_sequence: number };
    return row.last_sequence + 1;
  }

  private findByEventId(eventId: string): StoredEntry | undefined {
    const row = this.database.prepare(`
      SELECT event_id, idempotency_key, append_sequence, fingerprint,
             semantic_fingerprint, run_id, at, payload_json
      FROM approval_review_events WHERE event_id = ?
    `).get(eventId) as unknown as EventRow | undefined;
    return row ? this.fromStoredRow(row) : undefined;
  }

  private findByIdempotencyKey(idempotencyKey: string): StoredEntry | undefined {
    const row = this.database.prepare(`
      SELECT event_id, idempotency_key, append_sequence, fingerprint,
             semantic_fingerprint, run_id, at, payload_json
      FROM approval_review_events WHERE idempotency_key = ?
    `).get(idempotencyKey) as unknown as EventRow | undefined;
    return row ? this.fromStoredRow(row) : undefined;
  }

  private insert(entry: StoredEntry): void {
    this.database.prepare(`
      INSERT INTO approval_review_events (
        event_id, idempotency_key, append_sequence, fingerprint,
        semantic_fingerprint, run_id, at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.event.eventId,
      entry.event.idempotencyKey,
      entry.event.appendSequence,
      entry.fingerprint,
      entry.semanticFingerprint,
      entry.event.runId,
      entry.event.at,
      encodeJson(entry.event),
    );
  }

  private fromStoredRow(row: EventRow): StoredEntry {
    const event = this.fromRow(row);
    return { event, fingerprint: row.fingerprint, semanticFingerprint: row.semantic_fingerprint };
  }

  private fromRow(row: EventRow): ApprovalReviewEvent {
    try {
      return ApprovalReviewEventSchema.parse(JSON.parse(row.payload_json));
    } catch (error) {
      throw new SqliteApprovalReviewEventStoreError('stored approval review event failed contract validation', { cause: error });
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new SqliteApprovalReviewEventStoreError('approval review event store is closed');
  }
}

function validateReadOptions(afterSequence: number, limit: number): void {
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new SqliteApprovalReviewEventStoreError('afterSequence must be a non-negative integer');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_READ_LIMIT) throw new SqliteApprovalReviewEventStoreError(`limit must be between 1 and ${MAX_READ_LIMIT}`);
}

function encodeJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('undefined value');
    return encoded;
  } catch (error) {
    throw new SqliteApprovalReviewEventStoreError('approval review event is not JSON serializable', { cause: error });
  }
}
