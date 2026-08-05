import type {
  PermissionProfile,
  PermissionReasonCode,
  PermissionResolutionStatus,
  RunConfig,
  SandboxPolicy,
  TaskTrust,
} from '@ready4vibe/contracts';
import { parsePermissionProfile } from '@ready4vibe/contracts';
import {
  SandboxResolver,
  SandboxUnavailableError,
  type ResolvedSandbox,
  type SandboxResolveRequest,
  type SandboxResourceRequirements,
} from './index.js';

export interface PermissionSandboxRequestInput {
  readonly profile: PermissionProfile;
  readonly taskTrust: TaskTrust;
  readonly runSandbox: SandboxPolicy;
  readonly fullHostConfirmed?: boolean;
  readonly resources?: SandboxResourceRequirements;
}

export interface PermissionSandboxResolution {
  readonly status: PermissionResolutionStatus;
  readonly reasonCode: PermissionReasonCode;
  readonly resolved?: ResolvedSandbox;
  readonly request?: SandboxResolveRequest;
}

/** Project a permission profile into the existing resolver request. */
export function createPermissionSandboxRequest(input: PermissionSandboxRequestInput): SandboxResolveRequest | undefined {
  let profile: PermissionProfile;
  try {
    profile = parsePermissionProfile(input.profile);
  } catch {
    return undefined;
  }
  const runNetwork = 'network' in input.runSandbox ? input.runSandbox.network : 'restricted';
  if (profile.networkMode === 'enabled' && runNetwork !== 'enabled') return undefined;
  if (profile.networkMode !== 'enabled' && runNetwork === 'enabled') return undefined;

  const hostCapable = profile.filesystemScope === 'host' || profile.processScope === 'host';
  if (hostCapable) {
    if (input.taskTrust === 'untrusted-content' || input.fullHostConfirmed !== true) return undefined;
    return {
      taskTrust: input.taskTrust,
      policy: { mode: 'danger-full-access', enabledBy: 'explicit-user-only' },
      explicitDangerFullAccess: true,
      ...(input.resources ? { resources: input.resources } : {}),
    };
  }
  if (input.runSandbox.mode === 'danger-full-access') return undefined;
  if (profile.processScope === 'external-sandbox' && input.runSandbox.mode !== 'external-sandbox') return undefined;
  return {
    taskTrust: input.taskTrust,
    policy: input.runSandbox,
    ...(input.resources ? { resources: input.resources } : {}),
  };
}

/** Resolve through the existing SandboxResolver; this function has no fallback path. */
export async function resolvePermissionSandbox(
  input: PermissionSandboxRequestInput,
  resolver: SandboxResolver,
  signal?: AbortSignal,
): Promise<PermissionSandboxResolution> {
  const request = createPermissionSandboxRequest(input);
  if (!request) {
    const hostCapable = input.profile.filesystemScope === 'host' || input.profile.processScope === 'host';
    return { status: 'blocked', reasonCode: hostCapable ? (input.taskTrust === 'untrusted-content' ? 'UNTRUSTED_CONTENT' : 'FULL_HOST_CONFIRMATION_REQUIRED') : 'SANDBOX_REQUIRED' };
  }
  try {
    const resolved = await resolver.resolve(request, signal);
    return { status: 'ready', reasonCode: 'PROFILE_READY', request, resolved };
  } catch (error) {
    if (error instanceof SandboxUnavailableError) {
      const reasonCode: PermissionReasonCode = error.reason === 'danger-full-access-untrusted' || error.reason === 'untrusted-host-fallback'
        ? 'UNTRUSTED_CONTENT'
        : error.reason === 'danger-full-access-not-explicit'
          ? 'FULL_HOST_CONFIRMATION_REQUIRED'
          : 'SANDBOX_UNAVAILABLE';
      return { status: 'blocked', reasonCode, request };
    }
    return { status: 'blocked', reasonCode: 'SANDBOX_UNAVAILABLE', request };
  }
}

// Keep these names available to consumers without creating a second contract.
export type PermissionSandboxRun = Pick<RunConfig, 'sandbox' | 'taskTrust'>;
