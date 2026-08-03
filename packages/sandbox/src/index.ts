import type { SandboxPolicy, TaskTrust } from '@ready4vibe/contracts';

export type SandboxRuntime = 'docker' | 'podman' | 'vm';
export type SandboxNetwork = 'restricted' | 'enabled';
export type SandboxIsolation = 'container' | 'vm';

export interface SandboxResourceRequirements {
  maxMemoryBytes?: number;
  maxCpuMillis?: number;
}

export interface SandboxCapabilities {
  runtime: SandboxRuntime;
  version: string;
  isolation: SandboxIsolation;
  networkModes: readonly SandboxNetwork[];
  maxMemoryBytes?: number;
  maxCpuMillis?: number;
}

export interface SandboxProviderStatus {
  healthy: boolean;
  capabilities?: SandboxCapabilities;
}

export interface SandboxProviderVerifier {
  readonly runtime: SandboxRuntime;
  verify(signal?: AbortSignal): Promise<SandboxProviderStatus>;
}

export interface SandboxResolveRequest {
  taskTrust: TaskTrust;
  policy: SandboxPolicy;
  explicitDangerFullAccess?: boolean;
  resources?: SandboxResourceRequirements;
}

export interface ResolvedSandbox {
  mode: SandboxPolicy['mode'];
  network: SandboxNetwork | undefined;
  provider?: SandboxRuntime;
  capabilities?: SandboxCapabilities;
}

export type SandboxUnavailableReason =
  | 'provider-missing'
  | 'provider-unhealthy'
  | 'capability-mismatch'
  | 'untrusted-host-fallback'
  | 'danger-full-access-not-explicit'
  | 'danger-full-access-untrusted';

export class SandboxUnavailableError extends Error {
  readonly code = 'SANDBOX_UNAVAILABLE';

  constructor(readonly reason: SandboxUnavailableReason) {
    super('The requested sandbox is unavailable.');
    this.name = 'SandboxUnavailableError';
  }
}

export class SandboxResolver {
  private readonly providers: ReadonlyMap<SandboxRuntime, SandboxProviderVerifier>;

  constructor(providers: readonly SandboxProviderVerifier[] = []) {
    const map = new Map<SandboxRuntime, SandboxProviderVerifier>();
    for (const provider of providers) {
      if (map.has(provider.runtime)) {
        throw new Error(`sandbox provider already registered: ${provider.runtime}`);
      }
      map.set(provider.runtime, provider);
    }
    this.providers = map;
  }

  async resolve(request: SandboxResolveRequest, signal?: AbortSignal): Promise<ResolvedSandbox> {
    if (request.policy.mode === 'danger-full-access') {
      if (request.taskTrust === 'untrusted-content') {
        throw new SandboxUnavailableError('danger-full-access-untrusted');
      }
      if (request.explicitDangerFullAccess !== true) {
        throw new SandboxUnavailableError('danger-full-access-not-explicit');
      }
      return { mode: request.policy.mode, network: undefined };
    }

    if (request.taskTrust === 'untrusted-content' && request.policy.mode !== 'external-sandbox') {
      throw new SandboxUnavailableError('untrusted-host-fallback');
    }

    if (request.policy.mode !== 'external-sandbox') {
      return { mode: request.policy.mode, network: request.policy.network };
    }

    const provider = this.providers.get(request.policy.provider);
    if (!provider) throw new SandboxUnavailableError('provider-missing');

    let status: SandboxProviderStatus;
    try {
      status = await provider.verify(signal);
    } catch {
      throw new SandboxUnavailableError('provider-unhealthy');
    }
    if (!status || typeof status !== 'object' || status.healthy !== true || !this.isValidCapabilities(status.capabilities, provider.runtime)) {
      throw new SandboxUnavailableError('provider-unhealthy');
    }

    const capabilities = status.capabilities;
    if (
      capabilities.runtime !== provider.runtime ||
      capabilities.networkModes.includes(request.policy.network) === false ||
      (request.resources?.maxMemoryBytes !== undefined &&
        (capabilities.maxMemoryBytes === undefined || capabilities.maxMemoryBytes < request.resources.maxMemoryBytes)) ||
      (request.resources?.maxCpuMillis !== undefined &&
        (capabilities.maxCpuMillis === undefined || capabilities.maxCpuMillis < request.resources.maxCpuMillis))
    ) {
      throw new SandboxUnavailableError('capability-mismatch');
    }

    return {
      mode: request.policy.mode,
      network: request.policy.network,
      provider: provider.runtime,
      capabilities: {
        ...capabilities,
        networkModes: [...capabilities.networkModes],
      },
    };
  }

  private isValidCapabilities(value: SandboxCapabilities | undefined, runtime: SandboxRuntime): value is SandboxCapabilities {
    if (!value || typeof value !== 'object') return false;
    if (value.runtime !== runtime || typeof value.version !== 'string' || value.version.length === 0) return false;
    if (value.isolation !== 'container' && value.isolation !== 'vm') return false;
    if (!Array.isArray(value.networkModes) || value.networkModes.length === 0) return false;
    if (value.networkModes.some((mode) => mode !== 'restricted' && mode !== 'enabled')) return false;
    if (value.maxMemoryBytes !== undefined && (!Number.isSafeInteger(value.maxMemoryBytes) || value.maxMemoryBytes <= 0)) return false;
    if (value.maxCpuMillis !== undefined && (!Number.isSafeInteger(value.maxCpuMillis) || value.maxCpuMillis <= 0)) return false;
    return true;
  }
}
