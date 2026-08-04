import { createHash } from 'node:crypto';
import type { ApprovalPolicy as ApprovalPolicyConfig, TaskTrust } from '@ready4vibe/contracts';
import { ToolRegistry, type ToolDescriptor, type ToolRisk, type ToolSandboxMode } from '@ready4vibe/tools';

export type CompiledPolicyDecision = 'allow' | 'ask' | 'deny';
export type ClientPolicyDecision = CompiledPolicyDecision;
export type NetworkApproval = 'none' | 'explicit';
export type WorkspaceWriteScope = 'workspace' | 'outside-workspace';

export type PolicyReasonCode =
  | 'READ_ONLY'
  | 'SESSION_GRANT'
  | 'USER_APPROVAL_REQUIRED'
  | 'CLIENT_REQUESTED_APPROVAL'
  | 'CLIENT_DENIED'
  | 'NETWORK_APPROVAL_REQUIRED'
  | 'UNKNOWN_TOOL'
  | 'SCHEMA_UNAVAILABLE'
  | 'SCHEMA_UNSAFE'
  | 'RISK_MISMATCH'
  | 'SANDBOX_UNSUPPORTED'
  | 'SANDBOX_PROVIDER_REQUIRED'
  | 'SANDBOX_PROVIDER_MISMATCH'
  | 'UNTRUSTED_REQUIRES_EXTERNAL_SANDBOX'
  | 'UNTRUSTED_NETWORK_FORBIDDEN'
  | 'DANGER_FULL_ACCESS_FORBIDDEN'
  | 'PRIVILEGE_FORBIDDEN'
  | 'WORKSPACE_SCOPE_FORBIDDEN'
  | 'NETWORK_DISABLED'
  | 'APPROVAL_DISABLED'
  | 'PERMISSION_REQUEST_DISABLED'
  | 'STALE_POLICY_REVISION'
  | 'INVALID_ARGUMENT_FINGERPRINT'
  | 'INVALID_POLICY_INPUT'
  | 'GRANT_KEY_MISMATCH'
  | 'GRANT_EXPIRED'
  | 'GRANT_EXHAUSTED'
  | 'GRANT_NOT_ELIGIBLE'
  | 'DESTRUCTIVE_OPERATION';

export const POLICY_AUDIT_SCHEMA_VERSION = 'ready4vibe_policy_audit_v1' as const;
export const POLICY_APPROVAL_KEY_SCHEMA_VERSION = 'ready4vibe_policy_approval_key_v1' as const;

export interface PolicyCompileInput {
  readonly registry: ToolRegistry;
  readonly workspaceId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly risk: ToolRisk;
  readonly taskTrust: TaskTrust;
  readonly sandboxMode: ToolSandboxMode;
  readonly sandboxProvider?: 'docker' | 'podman' | 'vm';
  readonly networkAccess: 'restricted' | 'enabled';
  readonly networkApproval?: NetworkApproval;
  readonly approvalPolicy?: ApprovalPolicyConfig;
  readonly policyRevision: string;
  readonly currentPolicyRevision: string;
  readonly sessionId: string;
  /** SHA-256 of canonical, validated tool arguments; raw arguments never enter this API. */
  readonly argumentsFingerprint: string;
  readonly writeScope?: WorkspaceWriteScope;
  readonly privilegeRequested?: boolean;
  readonly dangerFullAccessConfirmed?: boolean;
  readonly clientRequestedDecision?: ClientPolicyDecision;
  readonly now?: number;
  readonly grant?: PolicyGrantSnapshot;
}

export interface PolicyApprovalKeyInput {
  readonly workspaceId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly risk: ToolRisk;
  readonly taskTrust: TaskTrust;
  readonly sandboxMode: ToolSandboxMode;
  readonly sandboxProvider?: 'docker' | 'podman' | 'vm';
  readonly networkAccess: 'restricted' | 'enabled';
  readonly policyRevision: string;
  readonly sessionId: string;
  readonly argumentsFingerprint: string;
}

export interface EffectivePolicy {
  readonly sandboxMode: ToolSandboxMode;
  readonly networkAccess: 'restricted' | 'enabled';
}

export interface PolicyAuditMetadata {
  readonly schemaVersion: typeof POLICY_AUDIT_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly risk: ToolRisk;
  readonly taskTrust: TaskTrust;
  readonly sandboxMode: ToolSandboxMode;
  readonly sandboxProvider?: 'docker' | 'podman' | 'vm';
  readonly networkAccess: 'restricted' | 'enabled';
  readonly argumentFingerprint: string;
  readonly policyRevision: string;
  readonly decision: CompiledPolicyDecision;
  readonly reasonCode: PolicyReasonCode;
  readonly reason: string;
}

export interface CompiledPolicy {
  readonly decision: CompiledPolicyDecision;
  readonly reasonCode: PolicyReasonCode;
  readonly reason: string;
  readonly approvalKey: string;
  readonly effective: EffectivePolicy;
  readonly audit: PolicyAuditMetadata;
  readonly grant?: PolicyGrantSnapshot;
}

export interface PolicyGrantSnapshot {
  readonly approvalKey: string;
  readonly policyRevision: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly remainingUses: number;
  readonly reason: string;
}

export type GrantInspectionState = 'missing' | 'active' | 'stale' | 'expired' | 'exhausted';

export interface GrantInspection {
  readonly state: GrantInspectionState;
  readonly grant?: PolicyGrantSnapshot;
}

export interface GrantIssueOptions {
  readonly ttlMs: number;
  readonly maxUses: number;
  readonly reason: string;
  readonly now?: number;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const SAFE_REVISION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_FINGERPRINT = /^[a-f0-9]{64}$/u;
const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SECRET_SHAPED = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|environment|env|bearer)/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const APPROVAL_KEY = /^approval\.v1\.[a-f0-9]{64}$/u;
const MAX_GRANT_TTL_MS = 5 * 60 * 1_000;
const MAX_GRANT_USES = 16;

const REASONS: Readonly<Record<PolicyReasonCode, string>> = {
  READ_ONLY: 'Read-only work is allowed by the server policy.',
  SESSION_GRANT: 'An exact, bounded session grant applies to this request.',
  USER_APPROVAL_REQUIRED: 'User approval is required for this request.',
  CLIENT_REQUESTED_APPROVAL: 'The client requested an additional approval step.',
  CLIENT_DENIED: 'The client denied this request.',
  NETWORK_APPROVAL_REQUIRED: 'Network access requires an explicit user amendment.',
  UNKNOWN_TOOL: 'The requested tool is not registered.',
  SCHEMA_UNAVAILABLE: 'The registered tool has no validated input schema.',
  SCHEMA_UNSAFE: 'The registered tool schema contains unsafe metadata.',
  RISK_MISMATCH: 'The requested risk does not match the registered tool.',
  SANDBOX_UNSUPPORTED: 'The selected sandbox does not support this tool.',
  SANDBOX_PROVIDER_REQUIRED: 'An external sandbox provider is required.',
  SANDBOX_PROVIDER_MISMATCH: 'The sandbox provider does not match the selected mode.',
  UNTRUSTED_REQUIRES_EXTERNAL_SANDBOX: 'Untrusted content requires an external sandbox.',
  UNTRUSTED_NETWORK_FORBIDDEN: 'Untrusted content cannot use network access in this policy.',
  DANGER_FULL_ACCESS_FORBIDDEN: 'Full host access requires an explicit user-only confirmation.',
  PRIVILEGE_FORBIDDEN: 'Privilege changes are not permitted by this policy.',
  WORKSPACE_SCOPE_FORBIDDEN: 'Writes outside the selected workspace are not permitted.',
  NETWORK_DISABLED: 'Network access is disabled by the effective policy.',
  APPROVAL_DISABLED: 'Approval is disabled for this request.',
  PERMISSION_REQUEST_DISABLED: 'The configured policy does not permit permission requests.',
  STALE_POLICY_REVISION: 'The policy revision is stale and must be re-evaluated.',
  INVALID_ARGUMENT_FINGERPRINT: 'The argument fingerprint is invalid.',
  INVALID_POLICY_INPUT: 'The policy input is invalid.',
  GRANT_KEY_MISMATCH: 'The approval grant does not match this exact request.',
  GRANT_EXPIRED: 'The approval grant has expired.',
  GRANT_EXHAUSTED: 'The approval grant has no remaining uses.',
  GRANT_NOT_ELIGIBLE: 'This request is not eligible for automatic approval.',
  DESTRUCTIVE_OPERATION: 'Destructive work requires an explicit sandbox and approval.',
};

/**
 * Create the opaque exact-match key used by grants. The canonical payload is
 * deliberately limited to safe metadata and the argument hash.
 */
export function createPolicyApprovalKey(input: PolicyApprovalKeyInput): string {
  if (!validateKeyInput(input)) return 'approval.v1.invalid';
  const canonical = JSON.stringify({
    schemaVersion: POLICY_APPROVAL_KEY_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    toolId: input.toolId,
    toolVersion: input.toolVersion,
    risk: input.risk,
    taskTrust: input.taskTrust,
    sandboxMode: input.sandboxMode,
    sandboxProvider: input.sandboxProvider ?? null,
    networkAccess: input.networkAccess,
    policyRevision: input.policyRevision,
    sessionId: input.sessionId,
    argumentsFingerprint: input.argumentsFingerprint,
  });
  return `approval.v1.${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/**
 * Pure policy compilation. No filesystem, process, network, event-store or
 * scheduler operation is performed here.
 */
export function compilePolicy(input: PolicyCompileInput): CompiledPolicy {
  const invalid = validateInput(input);
  if (invalid !== undefined) return invalidResult(invalid);

  const descriptor = input.registry.get(input.toolId, input.toolVersion);
  const approvalKey = createPolicyApprovalKey(input);
  if (!descriptor) return result(input, approvalKey, 'deny', 'UNKNOWN_TOOL');
  if (!isSafeSchema(descriptor.inputSchema)) {
    return result(input, approvalKey, 'deny', descriptor.inputSchema === undefined ? 'SCHEMA_UNAVAILABLE' : 'SCHEMA_UNSAFE');
  }
  if (descriptor.risk !== input.risk) return result(input, approvalKey, 'deny', 'RISK_MISMATCH');
  if (!descriptor.supportedSandboxModes.includes(input.sandboxMode)) return result(input, approvalKey, 'deny', 'SANDBOX_UNSUPPORTED');
  if (input.sandboxMode === 'external-sandbox' && input.sandboxProvider === undefined) return result(input, approvalKey, 'deny', 'SANDBOX_PROVIDER_REQUIRED');
  if (input.sandboxMode !== 'external-sandbox' && input.sandboxProvider !== undefined) return result(input, approvalKey, 'deny', 'SANDBOX_PROVIDER_MISMATCH');
  if (input.taskTrust === 'untrusted-content' && input.sandboxMode !== 'external-sandbox') {
    return result(input, approvalKey, 'deny', 'UNTRUSTED_REQUIRES_EXTERNAL_SANDBOX');
  }
  if (input.sandboxMode === 'danger-full-access' && input.dangerFullAccessConfirmed !== true) {
    return result(input, approvalKey, 'deny', 'DANGER_FULL_ACCESS_FORBIDDEN');
  }
  if (input.privilegeRequested === true) return result(input, approvalKey, 'deny', 'PRIVILEGE_FORBIDDEN');
  if (input.writeScope === 'outside-workspace') return result(input, approvalKey, 'deny', 'WORKSPACE_SCOPE_FORBIDDEN');
  if (input.policyRevision !== input.currentPolicyRevision) return result(input, approvalKey, 'deny', 'STALE_POLICY_REVISION');

  if (input.risk === 'network') {
    if (input.taskTrust === 'untrusted-content') return result(input, approvalKey, 'deny', 'UNTRUSTED_NETWORK_FORBIDDEN');
    if (input.networkAccess !== 'enabled') return result(input, approvalKey, 'deny', 'NETWORK_DISABLED');
    if (input.networkApproval !== 'explicit') return applyClientDecision(input, result(input, approvalKey, 'ask', 'NETWORK_APPROVAL_REQUIRED'));
  }

  if (input.risk !== 'read' && isApprovalDisabled(input.approvalPolicy)) return result(input, approvalKey, 'deny', 'APPROVAL_DISABLED');
  if (input.risk !== 'read' && isPermissionRequestDisabled(input.approvalPolicy)) return result(input, approvalKey, 'deny', 'PERMISSION_REQUEST_DISABLED');

  const grantDecision = evaluateGrant(input, approvalKey);
  if (grantDecision !== undefined) return applyClientDecision(input, grantDecision);

  let decision: CompiledPolicy = result(input, approvalKey, 'ask', 'USER_APPROVAL_REQUIRED');
  if (input.risk === 'read') decision = result(input, approvalKey, 'allow', 'READ_ONLY');
  else if (input.risk === 'destructive' && input.sandboxMode !== 'external-sandbox') {
    decision = result(input, approvalKey, 'deny', 'DESTRUCTIVE_OPERATION');
  } else if (input.risk === 'destructive' || input.taskTrust === 'untrusted-content') {
    decision = result(input, approvalKey, 'ask', 'USER_APPROVAL_REQUIRED');
  }
  if (input.sandboxMode === 'danger-full-access' && input.risk !== 'read') {
    decision = result(input, approvalKey, 'ask', 'DANGER_FULL_ACCESS_FORBIDDEN');
  }
  return applyClientDecision(input, decision);
}

/** A bounded in-memory grant store; persistence belongs to a later phase. */
export class BoundedApprovalGrantStore {
  private readonly grants = new Map<string, PolicyGrantSnapshot>();

  issue(approvalKey: string, policyRevision: string, options: GrantIssueOptions): PolicyGrantSnapshot {
    if (!APPROVAL_KEY.test(approvalKey)) throw new Error('approval key is invalid');
    if (!SAFE_REVISION.test(policyRevision)) throw new Error('policy revision is invalid');
    const now = options.now ?? Date.now();
    if (!isSafeTimestamp(now)) throw new Error('grant timestamp is invalid');
    if (!Number.isSafeInteger(options.ttlMs) || options.ttlMs <= 0 || options.ttlMs > MAX_GRANT_TTL_MS) throw new Error('grant ttl is outside its bound');
    if (!Number.isSafeInteger(options.maxUses) || options.maxUses <= 0 || options.maxUses > MAX_GRANT_USES) throw new Error('grant uses are outside their bound');
    if (!isSafeReason(options.reason)) throw new Error('grant reason is invalid');
    const grant: PolicyGrantSnapshot = Object.freeze({
      approvalKey,
      policyRevision,
      issuedAt: now,
      expiresAt: now + options.ttlMs,
      remainingUses: options.maxUses,
      reason: options.reason,
    });
    this.grants.set(approvalKey, grant);
    return grant;
  }

  inspect(approvalKey: string, policyRevision: string, now = Date.now()): GrantInspection {
    const grant = this.grants.get(approvalKey);
    if (!grant) return { state: 'missing' };
    if (grant.policyRevision !== policyRevision) return { state: 'stale', grant };
    if (grant.expiresAt <= now) return { state: 'expired', grant };
    if (grant.remainingUses <= 0) return { state: 'exhausted', grant };
    return { state: 'active', grant };
  }

  consume(approvalKey: string, policyRevision: string, now = Date.now()): boolean {
    const inspection = this.inspect(approvalKey, policyRevision, now);
    if (inspection.state !== 'active' || inspection.grant === undefined) return false;
    const next = Object.freeze({ ...inspection.grant, remainingUses: inspection.grant.remainingUses - 1 });
    this.grants.set(approvalKey, next);
    return true;
  }

  revoke(approvalKey: string): void {
    this.grants.delete(approvalKey);
  }

  clear(): void {
    this.grants.clear();
  }
}

function evaluateGrant(input: PolicyCompileInput, approvalKey: string): CompiledPolicy | undefined {
  const grant = input.grant;
  if (grant === undefined) return undefined;
  if (grant.approvalKey !== approvalKey) return result(input, approvalKey, 'deny', 'GRANT_KEY_MISMATCH');
  if (grant.policyRevision !== input.currentPolicyRevision) return result(input, approvalKey, 'deny', 'STALE_POLICY_REVISION');
  const now = input.now ?? Date.now();
  if (grant.expiresAt <= now) return result(input, approvalKey, 'ask', 'GRANT_EXPIRED');
  if (grant.remainingUses <= 0) return result(input, approvalKey, 'ask', 'GRANT_EXHAUSTED');
  if (!isGrantEligible(input)) return result(input, approvalKey, 'deny', 'GRANT_NOT_ELIGIBLE');
  return result(input, approvalKey, 'allow', 'SESSION_GRANT', grant);
}

function isGrantEligible(input: PolicyCompileInput): boolean {
  return input.risk === 'write'
    && input.taskTrust === 'trusted-workspace'
    && input.sandboxMode === 'workspace-write'
    && input.writeScope !== 'outside-workspace'
    && input.privilegeRequested !== true
    && input.networkAccess === 'restricted';
}

function applyClientDecision(input: PolicyCompileInput, policy: CompiledPolicy): CompiledPolicy {
  if (input.clientRequestedDecision === 'deny' && policy.decision !== 'deny') {
    return result(input, policy.approvalKey, 'deny', 'CLIENT_DENIED', policy.grant);
  }
  if (input.clientRequestedDecision === 'ask' && policy.decision === 'allow') {
    return result(input, policy.approvalKey, 'ask', 'CLIENT_REQUESTED_APPROVAL', policy.grant);
  }
  return policy;
}

function result(input: PolicyCompileInput, approvalKey: string, decision: CompiledPolicyDecision, reasonCode: PolicyReasonCode, grant?: PolicyGrantSnapshot): CompiledPolicy {
  const audit: PolicyAuditMetadata = {
    schemaVersion: POLICY_AUDIT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    toolId: input.toolId,
    toolVersion: input.toolVersion,
    risk: input.risk,
    taskTrust: input.taskTrust,
    sandboxMode: input.sandboxMode,
    ...(input.sandboxProvider === undefined ? {} : { sandboxProvider: input.sandboxProvider }),
    networkAccess: input.networkAccess,
    argumentFingerprint: input.argumentsFingerprint,
    policyRevision: input.policyRevision,
    decision,
    reasonCode,
    reason: REASONS[reasonCode],
  };
  return Object.freeze({
    decision,
    reasonCode,
    reason: REASONS[reasonCode],
    approvalKey,
    effective: Object.freeze({ sandboxMode: input.sandboxMode, networkAccess: input.networkAccess }),
    audit: Object.freeze(audit),
    ...(grant === undefined ? {} : { grant }),
  });
}

function invalidResult(reasonCode: 'INVALID_ARGUMENT_FINGERPRINT' | 'INVALID_POLICY_INPUT'): CompiledPolicy {
  const input = {
    workspaceId: 'invalid',
    toolId: 'invalid',
    toolVersion: 'invalid',
    risk: 'read' as const,
    taskTrust: 'trusted-workspace' as const,
    sandboxMode: 'read-only' as const,
    networkAccess: 'restricted' as const,
    policyRevision: 'invalid',
    argumentsFingerprint: 'invalid',
  } satisfies Pick<PolicyCompileInput, 'workspaceId' | 'toolId' | 'toolVersion' | 'risk' | 'taskTrust' | 'sandboxMode' | 'networkAccess' | 'policyRevision' | 'argumentsFingerprint'>;
  return result(input as PolicyCompileInput, 'approval.v1.invalid', 'deny', reasonCode);
}

function validateInput(input: PolicyCompileInput): 'INVALID_ARGUMENT_FINGERPRINT' | 'INVALID_POLICY_INPUT' | undefined {
  if (!(input.registry instanceof ToolRegistry)) return 'INVALID_POLICY_INPUT';
  if (!SAFE_FINGERPRINT.test(input.argumentsFingerprint)) return 'INVALID_ARGUMENT_FINGERPRINT';
  if (!isSafeId(input.workspaceId) || !isSafeId(input.toolId) || !isSafeId(input.toolVersion) || !isSafeId(input.sessionId)) return 'INVALID_POLICY_INPUT';
  if (!SAFE_REVISION.test(input.policyRevision) || !SAFE_REVISION.test(input.currentPolicyRevision)) return 'INVALID_POLICY_INPUT';
  if (!isTaskTrust(input.taskTrust) || !isRisk(input.risk) || !isSandboxMode(input.sandboxMode)) return 'INVALID_POLICY_INPUT';
  if (input.sandboxProvider !== undefined && !isSandboxProvider(input.sandboxProvider)) return 'INVALID_POLICY_INPUT';
  if (input.networkAccess !== 'restricted' && input.networkAccess !== 'enabled') return 'INVALID_POLICY_INPUT';
  if (input.networkApproval !== undefined && input.networkApproval !== 'none' && input.networkApproval !== 'explicit') return 'INVALID_POLICY_INPUT';
  if (input.clientRequestedDecision !== undefined && !isDecision(input.clientRequestedDecision)) return 'INVALID_POLICY_INPUT';
  if (input.writeScope !== undefined && input.writeScope !== 'workspace' && input.writeScope !== 'outside-workspace') return 'INVALID_POLICY_INPUT';
  if (input.now !== undefined && !isSafeTimestamp(input.now)) return 'INVALID_POLICY_INPUT';
  return undefined;
}

function validateKeyInput(input: PolicyApprovalKeyInput): boolean {
  return isSafeId(input.workspaceId)
    && isSafeId(input.toolId)
    && isSafeId(input.toolVersion)
    && isSafeId(input.sessionId)
    && SAFE_REVISION.test(input.policyRevision)
    && isTaskTrust(input.taskTrust)
    && isRisk(input.risk)
    && isSandboxMode(input.sandboxMode)
    && (input.sandboxProvider === undefined || isSandboxProvider(input.sandboxProvider))
    && (input.networkAccess === 'restricted' || input.networkAccess === 'enabled')
    && SAFE_FINGERPRINT.test(input.argumentsFingerprint);
}

function isSafeSchema(value: ToolDescriptor['inputSchema']): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (typeof value.type !== 'string' || !/^(?:object|array|string|number|integer|boolean)$/u.test(value.type)) return false;
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return false;
  }
  if (encoded.length > 64 * 1024) return false;
  return !containsUnsafeMetadata(value);
}

function containsUnsafeMetadata(value: unknown): boolean {
  if (typeof value === 'string') return SECRET_VALUE.test(value) || WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
  if (Array.isArray(value)) return value.some((entry) => containsUnsafeMetadata(entry));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([key, child]) => SECRET_SHAPED.test(key) || containsUnsafeMetadata(child));
}

function isApprovalDisabled(policy: ApprovalPolicyConfig | undefined): boolean {
  return policy === 'never';
}

function isPermissionRequestDisabled(policy: ApprovalPolicyConfig | undefined): boolean {
  return typeof policy === 'object' && policy.granular.permissionRequest === false;
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && CONTROL_TEXT.test(value);
}

function isSafeReason(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && CONTROL_TEXT.test(value) && !SECRET_VALUE.test(value) && !WINDOWS_ABSOLUTE.test(value) && !UNC_ABSOLUTE.test(value) && !POSIX_ABSOLUTE.test(value);
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTaskTrust(value: unknown): value is TaskTrust {
  return value === 'trusted-workspace' || value === 'untrusted-content';
}

function isRisk(value: unknown): value is ToolRisk {
  return value === 'read' || value === 'write' || value === 'destructive' || value === 'network';
}

function isSandboxMode(value: unknown): value is ToolSandboxMode {
  return value === 'read-only' || value === 'workspace-write' || value === 'external-sandbox' || value === 'danger-full-access';
}

function isSandboxProvider(value: unknown): value is 'docker' | 'podman' | 'vm' {
  return value === 'docker' || value === 'podman' || value === 'vm';
}

function isDecision(value: unknown): value is ClientPolicyDecision {
  return value === 'allow' || value === 'ask' || value === 'deny';
}
