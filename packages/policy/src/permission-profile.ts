import type {
  ApprovalPolicy,
  PermissionProfile,
  PermissionReasonCode,
  PermissionSessionGrant,
  PermissionResolutionStatus,
  RunConfig,
} from '@ready4vibe/contracts';
import {
  parsePermissionProfile,
  parsePermissionSessionGrant,
} from '@ready4vibe/contracts';
import type { ToolRisk } from '@ready4vibe/tools';
import { ToolRegistry, type ToolSandboxMode } from '@ready4vibe/tools';
import { compilePolicy, type CompiledPolicy, type PolicyGrantSnapshot } from './compiler.js';

export interface PermissionProfileApplicationInput {
  readonly profile: PermissionProfile;
  readonly run: Pick<RunConfig, 'workspaceId' | 'taskTrust' | 'sandbox' | 'approval' | 'createdBySessionId'>;
  readonly currentPolicyRevision: string;
  readonly currentProfileRevision?: string;
  readonly currentSandboxRevision?: string;
  /** Application-bound confirmation; the profile flag alone is not a grant. */
  readonly fullHostConfirmed?: boolean;
  readonly sessionId?: string;
  readonly userId?: string;
  readonly sessionGrant?: PermissionSessionGrant;
  readonly now?: string;
}

export interface PermissionProfileApplication {
  readonly status: PermissionResolutionStatus;
  readonly reasonCode: PermissionReasonCode;
  readonly effectiveProfile: PermissionProfile | null;
  readonly approvalPolicy: ApprovalPolicy;
  readonly networkAccess: 'restricted' | 'enabled';
  readonly dangerFullAccessConfirmed: boolean;
}

export interface PermissionToolDescriptor {
  readonly id: string;
  readonly risk: ToolRisk;
}

export interface PermissionPolicyCompileInput extends PermissionProfileApplicationInput {
  readonly registry: ToolRegistry;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly risk: ToolRisk;
  readonly argumentsFingerprint: string;
  readonly networkApproval?: 'none' | 'explicit';
  readonly grant?: PolicyGrantSnapshot;
}

export interface PermissionPolicyCompilation {
  readonly application: PermissionProfileApplication;
  readonly compiled?: CompiledPolicy;
}

/**
 * Resolve permission intent against the existing run boundary. This function
 * is pure and never creates a grant, starts a sandbox or invokes a tool.
 * Narrowing is allowed; widening is always rejected.
 */
export function resolvePermissionProfile(input: PermissionProfileApplicationInput): PermissionProfileApplication {
  let profile: PermissionProfile;
  try {
    profile = parsePermissionProfile(input.profile);
  } catch {
    return blocked('INVALID_REQUEST', input.run.approval);
  }

  if (profile.policyRevision !== input.currentPolicyRevision) {
    return blocked('STALE_POLICY_REVISION', input.run.approval);
  }
  if (input.currentProfileRevision !== undefined && profile.profileRevision !== input.currentProfileRevision) {
    return blocked('STALE_PROFILE_REVISION', input.run.approval);
  }
  if (profile.sandboxRevision !== undefined && input.currentSandboxRevision !== undefined && profile.sandboxRevision !== input.currentSandboxRevision) {
    return blocked('STALE_POLICY_REVISION', input.run.approval);
  }

  const workspaceRequired = profile.filesystemScope === 'workspace-only'
    || profile.processScope === 'external-sandbox'
    || profile.mcpSkillMode === 'configured';
  if (workspaceRequired && (!profile.workspaceId || profile.workspaceId !== input.run.workspaceId)) {
    return blocked('WORKSPACE_UNAVAILABLE', input.run.approval);
  }
  if (profile.taskTrust !== 'untrusted-content' && input.run.taskTrust === 'untrusted-content') {
    return blocked('UNTRUSTED_CONTENT', input.run.approval);
  }

  const hostCapable = profile.filesystemScope === 'host' || profile.processScope === 'host';
  if (!hostCapable && input.run.sandbox.mode === 'danger-full-access') {
    return blocked('POLICY_DENIED', input.run.approval);
  }
  if (hostCapable) {
    if (input.run.taskTrust === 'untrusted-content' || profile.taskTrust === 'untrusted-content') {
      return blocked('UNTRUSTED_CONTENT', input.run.approval);
    }
    if (input.fullHostConfirmed !== true) return blocked('FULL_HOST_CONFIRMATION_REQUIRED', input.run.approval);
    if (input.run.sandbox.mode !== 'danger-full-access') return blocked('POLICY_DENIED', input.run.approval);
  }

  if (profile.processScope === 'external-sandbox' && input.run.sandbox.mode !== 'external-sandbox') {
    return blocked('SANDBOX_REQUIRED', input.run.approval);
  }
  if (profile.processScope === 'external-sandbox' && input.run.sandbox.mode === 'external-sandbox'
    && profile.sandboxRevision !== undefined && input.currentSandboxRevision === undefined) {
    return blocked('SANDBOX_UNAVAILABLE', input.run.approval);
  }

  const runNetwork = 'network' in input.run.sandbox ? input.run.sandbox.network : 'restricted';
  if (profile.networkMode === 'enabled' && runNetwork !== 'enabled') return blocked('POLICY_DENIED', input.run.approval);
  if (profile.networkMode === 'restricted' && runNetwork === 'enabled') return blocked('POLICY_DENIED', input.run.approval);
  if (input.run.approval === 'never' && profile.approvalPosture !== 'none') return blocked('POLICY_DENIED', input.run.approval);

  if (profile.approvalPosture === 'session-auto') {
    const grantResult = validateSessionGrant(input, profile);
    if (grantResult !== undefined) return blocked(grantResult, input.run.approval);
  }

  return {
    status: 'ready',
    reasonCode: 'PROFILE_READY',
    effectiveProfile: profile,
    approvalPolicy: approvalPolicyFor(profile, input.run.approval),
    networkAccess: runNetwork,
    dangerFullAccessConfirmed: hostCapable && input.fullHostConfirmed === true,
  };
}

/**
 * Reuse the existing compiler after profile resolution. A blocked permission
 * application never reaches the compiler; a ready application is still
 * subject to the compiler's registered-tool, schema, risk, grant and policy
 * checks.
 */
export function compilePermissionProfilePolicy(input: PermissionPolicyCompileInput): PermissionPolicyCompilation {
  const application = resolvePermissionProfile(input);
  if (application.effectiveProfile === null) return { application };
  const profile = application.effectiveProfile;
  const sandboxMode: ToolSandboxMode = profile.processScope === 'host' || profile.filesystemScope === 'host'
    ? 'danger-full-access'
    : input.run.sandbox.mode;
  const sandboxProvider = input.run.sandbox.mode === 'external-sandbox' ? input.run.sandbox.provider : undefined;
  const taskTrust = input.run.taskTrust;
  const compiled = compilePolicy({
    registry: input.registry,
    workspaceId: input.run.workspaceId,
    toolId: input.toolId,
    toolVersion: input.toolVersion,
    risk: input.risk,
    taskTrust,
    sandboxMode,
    ...(sandboxProvider === undefined ? {} : { sandboxProvider }),
    networkAccess: application.networkAccess,
    ...(input.networkApproval === undefined ? {} : { networkApproval: input.networkApproval }),
    approvalPolicy: application.approvalPolicy,
    policyRevision: profile.policyRevision,
    currentPolicyRevision: input.currentPolicyRevision,
    sessionId: input.run.createdBySessionId,
    argumentsFingerprint: input.argumentsFingerprint,
    ...(profile.filesystemScope === 'host' ? {} : { writeScope: 'workspace' as const }),
    dangerFullAccessConfirmed: application.dangerFullAccessConfirmed,
    ...(input.grant === undefined ? {} : { grant: input.grant }),
  });
  return { application, compiled };
}

/** Filter only by permission families; the underlying ToolExecutor remains authoritative. */
export function permissionToolAllowed(profile: PermissionProfile, descriptor: PermissionToolDescriptor): boolean {
  const id = descriptor.id;
  if (id.startsWith('filesystem.') || id.startsWith('git.')) return profile.filesystemScope === 'workspace-only' || profile.filesystemScope === 'host';
  if (id === 'shell.exec' || id.startsWith('shell.')) return profile.processScope !== 'none';
  if (id.includes('/tool/') || id.startsWith('mcp.')) return profile.mcpSkillMode === 'configured';
  if (id.startsWith('network.')) return profile.networkMode !== 'off';
  return false;
}

function validateSessionGrant(input: PermissionProfileApplicationInput, profile: PermissionProfile): PermissionReasonCode | undefined {
  if (!input.sessionGrant || !input.sessionId || !input.userId) return 'SESSION_GRANT_REQUIRED';
  let grant: PermissionSessionGrant;
  try {
    grant = parsePermissionSessionGrant(input.sessionGrant);
  } catch {
    return 'SESSION_GRANT_REQUIRED';
  }
  const now = Date.parse(input.now ?? new Date().toISOString());
  if (!Number.isFinite(now)) return 'INVALID_REQUEST';
  if (grant.sessionId !== input.sessionId || input.sessionId !== input.run.createdBySessionId || grant.userId !== input.userId) return 'POLICY_DENIED';
  if (grant.policyRevision !== input.currentPolicyRevision) return 'STALE_POLICY_REVISION';
  if (grant.profileRevision !== profile.profileRevision) return 'STALE_PROFILE_REVISION';
  const expectedWorkspaceId = profile.filesystemScope === 'workspace-only' ? profile.workspaceId : undefined;
  if (grant.scope.profileId !== profile.profileId
    || grant.scope.workspaceId !== expectedWorkspaceId
    || grant.scope.filesystemScope !== profile.filesystemScope
    || grant.scope.processScope !== profile.processScope
    || grant.scope.networkMode !== profile.networkMode
    || grant.scope.mcpSkillMode !== profile.mcpSkillMode
    || grant.scope.taskTrust !== profile.taskTrust
    || grant.scope.approvalPosture !== 'session-auto') return 'POLICY_DENIED';
  if (grant.status === 'revoked') return 'SESSION_GRANT_REVOKED';
  if (grant.status === 'exhausted' || grant.usedUses >= grant.maxUses) return 'SESSION_GRANT_EXHAUSTED';
  if (grant.status !== 'active' || Date.parse(grant.expiresAt) <= now) return 'SESSION_GRANT_EXPIRED';
  return undefined;
}

function approvalPolicyFor(profile: PermissionProfile, configured: ApprovalPolicy): ApprovalPolicy {
  if (profile.approvalPosture === 'none') return 'never';
  if (configured === 'never') return 'never';
  return configured;
}

function blocked(reasonCode: PermissionReasonCode, configured: ApprovalPolicy): PermissionProfileApplication {
  return {
    status: 'blocked',
    reasonCode,
    effectiveProfile: null,
    approvalPolicy: configured,
    networkAccess: 'restricted',
    dangerFullAccessConfirmed: false,
  };
}
