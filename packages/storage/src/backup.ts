import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  BackupManifestSchema,
  type BackupManifest,
} from '@ready4vibe/contracts';

const DEFAULT_MAX_SNAPSHOT_BYTES = 5_000_000_000;
const SQLITE_INTEGRITY_OK = 'ok';

export type SqliteBackupErrorCode =
  | 'INVALID_OPTIONS'
  | 'SOURCE_MISSING'
  | 'SOURCE_INVALID'
  | 'DESTINATION_EQUALS_SOURCE'
  | 'DESTINATION_EXISTS'
  | 'SCHEMA_MISMATCH'
  | 'INTEGRITY_FAILED'
  | 'SIZE_LIMIT'
  | 'SNAPSHOT_FAILED'
  | 'DIGEST_FAILED';

export class SqliteBackupError extends Error {
  constructor(readonly code: SqliteBackupErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteBackupError';
  }
}

export interface SqliteBackupSnapshotOptions {
  /** Internal daemon path; it is never serialized into the manifest. */
  readonly databasePath: string | URL;
  /** Internal staging directory controlled by the caller. */
  readonly stagingDirectory: string | URL;
  readonly backupId: string;
  readonly productVersion: string;
  readonly hostRevision: string;
  readonly databaseSchemaVersion: number;
  readonly createdAt?: string;
  readonly maxSnapshotBytes?: number;
}

export interface SqliteBackupSnapshotResult {
  /** Internal path for a later storage/restore service; never a Web field. */
  readonly snapshotPath: string;
  readonly manifest: BackupManifest;
}

/**
 * Creates an immutable, integrity-checked SQLite snapshot and a safe manifest.
 * This adapter intentionally has no Web, restore, migration or event-store
 * integration; callers decide when an explicit backup action is authorized.
 */
export class SqliteBackupSnapshotAdapter {
  async create(options: SqliteBackupSnapshotOptions): Promise<SqliteBackupSnapshotResult> {
    const normalized = normalizeOptions(options);
    const sourcePath = toAbsolutePath(normalized.databasePath);
    const stagingDirectory = toAbsolutePath(normalized.stagingDirectory);
    const snapshotPath = join(stagingDirectory, `${normalized.backupId}.sqlite`);
    if (snapshotPath === sourcePath) throw new SqliteBackupError('DESTINATION_EQUALS_SOURCE', 'backup destination must differ from source');

    await ensureSourceFile(sourcePath);
    await mkdir(stagingDirectory, { recursive: true });
    if (await exists(snapshotPath)) throw new SqliteBackupError('DESTINATION_EXISTS', 'backup destination already exists');

    const temporaryPath = join(stagingDirectory, `.${normalized.backupId}.${randomUUID()}.sqlite.tmp`);
    let database: DatabaseSync | undefined;
    try {
      try {
        database = new DatabaseSync(sourcePath);
        database.exec('PRAGMA busy_timeout = 5000;');
        assertIntegrity(database, 'source');
        assertSchemaVersion(database, normalized.databaseSchemaVersion);
        vacuumInto(database, temporaryPath);
      } catch (error) {
        if (error instanceof SqliteBackupError) throw error;
        throw new SqliteBackupError('SNAPSHOT_FAILED', 'SQLite snapshot could not be created.', { cause: error });
      } finally {
        database?.close();
      }

      const outputStat = await safeStat(temporaryPath);
      if (!outputStat?.isFile()) throw new SqliteBackupError('SNAPSHOT_FAILED', 'SQLite snapshot output is missing');
      if (outputStat.size <= 0 || outputStat.size > normalized.maxSnapshotBytes) {
        throw new SqliteBackupError('SIZE_LIMIT', 'SQLite snapshot exceeds the configured size bound');
      }

      let snapshot: DatabaseSync | undefined;
      try {
        snapshot = new DatabaseSync(temporaryPath);
        assertIntegrity(snapshot, 'snapshot');
        assertSchemaVersion(snapshot, normalized.databaseSchemaVersion);
      } catch (error) {
        if (error instanceof SqliteBackupError) throw error;
        throw new SqliteBackupError('INTEGRITY_FAILED', 'SQLite snapshot integrity check failed.', { cause: error });
      } finally {
        snapshot?.close();
      }

      const digest = await hashFile(temporaryPath);
      const manifest = BackupManifestSchema.parse({
        schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
        backupId: normalized.backupId,
        productVersion: normalized.productVersion,
        hostRevision: normalized.hostRevision,
        databaseSchemaVersion: normalized.databaseSchemaVersion,
        createdAt: normalized.createdAt,
        entries: [{
          dataClass: 'sqlite-database',
          logicalId: null,
          digest,
          sizeBytes: outputStat.size,
          recordCount: null,
        }],
        encryption: 'none',
        includesCredentials: false,
        includesWorkspaceFiles: false,
        includesRawEnvironment: false,
      });

      try {
        await link(temporaryPath, snapshotPath);
      } catch (error) {
        if (await exists(snapshotPath)) throw new SqliteBackupError('DESTINATION_EXISTS', 'backup destination already exists.', { cause: error });
        throw new SqliteBackupError('SNAPSHOT_FAILED', 'SQLite snapshot could not be committed.', { cause: error });
      }
      return { snapshotPath, manifest };
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

interface NormalizedOptions {
  readonly databasePath: string | URL;
  readonly stagingDirectory: string | URL;
  readonly backupId: string;
  readonly productVersion: string;
  readonly hostRevision: string;
  readonly databaseSchemaVersion: number;
  readonly createdAt: string;
  readonly maxSnapshotBytes: number;
}

function normalizeOptions(options: SqliteBackupSnapshotOptions): NormalizedOptions {
  if (!options || typeof options !== 'object') throw new SqliteBackupError('INVALID_OPTIONS', 'backup options are required');
  const maxSnapshotBytes = options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES;
  if (!Number.isSafeInteger(maxSnapshotBytes) || maxSnapshotBytes <= 0 || maxSnapshotBytes > DEFAULT_MAX_SNAPSHOT_BYTES) {
    throw new SqliteBackupError('INVALID_OPTIONS', 'maxSnapshotBytes is outside the safe bound');
  }
  const createdAt = options.createdAt ?? new Date().toISOString();
  try {
    const manifestSeed = BackupManifestSchema.parse({
      schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
      backupId: options.backupId,
      productVersion: options.productVersion,
      hostRevision: options.hostRevision,
      databaseSchemaVersion: options.databaseSchemaVersion,
      createdAt,
      entries: [{ dataClass: 'sqlite-database', logicalId: null, digest: 'sha256:' + '0'.repeat(64), sizeBytes: 1, recordCount: null }],
      encryption: 'none',
      includesCredentials: false,
      includesWorkspaceFiles: false,
      includesRawEnvironment: false,
    });
    return { ...options, createdAt: manifestSeed.createdAt, maxSnapshotBytes };
  } catch (error) {
    throw new SqliteBackupError('INVALID_OPTIONS', 'backup metadata is invalid.', { cause: error });
  }
}

function toAbsolutePath(value: string | URL): string {
  try {
    return resolve(typeof value === 'string' ? value : fileURLToPath(value));
  } catch (error) {
    throw new SqliteBackupError('INVALID_OPTIONS', 'backup path is invalid.', { cause: error });
  }
}

async function ensureSourceFile(sourcePath: string): Promise<void> {
  const source = await safeStat(sourcePath);
  if (!source) throw new SqliteBackupError('SOURCE_MISSING', 'SQLite source database does not exist');
  if (!source.isFile()) throw new SqliteBackupError('SOURCE_INVALID', 'SQLite source database is not a file');
}

async function exists(path: string): Promise<boolean> {
  return (await safeStat(path)) !== undefined;
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function assertIntegrity(database: DatabaseSync, label: 'source' | 'snapshot'): void {
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as unknown as { integrity_check?: unknown };
    if (row?.integrity_check !== SQLITE_INTEGRITY_OK) throw new SqliteBackupError('INTEGRITY_FAILED', `${label} SQLite integrity check failed`);
  } catch (error) {
    if (error instanceof SqliteBackupError) throw error;
    throw new SqliteBackupError('INTEGRITY_FAILED', `${label} SQLite integrity check failed`, { cause: error });
  }
}

function assertSchemaVersion(database: DatabaseSync, expected: number): void {
  const row = database.prepare('PRAGMA user_version').get() as unknown as { user_version?: unknown };
  if (row?.user_version !== expected) throw new SqliteBackupError('SCHEMA_MISMATCH', 'SQLite user_version does not match the requested schema');
}

function vacuumInto(database: DatabaseSync, destination: string): void {
  const quotedPath = destination.replaceAll("'", "''");
  database.exec(`VACUUM INTO '${quotedPath}'`);
}

async function hashFile(path: string): Promise<string> {
  try {
    const hash = createHash('sha256');
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
    for await (const chunk of stream) hash.update(chunk);
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    throw new SqliteBackupError('DIGEST_FAILED', 'SQLite snapshot digest could not be computed.', { cause: error });
  }
}
