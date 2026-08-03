import { DatabaseSync } from 'node:sqlite';
import { v7 as uuidv7 } from 'uuid';
import type { EventStore, NewDomainEvent, StoredEvent } from '@ready4vibe/contracts';

export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, StoredEvent[]>();

  async append<TPayload>(event: NewDomainEvent<TPayload>): Promise<StoredEvent<TPayload>> {
    const stored = this.buildStored(event);
    const current = this.events.get(event.runId) ?? [];
    current.push(stored as StoredEvent);
    this.events.set(event.runId, current);
    return stored;
  }

  async appendBatch<TPayload>(events: readonly NewDomainEvent<TPayload>[]): Promise<StoredEvent<TPayload>[]> {
    if (events.length === 0) return [];
    const runId = events[0]?.runId;
    if (!runId || events.some((event) => event.runId !== runId)) {
      throw new Error('appendBatch requires a non-empty single runId');
    }

    const current = this.events.get(runId) ?? [];
    const stored = events.map((event, index) => ({
      ...event,
      version: 1 as const,
      id: `evt_${uuidv7()}`,
      seq: current.length + index + 1,
      at: new Date().toISOString(),
    }));
    this.events.set(runId, [...current, ...(stored as StoredEvent[])]);
    return stored;
  }

  async read<TPayload = unknown>(runId: string, afterSeq = 0): Promise<StoredEvent<TPayload>[]> {
    return (this.events.get(runId) ?? []).filter((event) => event.seq > afterSeq) as StoredEvent<TPayload>[];
  }

  listRunIds(): readonly string[] {
    return Object.freeze([...this.events.keys()]);
  }

  lastSeq(runId: string): number {
    return this.events.get(runId)?.at(-1)?.seq ?? 0;
  }

  private buildStored<TPayload>(event: NewDomainEvent<TPayload>): StoredEvent<TPayload> {
    return {
      ...event,
      version: 1,
      id: `evt_${uuidv7()}`,
      seq: this.lastSeq(event.runId) + 1,
      at: new Date().toISOString(),
    };
  }
}

type SqliteEventRow = {
  run_id: string;
  type: string;
  source: StoredEvent['source'];
  correlation_id: string;
  payload_json: string;
  version: number;
  id: string;
  seq: number;
  at: string;
};

/**
 * Durable EventStore backed by the SQLite engine shipped with Node 22+.
 *
 * The adapter deliberately keeps the same async port as InMemoryEventStore;
 * SQLite calls are synchronous inside the daemon process, while callers can
 * use one storage abstraction for both production and deterministic tests.
 */
export class SqliteEventStore implements EventStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string | URL) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        correlation_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        at TEXT NOT NULL,
        UNIQUE (run_id, seq)
      );
      CREATE INDEX IF NOT EXISTS run_events_run_seq_idx ON run_events (run_id, seq);
    `);
  }

  async append<TPayload>(event: NewDomainEvent<TPayload>): Promise<StoredEvent<TPayload>> {
    this.ensureOpen();
    const stored = this.toStored(event, this.lastSeq(event.runId) + 1);
    this.insert(stored);
    return stored;
  }

  async appendBatch<TPayload>(events: readonly NewDomainEvent<TPayload>[]): Promise<StoredEvent<TPayload>[]> {
    this.ensureOpen();
    if (events.length === 0) return [];
    const runId = events[0]?.runId;
    if (!runId || events.some((event) => event.runId !== runId)) {
      throw new Error('appendBatch requires a non-empty single runId');
    }

    this.database.exec('BEGIN IMMEDIATE');
    try {
      const firstSeq = this.lastSeq(runId);
      const stored = events.map((event, index) => this.toStored(event, firstSeq + index + 1));
      for (const event of stored) this.insert(event);
      this.database.exec('COMMIT');
      return stored;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original serialization/SQLite error.
      }
      throw error;
    }
  }

  async read<TPayload = unknown>(runId: string, afterSeq = 0): Promise<StoredEvent<TPayload>[]> {
    this.ensureOpen();
    const rows = this.database
      .prepare(`
        SELECT run_id, seq, id, version, type, source, correlation_id, payload_json, at
        FROM run_events
        WHERE run_id = ? AND seq > ?
        ORDER BY seq ASC
      `)
      .all(runId, afterSeq) as unknown as SqliteEventRow[];
    return rows.map((row) => this.fromRow<TPayload>(row));
  }

  listRunIds(): readonly string[] {
    this.ensureOpen();
    const rows = this.database
      .prepare('SELECT run_id FROM run_events GROUP BY run_id ORDER BY MIN(seq) ASC, run_id ASC')
      .all() as unknown as Array<{ run_id: string }>;
    return Object.freeze(rows.map((row) => row.run_id));
  }

  lastSeq(runId: string): number {
    this.ensureOpen();
    const row = this.database
      .prepare('SELECT COALESCE(MAX(seq), 0) AS last_seq FROM run_events WHERE run_id = ?')
      .get(runId) as unknown as { last_seq: number };
    return row.last_seq;
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private insert(event: StoredEvent): void {
    this.database
      .prepare(`
        INSERT INTO run_events (
          run_id, seq, id, version, type, source, correlation_id, payload_json, at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        event.runId,
        event.seq,
        event.id,
        event.version,
        event.type,
        event.source,
        event.correlationId,
        this.encodePayload(event.payload),
        event.at,
      );
  }

  private toStored<TPayload>(event: NewDomainEvent<TPayload>, seq: number): StoredEvent<TPayload> {
    // Serialize before mutating the database so cyclic/non-JSON payloads fail
    // deterministically and appendBatch can roll back all prior inserts.
    this.encodePayload(event.payload);
    return {
      ...event,
      version: 1,
      id: `evt_${uuidv7()}`,
      seq,
      at: new Date().toISOString(),
    };
  }

  private fromRow<TPayload>(row: SqliteEventRow): StoredEvent<TPayload> {
    return {
      runId: row.run_id,
      type: row.type,
      source: row.source,
      correlationId: row.correlation_id,
      payload: JSON.parse(row.payload_json) as TPayload,
      version: row.version as 1,
      id: row.id,
      seq: row.seq,
      at: row.at,
    };
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('event store is closed');
  }

  private encodePayload(payload: unknown): string {
    try {
      const encoded = JSON.stringify(payload);
      if (encoded === undefined) throw new Error('undefined payload');
      return encoded;
    } catch (error) {
      throw new Error('event payload must be JSON serializable', { cause: error });
    }
  }
}

export * from './goal.js';
