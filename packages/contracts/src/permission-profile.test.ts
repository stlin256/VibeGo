import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CONFIRMATION_REQUEST_SCHEMA_VERSION,
  PERMISSION_CONFIRMATION_SCHEMA_VERSION,
  PERMISSION_APPROVAL_KEY_SCHEMA_VERSION,
  PERMISSION_PROFILE_RESOLUTION_SCHEMA_VERSION,
  PERMISSION_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION,
  PERMISSION_PROFILE_SCHEMA_VERSION,
  PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION,
  PERMISSION_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION,
  PERMISSION_REVOKE_REQUEST_SCHEMA_VERSION,
  PERMISSION_REVOKE_RESULT_SCHEMA_VERSION,
  PERMISSION_SESSION_GRANT_SCHEMA_VERSION,
  PERMISSION_STATUS_SCHEMA_VERSION,
  createSafeDefaultPermissionProfile,
  parsePermissionConfirmation,
  parsePermissionConfirmationRequest,
  parsePermissionProfile,
  parsePermissionApprovalKey,
  parsePermissionProfileResolution,
  parsePermissionProfileRunSnapshot,
  parsePermissionProfileSettings,
  parsePermissionProfileSettingsStatus,
  parsePermissionRevokeRequest,
  parsePermissionRevokeResult,
  parsePermissionSessionGrant,
  parsePermissionStatus,
} from './permission-profile.js';

const timestamp = '2026-08-05T00:00:00.000Z';

const workspaceProfile = {
  schemaVersion: PERMISSION_PROFILE_SCHEMA_VERSION,
  profileId: 'workspace-coding' as const,
  filesystemScope: 'workspace-only' as const,
  processScope: 'none' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalPosture: 'bounded-auto' as const,
  taskTrust: 'trusted-workspace' as const,
  workspaceId: 'repo',
  policyRevision: 'policy-1',
  capabilityRevision: 'capability-1',
  profileRevision: 'profile-1',
  requiresConfirmation: false,
  updatedAt: timestamp,
};

const fullHostProfile = {
  ...workspaceProfile,
  profileId: 'full-host' as const,
  filesystemScope: 'host' as const,
  processScope: 'host' as const,
  approvalPosture: 'session-auto' as const,
  taskTrust: 'trusted-user' as const,
  workspaceId: undefined,
  requiresConfirmation: true,
};

const sessionScope = {
  kind: 'session' as const,
  profileId: 'full-host' as const,
  filesystemScope: 'host' as const,
  processScope: 'host' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalPosture: 'session-auto' as const,
  taskTrust: 'trusted-user' as const,
  confirmationRef: 'confirmation-1',
};

const approvalKey = {
  schemaVersion: PERMISSION_APPROVAL_KEY_SCHEMA_VERSION,
  toolId: 'filesystem.read',
  toolVersion: 'v1',
  argumentFingerprint: 'args-1',
  workspaceId: 'repo',
  permissionRevision: 'permission-1',
  networkMode: 'off' as const,
};

const grant = {
  schemaVersion: PERMISSION_SESSION_GRANT_SCHEMA_VERSION,
  grantId: 'grant-1',
  sessionId: 'session-1',
  userId: 'user-1',
  scope: sessionScope,
  policyRevision: 'policy-1',
  profileRevision: 'profile-1',
  capabilityRevision: 'capability-1',
  issuedAt: timestamp,
  expiresAt: '2026-08-05T01:00:00.000Z',
  maxUses: 10,
  usedUses: 0,
  status: 'active' as const,
  revokedAt: null,
  auditRef: 'audit-1',
};

describe('permission profile contracts', () => {
  it('accepts safe workspace intent and confirmed host intent', () => {
    expect(parsePermissionProfile(workspaceProfile).profileId).toBe('workspace-coding');
    expect(parsePermissionProfile(fullHostProfile).processScope).toBe('host');
  });

  it('rejects unknown fields, secrets, paths and unsafe host trust combinations', () => {
    expect(() => parsePermissionProfile({ ...workspaceProfile, extra: true })).toThrow();
    expect(() => parsePermissionProfile({ ...workspaceProfile, workspaceId: 'C:\\repo' })).toThrow();
    expect(() => parsePermissionProfile({ ...workspaceProfile, policyRevision: 'apiKey=secret-value' })).toThrow();
    expect(() => parsePermissionProfile({ ...workspaceProfile, taskTrust: 'untrusted-content', filesystemScope: 'host', processScope: 'host', requiresConfirmation: true })).toThrow();
    expect(() => parsePermissionProfile({ ...workspaceProfile, profileId: 'full-host', filesystemScope: 'host', processScope: 'host' })).toThrow();
    expect(() => parsePermissionProfile({ ...workspaceProfile, processScope: 'external-sandbox' })).toThrow();
  });

  it('requires a confirmed trusted host scope for session-auto', () => {
    expect(() => parsePermissionProfile({ ...workspaceProfile, approvalPosture: 'session-auto' })).toThrow();
    expect(() => parsePermissionProfile({ ...fullHostProfile, taskTrust: 'untrusted-content' })).toThrow();
    expect(parsePermissionProfile(fullHostProfile).approvalPosture).toBe('session-auto');
  });

  it('keeps resolution strict and fail-closed', () => {
    const ready = parsePermissionProfileResolution({
      schemaVersion: PERMISSION_PROFILE_RESOLUTION_SCHEMA_VERSION,
      status: 'ready',
      reasonCode: 'PROFILE_READY',
      requestedProfile: workspaceProfile,
      effectiveProfile: workspaceProfile,
      policyRevision: 'policy-1',
      capabilityRevision: 'capability-1',
      evaluatedAt: timestamp,
      nextStep: 'continue',
    });
    expect(ready.status).toBe('ready');
    expect(() => parsePermissionProfileResolution({
      ...ready,
      status: 'blocked',
      effectiveProfile: workspaceProfile,
    })).toThrow();
    expect(() => parsePermissionProfileResolution({ ...ready, rawCommand: 'cmd /c whoami' })).toThrow();
  });

  it('validates session grant scope, expiry, usage and revocation state', () => {
    expect(parsePermissionSessionGrant(grant).status).toBe('active');
    expect(() => parsePermissionSessionGrant({ ...grant, expiresAt: timestamp })).toThrow();
    expect(() => parsePermissionSessionGrant({ ...grant, usedUses: 11 })).toThrow();
    expect(() => parsePermissionSessionGrant({ ...grant, status: 'revoked' })).toThrow();
    expect(() => parsePermissionSessionGrant({ ...grant, status: 'exhausted', usedUses: 9 })).toThrow();
    expect(parsePermissionApprovalKey(approvalKey).toolId).toBe('filesystem.read');
    expect(() => parsePermissionApprovalKey({ ...approvalKey, command: 'cat secret.txt' })).toThrow();
  });

  it('accepts explicit confirmation and rejects non-host confirmation', () => {
    const confirmation = parsePermissionConfirmation({
      schemaVersion: PERMISSION_CONFIRMATION_SCHEMA_VERSION,
      confirmationId: 'confirmation-1',
      requestId: 'request-1',
      sessionId: 'session-1',
      userId: 'user-1',
      profileId: 'full-host',
      profileRevision: 'profile-1',
      policyRevision: 'policy-1',
      scopeFingerprint: 'sha256-1',
      acknowledged: true,
      confirmedAt: timestamp,
      expiresAt: '2026-08-05T01:00:00.000Z',
      auditRef: 'audit-1',
    });
    expect(confirmation.acknowledged).toBe(true);
    expect(() => parsePermissionConfirmation({ ...confirmation, profileId: 'workspace-coding' })).toThrow();
  });

  it('validates confirmation, revoke and status DTOs without secret-shaped fields', () => {
    const confirmationRequest = parsePermissionConfirmationRequest({
      schemaVersion: PERMISSION_CONFIRMATION_REQUEST_SCHEMA_VERSION,
      requestId: 'request-1',
      sessionId: 'session-1',
      userId: 'user-1',
      requestedProfile: fullHostProfile,
      expectedProfileRevision: 'profile-1',
      acknowledged: true,
      requestedAt: timestamp,
    });
    expect(confirmationRequest.requestId).toBe('request-1');

    expect(parsePermissionRevokeRequest({
      schemaVersion: PERMISSION_REVOKE_REQUEST_SCHEMA_VERSION,
      requestId: 'revoke-1',
      sessionId: 'session-1',
      userId: 'user-1',
      grantId: 'grant-1',
      reason: 'user-requested',
      requestedAt: timestamp,
    }).reason).toBe('user-requested');
    expect(() => parsePermissionRevokeRequest({
      schemaVersion: PERMISSION_REVOKE_REQUEST_SCHEMA_VERSION,
      requestId: 'revoke-1',
      sessionId: 'session-1',
      userId: 'user-1',
      reason: 'user-requested',
      requestedAt: timestamp,
    })).toThrow();

    const revokeResult = parsePermissionRevokeResult({
      schemaVersion: PERMISSION_REVOKE_RESULT_SCHEMA_VERSION,
      requestId: 'revoke-1',
      grantId: 'grant-1',
      status: 'revoked',
      currentRevision: 'permission-2',
      revokedAt: '2026-08-05T00:10:00.000Z',
      auditRef: 'audit-2',
    });
    expect(revokeResult.status).toBe('revoked');

    const status = parsePermissionStatus({
      schemaVersion: PERMISSION_STATUS_SCHEMA_VERSION,
      status: 'ready',
      reasonCode: 'PROFILE_READY',
      currentRevision: 'permission-1',
      requestedProfile: workspaceProfile,
      effectiveProfile: workspaceProfile,
      effectiveScope: {
        kind: 'run',
        profileId: 'workspace-coding',
        filesystemScope: 'workspace-only',
        processScope: 'none',
        networkMode: 'off',
        mcpSkillMode: 'off',
        approvalPosture: 'bounded-auto',
        taskTrust: 'trusted-workspace',
        workspaceId: 'repo',
        approvalKey,
      },
      grant: null,
      grantExpiresAt: null,
      evaluatedAt: timestamp,
      nextStep: 'continue',
    });
    expect(status.effectiveScope?.workspaceId).toBe('repo');
    expect(() => parsePermissionStatus({ ...status, apiKey: 'sk-secret-value' })).toThrow();
  });

  it('creates a safe default for legacy settings without granting host access', () => {
    const profile = createSafeDefaultPermissionProfile({
      profileRevision: 'profile-legacy-migrated',
      policyRevision: 'policy-1',
      updatedAt: timestamp,
    });
    expect(profile.profileId).toBe('workspace-coding');
    expect(profile.filesystemScope).toBe('workspace-only');
    expect(profile.processScope).toBe('none');
    expect(profile.networkMode).toBe('off');
    expect(profile.requiresConfirmation).toBe(false);
  });

  it('keeps settings and status projections versioned and strict', () => {
    const settings = parsePermissionProfileSettings({
      schemaVersion: PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION,
      profile: workspaceProfile,
      currentRevision: 'permission-1',
      previousRevision: null,
      updatedAt: timestamp,
    });
    expect(settings.currentRevision).toBe('permission-1');
    expect(() => parsePermissionProfileSettings({ ...settings, environment: { TOKEN: 'secret' } })).toThrow();
    expect(() => parsePermissionProfileSettingsStatus({
      schemaVersion: PERMISSION_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION,
      settings,
      resolution: {
        schemaVersion: PERMISSION_PROFILE_RESOLUTION_SCHEMA_VERSION,
        status: 'ready',
        reasonCode: 'PROFILE_READY',
        requestedProfile: workspaceProfile,
        effectiveProfile: workspaceProfile,
        policyRevision: 'policy-1',
        capabilityRevision: 'capability-1',
        evaluatedAt: timestamp,
        nextStep: 'continue',
      },
      currentRevision: 'permission-1',
      previousRevision: null,
      secret: 'token=bad',
    })).toThrow();
  });

  it('accepts an immutable run snapshot and rejects blocked snapshots with capabilities', () => {
    const snapshot = parsePermissionProfileRunSnapshot({
      schemaVersion: PERMISSION_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION,
      status: 'ready',
      reasonCode: 'PROFILE_READY',
      profileRevision: 'profile-1',
      policyRevision: 'policy-1',
      requestedProfile: workspaceProfile,
      effectiveProfile: workspaceProfile,
      effectiveScope: {
        kind: 'run',
        profileId: 'workspace-coding',
        filesystemScope: 'workspace-only',
        processScope: 'none',
        networkMode: 'off',
        mcpSkillMode: 'off',
        approvalPosture: 'bounded-auto',
        taskTrust: 'trusted-workspace',
        workspaceId: 'repo',
        approvalKey,
      },
      grantId: null,
      grantExpiresAt: null,
      capturedAt: timestamp,
    });
    expect(snapshot.effectiveScope?.kind).toBe('run');
    expect(() => parsePermissionProfileRunSnapshot({ ...snapshot, status: 'blocked', effectiveProfile: workspaceProfile })).toThrow();
    expect(() => parsePermissionProfileRunSnapshot({ ...snapshot, rawCommand: 'whoami' })).toThrow();
  });
});
