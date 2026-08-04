import { copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { link, mkdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RestorePlan } from '@ready4vibe/contracts';
import {
  SqliteRestorePreflightAdapter,
  SqliteRestorePreflightError,
  type SqliteRestorePreflightOptions,
} from './restore-preflight.js';

export type SqliteRestoreStagingErrorCode =
  | 'INVALID_OPTIONS'
  | 'DESTINATION_EXISTS'
  | 'DESTINATION_EQUALS_SOURCE'
  | 'STAGING_FAILED';

export class SqliteRestoreStagingError extends Error {
  constructor(readonly code: SqliteRestoreStagingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SqliteRestoreStagingError';
  }
}

export interface SqliteRestoreStagingOptions extends SqliteRestorePreflightOptions {
  /** Internal host directory; never serialized into the RestorePlan. */
  readonly stagingDirectory: string | URL;
}

export interface SqliteRestoreStagingResult {
  /** Internal candidate path for a later restore application service. */
  readonly stagedPath: string;
  readonly plan: RestorePlan;
}

/**
 * Copies a validated snapshot into an immutable staging candidate.
 *
 * The adapter intentionally stops before migration or data-pointer switching.
 * It composes the read-only preflight before and after the copy, uses a
 * temporary file plus a no-replace hard-link commit, and never writes current.
 */
export class SqliteRestoreStagingAdapter {
  private readonly preflightAdapter: SqliteRestorePreflightAdapter;

  constructor(preflightAdapter = new SqliteRestorePreflightAdapter()) {
    this.preflightAdapter = preflightAdapter;
  }

  async stage(options: SqliteRestoreStagingOptions): Promise<SqliteRestoreStagingResult> {
    const plan = await this.preflightAdapter.preflight(options);
    const stagingDirectory = toAbsolutePath(options.stagingDirectory);
    const snapshotPath = toAbsolutePath(options.snapshotPath);
    const targetPath = toAbsolutePath(options.targetDatabasePath);
    const stagedPath = join(stagingDirectory, `${plan.planId}.sqlite`);
    if (stagedPath === snapshotPath || stagedPath === targetPath) {
      throw new SqliteRestoreStagingError(
        'DESTINATION_EQUALS_SOURCE',
        'restore staging candidate must differ from snapshot and current database',
      );
    }

    try {
      await mkdir(stagingDirectory, { recursive: true });
    } catch (error) {
      throw new SqliteRestoreStagingError('STAGING_FAILED', 'restore staging directory could not be prepared', { cause: error });
    }

    if (await exists(stagedPath)) {
      throw new SqliteRestoreStagingError('DESTINATION_EXISTS', 'restore staging candidate already exists');
    }

    const temporaryPath = join(stagingDirectory, `.${plan.planId}.${randomUUID()}.sqlite.tmp`);
    try {
      try {
        await copyFile(snapshotPath, temporaryPath, constants.COPYFILE_EXCL);
      } catch (error) {
        throw new SqliteRestoreStagingError('STAGING_FAILED', 'restore snapshot could not be copied to staging', { cause: error });
      }

      let stagedPlan: RestorePlan;
      try {
        stagedPlan = await this.preflightAdapter.preflight({
          ...options,
          snapshotPath: temporaryPath,
          planId: plan.planId,
          createdAt: plan.createdAt,
        });
      } catch (error) {
        if (error instanceof SqliteRestorePreflightError) throw error;
        throw new SqliteRestoreStagingError('STAGING_FAILED', 'staged restore snapshot could not be verified', { cause: error });
      }

      try {
        await link(temporaryPath, stagedPath);
      } catch (error) {
        if (await exists(stagedPath)) {
          throw new SqliteRestoreStagingError('DESTINATION_EXISTS', 'restore staging candidate already exists', { cause: error });
        }
        throw new SqliteRestoreStagingError('STAGING_FAILED', 'restore staging candidate could not be committed', { cause: error });
      }
      return { stagedPath, plan: stagedPlan };
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

function toAbsolutePath(value: string | URL): string {
  try {
    return resolve(typeof value === 'string' ? value : fileURLToPath(value));
  } catch (error) {
    throw new SqliteRestoreStagingError('INVALID_OPTIONS', 'restore staging path is invalid', { cause: error });
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
