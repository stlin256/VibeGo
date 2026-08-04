import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BackupManifestSchema,
  RestorePlanSchema,
  type BackupManifest,
  type RestorePlan,
} from '@ready4vibe/contracts';

const DEFAULT_MAX_SNAPSHOT_BYTES = 5_000_000_000;
const SQLITE_INTEGRITY_OK = 'ok';

export type SqliteRestorePreflightErrorCode =
  | 'INVALID_OPTIONS'
  | 'MANIFEST_INVALID'
  | 'UNSUPPORTED_ENCRYPTION'
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_INVALID'
  | 'TARGET_MISSING'
  | 'TARGET_INVALID'
  | 'DESTINATION_EQUALS_SOURCE'
  | 'SIZE_LIMIT'
  | 'SIZE_MISMATCH'
  | 'DIGEST_FAILED'
  | 'DIGEST_MISMATCH'
  | 'INTEGRITY_FAILED'
  | 'SCHEMA_MISMATCH';

export class SqliteRestorePreflightError extends Error {
  constructor(readonly code: SqliteRestorePreflightErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteRestorePreflightError';
  }
}

export interface SqliteRestorePreflightOptions {
  /** Internal host path; it is never copied into the RestorePlan contract. */
  readonly snapshotPath: string | URL;
  /** Existing current database; opened read-only to preserve it during preflight. */
  readonly targetDatabasePath: string | URL;
  /** Raw manifest input is parsed again at the trust boundary. */
  readonly manifest: unknown;
  readonly targetProductVersion: string;
  readonly targetDatabaseSchemaVersion: number;
  readonly planId?: string;
  readonly createdAt?: string;
  readonly maxSnapshotBytes?: number;
}

/**
 * Read-only restore validation for a SQLite backup snapshot.
 *
 * This adapter deliberately stops at a reviewable RestorePlan. It never copies
 * or deletes a database, runs a migration, changes a data pointer, writes a
 * RestoreResult, imports credentials/workspace files or touches event stores.
 */
export class SqliteRestorePreflightAdapter {
  async preflight(options: SqliteRestorePreflightOptions): Promise<RestorePlan> {
    const normalized = normalizeOptions(options);
    const snapshotPath = toAbsolutePath(normalized.snapshotPath);
    const targetPath = toAbsolutePath(normalized.targetDatabasePath);
    if (snapshotPath === targetPath) {
      throw new SqliteRestorePreflightError(
        'DESTINATION_EQUALS_SOURCE',
        'restore snapshot and current database must be different files',
      );
    }

    const manifest = normalized.manifest;
    if (manifest.encryption !== 'none') {
      throw new SqliteRestorePreflightError(
        'UNSUPPORTED_ENCRYPTION',
        'encrypted backup snapshots are not supported by this preflight adapter',
      );
    }

    const snapshotStat = await requireFile(snapshotPath, 'snapshot');
    if (snapshotStat.size <= 0 || snapshotStat.size > normalized.maxSnapshotBytes) {
      throw new SqliteRestorePreflightError('SIZE_LIMIT', 'SQLite snapshot exceeds the configured size bound');
    }

    const sqliteEntry = manifest.entries.find((entry) => entry.dataClass === 'sqlite-database');
    if (!sqliteEntry) {
      throw new SqliteRestorePreflightError('MANIFEST_INVALID', 'backup manifest has no SQLite database entry');
    }
    if (snapshotStat.size !== sqliteEntry.sizeBytes) {
      throw new SqliteRestorePreflightError('SIZE_MISMATCH', 'SQLite snapshot size does not match its manifest');
    }

    const digest = await hashFile(snapshotPath);
    if (digest !== sqliteEntry.digest) {
      throw new SqliteRestorePreflightError('DIGEST_MISMATCH', 'SQLite snapshot digest does not match its manifest');
    }

    const snapshot = openReadOnly(snapshotPath, 'snapshot');
    try {
      assertIntegrity(snapshot, 'snapshot');
      assertSchemaVersion(snapshot, manifest.databaseSchemaVersion, 'snapshot');
    } finally {
      snapshot.close();
    }

    await requireFile(targetPath, 'target');
    const target = openReadOnly(targetPath, 'target');
    try {
      assertIntegrity(target, 'target');
      assertSchemaVersion(target, normalized.targetDatabaseSchemaVersion, 'target');
    } finally {
      target.close();
    }

    return buildRestorePlan(normalized, manifest);
  }
}

interface NormalizedOptions {
  readonly snapshotPath: string | URL;
  readonly targetDatabasePath: string | URL;
  readonly manifest: BackupManifest;
  readonly targetProductVersion: string;
  readonly targetDatabaseSchemaVersion: number;
  readonly planId: string;
  readonly createdAt: string;
  readonly maxSnapshotBytes: number;
}

function normalizeOptions(options: SqliteRestorePreflightOptions): NormalizedOptions {
  if (!options || typeof options !== 'object') {
    throw new SqliteRestorePreflightError('INVALID_OPTIONS', 'restore preflight options are required');
  }

  const maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
  if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes <= 0 || maxSnapshotBytes > DEFAULT_MAX_SNAPSHOT_BYTES) {
    throw new SqliteRestorePreflightError('INVALID_OPTIONS', 'maxSnapshotBytes is outside the safe bound');
  }

  let manifest: BackupManifest;
  try {
    manifest = BackupManifestSchema.parse(options.manifest);
  } catch (error) {
    throw new SqliteRestorePreflightError('MANIFEST_INVALID', 'backup manifest is invalid', { cause: error });
  }

  if (!Number.isSafeInteger(options.targetDatabaseSchemaVersion) || options.targetDatabaseSchemaVersion < 0 || options.targetDatabaseSchemaVersion > 1_000_000) {
    throw new SqliteRestorePreflightError('INVALID_OPTIONS', 'target database schema version is outside the safe bound');
  }

  const planId = options.planId ?? `restore_${randomUUID()}`;
  const createdAt = options.createdAt ?? new Date().toISOString();
  return {
    snapshotPath: options.snapshotPath,
    targetDatabasePath: options.targetDatabasePath,
    manifest,
    targetProductVersion: options.targetProductVersion,
    targetDatabaseSchemaVersion: options.targetDatabaseSchemaVersion,
    planId,
    createdAt,
    maxSnapshotBytes,
  };
}

function buildRestorePlan(options: NormalizedOptions, manifest: BackupManifest): RestorePlan {
  const sourceSchema = manifest.databaseSchemaVersion;
  const targetSchema = options.targetDatabaseSchemaVersion;
  const compatibility = targetSchema === sourceSchema
    ? 'compatible'
    : targetSchema > sourceSchema
      ? 'requires-migration'
      : 'blocked';

  const warnings = compatibility === 'requires-migration'
    ? ['target database schema requires a forward migration before restore']
    : compatibility === 'blocked'
      ? ['target database schema is older than the snapshot; downgrade restore is unsupported']
      : [];

  const excludedDataClasses = manifest.entries
    .filter((entry) => entry.dataClass !== 'sqlite-database')
    .map((entry) => entry.dataClass);
  if (excludedDataClasses.length > 0) {
    warnings.push('non-SQLite backup data classes are excluded from this preflight');
  }

  try {
    return RestorePlanSchema.parse({
      schemaVersion: 'ready4vibe_restore_plan_v1',
      planId: options.planId,
      sourceBackupId: manifest.backupId,
      sourceProductVersion: manifest.productVersion,
      targetProductVersion: options.targetProductVersion,
      sourceDatabaseSchemaVersion: sourceSchema,
      targetDatabaseSchemaVersion: targetSchema,
      compatibility,
      confirmationRequired: true,
      preserveCurrent: true,
      importCredentials: false,
      importWorkspaceFiles: false,
      workspaceBindings: [],
      excludedDataClasses,
      warnings,
      createdAt: options.createdAt,
    });
  } catch (error) {
    throw new SqliteRestorePreflightError('INVALID_OPTIONS', 'restore plan metadata is invalid', { cause: error });
  }
}

function toAbsolutePath(value: string | URL): string {
  try {
    return resolve(typeof value === 'string' ? value : fileURLToPath(value));
  } catch (error) {
    throw new SqliteRestorePreflightError('INVALID_OPTIONS', 'restore path is invalid', { cause: error });
  }
}

async function requireFile(path: string, label: 'snapshot' | 'target'): Promise<Awaited<ReturnType<typeof stat>>> {
  let result: Awaited<ReturnType<typeof stat>>;
  try {
    result = await stat(path);
  } catch (error) {
    throw new SqliteRestorePreflightError(label === 'snapshot' ? 'SNAPSHOT_MISSING' : 'TARGET_MISSING', `${label} database does not exist`, { cause: error });
  }
  if (!result.isFile()) {
    throw new SqliteRestorePreflightError(label === 'snapshot' ? 'SNAPSHOT_INVALID' : 'TARGET_INVALID', `${label} database is not a file`);
  }
  return result;
}

function openReadOnly(path: string, label: 'snapshot' | 'target'): DatabaseSync {
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw new SqliteRestorePreflightError('INTEGRITY_FAILED', `${label} SQLite database could not be opened read-only`, { cause: error });
  }
}

function assertIntegrity(database: DatabaseSync, label: 'snapshot' | 'target'): void {
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as unknown as { integrity_check?: unknown };
    if (row?.integrity_check !== SQLITE_INTEGRITY_OK) {
      throw new SqliteRestorePreflightError('INTEGRITY_FAILED', `${label} SQLite integrity check failed`);
    }
  } catch (error) {
    if (error instanceof SqliteRestorePreflightError) throw error;
    throw new SqliteRestorePreflightError('INTEGRITY_FAILED', `${label} SQLite integrity check failed`, { cause: error });
  }
}

function assertSchemaVersion(database: DatabaseSync, expected: number, label: 'snapshot' | 'target'): void {
  try {
    const row = database.prepare('PRAGMA user_version').get() as unknown as { user_version?: unknown };
    if (row?.user_version !== expected) {
      throw new SqliteRestorePreflightError('SCHEMA_MISMATCH', `${label} SQLite user_version does not match the expected schema`);
    }
  } catch (error) {
    if (error instanceof SqliteRestorePreflightError) throw error;
    throw new SqliteRestorePreflightError('SCHEMA_MISMATCH', `${label} SQLite schema could not be read`, { cause: error });
  }
}

async function hashFile(path: string): Promise<string> {
  try {
    const hash = createHash('sha256');
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
    for await (const chunk of stream) hash.update(chunk);
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    throw new SqliteRestorePreflightError('DIGEST_FAILED', 'SQLite snapshot digest could not be computed', { cause: error });
  }
}
