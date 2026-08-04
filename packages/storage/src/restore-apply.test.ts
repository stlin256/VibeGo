import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm, rename as fsRename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteBackupSnapshotAdapter } from './backup.js';
import { SqliteRestoreApplyAdapter } from './restore-apply.js';
import { SqliteRestoreStagingAdapter } from './restore-staging.js';

const roots: string[] = [];

async function rootDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ready4vibe-restore-apply-'));
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
  stagedPath: string;
  manifest: Awaited<ReturnType<SqliteBackupSnapshotAdapter['create']>>['manifest'];
  plan: Awaited<ReturnType<SqliteRestoreStagingAdapter['stage']>>['plan'];
}> {
  const root = await rootDirectory();
  const source = join(root, 'current.sqlite');
  createDatabase(source, schemaVersion, 'current');
  const backup = await new SqliteBackupSnapshotAdapter().create({
    databasePath: source,
    stagingDirectory: join(root, 'snapshots'),
    backupId: 'backup_20260805',
    productVersion: '0.1.0',
    hostRevision: 'host-20260805',
    databaseSchemaVersion: schemaVersion,
    createdAt: '2026-08-05T00:00:00.000Z',
  });
  const staged = await new SqliteRestoreStagingAdapter().stage({
    snapshotPath: backup.snapshotPath,
    targetDatabasePath: source,
    stagingDirectory: join(root, 'restore-candidates'),
    manifest: backup.manifest,
    targetProductVersion: '0.1.1',
    targetDatabaseSchemaVersion: schemaVersion,
    planId: 'restore_20260805',
    createdAt: '2026-08-05T00:01:00.000Z',
  });
  return { root, source, stagedPath: staged.stagedPath, manifest: backup.manifest, plan: staged.plan };
}

function confirmation(planId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'ready4vibe_restore_apply_confirmation_v1',
    confirmationId: 'confirm_20260805',
    planId,
    approved: true,
    confirmedAt: '2026-08-05T00:02:00.000Z',
    ...overrides,
  };
}

function applyOptions(fixtureValue: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}): Parameters<SqliteRestoreApplyAdapter['apply']>[0] {
  return {
    plan: fixtureValue.plan,
    confirmation: confirmation(fixtureValue.plan.planId),
    manifest: fixtureValue.manifest,
    stagedPath: fixtureValue.stagedPath,
    currentDatabasePath: fixtureValue.source,
    previousDatabasePath: join(fixtureValue.root, 'previous.sqlite'),
    previousRevision: 'host-20260804',
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('SqliteRestoreApplyAdapter', () => {
  it('applies a compatible plan after explicit confirmation and preserves previous', async () => {
    const value = await fixture();
    const beforeCurrent = await readFile(value.source);
    const stagedBytes = await readFile(value.stagedPath);
    const result = await new SqliteRestoreApplyAdapter().apply(applyOptions(value));
    expect(result).toMatchObject({
      schemaVersion: 'ready4vibe_restore_result_v1',
      planId: value.plan.planId,
      status: 'applied',
      previousRevision: 'host-20260804',
      restoredEntryCount: 1,
      diagnosticId: null,
      reasonCode: null,
    });
    await expect(readFile(value.source)).resolves.toEqual(stagedBytes);
    await expect(readFile(join(value.root, 'previous.sqlite'))).resolves.toEqual(beforeCurrent);
    const current = new DatabaseSync(value.source, { readOnly: true });
    expect(current.prepare('PRAGMA integrity_check').get()).toMatchObject({ integrity_check: 'ok' });
    current.close();
  });

  it('rejects an unapproved or plan-mismatched confirmation before touching files', async () => {
    const value = await fixture();
    const beforeCurrent = await readFile(value.source);
    await expect(new SqliteRestoreApplyAdapter().apply(applyOptions(value, { confirmation: confirmation(value.plan.planId, { approved: false }) }))).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    await expect(new SqliteRestoreApplyAdapter().apply(applyOptions(value, { confirmation: confirmation('restore_other123') }))).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    await expect(readFile(value.source)).resolves.toEqual(beforeCurrent);
    await expect(readdir(join(value.root, 'previous.sqlite'))).rejects.toThrow();
  });

  it('rejects migration-required plans without creating previous or replacing current', async () => {
    const value = await fixture();
    const target = join(value.root, 'target-newer.sqlite');
    createDatabase(target, 8, 'target-newer');
    const backup = await new SqliteBackupSnapshotAdapter().create({
      databasePath: value.source,
      stagingDirectory: join(value.root, 'second-snapshots'),
      backupId: 'backup_20260806',
      productVersion: '0.1.0',
      hostRevision: 'host-20260805',
      databaseSchemaVersion: 7,
    });
    const staged = await new SqliteRestoreStagingAdapter().stage({
      snapshotPath: backup.snapshotPath,
      targetDatabasePath: target,
      stagingDirectory: join(value.root, 'second-candidates'),
      manifest: backup.manifest,
      targetProductVersion: '0.1.1',
      targetDatabaseSchemaVersion: 8,
      planId: 'restore_20260806',
    });
    const beforeTarget = await readFile(target);
    await expect(new SqliteRestoreApplyAdapter().apply({
      plan: staged.plan,
      confirmation: confirmation(staged.plan.planId),
      manifest: backup.manifest,
      stagedPath: staged.stagedPath,
      currentDatabasePath: target,
      previousDatabasePath: join(value.root, 'previous-newer.sqlite'),
      previousRevision: 'host-20260804',
    })).rejects.toMatchObject({ code: 'RESTORE_NOT_COMPATIBLE' });
    await expect(readFile(target)).resolves.toEqual(beforeTarget);
  });

  it('rejects an existing previous target without overwriting it', async () => {
    const value = await fixture();
    const previous = join(value.root, 'previous.sqlite');
    await writeFile(previous, 'keep-this-previous', 'utf8');
    const beforeCurrent = await readFile(value.source);
    await expect(new SqliteRestoreApplyAdapter().apply(applyOptions(value))).rejects.toMatchObject({ code: 'PREVIOUS_EXISTS' });
    await expect(readFile(previous, 'utf8')).resolves.toBe('keep-this-previous');
    await expect(readFile(value.source)).resolves.toEqual(beforeCurrent);
  });

  it('fails closed on a changed staged candidate before creating previous', async () => {
    const value = await fixture();
    const stagedBytes = Buffer.alloc((await readFile(value.stagedPath)).length, 0);
    await writeFile(value.stagedPath, stagedBytes);
    const beforeCurrent = await readFile(value.source);
    await expect(new SqliteRestoreApplyAdapter().apply(applyOptions(value))).rejects.toMatchObject({ code: 'DIGEST_MISMATCH' });
    await expect(readFile(value.source)).resolves.toEqual(beforeCurrent);
    await expect(readdir(join(value.root, 'previous.sqlite'))).rejects.toThrow();
  });

  it('requires a readable current database before any swap', async () => {
    const value = await fixture();
    const missing = join(value.root, 'missing-current.sqlite');
    await expect(new SqliteRestoreApplyAdapter().apply(applyOptions(value, { currentDatabasePath: missing }))).rejects.toMatchObject({ code: 'TARGET_MISSING' });
    await expect(readdir(join(value.root, 'previous.sqlite'))).rejects.toThrow();
  });

  it('rejects duplicate application after previous evidence exists', async () => {
    const value = await fixture();
    const adapter = new SqliteRestoreApplyAdapter();
    await adapter.apply(applyOptions(value));
    const currentAfterFirst = await readFile(value.source);
    await expect(adapter.apply(applyOptions(value))).rejects.toMatchObject({ code: 'PREVIOUS_EXISTS' });
    await expect(readFile(value.source)).resolves.toEqual(currentAfterFirst);
  });

  it('rolls current back when the guarded swap fails', async () => {
    const value = await fixture();
    const beforeCurrent = await readFile(value.source);
    let renameCalls = 0;
    const rename: typeof fsRename = async (from, to): Promise<void> => {
      renameCalls += 1;
      if (renameCalls === 1) throw Object.assign(new Error('destination exists'), { code: 'EEXIST' });
      if (renameCalls === 3) throw Object.assign(new Error('simulated swap failure'), { code: 'EIO' });
      await fsRename(from, to);
    };
    await expect(new SqliteRestoreApplyAdapter({ rename }).apply(applyOptions(value))).rejects.toMatchObject({ code: 'SWAP_FAILED' });
    await expect(readFile(value.source)).resolves.toEqual(beforeCurrent);
    await expect(readdir(join(value.root, 'previous.sqlite'))).rejects.toThrow();
    const files = await readdir(value.root);
    expect(files.filter((file) => file.includes('.restore-swap-'))).toEqual([]);
  });

  it('returns only bounded result metadata and never exposes host paths', async () => {
    const value = await fixture();
    const result = await new SqliteRestoreApplyAdapter().apply(applyOptions(value));
    expect(JSON.stringify(result)).not.toMatch(/C:\\|\/Users\/|api[_-]?key|secret/iu);
    expect(JSON.stringify(result)).not.toContain(value.root);
  });
});
