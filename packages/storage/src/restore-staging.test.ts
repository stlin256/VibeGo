import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteBackupSnapshotAdapter } from './backup.js';
import { SqliteRestorePreflightAdapter, SqliteRestorePreflightError } from './restore-preflight.js';
import { SqliteRestoreStagingAdapter } from './restore-staging.js';

const roots: string[] = [];

async function rootDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ready4vibe-restore-staging-'));
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

function stagingOptions(fixtureValue: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}): Parameters<SqliteRestoreStagingAdapter['stage']>[0] {
  return {
    snapshotPath: fixtureValue.snapshotPath,
    targetDatabasePath: fixtureValue.source,
    stagingDirectory: join(fixtureValue.root, 'restore-candidates'),
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

describe('SqliteRestoreStagingAdapter', () => {
  it('stages a preflight-validated snapshot and returns an internal candidate path', async () => {
    const value = await fixture();
    const beforeCurrent = await readFile(value.source);
    const result = await new SqliteRestoreStagingAdapter().stage(stagingOptions(value));
    expect(result.stagedPath).toBe(join(value.root, 'restore-candidates', 'restore_20260805.sqlite'));
    expect(result.plan.compatibility).toBe('compatible');
    const stagedBytes = await readFile(result.stagedPath);
    expect(createHash('sha256').update(stagedBytes).digest('hex')).toBe(value.manifest.entries[0]?.digest.slice('sha256:'.length));
    const staged = new DatabaseSync(result.stagedPath, { readOnly: true });
    expect(staged.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    expect(staged.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 7 });
    staged.close();
    await expect(readFile(value.source)).resolves.toEqual(beforeCurrent);
  });

  it('binds a generated plan id to the candidate filename', async () => {
    const value = await fixture();
    const { planId: _planId, ...withoutPlanId } = stagingOptions(value);
    const result = await new SqliteRestoreStagingAdapter().stage(withoutPlanId);
    expect(result.plan.planId).toMatch(/^restore_[A-Za-z0-9_-]{8,128}$/u);
    expect(result.stagedPath).toBe(join(value.root, 'restore-candidates', `${result.plan.planId}.sqlite`));
  });

  it('rejects an existing candidate and never overwrites it', async () => {
    const value = await fixture();
    const adapter = new SqliteRestoreStagingAdapter();
    const first = await adapter.stage(stagingOptions(value));
    await writeFile(first.stagedPath, 'do-not-overwrite', 'utf8');
    await expect(adapter.stage(stagingOptions(value))).rejects.toMatchObject({ code: 'DESTINATION_EXISTS' });
    await expect(readFile(first.stagedPath, 'utf8')).resolves.toBe('do-not-overwrite');
  });

  it('cleans failed staging setup without creating a partial candidate', async () => {
    const value = await fixture();
    const stagingDirectory = join(value.root, 'restore-candidates');
    await writeFile(stagingDirectory, 'not-a-directory', 'utf8');
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value))).rejects.toMatchObject({ code: 'STAGING_FAILED' });
    expect(await readdir(value.root)).not.toContain('restore_20260805.sqlite');
  });

  it('removes the temporary copy when the post-copy verification fails', async () => {
    const value = await fixture();
    const realPreflight = new SqliteRestorePreflightAdapter();
    let calls = 0;
    const preflight = {
      preflight: async (options: Parameters<SqliteRestorePreflightAdapter['preflight']>[0]) => {
        calls += 1;
        if (calls === 1) return realPreflight.preflight(options);
        throw new SqliteRestorePreflightError('INTEGRITY_FAILED', 'test verification failure');
      },
    } as unknown as SqliteRestorePreflightAdapter;
    await expect(new SqliteRestoreStagingAdapter(preflight).stage(stagingOptions(value))).rejects.toMatchObject({ code: 'INTEGRITY_FAILED' });
    const files = await readdir(join(value.root, 'restore-candidates'));
    expect(files.filter((file) => file.endsWith('.tmp'))).toEqual([]);
    expect(files.filter((file) => file.endsWith('.sqlite'))).toEqual([]);
  });

  it('fails before staging when the snapshot digest is wrong', async () => {
    const value = await fixture();
    const bytes = await readFile(value.snapshotPath);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await writeFile(value.snapshotPath, bytes);
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value))).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' });
    await expect(readdir(join(value.root, 'restore-candidates'))).rejects.toThrow();
  });

  it('fails before staging when the snapshot schema disagrees with the manifest', async () => {
    const value = await fixture();
    const manifest = { ...value.manifest, databaseSchemaVersion: 8 };
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value, { manifest }))).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
    await expect(readdir(join(value.root, 'restore-candidates'))).rejects.toThrow();
  });

  it('fails closed when the current target schema does not match its declared version', async () => {
    const value = await fixture();
    const target = join(value.root, 'target.sqlite');
    createDatabase(target, 8, 'target');
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value, { targetDatabasePath: target, targetDatabaseSchemaVersion: 7 }))).rejects.toMatchObject({ code: 'SCHEMA_MISMATCH' });
    await expect(readdir(join(value.root, 'restore-candidates'))).rejects.toThrow();
  });

  it('enforces the snapshot size bound before writing staging output', async () => {
    const value = await fixture();
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value, { maxSnapshotBytes: 1 }))).rejects.toMatchObject({ code: 'SIZE_LIMIT' });
    await expect(readdir(join(value.root, 'restore-candidates'))).rejects.toThrow();
  });

  it('rejects source-target collisions through the preflight boundary', async () => {
    const value = await fixture();
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value, { snapshotPath: value.source }))).rejects.toMatchObject({ code: 'DESTINATION_EQUALS_SOURCE' });
  });

  it('rejects unsafe manifest input before creating the staging directory', async () => {
    const value = await fixture();
    const manifest = { ...value.manifest, unexpected: 'field' };
    await expect(new SqliteRestoreStagingAdapter().stage(stagingOptions(value, { manifest }))).rejects.toMatchObject({ code: 'MANIFEST_INVALID' });
    await expect(readdir(join(value.root, 'restore-candidates'))).rejects.toThrow();
  });

  it('keeps the plan path-free and does not create a RestoreResult or mutate current', async () => {
    const value = await fixture();
    const beforeCurrent = await readFile(value.source);
    const result = await new SqliteRestoreStagingAdapter().stage(stagingOptions(value));
    expect(JSON.stringify(result.plan)).not.toMatch(/C:\\|\/Users\/|api[_-]?key|secret/iu);
    expect(JSON.stringify(result.plan)).not.toContain(result.stagedPath);
    expect(result).not.toHaveProperty('restoreResult');
    await expect(readFile(value.source)).resolves.toEqual(beforeCurrent);
  });
});
