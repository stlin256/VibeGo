import { constants } from 'node:fs';
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, rename as fsRename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RestoreResultSchema,
  parseBackupManifest,
  parseRestoreApplyConfirmation,
  parseRestorePlan,
  type RestorePlan,
  type RestoreResult,
} from '@ready4vibe/contracts';
import {
  SqliteRestorePreflightAdapter,
  SqliteRestorePreflightError,
  type SqliteRestorePreflightOptions,
} from './restore-preflight.js';

export type SqliteRestoreApplyErrorCode =
  | 'INVALID_OPTIONS'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_MISMATCH'
  | 'RESTORE_NOT_COMPATIBLE'
  | 'PREVIOUS_EXISTS'
  | 'DESTINATION_EQUALS_SOURCE'
  | 'TARGET_CHANGED'
  | 'PREVIOUS_FAILED'
  | 'SWAP_FAILED'
  | 'MANUAL_RECOVERY_REQUIRED'
  | 'APPLY_FAILED';

export class SqliteRestoreApplyError extends Error {
  constructor(readonly code: SqliteRestoreApplyErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteRestoreApplyError';
  }
}

export interface RestoreApplyDependencies {
  readonly rename?: typeof fsRename;
}

export interface SqliteRestoreApplyOptions {
  /** Parsed again at the trust boundary; no path is copied into the result. */
  readonly plan: unknown;
  readonly confirmation: unknown;
  readonly manifest: unknown;
  /** Internal storage paths; never returned in RestoreResult. */
  readonly stagedPath: string | URL;
  readonly currentDatabasePath: string | URL;
  readonly previousDatabasePath: string | URL;
  readonly previousRevision: string;
  readonly completedAt?: string;
  readonly maxSnapshotBytes?: number;
}

/**
 * Applies an explicitly confirmed, compatible restore plan.
 *
 * This is intentionally a storage/application adapter, not a daemon route. It
 * preserves current as an immutable previous hard-link, prepares and verifies
 * a new current file, and rolls the current path back if the guarded swap
 * cannot complete. It never imports credentials/workspace files or writes an
 * event/RestoreResult record.
 */
export class SqliteRestoreApplyAdapter {
  private readonly rename: typeof fsRename;
  private readonly preflightAdapter: SqliteRestorePreflightAdapter;

  constructor(
    dependencies: RestoreApplyDependencies = {},
    preflightAdapter = new SqliteRestorePreflightAdapter(),
  ) {
    this.rename = dependencies.rename ?? fsRename;
    this.preflightAdapter = preflightAdapter;
  }

  async apply(options: SqliteRestoreApplyOptions): Promise<RestoreResult> {
    const plan = parsePlan(options.plan);
    const confirmation = parseConfirmation(options.confirmation);
    const manifest = parseManifest(options.manifest);
    if (confirmation.planId !== plan.planId) {
      throw new SqliteRestoreApplyError('CONFIRMATION_MISMATCH', 'restore confirmation does not match the plan');
    }
    if (plan.compatibility !== 'compatible') {
      throw new SqliteRestoreApplyError('RESTORE_NOT_COMPATIBLE', 'only compatible restore plans may be applied');
    }

    const completedAt = options.completedAt ?? new Date().toISOString();
    validateResultMetadata(plan, options.previousRevision, completedAt);
    const stagedPath = toAbsolutePath(options.stagedPath);
    const currentPath = toAbsolutePath(options.currentDatabasePath);
    const previousPath = toAbsolutePath(options.previousDatabasePath);
    if (stagedPath === currentPath || stagedPath === previousPath || currentPath === previousPath) {
      throw new SqliteRestoreApplyError('DESTINATION_EQUALS_SOURCE', 'restore apply paths must be different files');
    }

    const preflightOptions: SqliteRestorePreflightOptions = {
      snapshotPath: stagedPath,
      targetDatabasePath: currentPath,
      manifest,
      targetProductVersion: plan.targetProductVersion,
      targetDatabaseSchemaVersion: plan.targetDatabaseSchemaVersion,
      planId: plan.planId,
      createdAt: plan.createdAt,
      ...(options.maxSnapshotBytes === undefined ? {} : { maxSnapshotBytes: options.maxSnapshotBytes }),
    };
    const verifiedPlan = await this.preflightAdapter.preflight(preflightOptions);
    if (!samePlanIdentity(plan, verifiedPlan)) {
      throw new SqliteRestoreApplyError('INVALID_OPTIONS', 'staged snapshot does not match the restore plan');
    }

    if (await exists(previousPath)) {
      throw new SqliteRestoreApplyError('PREVIOUS_EXISTS', 'restore previous target already exists');
    }

    const currentFingerprint = await fingerprint(currentPath);
    const currentDigest = await hashFile(currentPath, 'current');
    const previousDirectory = dirname(previousPath);
    const currentDirectory = dirname(currentPath);
    try {
      await mkdir(previousDirectory, { recursive: true });
    } catch (error) {
      throw new SqliteRestoreApplyError('PREVIOUS_FAILED', 'restore previous directory could not be prepared', { cause: error });
    }

    const previousTemporaryPath = join(previousDirectory, `.${basename(previousPath)}.restore-previous-${randomUUID()}.tmp`);
    const currentTemporaryPath = join(currentDirectory, `.${basename(currentPath)}.restore-swap-${randomUUID()}.tmp`);
    const oldCurrentPath = join(currentDirectory, `.${basename(currentPath)}.restore-old-${randomUUID()}.tmp`);
    let previousCreated = false;
    let swapCommitted = false;
    try {
      await copyFileChecked(currentPath, previousTemporaryPath, 'PREVIOUS_FAILED');
      const previousDigest = await hashFile(previousTemporaryPath, 'previous');
      if (previousDigest !== currentDigest || !sameFingerprint(currentFingerprint, await fingerprint(currentPath))) {
        throw new SqliteRestoreApplyError('TARGET_CHANGED', 'current database changed while preserving previous');
      }
      try {
        await link(previousTemporaryPath, previousPath);
      } catch (error) {
        if (await exists(previousPath)) {
          throw new SqliteRestoreApplyError('PREVIOUS_EXISTS', 'restore previous target already exists', { cause: error });
        }
        throw new SqliteRestoreApplyError('PREVIOUS_FAILED', 'restore previous target could not be committed', { cause: error });
      }
      previousCreated = true;

      await assertCurrentUnchanged(currentPath, currentFingerprint, currentDigest);
      await copyFileChecked(stagedPath, currentTemporaryPath, 'SWAP_FAILED');
      const stagedPlan = await this.preflightAdapter.preflight({
        ...preflightOptions,
        snapshotPath: currentTemporaryPath,
      });
      if (!samePlanIdentity(plan, stagedPlan)) {
        throw new SqliteRestoreApplyError('INVALID_OPTIONS', 'prepared current candidate does not match the restore plan');
      }
      await assertCurrentUnchanged(currentPath, currentFingerprint, currentDigest);

      await this.swapCurrent(currentTemporaryPath, currentPath, oldCurrentPath);
      swapCommitted = true;
      const appliedDigest = await hashFile(currentPath, 'applied current');
      if (appliedDigest !== manifest.entries.find((entry) => entry.dataClass === 'sqlite-database')?.digest) {
        throw new SqliteRestoreApplyError('SWAP_FAILED', 'applied current digest does not match the restore manifest');
      }
      return RestoreResultSchema.parse({
        schemaVersion: 'ready4vibe_restore_result_v1',
        planId: plan.planId,
        status: 'applied',
        completedAt,
        previousRevision: options.previousRevision,
        restoredEntryCount: 1,
        diagnosticId: null,
        reasonCode: null,
      });
    } catch (error) {
      if (swapCommitted) {
        try {
          await this.rollbackCurrent(previousPath, currentPath);
        } catch (rollbackError) {
          throw new SqliteRestoreApplyError('MANUAL_RECOVERY_REQUIRED', 'restore swap failed and automatic rollback failed', { cause: rollbackError });
        }
      }
      if (previousCreated) await rm(previousPath, { force: true }).catch(() => undefined);
      if (error instanceof SqliteRestoreApplyError || error instanceof SqliteRestorePreflightError) throw error;
      throw new SqliteRestoreApplyError('APPLY_FAILED', 'restore apply failed', { cause: error });
    } finally {
      await Promise.all([
        rm(previousTemporaryPath, { force: true }).catch(() => undefined),
        rm(currentTemporaryPath, { force: true }).catch(() => undefined),
        rm(oldCurrentPath, { force: true }).catch(() => undefined),
      ]);
    }
  }

  private async swapCurrent(currentTemporaryPath: string, currentPath: string, oldCurrentPath: string): Promise<void> {
    try {
      await this.rename(currentTemporaryPath, currentPath);
      return;
    } catch (error) {
      if (!isDestinationConflict(error)) {
        throw new SqliteRestoreApplyError('SWAP_FAILED', 'current database could not be replaced', { cause: error });
      }
    }

    try {
      await this.rename(currentPath, oldCurrentPath);
      try {
        await this.rename(currentTemporaryPath, currentPath);
      } catch (error) {
        try {
          await this.rename(oldCurrentPath, currentPath);
        } catch (rollbackError) {
          throw new SqliteRestoreApplyError('MANUAL_RECOVERY_REQUIRED', 'current database swap rollback failed', { cause: rollbackError });
        }
        throw new SqliteRestoreApplyError('SWAP_FAILED', 'current database candidate could not be installed', { cause: error });
      }
      await rm(oldCurrentPath, { force: true }).catch(() => undefined);
    } catch (error) {
      if (error instanceof SqliteRestoreApplyError) throw error;
      throw new SqliteRestoreApplyError('SWAP_FAILED', 'current database swap failed', { cause: error });
    }
  }

  private async rollbackCurrent(previousPath: string, currentPath: string): Promise<void> {
    const rollbackPath = join(dirname(currentPath), `.${basename(currentPath)}.restore-rollback-${randomUUID()}.tmp`);
    try {
      await copyFile(previousPath, rollbackPath, constants.COPYFILE_EXCL);
      await this.replaceWithFallback(rollbackPath, currentPath);
    } finally {
      await rm(rollbackPath, { force: true }).catch(() => undefined);
    }
  }

  private async replaceWithFallback(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      await this.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!isDestinationConflict(error)) throw error;
    }
    const oldPath = join(dirname(destinationPath), `.${basename(destinationPath)}.restore-rollback-old-${randomUUID()}.tmp`);
    await this.rename(destinationPath, oldPath);
    try {
      await this.rename(sourcePath, destinationPath);
    } catch (error) {
      await this.rename(oldPath, destinationPath).catch(() => undefined);
      throw error;
    }
    await rm(oldPath, { force: true });
  }
}

function parsePlan(input: unknown): RestorePlan {
  try {
    return parseRestorePlan(input);
  } catch (error) {
    throw new SqliteRestoreApplyError('INVALID_OPTIONS', 'restore plan is invalid', { cause: error });
  }
}

function parseConfirmation(input: unknown) {
  try {
    return parseRestoreApplyConfirmation(input);
  } catch (error) {
    throw new SqliteRestoreApplyError('CONFIRMATION_REQUIRED', 'explicit restore confirmation is required', { cause: error });
  }
}

function parseManifest(input: unknown) {
  try {
    return parseBackupManifest(input);
  } catch (error) {
    throw new SqliteRestoreApplyError('INVALID_OPTIONS', 'restore backup manifest is invalid', { cause: error });
  }
}

function validateResultMetadata(plan: RestorePlan, previousRevision: string, completedAt: string): void {
  try {
    RestoreResultSchema.parse({
      schemaVersion: 'ready4vibe_restore_result_v1',
      planId: plan.planId,
      status: 'applied',
      completedAt,
      previousRevision,
      restoredEntryCount: 1,
      diagnosticId: null,
      reasonCode: null,
    });
  } catch (error) {
    throw new SqliteRestoreApplyError('INVALID_OPTIONS', 'restore result metadata is invalid', { cause: error });
  }
}

function samePlanIdentity(left: RestorePlan, right: RestorePlan): boolean {
  return left.planId === right.planId
    && left.sourceBackupId === right.sourceBackupId
    && left.sourceDatabaseSchemaVersion === right.sourceDatabaseSchemaVersion
    && left.targetDatabaseSchemaVersion === right.targetDatabaseSchemaVersion
    && left.compatibility === right.compatibility;
}

function toAbsolutePath(value: string | URL): string {
  try {
    return resolve(typeof value === 'string' ? value : fileURLToPath(value));
  } catch (error) {
    throw new SqliteRestoreApplyError('INVALID_OPTIONS', 'restore apply path is invalid', { cause: error });
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fingerprint(path: string): Promise<{ size: number; mtimeMs: number; ino: number; dev: number }> {
  try {
    const value = await stat(path);
    return { size: value.size, mtimeMs: value.mtimeMs, ino: value.ino, dev: value.dev };
  } catch (error) {
    throw new SqliteRestoreApplyError('APPLY_FAILED', 'restore current fingerprint could not be read', { cause: error });
  }
}

function sameFingerprint(left: { size: number; mtimeMs: number; ino: number; dev: number }, right: { size: number; mtimeMs: number; ino: number; dev: number }): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs && left.ino === right.ino && left.dev === right.dev;
}

async function hashFile(path: string, label: string): Promise<string> {
  try {
    const hash = createHash('sha256');
    const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
    for await (const chunk of stream) hash.update(chunk);
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    throw new SqliteRestoreApplyError('APPLY_FAILED', `${label} digest could not be computed`, { cause: error });
  }
}

async function copyFileChecked(sourcePath: string, destinationPath: string, code: 'PREVIOUS_FAILED' | 'SWAP_FAILED'): Promise<void> {
  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  } catch (error) {
    throw new SqliteRestoreApplyError(code, 'restore file copy failed', { cause: error });
  }
}

async function assertCurrentUnchanged(path: string, expectedFingerprint: { size: number; mtimeMs: number; ino: number; dev: number }, expectedDigest: string): Promise<void> {
  const currentFingerprint = await fingerprint(path);
  if (!sameFingerprint(expectedFingerprint, currentFingerprint)) {
    throw new SqliteRestoreApplyError('TARGET_CHANGED', 'current database changed during restore apply');
  }
  const currentDigest = await hashFile(path, 'current');
  if (currentDigest !== expectedDigest) {
    throw new SqliteRestoreApplyError('TARGET_CHANGED', 'current database digest changed during restore apply');
  }
}

function isDestinationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? (error as { code?: unknown }).code : undefined;
  return code === 'EEXIST' || code === 'EPERM' || code === 'EBUSY';
}
