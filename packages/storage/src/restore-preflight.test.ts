import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteBackupSnapshotAdapter } from './backup.js';
import { SqliteRestorePreflightAdapter } from './restore-preflight.js';

const roots: string[] = [];

async function rootDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ready4vibe-restore-preflight-'));
  roots.push(root);
  return root;
}

function createDatabase(path: string, schemaVersion: number, value: string): void {
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA user_version = ${schemaVersion}; CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);`);
  database.prepare('INSERT INTO records (value) VALUES (?)').run(value);
  database.close();
}

async function fixture(schemaVersion = 7): Promise<{
  root: string;
  source: string;
  snapshotPath: string;
  manifest: Awaited<ReturnType<SqliteBackupSnapshotAdapter['create']>>['manifest'];
}> {
  const root = await rootDirectory();
  const source = join(root, 'current.sqlite');
  createDatabase(source, schemaVersion, 'current');
  const result = await new SqliteBackupSnapshotAdapter().create({
    databasePath: source,
    stagingDirectory: join(root, 'snapshots'),
    backupId: 'backup_20260805',
    productVersion: '0.1.0',
    hostRevision: 'host-20260805',
    databaseSchemaVersion: schemaVersion,
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  return { root, source, snapshotPath: result.snapshotPath, manifest: result.manifest };
}

function preflightOptions(fixtureValue: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}): Parameters<SqliteRestorePreflightAdapter['preflight']>[0] {
  return {
    snapshotPath: fixtureValue.snapshotPath,
    targetDatabasePath: fixtureValue.source,
    manifest: fixtureValue.manifest,
    targetProductVersion: '0.1.1',
    targetDatabaseSchemaVersion: fixtureValue.manifest.databaseSchemaVersion,
    planId: 'restore_20260805',
    createdAt: '2026-08-05T00:01:00.000Z',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteRestorePreflightAdapter', () => {
  it('creates a compatible plan and leaves current database and staging files unchanged', async () => {
    const value = await fixture();
    const beforeDatabase = await readFile(value.source);
    const beforeFiles = await readdir(join(value.root, 'snapshots'));
    const plan = await new SqliteRestorePreflightAdapter().preflight(preflightOptions(value));
    expect(plan).toMatchObject({
      schemaVersion: 'ready4vibe_restore_plan_v1',
      planId: 'restore_20260805',
      sourceBackupId: 'backup_20260805',
      sourceProductVersion: '0.1.0',
      targetProductVersion: '0.1.1',
      sourceDatabaseSchemaVersion: 7,
      targetDatabaseSchemaVersion: 7,
      compatibility: 'compatible',
      confirmationRequired: true,
      preserveCurrent: true,
      importCredentials: false,
      importWorkspaceFiles: false,
      workspaceBindings: [],
      excludedDataClasses: [],
      warnings: [],
    });
    expect(JSON.stringify(plan)).not.toMatch(/C:\\|\/Users\/|api[_-]?key|secret/iu);
    await expect(readFile(value.source)).resolves.toEqual(beforeDatabase);
    await expect(readdir(join(value.root, 'snapshots'))).resolves.toEqual(beforeFiles);
  });

  it('marks a newer target schema as requiring migration', async () => {
    const value = await fixture(7);
    const target = join(value.root, 'target-newer.sqlite');
    createDatabase(target, 8, 'target-newer');
    const plan = await new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { targetDatabasePath: target, targetDatabaseSchemaVersion: 8 }));
    expect(plan.compatibility).toBe('requires-migration');
    expect(plan.warnings).toContain('target database schema requires a forward migration before restore');
  });

  it('blocks a target schema older than the snapshot', async () => {
    const value = await fixture(7);
    const target = join(value.root, 'target-older.sqlite');
    createDatabase(target, 6, 'target-older');
    const plan = await new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { targetDatabasePath: target, targetDatabaseSchemaVersion: 6 }));
    expect(plan.compatibility).toBe('blocked');
    expect(plan.warnings).toContain('target database schema is older than the snapshot; downgrade restore is unsupported');
  });

  it('rejects a digest mismatch before opening the snapshot', async () => {
    const value = await fixture();
    const bytes = await readFile(value.snapshotPath);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await writeFile(value.snapshotPath, bytes);
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value))).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' });
  });

  it('rejects a manifest size mismatch', async () => {
    const value = await fixture();
    const manifest = {
      ...value.manifest,
      entries: value.manifest.entries.map((entry) => ({ ...entry, sizeBytes: entry.sizeBytes + 1 })),
    };
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { manifest }))).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });
  });

  it('enforces the caller size limit before SQLite access', async () => {
    const value = await fixture();
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { maxSnapshotBytes: 1 }))).rejects.toMatchObject({ code: 'SIZE_LIMIT' });
  });

  it('rejects a snapshot that passes digest but fails SQLite integrity/open', async () => {
    const value = await fixture();
    const bytes = Buffer.alloc((await readFile(value.snapshotPath)).length, 0);
    await writeFile(value.snapshotPath, bytes);
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const manifest = {
      ...value.manifest,
      entries: value.manifest.entries.map((entry) => ({ ...entry, digest })),
    };
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { manifest }))).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
  });

  it('rejects a snapshot schema that disagrees with the manifest', async () => {
    const value = await fixture(7);
    const manifest = { ...value.manifest, databaseSchemaVersion: 8 };
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { manifest }))).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
  });

  it('fails closed when the snapshot is missing', async () => {
    const value = await fixture();
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { snapshotPath: join(value.root, 'missing.sqlite') }))).rejects.toMatchObject({ code: 'SNAPSHOT_MISSING' });
  });

  it('rejects a source-target collision without changing the current database', async () => {
    const value = await fixture();
    const beforeDatabase = await readFile(value.source);
    await expect(new SqliteRestorePreflightAdapter().preflight(preflightOptions(value, { snapshotPath: value.source }))).rejects.toMatchObject({ code: 'DESTINATION_EQUALS_SOURCE' });
    await expect(readFile(value.source)).resolves.toEqual(beforeDatabase);
  });
});
