import {
  CAPABILITY_PROFILE_RESOLUTION_SCHEMA_VERSION,
  parseCapabilityProfile,
  type CapabilityApprovalMode,
  type CapabilityFilesystemMode,
  type CapabilityModelMode,
  type CapabilityMcpSkillMode,
  type CapabilityNetworkMode,
  type CapabilityProfile,
  type CapabilityShellMode,
  type CapabilityTransportMode,
} from '@ready4vibe/contracts';

export type CapabilityHealth = 'ready' | 'degraded' | 'blocked' | 'missing';
export type CapabilityResolutionStatus = import('@ready4vibe/contracts').CapabilityResolutionStatus;
export type CapabilityResolutionReasonCode = import('@ready4vibe/contracts').CapabilityResolutionReasonCode;

export interface CapabilityProfilePolicy {
  readonly policyRevision: string;
  readonly transportModes: readonly CapabilityTransportMode[];
  readonly modelModes: readonly CapabilityModelMode[];
  readonly filesystemModes: readonly CapabilityFilesystemMode[];
  readonly shellModes: readonly CapabilityShellMode[];
  readonly networkModes: readonly CapabilityNetworkMode[];
  readonly mcpSkillModes: readonly CapabilityMcpSkillMode[];
  readonly approvalModes: readonly CapabilityApprovalMode[];
  readonly transportHealth: Readonly<Partial<Record<CapabilityTransportMode, CapabilityHealth>>>;
  readonly workspaceHealth: CapabilityHealth;
  readonly modelHealth: CapabilityHealth;
  readonly filesystemHealth: CapabilityHealth;
  readonly externalSandboxHealth: CapabilityHealth;
  readonly hostRunnerHealth: CapabilityHealth;
  readonly networkHealth: CapabilityNetworkMode;
  readonly mcpSkillHealth: CapabilityHealth;
}

export interface CapabilityProfileResolution {
  readonly schemaVersion: typeof CAPABILITY_PROFILE_RESOLUTION_SCHEMA_VERSION;
  readonly status: CapabilityResolutionStatus;
  readonly reasonCode: CapabilityResolutionReasonCode;
  readonly requestedProfile: CapabilityProfile;
  readonly effectiveProfile: CapabilityProfile | null;
  readonly policyRevision: string;
  readonly evaluatedAt: string;
}

/**
 * Resolve a validated profile against server-owned capability evidence.
 *
 * This function is deliberately pure: it does not inspect the filesystem,
 * spawn a process, call a provider, acquire a scheduler lease or write an
 * event. A server policy can narrow user intent, but it can never widen it.
 */
export function resolveCapabilityProfile(
  profile: CapabilityProfile,
  policy: CapabilityProfilePolicy,
  evaluatedAt: string,
): CapabilityProfileResolution {
  const requested = parseCapabilityProfile(profile);
  const policyRevision = boundedRevision(policy.policyRevision);
  if (requested.policyRevision !== policyRevision) {
    return result('blocked', 'STALE_POLICY_REVISION', requested, null, policyRevision, evaluatedAt);
  }
  if (!hasEveryOffFallback(policy)) {
    return result('blocked', 'INVALID_SERVER_POLICY', requested, null, policyRevision, evaluatedAt);
  }

  const transportHealth = policy.transportHealth[requested.transportMode] ?? 'missing';
  if (!policy.transportModes.includes(requested.transportMode) || transportHealth !== 'ready') {
    return result('blocked', 'TRANSPORT_UNAVAILABLE', requested, null, policyRevision, evaluatedAt);
  }

  const activeWorkspace = requested.filesystemMode !== 'off'
    || requested.shellMode !== 'off'
    || requested.mcpSkillMode !== 'off';
  if (activeWorkspace && !requested.workspaceId) {
    return result('blocked', 'WORKSPACE_REQUIRED', requested, null, policyRevision, evaluatedAt);
  }
  if (activeWorkspace && policy.workspaceHealth !== 'ready') {
    return result('blocked', 'WORKSPACE_UNAVAILABLE', requested, null, policyRevision, evaluatedAt);
  }

  const effective = {
    ...requested,
    modelMode: narrow(requested.modelMode, policy.modelModes, MODEL_ORDER),
    filesystemMode: narrow(requested.filesystemMode, policy.filesystemModes, FILESYSTEM_ORDER),
    shellMode: narrow(requested.shellMode, policy.shellModes, SHELL_ORDER),
    networkMode: narrow(requested.networkMode, policy.networkModes, NETWORK_ORDER),
    mcpSkillMode: narrow(requested.mcpSkillMode, policy.mcpSkillModes, MCP_ORDER),
    approvalMode: narrow(requested.approvalMode, policy.approvalModes, APPROVAL_ORDER),
  } satisfies CapabilityProfile;

  const healthAdjusted = adjustForHealth(effective, policy);
  const checkedEffective = parseCapabilityProfile(healthAdjusted.profile);
  if (healthAdjusted.blockedReason) {
    return result('blocked', healthAdjusted.blockedReason, requested, null, policyRevision, evaluatedAt);
  }
  const changed = !sameCapabilitySet(requested, checkedEffective);
  return result(changed || healthAdjusted.degraded ? 'degraded' : 'ready', changed ? 'CAPABILITY_NARROWED' : 'PROFILE_READY', requested, checkedEffective, policyRevision, evaluatedAt);
}

const MODEL_ORDER: readonly CapabilityModelMode[] = ['off', 'fake', 'configured'];
const FILESYSTEM_ORDER: readonly CapabilityFilesystemMode[] = ['off', 'workspace-read', 'workspace-write'];
const SHELL_ORDER: readonly CapabilityShellMode[] = ['off', 'external-sandbox', 'host-restricted'];
const NETWORK_ORDER: readonly CapabilityNetworkMode[] = ['off', 'restricted', 'enabled'];
const MCP_ORDER: readonly CapabilityMcpSkillMode[] = ['off', 'configured'];
const APPROVAL_ORDER: readonly CapabilityApprovalMode[] = ['none', 'on-request', 'bounded-auto', 'explicit'];

function adjustForHealth(profile: CapabilityProfile, policy: CapabilityProfilePolicy): {
  readonly profile: CapabilityProfile;
  readonly degraded: boolean;
  readonly blockedReason?: CapabilityResolutionReasonCode;
} {
  let next = { ...profile };
  let degraded = false;
  if (next.modelMode === 'configured' && policy.modelHealth !== 'ready') {
    next = { ...next, modelMode: policy.modelModes.includes('fake') ? 'fake' : 'off' };
    degraded = true;
    if (next.modelMode === 'off') return { profile: next, degraded, blockedReason: 'MODEL_UNAVAILABLE' };
  }
  if (next.filesystemMode !== 'off' && policy.filesystemHealth !== 'ready') {
    next = { ...next, filesystemMode: 'off' };
    degraded = true;
    if (profile.filesystemMode === 'workspace-write' && !policy.filesystemModes.includes('workspace-read')) {
      return { profile: next, degraded, blockedReason: 'FILESYSTEM_UNAVAILABLE' };
    }
  }
  if (next.shellMode === 'external-sandbox' && policy.externalSandboxHealth !== 'ready') {
    next = { ...next, shellMode: 'off' };
    degraded = true;
    if (!policy.shellModes.includes('off')) return { profile: next, degraded, blockedReason: 'SANDBOX_UNAVAILABLE' };
  }
  if (next.shellMode === 'host-restricted' && policy.hostRunnerHealth !== 'ready') {
    next = { ...next, shellMode: 'off' };
    degraded = true;
    if (!policy.shellModes.includes('off')) return { profile: next, degraded, blockedReason: 'HOST_RUNNER_UNAVAILABLE' };
  }
  if (next.networkMode === 'enabled' && policy.networkHealth !== 'enabled') {
    next = { ...next, networkMode: policy.networkModes.includes('restricted') ? 'restricted' : 'off' };
    degraded = true;
    if (next.networkMode === 'off' && !policy.networkModes.includes('off')) return { profile: next, degraded, blockedReason: 'NETWORK_NOT_ALLOWED' };
  }
  if (next.mcpSkillMode === 'configured' && policy.mcpSkillHealth !== 'ready') {
    next = { ...next, mcpSkillMode: 'off' };
    degraded = true;
    if (!policy.mcpSkillModes.includes('off')) return { profile: next, degraded, blockedReason: 'MCP_SKILL_UNAVAILABLE' };
  }
  return { profile: next, degraded };
}

function narrow<T extends string>(requested: T, allowed: readonly T[], order: readonly T[]): T {
  const requestedIndex = order.indexOf(requested);
  for (let index = requestedIndex; index >= 0; index -= 1) {
    const candidate = order[index];
    if (candidate !== undefined && allowed.includes(candidate)) return candidate;
  }
  return order[0] as T;
}

function hasEveryOffFallback(policy: CapabilityProfilePolicy): boolean {
  return policy.modelModes.includes('off')
    && policy.filesystemModes.includes('off')
    && policy.shellModes.includes('off')
    && policy.networkModes.includes('off')
    && policy.mcpSkillModes.includes('off')
    && policy.approvalModes.includes('none');
}

function sameCapabilitySet(left: CapabilityProfile, right: CapabilityProfile): boolean {
  return left.profileId === right.profileId
    && left.transportMode === right.transportMode
    && left.workspaceId === right.workspaceId
    && left.modelMode === right.modelMode
    && left.filesystemMode === right.filesystemMode
    && left.shellMode === right.shellMode
    && left.networkMode === right.networkMode
    && left.mcpSkillMode === right.mcpSkillMode
    && left.approvalMode === right.approvalMode
    && left.sandboxRef === right.sandboxRef
    && left.policyRevision === right.policyRevision
    && left.requiresAcknowledgement === right.requiresAcknowledgement;
}

function boundedRevision(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) return 'invalid';
  return value;
}

function result(
  status: CapabilityResolutionStatus,
  reasonCode: CapabilityResolutionReasonCode,
  requestedProfile: CapabilityProfile,
  effectiveProfile: CapabilityProfile | null,
  policyRevision: string,
  evaluatedAt: string,
): CapabilityProfileResolution {
  return {
    schemaVersion: CAPABILITY_PROFILE_RESOLUTION_SCHEMA_VERSION,
    status,
    reasonCode,
    requestedProfile,
    effectiveProfile,
    policyRevision,
    evaluatedAt,
  };
}
