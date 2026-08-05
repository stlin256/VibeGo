import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { NewGoalEvent, StoredGoalEvent } from '@ready4vibe/contracts';
import { parseNewGoalEvent, parseStoredGoalEvent } from '@ready4vibe/contracts';

export class SqliteGoalEventStoreError extends Error {
  readonly code = 'GOAL_EVENT_STORAGE_ERROR';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteGoalEventStoreError';
  }
}

export class SqliteGoalEventConflictError extends Error {
  readonly code = 'GOAL_EVENT_CONFLICT';

  constructor(readonly eventId: string) {
    super('A goal event id was already used with different content.');
    this.name = 'SqliteGoalEventConflictError';
  }
}

/** JSON canonicalization shared by the SQLite adapter's conflict check. */
export function canonicalGoalJson(value: unknown): string {
  if (value === undefined) throw new SqliteGoalEventStoreError('value is not JSON serializable');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new SqliteGoalEventStoreError('value is not JSON serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalGoalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalGoalJson(record[key])}`).join(',')}}`;
}

export function fingerprintGoalEvent(event: NewGoalEvent | StoredGoalEvent): string {
  const { appendSequence: _appendSequence, ...withoutSequence } = event as StoredGoalEvent;
  return createHash('sha256').update(canonicalGoalJson(withoutSequence)).digest('hex');
}

type GoalEventRow = {
  goal_id: string;
  append_sequence: number;
  event_id: string;
  fingerprint: string;
  schema_version: string;
  event_type: string;
  recorded_at: string;
  producer: string;
  privacy: string;
  projection_version: string;
  refs_json: string;
  payload_json: string;
};

export interface GoalEventStoreLike {
  append<TPayload = Record<string, unknown>>(event: NewGoalEvent<TPayload>): Promise<StoredGoalEvent<TPayload>>;
  appendBatch<TPayload = Record<string, unknown>>(events: readonly NewGoalEvent<TPayload>[]): Promise<StoredGoalEvent<TPayload>[]>;
  read<TPayload = Record<string, unknown>>(goalId: string, afterSequence?: number): Promise<StoredGoalEvent<TPayload>[]>;
  lastSequence(goalId: string): number;
  close(): void;
}

/**
 * Durable goal-local event store. It owns only `goal_events`; the existing
 * run-centric `run_events` table and its sequence namespace are untouched.
 */
export class SqliteGoalEventStore implements GoalEventStoreLike {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string | URL) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS goal_events (
        goal_id TEXT NOT NULL,
        append_sequence INTEGER NOT NULL CHECK (append_sequence > 0),
        event_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        control_revision INTEGER NOT NULL DEFAULT 0,
        schema_version TEXT NOT NULL,
        event_type TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        producer TEXT NOT NULL,
        privacy TEXT NOT NULL,
        projection_version TEXT NOT NULL,
        refs_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE (goal_id, append_sequence)
      );
      CREATE INDEX IF NOT EXISTS goal_events_goal_seq_idx ON goal_events (goal_id, append_sequence);
    `);
    this.ensureControlRevisionColumn();
  }

  async append<TPayload = Record<string, unknown>>(event: NewGoalEvent<TPayload>): Promise<StoredGoalEvent<TPayload>> {
    this.ensureOpen();
    const parsed = parseNewGoalEvent(event);
    const fingerprint = fingerprintGoalEvent(parsed);
    return this.transaction(() => {
      const existing = this.findByEventId(parsed.eventId);
      if (existing) return this.resolveExisting(parsed, fingerprint, existing) as StoredGoalEvent<TPayload>;
      const stored = this.toStored(parsed, this.nextSequence(parsed.goalId));
      this.insert(stored, fingerprint);
      return stored as StoredGoalEvent<TPayload>;
    });
  }

  async appendBatch<TPayload = Record<string, unknown>>(events: readonly NewGoalEvent<TPayload>[]): Promise<StoredGoalEvent<TPayload>[]> {
    this.ensureOpen();
    if (events.length === 0) return [];
    const parsed = events.map((event) => parseNewGoalEvent(event));
    const goalId = parsed[0]?.goalId;
    if (!goalId || parsed.some((event) => event.goalId !== goalId)) throw new SqliteGoalEventStoreError('appendBatch requires a non-empty single goalId');

    return this.transaction(() => {
      const planned = new Map<string, { fingerprint: string; stored: StoredGoalEvent }>();
      const result: StoredGoalEvent[] = [];
      let nextSequence = this.nextSequence(goalId);
      for (const event of parsed) {
        const fingerprint = fingerprintGoalEvent(event);
        const existingRow = this.findByEventId(event.eventId);
        const plannedEntry = planned.get(event.eventId);
        const existing = existingRow?.stored ?? plannedEntry?.stored;
        if (existing) {
          const existingFingerprint = existingRow?.fingerprint ?? plannedEntry?.fingerprint;
          if (existingFingerprint !== fingerprint) throw new SqliteGoalEventConflictError(event.eventId);
          result.push(existing);
          continue;
        }
        const stored = this.toStored(event, nextSequence++);
        planned.set(event.eventId, { fingerprint, stored });
        result.push(stored);
      }
      for (const entry of planned.values()) this.insert(entry.stored, entry.fingerprint);
      return result as StoredGoalEvent<TPayload>[];
    });
  }

  async read<TPayload = Record<string, unknown>>(goalId: string, afterSequence = 0): Promise<StoredGoalEvent<TPayload>[]> {
    this.ensureOpen();
    this.validateCursor(afterSequence);
    const rows = this.database.prepare(`
      SELECT goal_id, append_sequence, event_id, fingerprint, schema_version, event_type,
             recorded_at, producer, privacy, projection_version, refs_json, payload_json
      FROM goal_events
      WHERE goal_id = ? AND append_sequence > ?
      ORDER BY append_sequence ASC
    `).all(goalId, afterSequence) as unknown as GoalEventRow[];
    return rows.map((row) => this.fromRow<TPayload>(row));
  }

  listGoalIds(): readonly string[] {
    this.ensureOpen();
    const rows = this.database.prepare('SELECT goal_id FROM goal_events GROUP BY goal_id ORDER BY MIN(append_sequence) ASC, goal_id ASC').all() as unknown as Array<{ goal_id: string }>;
    return Object.freeze(rows.map((row) => row.goal_id));
  }

  lastSequence(goalId: string): number {
    this.ensureOpen();
    return this.nextSequence(goalId) - 1;
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
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original domain/SQLite error.
      }
      throw error;
    }
  }

  private findByEventId(eventId: string): { fingerprint: string; stored: StoredGoalEvent } | undefined {
    const row = this.database.prepare(`
      SELECT goal_id, append_sequence, event_id, fingerprint, schema_version, event_type,
             recorded_at, producer, privacy, projection_version, refs_json, payload_json
      FROM goal_events WHERE event_id = ?
    `).get(eventId) as unknown as GoalEventRow | undefined;
    if (!row) return undefined;
    return { fingerprint: row.fingerprint, stored: this.fromRow(row) };
  }

  private resolveExisting(event: NewGoalEvent, fingerprint: string, existing: { fingerprint: string; stored: StoredGoalEvent }): StoredGoalEvent {
    if (existing.fingerprint !== fingerprint) throw new SqliteGoalEventConflictError(event.eventId);
    return existing.stored;
  }

  private nextSequence(goalId: string): number {
    const row = this.database.prepare('SELECT COALESCE(MAX(append_sequence), 0) AS last_sequence FROM goal_events WHERE goal_id = ?').get(goalId) as unknown as { last_sequence: number };
    return row.last_sequence + 1;
  }

  private insert(event: StoredGoalEvent, fingerprint: string): void {
    this.database.prepare(`
      INSERT INTO goal_events (
        goal_id, append_sequence, event_id, fingerprint, schema_version, event_type,
        recorded_at, producer, privacy, projection_version, refs_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.goalId,
      event.appendSequence,
      event.eventId,
      fingerprint,
      event.schemaVersion,
      event.eventType,
      event.recordedAt,
      event.producer,
      event.privacy,
      event.projectionVersion,
      this.encodeJson(event.refs, 'refs'),
      this.encodeJson(event.payload, 'payload'),
    );
  }

  private toStored(event: NewGoalEvent, appendSequence: number): StoredGoalEvent {
    return { ...event, appendSequence };
  }

  private fromRow<TPayload = Record<string, unknown>>(row: GoalEventRow): StoredGoalEvent<TPayload> {
    try {
      return parseStoredGoalEvent({
        schemaVersion: row.schema_version,
        eventId: row.event_id,
        goalId: row.goal_id,
        eventType: row.event_type,
        recordedAt: row.recorded_at,
        producer: row.producer,
        privacy: row.privacy,
        projectionVersion: row.projection_version,
        refs: JSON.parse(row.refs_json),
        payload: JSON.parse(row.payload_json),
        appendSequence: row.append_sequence,
      }) as StoredGoalEvent<TPayload>;
    } catch (error) {
      throw new SqliteGoalEventStoreError('stored goal event failed contract validation', { cause: error });
    }
  }

  private encodeJson(value: unknown, label: string): string {
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new Error('undefined value');
      return encoded;
    } catch (error) {
      throw new SqliteGoalEventStoreError(`${label} must be JSON serializable`, { cause: error });
    }
  }

  private validateCursor(afterSequence: number): void {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new SqliteGoalEventStoreError('afterSequence must be a non-negative integer');
  }

  private ensureOpen(): void {
    if (this.closed) throw new SqliteGoalEventStoreError('goal event store is closed');
  }

  private ensureControlRevisionColumn(): void {
    const columns = this.database.prepare('PRAGMA table_info(goal_events)').all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'control_revision')) {
      this.database.exec('ALTER TABLE goal_events ADD COLUMN control_revision INTEGER NOT NULL DEFAULT 0');
    }
  }
}
