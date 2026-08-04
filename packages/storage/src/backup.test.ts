import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteBackupSnapshotAdapter } from './backup.js';

const roots: string[] = [];

async function rootDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ready4vibe-backup-'));
  roots.push(root);
  return root;
}

function createSource(root: string, schemaVersion = 7): string {
  const path = join(root, 'events.sqlite');
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA user_version = ${schemaVersion}; CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records (value) VALUES ('stable');`);
  database.close();
  return path;
}

function options(databasePath: string, stagingDirectory: string, overrides: Partial<Parameters<SqliteBackupSnapshotAdapter['create']>[0]> = {}): Parameters<SqliteBackupSnapshotAdapter['create']>[0] {
  return {
    databasePath,
    stagingDirectory,
    backupId: 'backup_20260805',
    productVersion: '0.1.0',
    hostRevision: 'host-20260805',
    databaseSchemaVersion: 7,
    createdAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteBackupSnapshotAdapter', () => {
  it('creates an immutable integrity-checked snapshot and safe manifest', async () => {
    const root = await rootDirectory();
    const source = createSource(root);
    const staging = join(root, 'snapshots');
    const result = await new SqliteBackupSnapshotAdapter().create(options(source, staging));
    expect(result.snapshotPath).toBe(join(staging, 'backup_20260805.sqlite'));
    expect(result.manifest).toMatchObject({
      schemaVersion: 'ready4vibe_backup_manifest_v1',
      backupId: 'backup_20260805',
      databaseSchemaVersion: 7,
      entries: [{ dataClass: 'sqlite-database', logicalId: null, sizeBytes: expect.any(Number) }],
      includesCredentials: false,
      includesWorkspaceFiles: false,
      includesRawEnvironment: false,
    });
    const bytes = await readFile(result.snapshotPath);
    expect(result.manifest.entries[0]?.digest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    expect(JSON.stringify(result.manifest)).not.toMatch(/C:\\|\/Users\/|api[_-]?key|secret/iu);
    const reopened = new DatabaseSync(result.snapshotPath);
    expect(reopened.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    expect(reopened.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 7 });
    expect(reopened.prepare('SELECT value FROM records').get()).toMatchObject({ value: 'stable' });
    reopened.close();
    await expect(new SqliteBackupSnapshotAdapter().create(options(source, staging))).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
    expect((await readdir(staging)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('keeps existing destinations immutable and cleans failed temporary output', async () => {
    const root = await rootDirectory();
    const source = createSource(root);
    const staging = join(root, 'snapshots');
    await writeFile(join(staging, 'placeholder'), 'existing', 'utf8').catch(() => undefined);
    await expect(new SqliteBackupSnapshotAdapter().create(options(source, staging, { maxSnapshotBytes: 1 }))).rejects.toMatchObject({ code: 'SIZE_LIMIT' });
    expect((await readdir(staging)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    const destination = join(staging, 'backup_20260805.sqlite');
    await writeFile(destination, 'do-not-overwrite', 'utf8');
    await expect(new SqliteBackupSnapshotAdapter().create(options(source, staging))).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
    await expect(readFile(destination, 'utf8')).resolves.toBe('do-not-overwrite');
  });

  it('fails closed for missing/corrupt sources, schema mismatch and source collision', async () => {
    const root = await rootDirectory();
    const adapter = new SqliteBackupSnapshotAdapter();
    await expect(adapter.create(options(join(root, 'missing.sqlite'), join(root, 'snapshots')))).rejects.toMatchObject({ code: 'SOURCE_MISSING' });
    const corrupt = join(root, 'corrupt.sqlite');
    await writeFile(corrupt, 'not sqlite', 'utf8');
    await expect(adapter.create(options(corrupt, join(root, 'corrupt-snapshots')))).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    const source = createSource(root, 8);
    await expect(adapter.create(options(source, join(root, 'schema-snapshots')))).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
    const collision = join(root, 'backup_collision.sqlite');
    await writeFile(collision, 'source', 'utf8');
    await expect(adapter.create(options(collision, root, { backupId: 'backup_collision' }))).rejects.toMatchObject({ code: 'DESTINATION_EQUALS_SOURCE' });
  });

  it('rejects invalid metadata and unsafe output bounds before opening SQLite', async () => {
    const root = await rootDirectory();
    const source = createSource(root);
    const adapter = new SqliteBackupSnapshotAdapter();
    await expect(adapter.create(options(source, join(root, 'snapshots'), { backupId: 'latest' }))).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(adapter.create(options(source, join(root, 'snapshots'), { maxSnapshotBytes: 5_000_000_001 }))).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(adapter.create(options(source, join(root, 'snapshots'), { hostRevision: 'C:\\private\\host' }))).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});
