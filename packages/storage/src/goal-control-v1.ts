import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type {
  NewGoalControlEventV1,
  StoredGoalControlEventV1,
  StoredGoalEvent,
} from '@ready4vibe/contracts';
import {
  NewGoalControlEventV1Schema,
  StoredGoalControlEventV1Schema,
  StoredGoalEventSchema,
} from '@ready4vibe/contracts';

export class SqliteGoalControlV1StoreError extends Error {
  readonly code: string = 'GOAL_V1_EVENT_STORAGE_ERROR';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteGoalControlV1StoreError';
  }
}

export class SqliteGoalControlV1ConflictError extends SqliteGoalControlV1StoreError {
  override readonly code = 'GOAL_V1_EVENT_CONFLICT';

  constructor(readonly eventId: string) {
    super('A Goal Control v1 event id was already used with different content.');
    this.name = 'SqliteGoalControlV1ConflictError';
  }
}

type ReplayEvent = StoredGoalEvent | StoredGoalControlEventV1;
type GoalEventRow = {
  goal_id: string;
  append_sequence: number;
  event_id: string;
  fingerprint: string;
  control_revision: number;
  schema_version: string;
  event_type: string;
  recorded_at: string;
  producer: string;
  privacy: string;
  projection_version: string;
  refs_json: string;
  payload_json: string;
};

/**
 * SQLite adapter for additive Goal Control v1 events. It shares the existing
 * `goal_events` table and never touches `run_events`; v0 rows are decoded for
 * mixed replay but only validated v1 events can be appended through this port.
 */
export class SqliteGoalControlV1EventStore {
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

  async append(event: NewGoalControlEventV1): Promise<StoredGoalControlEventV1> {
    this.ensureOpen();
    const parsed = NewGoalControlEventV1Schema.parse(event) as NewGoalControlEventV1;
    const eventFingerprint = fingerprint(parsed);
    return this.transaction(() => {
      const existing = this.findByEventId(parsed.eventId);
      if (existing) {
        if (existing.event.schemaVersion === 'ready4vibe_goal_event_v1' && existing.fingerprint === eventFingerprint) {
          return existing.event;
        }
        throw new SqliteGoalControlV1ConflictError(parsed.eventId);
      }
      const stored: StoredGoalControlEventV1 = { ...parsed, appendSequence: this.nextSequence(parsed.goalId) };
      this.insert(stored, eventFingerprint);
      return stored;
    });
  }

  async appendBatch(events: readonly NewGoalControlEventV1[]): Promise<StoredGoalControlEventV1[]> {
    this.ensureOpen();
    if (events.length === 0) return [];
    const parsed = events.map((event) => NewGoalControlEventV1Schema.parse(event) as NewGoalControlEventV1);
    const goalId = parsed[0]!.goalId;
    if (parsed.some((event) => event.goalId !== goalId)) throw new SqliteGoalControlV1StoreError('appendBatch requires one goal id');
    return this.transaction(() => {
      const planned = new Map<string, { fingerprint: string; event: StoredGoalControlEventV1 }>();
      const result: StoredGoalControlEventV1[] = [];
      let nextSequence = this.nextSequence(goalId);
      for (const event of parsed) {
        const eventFingerprint = fingerprint(event);
        const existing = this.findByEventId(event.eventId);
        const plannedEvent = planned.get(event.eventId);
        if (existing || plannedEvent) {
          const existingEvent = existing?.event ?? plannedEvent!.event;
          const existingFingerprint = existing?.fingerprint ?? plannedEvent!.fingerprint;
          if (existingEvent.schemaVersion !== 'ready4vibe_goal_event_v1' || existingFingerprint !== eventFingerprint) {
            throw new SqliteGoalControlV1ConflictError(event.eventId);
          }
          result.push(existingEvent);
          continue;
        }
        const stored: StoredGoalControlEventV1 = { ...event, appendSequence: nextSequence++ };
        planned.set(event.eventId, { fingerprint: eventFingerprint, event: stored });
        result.push(stored);
      }
      for (const entry of planned.values()) this.insert(entry.event, entry.fingerprint);
      return result;
    });
  }

  async read(goalId: string, afterSequence = 0): Promise<ReplayEvent[]> {
    this.ensureOpen();
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new SqliteGoalControlV1StoreError('afterSequence must be a non-negative integer');
    const rows = this.database.prepare(`
      SELECT goal_id, append_sequence, event_id, fingerprint, control_revision, schema_version,
             event_type, recorded_at, producer, privacy, projection_version, refs_json, payload_json
      FROM goal_events
      WHERE goal_id = ? AND append_sequence > ?
      ORDER BY append_sequence ASC
    `).all(goalId, afterSequence) as unknown as GoalEventRow[];
    return rows.map((row) => this.fromRow(row));
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
        // Preserve the original error.
      }
      throw error;
    }
  }

  private findByEventId(eventId: string): { fingerprint: string; event: ReplayEvent } | undefined {
    const row = this.database.prepare(`
      SELECT goal_id, append_sequence, event_id, fingerprint, control_revision, schema_version,
             event_type, recorded_at, producer, privacy, projection_version, refs_json, payload_json
      FROM goal_events WHERE event_id = ?
    `).get(eventId) as unknown as GoalEventRow | undefined;
    return row ? { fingerprint: row.fingerprint, event: this.fromRow(row) } : undefined;
  }

  private nextSequence(goalId: string): number {
    const row = this.database.prepare('SELECT COALESCE(MAX(append_sequence), 0) AS last_sequence FROM goal_events WHERE goal_id = ?').get(goalId) as unknown as { last_sequence: number };
    return row.last_sequence + 1;
  }

  private insert(event: StoredGoalControlEventV1, eventFingerprint: string): void {
    this.database.prepare(`
      INSERT INTO goal_events (
        goal_id, append_sequence, event_id, fingerprint, control_revision, schema_version,
        event_type, recorded_at, producer, privacy, projection_version, refs_json, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.goalId,
      event.appendSequence,
      event.eventId,
      eventFingerprint,
      event.controlRevision,
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

  private fromRow(row: GoalEventRow): ReplayEvent {
    try {
      const common = {
        eventId: row.event_id,
        goalId: row.goal_id,
        eventType: row.event_type,
        recordedAt: row.recorded_at,
        producer: row.producer,
        privacy: row.privacy,
        refs: JSON.parse(row.refs_json),
        payload: JSON.parse(row.payload_json),
        appendSequence: row.append_sequence,
      };
      if (row.schema_version === 'ready4vibe_goal_event_v1') {
        return StoredGoalControlEventV1Schema.parse({
          schemaVersion: row.schema_version,
          projectionVersion: row.projection_version,
          controlRevision: row.control_revision,
          ...common,
        }) as StoredGoalControlEventV1;
      }
      return StoredGoalEventSchema.parse({
        schemaVersion: row.schema_version,
        projectionVersion: row.projection_version,
        ...common,
      }) as StoredGoalEvent;
    } catch (error) {
      throw new SqliteGoalControlV1StoreError('stored Goal event failed contract validation', { cause: error });
    }
  }

  private encodeJson(value: unknown, label: string): string {
    try {
      const encoded = JSON.stringify(value);
      if (encoded === undefined) throw new Error('undefined value');
      return encoded;
    } catch (error) {
      throw new SqliteGoalControlV1StoreError(`${label} must be JSON serializable`, { cause: error });
    }
  }

  private ensureControlRevisionColumn(): void {
    const columns = this.database.prepare('PRAGMA table_info(goal_events)').all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'control_revision')) {
      this.database.exec('ALTER TABLE goal_events ADD COLUMN control_revision INTEGER NOT NULL DEFAULT 0');
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new SqliteGoalControlV1StoreError('goal event store is closed');
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function fingerprint(event: NewGoalControlEventV1 | StoredGoalControlEventV1): string {
  const { appendSequence: _appendSequence, ...withoutSequence } = event as StoredGoalControlEventV1;
  return createHash('sha256').update(canonicalJson(withoutSequence)).digest('hex');
}
