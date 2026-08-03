import { DatabaseSync } from 'node:sqlite';

const NAME_PATTERN = /^[a-z][a-z0-9._-]{0,63}$/u;
const MAX_VALUE_BYTES = 256 * 1024;
const SECRET_KEY = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token|environment|env)/iu;

export type SettingsStoreErrorCode =
  | 'SETTINGS_CLOSED'
  | 'SETTINGS_INVALID_NAME'
  | 'SETTINGS_NOT_SERIALIZABLE'
  | 'SETTINGS_TOO_LARGE'
  | 'SETTINGS_SECRET_FIELD'
  | 'SETTINGS_CORRUPT';

export class SettingsStoreError extends Error {
  constructor(readonly code: SettingsStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SettingsStoreError';
  }
}

export interface SettingsStore {
  get<T = unknown>(namespace: string, key: string): T | undefined;
  set(namespace: string, key: string, value: unknown): void;
  delete(namespace: string, key: string): void;
  close(): void;
}

type SettingsRow = {
  namespace: string;
  setting_key: string;
  schema_version: number;
  value_json: string;
};

/**
 * Small synchronous settings adapter backed by the Node SQLite engine. It is
 * deliberately not an EventStore: values are versioned snapshots, not an
 * append-only domain stream.
 */
export class SqliteSettingsStore implements SettingsStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(databasePath: string | URL) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS daemon_settings (
        namespace TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (namespace, setting_key)
      );
    `);
  }

  get<T = unknown>(namespace: string, key: string): T | undefined {
    this.ensureOpen();
    validateName(namespace, 'namespace');
    validateName(key, 'key');
    const row = this.database.prepare(`
      SELECT namespace, setting_key, schema_version, value_json
      FROM daemon_settings
      WHERE namespace = ? AND setting_key = ?
    `).get(namespace, key) as unknown as SettingsRow | undefined;
    if (!row) return undefined;
    if (row.schema_version !== 1) throw new SettingsStoreError('SETTINGS_CORRUPT', 'Stored settings use an unsupported schema version.');
    try {
      const value = JSON.parse(row.value_json) as unknown;
      validateValue(value);
      return value as T;
    } catch (error) {
      if (error instanceof SettingsStoreError) throw error;
      throw new SettingsStoreError('SETTINGS_CORRUPT', 'Stored settings are not valid JSON.', { cause: error });
    }
  }

  set(namespace: string, key: string, value: unknown): void {
    this.ensureOpen();
    validateName(namespace, 'namespace');
    validateName(key, 'key');
    const encoded = encodeValue(value);
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO daemon_settings (namespace, setting_key, schema_version, value_json, updated_at)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(namespace, setting_key) DO UPDATE SET
          schema_version = excluded.schema_version,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).run(namespace, key, encoded, new Date().toISOString());
    });
  }

  delete(namespace: string, key: string): void {
    this.ensureOpen();
    validateName(namespace, 'namespace');
    validateName(key, 'key');
    this.transaction(() => {
      this.database.prepare('DELETE FROM daemon_settings WHERE namespace = ? AND setting_key = ?').run(namespace, key);
    });
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      operation();
      this.database.exec('COMMIT');
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new SettingsStoreError('SETTINGS_CLOSED', 'Settings store is closed.');
  }
}

/** Deterministic test double with the same validation and snapshot semantics. */
export class InMemorySettingsStore implements SettingsStore {
  private readonly values = new Map<string, string>();
  private closed = false;

  get<T = unknown>(namespace: string, key: string): T | undefined {
    this.ensureOpen();
    validateName(namespace, 'namespace');
    validateName(key, 'key');
    const encoded = this.values.get(this.compositeKey(namespace, key));
    if (encoded === undefined) return undefined;
    const value = JSON.parse(encoded) as unknown;
    validateValue(value);
    return value as T;
  }

  set(namespace: string, key: string, value: unknown): void {
    this.ensureOpen();
    validateName(namespace, 'namespace');
    validateName(key, 'key');
    this.values.set(this.compositeKey(namespace, key), encodeValue(value));
  }

  delete(namespace: string, key: string): void {
    this.ensureOpen();
    validateName(namespace, 'namespace');
    validateName(key, 'key');
    this.values.delete(this.compositeKey(namespace, key));
  }

  close(): void {
    this.closed = true;
  }

  private compositeKey(namespace: string, key: string): string {
    return `${namespace}\u0000${key}`;
  }

  private ensureOpen(): void {
    if (this.closed) throw new SettingsStoreError('SETTINGS_CLOSED', 'Settings store is closed.');
  }
}

function validateName(value: string, label: string): void {
  if (typeof value !== 'string' || !NAME_PATTERN.test(value)) {
    throw new SettingsStoreError('SETTINGS_INVALID_NAME', `Settings ${label} is invalid.`);
  }
  if (SECRET_KEY.test(value)) {
    throw new SettingsStoreError('SETTINGS_SECRET_FIELD', `Secret-shaped settings ${label} is not allowed.`);
  }
}

function encodeValue(value: unknown): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value) ?? '';
  } catch (error) {
    throw new SettingsStoreError('SETTINGS_NOT_SERIALIZABLE', 'Settings value must be JSON serializable.', { cause: error });
  }
  if (encoded.length === 0) throw new SettingsStoreError('SETTINGS_NOT_SERIALIZABLE', 'Settings value must be JSON serializable.');
  if (Buffer.byteLength(encoded, 'utf8') > MAX_VALUE_BYTES) throw new SettingsStoreError('SETTINGS_TOO_LARGE', 'Settings value exceeds the safe size limit.');
  let parsed: unknown;
  try { parsed = JSON.parse(encoded) as unknown; } catch (error) { throw new SettingsStoreError('SETTINGS_NOT_SERIALIZABLE', 'Settings value must be JSON serializable.', { cause: error }); }
  validateValue(parsed);
  return encoded;
}

function validateValue(value: unknown, path: readonly string[] = []): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) validateValue(item, [...path, String(index)]);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new SettingsStoreError('SETTINGS_SECRET_FIELD', `Secret-shaped settings field is not allowed at ${[...path, key].join('.')}.`);
    validateValue(child, [...path, key]);
  }
}

export const SETTINGS_VALUE_LIMIT_BYTES = MAX_VALUE_BYTES;
