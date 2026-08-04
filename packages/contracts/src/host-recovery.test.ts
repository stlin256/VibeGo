import { describe, expect, it } from 'vitest';
import {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  DIAGNOSTIC_BUNDLE_SCHEMA_VERSION,
  RECOVERY_STATUS_SCHEMA_VERSION,
  RESTORE_PLAN_SCHEMA_VERSION,
  RESTORE_APPLY_CONFIRMATION_SCHEMA_VERSION,
  RESTORE_RESULT_SCHEMA_VERSION,
  BackupManifestSchema,
  DiagnosticBundleDescriptorSchema,
  RecoveryStatusSchema,
  RestorePlanSchema,
  RestoreApplyConfirmationSchema,
  RestoreResultSchema,
  parseBackupManifest,
  parseDiagnosticBundleDescriptor,
  parseRecoveryStatus,
  parseRestorePlan,
  parseRestoreApplyConfirmation,
  parseRestoreResult,
} from './host-recovery.js';

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

const backup = {
  schemaVersion: BACKUP_MANIFEST_SCHEMA_VERSION,
  backupId: 'backup_20260805',
  productVersion: '0.1.0',
  hostRevision: 'host-20260805',
  databaseSchemaVersion: 4,
  createdAt: '2026-08-05T00:00:00.000Z',
  entries: [
    { dataClass: 'sqlite-database' as const, logicalId: null, digest: digest('a'), sizeBytes: 1_024, recordCount: 12 },
    { dataClass: 'daemon-settings' as const, logicalId: 'settings', digest: digest('b'), sizeBytes: 512, recordCount: 3 },
  ],
  encryption: 'none' as const,
  includesCredentials: false as const,
  includesWorkspaceFiles: false as const,
  includesRawEnvironment: false as const,
};

const restorePlan = {
  schemaVersion: RESTORE_PLAN_SCHEMA_VERSION,
  planId: 'restore_20260805',
  sourceBackupId: backup.backupId,
  sourceProductVersion: '0.1.0',
  targetProductVersion: '0.1.1',
  sourceDatabaseSchemaVersion: 4,
  targetDatabaseSchemaVersion: 5,
  compatibility: 'requires-migration' as const,
  confirmationRequired: true as const,
  preserveCurrent: true as const,
  importCredentials: false as const,
  importWorkspaceFiles: false as const,
  workspaceBindings: [{ sourceWorkspaceId: 'ws_main', targetWorkspaceId: 'ws_main_copy', status: 'mapped' as const }],
  excludedDataClasses: ['usage-ledger' as const],
  warnings: ['database migration will run in a staging copy'],
  createdAt: '2026-08-05T00:01:00.000Z',
};

describe('host backup, restore and recovery contracts', () => {
  it('accepts bounded logical backup metadata without paths or secrets', () => {
    expect(parseBackupManifest(backup)).toEqual(backup);
    expect(backup.entries.every((entry) => !entry.logicalId?.includes('\\'))).toBe(true);
  });

  it('rejects unknown fields, duplicate classes, absolute paths and secret-shaped content', () => {
    expect(() => BackupManifestSchema.parse({ ...backup, apiKey: 'sk-test' })).toThrow();
    expect(() => BackupManifestSchema.parse({ ...backup, entries: [{ ...backup.entries[0], logicalId: 'C:\\data\\db.sqlite' }] })).toThrow(/bounded|absolute path/iu);
    expect(() => BackupManifestSchema.parse({ ...backup, entries: [backup.entries[0], { ...backup.entries[1], dataClass: 'sqlite-database' }] })).toThrow(/unique/iu);
    expect(() => BackupManifestSchema.parse({ ...backup, entries: [{ ...backup.entries[0], logicalId: 'api_key=hidden' }] })).toThrow(/secret|bounded/iu);
    expect(() => BackupManifestSchema.parse({ ...backup, includesCredentials: true })).toThrow();
  });

  it('requires explicit restore intent and disallows credential/workspace imports', () => {
    expect(parseRestorePlan(restorePlan)).toEqual(restorePlan);
    expect(() => RestorePlanSchema.parse({ ...restorePlan, confirmationRequired: false })).toThrow();
    expect(() => RestorePlanSchema.parse({ ...restorePlan, importCredentials: true })).toThrow();
    expect(() => RestorePlanSchema.parse({ ...restorePlan, importWorkspaceFiles: true })).toThrow();
    expect(() => RestorePlanSchema.parse({ ...restorePlan, compatibility: 'blocked', warnings: [] })).toThrow(/warning/iu);
    expect(() => RestorePlanSchema.parse({ ...restorePlan, workspaceBindings: [restorePlan.workspaceBindings[0], restorePlan.workspaceBindings[0]] })).toThrow(/unique/iu);
  });

  it('accepts only a versioned explicit restore approval', () => {
    const confirmation = {
      schemaVersion: RESTORE_APPLY_CONFIRMATION_SCHEMA_VERSION,
      confirmationId: 'confirm_20260805',
      planId: restorePlan.planId,
      approved: true as const,
      confirmedAt: '2026-08-05T00:01:30.000Z',
    };
    expect(parseRestoreApplyConfirmation(confirmation)).toEqual(confirmation);
    expect(() => RestoreApplyConfirmationSchema.parse({ ...confirmation, approved: false })).toThrow();
  });

  it('rejects unsafe approval fields and unknown properties', () => {
    const confirmation = {
      schemaVersion: RESTORE_APPLY_CONFIRMATION_SCHEMA_VERSION,
      confirmationId: 'confirm_20260805',
      planId: restorePlan.planId,
      approved: true as const,
      confirmedAt: '2026-08-05T00:01:30.000Z',
    };
    expect(() => RestoreApplyConfirmationSchema.parse({ ...confirmation, apiKey: 'sk-test' })).toThrow();
    expect(() => RestoreApplyConfirmationSchema.parse({ ...confirmation, confirmationId: 'C:\\secret' })).toThrow();
  });

  it('keeps restore results fail-closed and preserves the previous revision', () => {
    const applied = parseRestoreResult({
      schemaVersion: RESTORE_RESULT_SCHEMA_VERSION,
      planId: restorePlan.planId,
      status: 'applied',
      completedAt: '2026-08-05T00:02:00.000Z',
      previousRevision: 'host-20260804',
      restoredEntryCount: 2,
      diagnosticId: null,
      reasonCode: null,
    });
    expect(applied.previousRevision).toBe('host-20260804');
    expect(() => RestoreResultSchema.parse({ ...applied, previousRevision: null })).toThrow(/previousRevision/iu);
    expect(() => RestoreResultSchema.parse({ ...applied, status: 'failed', reasonCode: null })).toThrow(/reasonCode/iu);
    expect(() => RestoreResultSchema.parse({ ...applied, status: 'staged', restoredEntryCount: 1 })).toThrow(/staged/iu);
  });

  it('limits safe-mode operations and requires reasons for critical recovery states', () => {
    const healthy = parseRecoveryStatus({
      schemaVersion: RECOVERY_STATUS_SCHEMA_VERSION,
      state: 'healthy',
      safeMode: false,
      currentRevision: 'host-20260805',
      previousRevision: null,
      reasonCode: null,
      allowedOperations: ['health', 'settings', 'interactive-run'],
      diagnosticId: null,
      updatedAt: '2026-08-05T00:03:00.000Z',
    });
    expect(healthy.state).toBe('healthy');
    expect(() => RecoveryStatusSchema.parse({ ...healthy, state: 'database-corrupt', safeMode: false, reasonCode: 'integrity-failed' })).toThrow(/safe mode/iu);
    expect(() => RecoveryStatusSchema.parse({ ...healthy, state: 'database-corrupt', safeMode: true, reasonCode: 'integrity-failed', allowedOperations: ['health', 'interactive-run'] })).toThrow(/safe mode operation/iu);
    expect(() => RecoveryStatusSchema.parse({ ...healthy, state: 'rollback-available', reasonCode: 'health-failed', previousRevision: null })).toThrow(/previousRevision/iu);
  });

  it('accepts only redacted bounded diagnostic descriptors', () => {
    const descriptor = parseDiagnosticBundleDescriptor({
      schemaVersion: DIAGNOSTIC_BUNDLE_SCHEMA_VERSION,
      diagnosticId: 'diag_20260805',
      createdAt: '2026-08-05T00:04:00.000Z',
      expiresAt: '2026-08-05T01:04:00.000Z',
      status: 'ready',
      sections: ['runtime-health', 'recovery-state'],
      sizeBytes: 4_096,
      digest: digest('c'),
      redacted: true,
      retention: 'until-expiry',
      reasonCode: null,
    });
    expect(descriptor.redacted).toBe(true);
    expect(() => DiagnosticBundleDescriptorSchema.parse({ ...descriptor, redacted: false })).toThrow();
    expect(() => DiagnosticBundleDescriptorSchema.parse({ ...descriptor, status: 'failed', reasonCode: null })).toThrow(/reasonCode/iu);
    expect(() => DiagnosticBundleDescriptorSchema.parse({ ...descriptor, sections: ['runtime-health', 'runtime-health'] })).toThrow(/unique/iu);
    expect(() => DiagnosticBundleDescriptorSchema.parse({ ...descriptor, sections: ['settings-metadata'], reasonCode: 'C:\\secret' })).toThrow(/bounded|absolute path/iu);
  });
});
