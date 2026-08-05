import { v7 as uuidv7 } from 'uuid';
import {
  PERMISSION_PROFILE_SCHEMA_VERSION,
  PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION,
  PermissionConfirmationRequestSchema,
  PermissionConfirmationSchema,
  PermissionProfileResolutionSchema,
  PermissionProfileRunSnapshotSchema,
  PermissionProfileSchema,
  PermissionProfileSettingsPatchSchema,
  PermissionProfileSettingsSchema,
  PermissionProfileSettingsStatusSchema,
  PermissionRevokeRequestSchema,
  PermissionRevokeResultSchema,
  PermissionSessionGrantSchema,
  PermissionStatusSchema,
  createSafeDefaultPermissionProfile,
  type PermissionConfirmation,
  type PermissionProfile,
  type PermissionProfileRunSnapshot,
  type PermissionProfileSettings,
  type PermissionProfileSettingsStatus,
  type PermissionRevokeResult,
  type PermissionSessionGrant,
  type PermissionStatus,
  type RunConfig,
} from '@ready4vibe/contracts';
import type { CapabilityProfilePolicy } from '@ready4vibe/policy';
import { resolvePermissionProfile, type PermissionProfileApplication } from '@ready4vibe/policy';
import type { SettingsStore } from '@ready4vibe/storage';

export const PERMISSION_PROFILE_SETTINGS_NAMESPACE = 'permission-profile' as const;
export const PERMISSION_PROFILE_SETTINGS_KEY = 'v1' as const;
export const PERMISSION_LOCAL_USER_ID = 'local-user' as const;

const DEFAULT_GRANT_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_GRANT_MAX_USES = 100;
const SANDBOX_REVISION = 'sandbox-1';
const SETTINGS_SESSION_ID = 'settings-session';

export interface PermissionAuthContext {
  readonly sessionId: string;
  readonly userId: string;
}

export interface PermissionProfileSettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly policy: () => CapabilityProfilePolicy;
  readonly workspaceExists?: (workspaceId: string) => boolean;
  readonly defaultWorkspaceId?: string;
  readonly sessionGrantTtlMs?: number;
  readonly sessionGrantMaxUses?: number;
  readonly clock?: () => Date;
}

export interface PermissionProfileSettingsManager {
  status(): PermissionProfileSettingsStatus;
  permissionStatus(sessionId?: string, userId?: string): PermissionStatus;
  patch(input: unknown): PermissionProfileSettingsStatus;
  confirmFullHost(input: unknown, auth?: PermissionAuthContext): PermissionStatus;
  revoke(input: unknown, auth?: PermissionAuthContext): PermissionRevokeResult;
  snapshotForRun(config: RunConfig, authenticatedSessionId?: string): PermissionProfileRunSnapshot;
}

export type PermissionProfileSettingsErrorCode =
  | 'INVALID_SETTINGS'
  | 'CORRUPT_SETTINGS'
  | 'PERSISTENCE_FAILED'
  | 'REVISION_CONFLICT'
  | 'STALE_POLICY_REVISION'
  | 'AUTHENTICATION_REQUIRED'
  | 'POLICY_DENIED'
  | 'GRANT_NOT_FOUND';

export class PermissionProfileSettingsError extends Error {
  constructor(readonly code: PermissionProfileSettingsErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PermissionProfileSettingsError';
  }
}

export class DurablePermissionProfileSettingsManager implements PermissionProfileSettingsManager {
  private readonly settings: SettingsStore;
  private readonly policy: () => CapabilityProfilePolicy;
  private readonly workspaceExists: (workspaceId: string) => boolean;
  private readonly defaultWorkspaceId: string;
  private readonly clock: () => Date;
  private readonly grantTtlMs: number;
  private readonly grantMaxUses: number;
  private settingsValue: PermissionProfileSettings;
  private readonly grants = new Map<string, PermissionSessionGrant>();
  private readonly confirmations = new Map<string, PermissionConfirmation>();
  private readonly confirmationsByRequest = new Map<string, PermissionConfirmation>();

  constructor(options: PermissionProfileSettingsManagerOptions) {
    this.settings = options.settings;
    this.policy = options.policy;
    this.workspaceExists = options.workspaceExists ?? (() => true);
    this.defaultWorkspaceId = options.defaultWorkspaceId ?? 'default';
    this.clock = options.clock ?? (() => new Date());
    this.grantTtlMs = positiveBound(options.sessionGrantTtlMs ?? DEFAULT_GRANT_TTL_MS, 24 * 60 * 60 * 1_000);
    this.grantMaxUses = positiveBound(options.sessionGrantMaxUses ?? DEFAULT_GRANT_MAX_USES, 10_000);
    this.settingsValue = this.loadSettings();
    this.recoverStalePolicy();
  }

  status(): PermissionProfileSettingsStatus {
    const evaluatedAt = this.now();
    const evaluation = this.evaluate(this.baselineRunConfig(), undefined, false, evaluatedAt);
    const resolution = PermissionProfileResolutionSchema.parse({
      schemaVersion: 'ready4vibe_permission_profile_resolution_v1',
      status: evaluation.application.status,
      reasonCode: evaluation.application.reasonCode,
      requestedProfile: this.settingsValue.profile,
      effectiveProfile: evaluation.application.effectiveProfile,
      policyRevision: this.settingsValue.profile.policyRevision,
      ...(this.settingsValue.profile.capabilityRevision ? { capabilityRevision: this.settingsValue.profile.capabilityRevision } : {}),
      evaluatedAt,
      nextStep: nextStepFor(evaluation.application.reasonCode),
    });
    return PermissionProfileSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_permission_profile_settings_status_v1',
      settings: this.settingsValue,
      resolution,
      currentRevision: this.settingsValue.currentRevision,
      previousRevision: this.settingsValue.previousRevision,
    });
  }

  permissionStatus(sessionId?: string, userId: string = PERMISSION_LOCAL_USER_ID): PermissionStatus {
    const auth = sessionId ? { sessionId, userId } : undefined;
    const evaluatedAt = this.now();
    const evaluation = this.evaluate(this.baselineRunConfig(auth?.sessionId), auth, false, evaluatedAt);
    const grant = auth ? this.grants.get(auth.sessionId) : undefined;
    const effective = evaluation.application.effectiveProfile;
    const active = evaluation.application.status === 'ready' || evaluation.application.status === 'degraded';
    const confirmation = auth ? this.currentConfirmation(auth.sessionId, evaluatedAt) : undefined;
    const status = evaluation.application.reasonCode === 'SESSION_GRANT_REVOKED'
      ? 'revoked'
      : evaluation.application.reasonCode === 'SESSION_GRANT_EXPIRED' || evaluation.application.reasonCode === 'SESSION_GRANT_EXHAUSTED'
        ? 'expired'
        : evaluation.application.status;
    return PermissionStatusSchema.parse({
      schemaVersion: 'ready4vibe_permission_status_v1',
      status,
      reasonCode: evaluation.application.reasonCode,
      currentRevision: this.settingsValue.currentRevision,
      requestedProfile: this.settingsValue.profile,
      effectiveProfile: active ? effective : null,
      effectiveScope: active && effective ? this.runScope(effective, confirmation?.confirmationId) : null,
      grant: grant ?? null,
      grantExpiresAt: grant?.expiresAt ?? null,
      evaluatedAt,
      nextStep: nextStepFor(evaluation.application.reasonCode),
    });
  }

  patch(input: unknown): PermissionProfileSettingsStatus {
    let patch;
    try {
      patch = PermissionProfileSettingsPatchSchema.parse(input);
    } catch (error) {
      throw new PermissionProfileSettingsError('INVALID_SETTINGS', 'Permission profile settings are invalid.', { cause: error });
    }
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== this.settingsValue.currentRevision) {
      throw new PermissionProfileSettingsError('REVISION_CONFLICT', 'Permission profile revision is stale.');
    }
    const currentPolicy = this.policy();
    if (patch.profile.policyRevision !== currentPolicy.policyRevision) {
      throw new PermissionProfileSettingsError('STALE_POLICY_REVISION', 'Permission profile policy revision is stale.');
    }
    const nextRevision = nextProfileRevision(this.settingsValue.currentRevision);
    const nextProfile = PermissionProfileSchema.parse({
      ...patch.profile,
      profileRevision: nextRevision,
      updatedAt: this.now(),
    });
    const next = PermissionProfileSettingsSchema.parse({
      schemaVersion: PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION,
      profile: nextProfile,
      currentRevision: nextRevision,
      previousRevision: this.settingsValue.currentRevision,
      updatedAt: this.now(),
    });
    this.persist(next);
    this.settingsValue = next;
    return this.status();
  }

  confirmFullHost(input: unknown, auth?: PermissionAuthContext): PermissionStatus {
    if (!auth) throw new PermissionProfileSettingsError('AUTHENTICATION_REQUIRED', 'An authenticated session is required for full-host confirmation.');
    this.assertAuth(auth);
    let request;
    try {
      request = PermissionConfirmationRequestSchema.parse(input);
    } catch (error) {
      throw new PermissionProfileSettingsError('INVALID_SETTINGS', 'Full-host confirmation request is invalid.', { cause: error });
    }
    if (request.sessionId !== auth.sessionId || request.userId !== auth.userId) {
      throw new PermissionProfileSettingsError('AUTHENTICATION_REQUIRED', 'The confirmation session does not match the authenticated session.');
    }
    if (request.expectedProfileRevision !== this.settingsValue.currentRevision
      || request.requestedProfile.profileRevision !== this.settingsValue.currentRevision
      || request.requestedProfile.policyRevision !== this.policy().policyRevision) {
      throw new PermissionProfileSettingsError('REVISION_CONFLICT', 'Full-host confirmation targets a stale permission profile.');
    }
    if (request.requestedProfile.profileId !== 'full-host'
      || request.requestedProfile.taskTrust === 'untrusted-content'
      || (request.requestedProfile.approvalPosture !== 'explicit' && request.requestedProfile.approvalPosture !== 'session-auto')
      || (request.requestedProfile.filesystemScope !== 'host' && request.requestedProfile.processScope !== 'host')) {
      throw new PermissionProfileSettingsError('POLICY_DENIED', 'Only a trusted host-capable full-host profile can be confirmed.');
    }
    const existing = this.confirmationsByRequest.get(request.requestId);
    if (existing) {
      if (existing.sessionId !== auth.sessionId || existing.userId !== auth.userId || existing.profileRevision !== request.expectedProfileRevision) {
        throw new PermissionProfileSettingsError('POLICY_DENIED', 'The confirmation request id is already bound to another session or profile.');
      }
      return this.permissionStatus(auth.sessionId, auth.userId);
    }
    const confirmedAt = this.now();
    const expiresAt = new Date(Date.parse(confirmedAt) + this.grantTtlMs).toISOString();
    const confirmation = PermissionConfirmationSchema.parse({
      schemaVersion: 'ready4vibe_permission_confirmation_v1',
      confirmationId: `confirmation_${uuidv7()}`,
      requestId: request.requestId,
      sessionId: auth.sessionId,
      userId: auth.userId,
      profileId: request.requestedProfile.profileId,
      profileRevision: request.requestedProfile.profileRevision,
      policyRevision: request.requestedProfile.policyRevision,
      scopeFingerprint: `scope_${request.requestedProfile.profileRevision}`,
      acknowledged: true,
      confirmedAt,
      expiresAt,
      auditRef: `audit_${uuidv7()}`,
    });
    const grant = PermissionSessionGrantSchema.parse({
      schemaVersion: 'ready4vibe_permission_session_grant_v1',
      grantId: `grant_${uuidv7()}`,
      sessionId: auth.sessionId,
      userId: auth.userId,
      scope: {
        kind: 'session',
        profileId: request.requestedProfile.profileId,
        filesystemScope: request.requestedProfile.filesystemScope,
        processScope: request.requestedProfile.processScope,
        networkMode: request.requestedProfile.networkMode,
        mcpSkillMode: request.requestedProfile.mcpSkillMode,
        approvalPosture: request.requestedProfile.approvalPosture,
        taskTrust: request.requestedProfile.taskTrust,
        ...(request.requestedProfile.workspaceId ? { workspaceId: request.requestedProfile.workspaceId } : {}),
        ...(request.requestedProfile.sandboxRevision ? { sandboxRevision: request.requestedProfile.sandboxRevision } : {}),
        confirmationRef: confirmation.confirmationId,
      },
      policyRevision: request.requestedProfile.policyRevision,
      profileRevision: request.requestedProfile.profileRevision,
      ...(request.requestedProfile.capabilityRevision ? { capabilityRevision: request.requestedProfile.capabilityRevision } : {}),
      issuedAt: confirmedAt,
      expiresAt,
      maxUses: this.grantMaxUses,
      usedUses: 0,
      status: 'active',
      revokedAt: null,
      auditRef: confirmation.auditRef,
    });
    this.confirmations.set(auth.sessionId, confirmation);
    this.confirmationsByRequest.set(request.requestId, confirmation);
    this.grants.set(auth.sessionId, grant);
    return this.permissionStatus(auth.sessionId, auth.userId);
  }

  revoke(input: unknown, auth?: PermissionAuthContext): PermissionRevokeResult {
    if (!auth) throw new PermissionProfileSettingsError('AUTHENTICATION_REQUIRED', 'An authenticated session is required to revoke a permission grant.');
    this.assertAuth(auth);
    let request;
    try {
      request = PermissionRevokeRequestSchema.parse(input);
    } catch (error) {
      throw new PermissionProfileSettingsError('INVALID_SETTINGS', 'Permission revoke request is invalid.', { cause: error });
    }
    if (request.sessionId !== auth.sessionId || request.userId !== auth.userId) {
      throw new PermissionProfileSettingsError('AUTHENTICATION_REQUIRED', 'The revoke session does not match the authenticated session.');
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== this.settingsValue.currentRevision) {
      throw new PermissionProfileSettingsError('REVISION_CONFLICT', 'Permission profile revision is stale.');
    }
    const existing = this.grants.get(auth.sessionId);
    const targetId = request.grantId ?? existing?.grantId ?? 'grant_none';
    if (!existing || existing.grantId !== targetId) {
      return PermissionRevokeResultSchema.parse({
        schemaVersion: 'ready4vibe_permission_revoke_result_v1',
        requestId: request.requestId,
        grantId: targetId,
        status: 'not-found',
        currentRevision: this.settingsValue.currentRevision,
        revokedAt: null,
        auditRef: `audit_${uuidv7()}`,
      });
    }
    if (existing.status === 'revoked') {
      return PermissionRevokeResultSchema.parse({
        schemaVersion: 'ready4vibe_permission_revoke_result_v1',
        requestId: request.requestId,
        grantId: existing.grantId,
        status: 'already-revoked',
        currentRevision: this.settingsValue.currentRevision,
        revokedAt: existing.revokedAt,
        auditRef: existing.auditRef,
      });
    }
    const revokedAt = this.now();
    const revoked = PermissionSessionGrantSchema.parse({ ...existing, status: 'revoked', revokedAt });
    this.grants.set(auth.sessionId, revoked);
    this.confirmations.delete(auth.sessionId);
    return PermissionRevokeResultSchema.parse({
      schemaVersion: 'ready4vibe_permission_revoke_result_v1',
      requestId: request.requestId,
      grantId: existing.grantId,
      status: 'revoked',
      currentRevision: this.settingsValue.currentRevision,
      revokedAt,
      auditRef: existing.auditRef,
    });
  }

  snapshotForRun(config: RunConfig, authenticatedSessionId?: string): PermissionProfileRunSnapshot {
    const auth = authenticatedSessionId ? { sessionId: authenticatedSessionId, userId: PERMISSION_LOCAL_USER_ID } : undefined;
    const capturedAt = this.now();
    const evaluation = this.evaluate(config, auth, true, capturedAt);
    const effective = evaluation.application.effectiveProfile;
    const active = evaluation.application.status === 'ready' || evaluation.application.status === 'degraded';
    const confirmation = auth ? this.currentConfirmation(auth.sessionId, capturedAt) : undefined;
    const grant = auth ? this.grants.get(auth.sessionId) : undefined;
    const snapshot = PermissionProfileRunSnapshotSchema.parse({
      schemaVersion: 'ready4vibe_permission_profile_run_snapshot_v1',
      status: evaluation.application.status,
      reasonCode: evaluation.application.reasonCode,
      profileRevision: this.settingsValue.currentRevision,
      policyRevision: this.settingsValue.profile.policyRevision,
      requestedProfile: this.settingsValue.profile,
      effectiveProfile: active ? effective : null,
      effectiveScope: active && effective ? this.runScope(effective, confirmation?.confirmationId) : null,
      grantId: active && grant && grant.status === 'active' ? grant.grantId : null,
      grantExpiresAt: active && grant && grant.status === 'active' ? grant.expiresAt : null,
      capturedAt,
    });
    return deepFreeze(snapshot);
  }

  private evaluate(config: RunConfig, auth: PermissionAuthContext | undefined, consumeGrant: boolean, now: string): { application: PermissionProfileApplication; grant?: PermissionSessionGrant } {
    const profile = this.settingsValue.profile;
    const currentPolicy = this.policy();
    const hostCapable = profile.filesystemScope === 'host' || profile.processScope === 'host';
    if (config.taskTrust === 'untrusted-content' && hostCapable) {
      return { application: blocked('UNTRUSTED_CONTENT', config.approval) };
    }
    if (config.taskTrust === 'untrusted-content' && config.sandbox.mode !== 'external-sandbox') {
      return { application: blocked('SANDBOX_REQUIRED', config.approval) };
    }
    if (profile.workspaceId && !this.workspaceExists(profile.workspaceId)) {
      return { application: blocked('WORKSPACE_UNAVAILABLE', config.approval) };
    }
    if (hostCapable && currentPolicy.hostRunnerHealth !== 'ready') {
      return { application: blocked('CAPABILITY_UNAVAILABLE', config.approval) };
    }
    if (profile.processScope === 'external-sandbox' && currentPolicy.externalSandboxHealth !== 'ready') {
      return { application: blocked('SANDBOX_UNAVAILABLE', config.approval) };
    }
    const confirmation = auth ? this.currentConfirmation(auth.sessionId, now) : undefined;
    const grant = auth ? this.grants.get(auth.sessionId) : undefined;
    if (hostCapable && grant?.status === 'revoked') {
      return { application: blocked('SESSION_GRANT_REVOKED', config.approval), grant };
    }
    if (hostCapable && grant?.status === 'expired') {
      return { application: blocked('SESSION_GRANT_EXPIRED', config.approval), grant };
    }
    if (hostCapable && grant?.status === 'exhausted') {
      return { application: blocked('SESSION_GRANT_EXHAUSTED', config.approval), grant };
    }
    if (hostCapable && !confirmation) {
      return { application: blocked(auth ? 'FULL_HOST_CONFIRMATION_REQUIRED' : 'FULL_HOST_CONFIRMATION_REQUIRED', config.approval) };
    }
    const sessionGrant = auth && profile.approvalPosture === 'session-auto' ? grant : undefined;
    const application = resolvePermissionProfile({
      profile,
      run: {
        workspaceId: config.workspaceId,
        taskTrust: config.taskTrust,
        sandbox: config.sandbox,
        approval: config.approval,
        createdBySessionId: config.createdBySessionId,
      },
      currentPolicyRevision: currentPolicy.policyRevision,
      currentProfileRevision: this.settingsValue.currentRevision,
      currentSandboxRevision: SANDBOX_REVISION,
      fullHostConfirmed: confirmation !== undefined,
      ...(auth ? { sessionId: auth.sessionId, userId: auth.userId } : {}),
      ...(sessionGrant ? { sessionGrant } : {}),
      now,
    });
    if (application.status === 'ready' && sessionGrant && consumeGrant) {
      this.consumeGrant(auth!.sessionId, sessionGrant, now);
    }
    return { application, ...(grant ? { grant: this.grants.get(auth!.sessionId) ?? grant } : {}) };
  }

  private consumeGrant(sessionId: string, grant: PermissionSessionGrant, now: string): void {
    if (grant.status !== 'active' || Date.parse(grant.expiresAt) <= Date.parse(now)) return;
    const usedUses = grant.usedUses + 1;
    const next = PermissionSessionGrantSchema.parse({
      ...grant,
      usedUses,
      status: usedUses >= grant.maxUses ? 'exhausted' : 'active',
    });
    this.grants.set(sessionId, next);
  }

  private currentConfirmation(sessionId: string, now: string): PermissionConfirmation | undefined {
    const confirmation = this.confirmations.get(sessionId);
    if (!confirmation) return undefined;
    if (Date.parse(confirmation.expiresAt) <= Date.parse(now)) {
      this.confirmations.delete(sessionId);
      const grant = this.grants.get(sessionId);
      if (grant && grant.status === 'active') this.grants.set(sessionId, PermissionSessionGrantSchema.parse({ ...grant, status: 'expired' }));
      return undefined;
    }
    if (confirmation.profileRevision !== this.settingsValue.currentRevision || confirmation.policyRevision !== this.policy().policyRevision) return undefined;
    return confirmation;
  }

  private permissionScopeProfile(profile: PermissionProfile, confirmationRef?: string) {
    return {
      kind: 'run' as const,
      profileId: profile.profileId,
      filesystemScope: profile.filesystemScope,
      processScope: profile.processScope,
      networkMode: profile.networkMode,
      mcpSkillMode: profile.mcpSkillMode,
      approvalPosture: profile.approvalPosture,
      taskTrust: profile.taskTrust,
      ...(profile.workspaceId ? { workspaceId: profile.workspaceId } : {}),
      ...(profile.sandboxRevision ? { sandboxRevision: profile.sandboxRevision } : {}),
      ...(confirmationRef ? { confirmationRef } : {}),
    };
  }

  private runScope(profile: PermissionProfile, confirmationRef?: string) {
    return this.permissionScopeProfile(profile, confirmationRef);
  }

  private baselineRunConfig(sessionId = SETTINGS_SESSION_ID): RunConfig {
    const profile = this.settingsValue.profile;
    const network: 'enabled' | 'restricted' = profile.networkMode === 'enabled' ? 'enabled' : 'restricted';
    const sandbox = profile.filesystemScope === 'host' || profile.processScope === 'host'
      ? { mode: 'danger-full-access' as const, enabledBy: 'explicit-user-only' as const }
      : profile.processScope === 'external-sandbox'
        ? { mode: 'external-sandbox' as const, provider: 'docker' as const, network }
        : { mode: 'read-only' as const, network };
    return {
      workspaceId: profile.workspaceId ?? this.defaultWorkspaceId,
      userMessage: 'permission status',
      model: { provider: 'fake', name: 'status' },
      // Settings projection is a trusted local baseline; actual run trust is
      // supplied by the caller and is checked again in snapshotForRun().
      taskTrust: 'trusted-workspace',
      sandbox,
      approval: profile.approvalPosture === 'none' ? 'never' : 'on-request',
      limits: { maxTurns: 1, maxWallTimeMs: 60_000, maxModelInputTokens: 1, maxModelOutputTokens: 1, maxToolCalls: 1, maxOutputBytes: 1, maxContextBytes: 1 },
      createdBySessionId: sessionId,
      clientRequestId: 'permission-status',
    };
  }

  private loadSettings(): PermissionProfileSettings {
    const stored = this.settings.get<unknown>(PERMISSION_PROFILE_SETTINGS_NAMESPACE, PERMISSION_PROFILE_SETTINGS_KEY);
    if (stored === undefined) {
      const initial = this.createDefaultSettings('profile-1');
      this.persist(initial);
      return initial;
    }
    try {
      const parsed = PermissionProfileSettingsSchema.parse(stored);
      if (parsed.currentRevision !== parsed.profile.profileRevision) throw new Error('profile revision mismatch');
      return parsed;
    } catch (error) {
      throw new PermissionProfileSettingsError('CORRUPT_SETTINGS', 'Stored permission profile settings are invalid.', { cause: error });
    }
  }

  private recoverStalePolicy(): void {
    const currentPolicy = this.policy();
    if (this.settingsValue.profile.policyRevision === currentPolicy.policyRevision) return;
    const next = this.createDefaultSettings(nextProfileRevision(this.settingsValue.currentRevision));
    const recovered = PermissionProfileSettingsSchema.parse({ ...next, previousRevision: this.settingsValue.currentRevision });
    this.persist(recovered);
    this.settingsValue = recovered;
  }

  private createDefaultSettings(revision: string): PermissionProfileSettings {
    const now = this.now();
    const profile = createSafeDefaultPermissionProfile({
      profileRevision: revision,
      policyRevision: this.policy().policyRevision,
      updatedAt: now,
      workspaceId: this.defaultWorkspaceId,
    });
    return PermissionProfileSettingsSchema.parse({
      schemaVersion: PERMISSION_PROFILE_SETTINGS_SCHEMA_VERSION,
      profile,
      currentRevision: revision,
      previousRevision: null,
      updatedAt: now,
    });
  }

  private persist(value: PermissionProfileSettings): void {
    try {
      this.settings.set(PERMISSION_PROFILE_SETTINGS_NAMESPACE, PERMISSION_PROFILE_SETTINGS_KEY, value);
    } catch (error) {
      throw new PermissionProfileSettingsError('PERSISTENCE_FAILED', 'Permission profile settings could not be saved.', { cause: error });
    }
  }

  private assertAuth(auth: PermissionAuthContext): void {
    if (!auth.sessionId || auth.userId !== PERMISSION_LOCAL_USER_ID) {
      throw new PermissionProfileSettingsError('AUTHENTICATION_REQUIRED', 'The authenticated session is invalid.');
    }
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

function positiveBound(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error('permission grant bound is invalid');
  return value;
}

function nextProfileRevision(value: string): string {
  const match = /^profile-(\d+)$/u.exec(value);
  const current = match ? Number(match[1]) : 0;
  return `profile-${Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1}`;
}

function blocked(reasonCode: PermissionProfileApplication['reasonCode'], approval: RunConfig['approval']): PermissionProfileApplication {
  return {
    status: 'blocked',
    reasonCode,
    effectiveProfile: null,
    approvalPolicy: approval,
    networkAccess: 'restricted',
    dangerFullAccessConfirmed: false,
  };
}

function nextStepFor(reasonCode: PermissionProfileApplication['reasonCode']): string {
  switch (reasonCode) {
    case 'PROFILE_READY': return 'continue';
    case 'FULL_HOST_CONFIRMATION_REQUIRED': return 'confirm_full_host';
    case 'SESSION_GRANT_REQUIRED': return 'confirm_full_host';
    case 'SESSION_GRANT_EXHAUSTED': return 'confirm_full_host';
    case 'SESSION_GRANT_REVOKED': return 'confirm_full_host';
    case 'SESSION_GRANT_EXPIRED': return 'confirm_full_host';
    case 'CAPABILITY_UNAVAILABLE': return 'enable_host_runner';
    case 'SANDBOX_REQUIRED': return 'configure_external_sandbox';
    case 'SANDBOX_UNAVAILABLE': return 'repair_external_sandbox';
    case 'WORKSPACE_UNAVAILABLE': return 'select_workspace';
    default: return 'review_permission_settings';
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
