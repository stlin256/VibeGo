import type {
  AgentMemoryIdentity,
  AgentMemoryOperations,
  AgentMemoryProvider,
  AgentMemorySettings,
  AgentMemorySettingsPatch,
  AgentMemorySettingsStatus,
  AgentMemoryStatus,
  ModelProvider,
} from '@ready4vibe/contracts';
import {
  AgentMemoryIdentitySchema,
  AgentMemoryOperationsSchema,
  AgentMemorySettingsPatchSchema,
  AgentMemorySettingsSchema,
  AgentMemorySettingsStatusSchema,
  AgentMemoryStatusSchema,
  AGENT_MEMORY_SETTINGS_SCHEMA_VERSION,
} from '@ready4vibe/contracts';
import type { SettingsStore } from '@ready4vibe/storage';
import { TencentMemoryCoreProvider, type MemoryCoreProviderOptions } from './memory-core-provider.js';
import { TencentMemoryProxyProvider } from './memory-proxy-provider.js';

export const AGENT_MEMORY_SETTINGS_NAMESPACE = 'agent-memory' as const;
export const AGENT_MEMORY_SETTINGS_KEY = 'v1' as const;

export interface AgentMemoryRuntimeOperations {
  start?(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  endpoint?(): string | undefined;
  probe(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  update(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  enqueueUpdate?(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  rollback(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  operations?(): AgentMemoryOperations;
  close?(): Promise<void>;
}

/**
 * Immutable application-service input for one run. The provider is never
 * serialized or exposed to Web; it is disposed asynchronously after the run's
 * compact write-back has been queued.
 */
export interface AgentMemoryRunSnapshot {
  readonly provider: AgentMemoryProvider;
  readonly modelProvider?: ModelProvider;
  readonly identity: AgentMemoryIdentity;
  readonly revision: string | null;
  readonly dispose: () => Promise<void>;
}

export interface AgentMemorySettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly provider?: AgentMemoryProvider;
  readonly providerFactory?: (identity: AgentMemoryIdentity) => AgentMemoryProvider | undefined;
  /** Returns the current direct model provider for proxy fallback snapshots. */
  readonly modelProviderFactory?: () => ModelProvider | undefined;
  readonly runtime?: AgentMemoryRuntimeOperations;
  readonly environment?: NodeJS.ProcessEnv;
}

export class AgentMemorySettingsError extends Error {
  constructor(readonly code: 'INVALID_SETTINGS' | 'CORRUPT_SETTINGS' | 'PERSISTENCE_FAILED' | 'RUNTIME_UNAVAILABLE' | 'UPDATE_UNAVAILABLE' | 'ROLLBACK_UNAVAILABLE', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentMemorySettingsError';
  }
}

const DEFAULT_SETTINGS: AgentMemorySettings = {
  schemaVersion: AGENT_MEMORY_SETTINGS_SCHEMA_VERSION,
  enabled: false,
  mode: 'off',
  teamId: 'vibego',
  agentId: 'vibego-local-agent',
  userId: 'local-user',
  upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory',
  upstreamRef: 'feat/server_team',
  upstreamRefLocked: false,
  autoUpdate: true,
  updateIntervalMinutes: 60,
  fallbackToDirectProvider: true,
};

export class AgentMemorySettingsManager {
  private settingsValue: AgentMemorySettings;
  private provider: AgentMemoryProvider | undefined;
  private readonly providerFactory: ((identity: AgentMemoryIdentity) => AgentMemoryProvider | undefined) | undefined;
  private readonly providerWasInjected: boolean;
  private readonly modelProviderFactory: (() => ModelProvider | undefined) | undefined;
  private readonly runtime: AgentMemoryRuntimeOperations | undefined;
  private readonly settings: SettingsStore;
  private readonly environment: NodeJS.ProcessEnv;
  private lastStatus: AgentMemoryStatus;

  constructor(options: AgentMemorySettingsManagerOptions) {
    this.settings = options.settings;
    this.providerFactory = options.providerFactory;
    this.modelProviderFactory = options.modelProviderFactory;
    this.providerWasInjected = options.provider !== undefined;
    this.runtime = options.runtime;
    this.environment = options.environment ?? process.env;
    this.settingsValue = this.loadSettings();
    this.provider = options.provider ?? this.createProvider(this.settingsValue);
    this.lastStatus = this.initialStatus(this.settingsValue);
  }

  settingsSnapshot(): AgentMemorySettings {
    return { ...this.settingsValue };
  }

  createRunSnapshot(sessionId?: string): AgentMemoryRunSnapshot | undefined {
    const settings = this.settingsValue;
    if (!settings.enabled || settings.mode === 'off') return undefined;
    const identity = identityFromSettings(settings, sessionId);
    let provider: AgentMemoryProvider | undefined;
    let ownsProvider = false;
    if (this.providerFactory) {
      try { provider = this.providerFactory(identity); ownsProvider = provider !== undefined; } catch { provider = undefined; }
    } else if (this.providerWasInjected) {
      provider = this.provider;
    } else {
      provider = this.createProvider(settings, identity);
      ownsProvider = provider !== undefined;
    }
    if (!provider) return undefined;
    const modelProvider = settings.mode === 'proxy' || settings.mode === 'full-stack'
      ? (isModelProvider(provider) ? provider : undefined)
      : undefined;
    return {
      provider,
      ...(modelProvider ? { modelProvider } : {}),
      identity,
      revision: this.lastStatus.revision,
      dispose: ownsProvider ? () => provider!.close() : async () => undefined,
    };
  }

  status(): AgentMemorySettingsStatus {
    return this.response();
  }

  /** Returns bounded diagnostics without exposing provider credentials or paths. */
  operations(): AgentMemoryOperations {
    const runtime = this.runtime?.operations?.();
    const provider = this.provider?.operations?.();
    return AgentMemoryOperationsSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_operations_v1',
      currentRevision: runtime?.currentRevision ?? provider?.currentRevision ?? this.lastStatus.revision,
      previousRevision: runtime?.previousRevision ?? provider?.previousRevision ?? this.lastStatus.previousRevision,
      healthLatencyMs: runtime?.healthLatencyMs ?? provider?.healthLatencyMs ?? null,
      recall: provider?.recall ?? { hits: 0, misses: 0, lastAt: null },
      writeQueue: provider?.writeQueue ?? { pending: 0, inFlight: false, accepted: 0, failed: 0, lastAttemptAt: null, lastErrorCode: null },
      updates: runtime?.updates ?? [],
    });
  }

  patch(input: unknown): AgentMemorySettingsStatus {
    let patch: AgentMemorySettingsPatch;
    try {
      patch = AgentMemorySettingsPatchSchema.parse(input);
    } catch (error) {
      throw new AgentMemorySettingsError('INVALID_SETTINGS', 'Agent memory settings are invalid.', { cause: error });
    }
    let next: AgentMemorySettings;
    try {
      // Keep the durable default fully off while making the first enable action
      // ergonomic: an omitted mode selects the preferred MemoryCore adapter.
      const normalizedPatch = patch.enabled === true && patch.mode === undefined && this.settingsValue.mode === 'off'
        ? { ...patch, mode: 'memory-core' as const }
        : patch;
      next = AgentMemorySettingsSchema.parse({ ...this.settingsValue, ...normalizedPatch, schemaVersion: AGENT_MEMORY_SETTINGS_SCHEMA_VERSION });
    } catch (error) {
      throw new AgentMemorySettingsError('INVALID_SETTINGS', 'Agent memory settings are invalid.', { cause: error });
    }
    try {
      this.settings.set(AGENT_MEMORY_SETTINGS_NAMESPACE, AGENT_MEMORY_SETTINGS_KEY, next);
    } catch (error) {
      throw new AgentMemorySettingsError('PERSISTENCE_FAILED', 'Agent memory settings could not be saved.', { cause: error });
    }
    const previousProvider = this.provider;
    this.settingsValue = next;
    if (!this.providerWasInjected || this.providerFactory) this.provider = this.createProvider(next);
    if (previousProvider && previousProvider !== this.provider) void previousProvider.close();
    this.lastStatus = this.initialStatus(next);
    if (this.runtime?.start && next.mode === 'memory-core') {
      void this.runtime.start().then((status) => {
        if (this.settingsValue !== next) return;
        this.refreshProviderForRuntime();
        this.lastStatus = next.enabled ? this.normalizeRuntimeStatus(status) : this.disabledStatus();
      }).catch(() => {
        if (this.settingsValue === next) this.lastStatus = next.enabled ? unavailableStatus(next.mode, 'unavailable') : this.disabledStatus();
      });
    } else if (next.enabled && this.provider && (next.mode === 'proxy' || next.mode === 'full-stack')) {
      void this.provider.status().then((status) => {
        if (this.settingsValue === next) this.lastStatus = this.normalizeRuntimeStatus(status);
      }).catch(() => {
        if (this.settingsValue === next) this.lastStatus = unavailableStatus(next.mode, 'unavailable');
      });
    }
    return this.response();
  }

  async probe(signal?: AbortSignal): Promise<AgentMemorySettingsStatus> {
    if (!this.settingsValue.enabled) {
      this.lastStatus = this.disabledStatus();
      return this.response();
    }
    try {
      const status = this.runtime && this.settingsValue.mode === 'memory-core'
        ? await this.runtime.probe(signal)
        : this.provider ? await this.provider.status(signal) : unavailableStatus(this.settingsValue.mode, 'unavailable');
      this.lastStatus = this.normalizeRuntimeStatus(status);
    } catch {
      this.lastStatus = unavailableStatus(this.settingsValue.mode, 'unavailable');
    }
    return this.response();
  }

  async start(signal?: AbortSignal): Promise<AgentMemorySettingsStatus> {
    if (!this.settingsValue.enabled) {
      this.lastStatus = this.disabledStatus();
      return this.response();
    }
    try {
      this.lastStatus = this.normalizeRuntimeStatus(this.runtime && this.settingsValue.mode === 'memory-core' && this.runtime.start
        ? await this.runtime.start(signal)
        : this.provider ? await this.provider.status(signal) : unavailableStatus(this.settingsValue.mode, 'unavailable'));
      if (this.settingsValue.mode === 'memory-core') this.refreshProviderForRuntime();
    } catch {
      this.lastStatus = unavailableStatus(this.settingsValue.mode, 'unavailable');
    }
    return this.response();
  }

  async update(signal?: AbortSignal): Promise<AgentMemorySettingsStatus> {
    if (!this.settingsValue.enabled) {
      this.lastStatus = this.disabledStatus();
      return this.response();
    }
    if (!this.runtime || this.settingsValue.mode !== 'memory-core') {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'update');
      return this.response();
    }
    try {
      this.lastStatus = this.normalizeRuntimeStatus(await this.runtime.update(signal));
      this.refreshProviderForRuntime();
    } catch {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'update');
    }
    return this.response();
  }

  async enqueueUpdate(signal?: AbortSignal): Promise<AgentMemorySettingsStatus> {
    if (!this.settingsValue.enabled) {
      this.lastStatus = this.disabledStatus();
      return this.response();
    }
    if (!this.runtime || this.settingsValue.mode !== 'memory-core') return this.update(signal);
    try {
      this.lastStatus = this.normalizeRuntimeStatus(await (this.runtime.enqueueUpdate ? this.runtime.enqueueUpdate(signal) : this.runtime.update(signal)));
      this.refreshProviderForRuntime();
    } catch {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'update');
    }
    return this.response();
  }

  async rollback(signal?: AbortSignal): Promise<AgentMemorySettingsStatus> {
    if (!this.settingsValue.enabled) {
      this.lastStatus = this.disabledStatus();
      return this.response();
    }
    if (!this.runtime || this.settingsValue.mode !== 'memory-core') {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'rollback');
      return this.response();
    }
    try {
      this.lastStatus = this.normalizeRuntimeStatus(await this.runtime.rollback(signal));
      this.refreshProviderForRuntime();
    } catch {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'rollback');
    }
    return this.response();
  }

  async close(): Promise<void> {
    try {
      await this.runtime?.close?.();
    } finally {
      await this.provider?.close();
    }
  }

  private loadSettings(): AgentMemorySettings {
    const value = this.settings.get<unknown>(AGENT_MEMORY_SETTINGS_NAMESPACE, AGENT_MEMORY_SETTINGS_KEY);
    if (value === undefined) {
      this.settings.set(AGENT_MEMORY_SETTINGS_NAMESPACE, AGENT_MEMORY_SETTINGS_KEY, DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    try {
      return AgentMemorySettingsSchema.parse(value);
    } catch (error) {
      throw new AgentMemorySettingsError('CORRUPT_SETTINGS', 'Stored agent memory settings are invalid.', { cause: error });
    }
  }

  private createProvider(settings: AgentMemorySettings, identity = identityFromSettings(settings)): AgentMemoryProvider | undefined {
    if (!settings.enabled || settings.mode === 'off') return undefined;
    if (this.providerFactory) {
      try { return this.providerFactory(identity); } catch { return undefined; }
    }
    const fallback = (settings.mode === 'proxy' || settings.mode === 'full-stack') ? this.modelProviderFactory?.() : undefined;
    return createProviderFromEnvironment(settings, identity, this.environment, this.runtime?.endpoint?.(), fallback);
  }

  private refreshProviderForRuntime(): void {
    if (this.providerWasInjected && !this.providerFactory) return;
    const previous = this.provider;
    this.provider = this.createProvider(this.settingsValue);
    if (previous && previous !== this.provider) void previous.close();
  }

  private initialStatus(settings: AgentMemorySettings): AgentMemoryStatus {
    if (!settings.enabled) return this.disabledStatus();
    return unavailableStatus(settings.mode, 'unavailable');
  }

  private disabledStatus(): AgentMemoryStatus {
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false,
      degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null,
      updateState: 'disabled', lastErrorCode: null, capabilities: [],
    });
  }

  private normalizeRuntimeStatus(status: AgentMemoryStatus): AgentMemoryStatus {
    return AgentMemoryStatusSchema.parse({ ...status, enabled: true, mode: this.settingsValue.mode });
  }

  private response(): AgentMemorySettingsStatus {
    return AgentMemorySettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_settings_status_v0',
      settings: this.settingsValue,
      status: this.lastStatus,
      currentRevision: this.lastStatus.revision,
      previousRevision: this.lastStatus.previousRevision,
    });
  }
}

function identityFromSettings(settings: AgentMemorySettings, sessionId?: string): AgentMemoryIdentity {
  const safeSessionId = typeof sessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$/u.test(sessionId)
    ? sessionId
    : undefined;
  return AgentMemoryIdentitySchema.parse({
    teamId: settings.teamId,
    agentId: settings.agentId,
    userId: settings.userId,
    ...(safeSessionId ? { sessionId: safeSessionId } : {}),
  });
}

function unavailableStatus(mode: AgentMemorySettings['mode'], code: AgentMemoryStatus['lastErrorCode']): AgentMemoryStatus {
  return AgentMemoryStatusSchema.parse({
    schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: true, mode, available: false, degraded: true,
    revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null,
    updateState: code === 'rollback' ? 'rollback' : 'degraded', lastErrorCode: code, capabilities: [],
  });
}

function actionUnavailableStatus(previous: AgentMemoryStatus, mode: AgentMemorySettings['mode'], code: 'update' | 'rollback'): AgentMemoryStatus {
  return AgentMemoryStatusSchema.parse({
    ...previous,
    enabled: true,
    mode,
    degraded: true,
    lastErrorCode: code,
    updateState: code === 'rollback' ? 'rollback' : 'degraded',
  });
}

function createProviderFromEnvironment(
  settings: AgentMemorySettings,
  identity: AgentMemoryIdentity,
  environment: NodeJS.ProcessEnv,
  endpointOverride?: string,
  fallback?: ModelProvider,
): AgentMemoryProvider | undefined {
  if (settings.mode === 'memory-core') {
    const apiKey = environment.READY4VIBE_MEMORY_CORE_API_KEY;
    if (!apiKey) return undefined;
    const endpoint = endpointOverride ?? environment.READY4VIBE_MEMORY_CORE_ENDPOINT ?? 'http://127.0.0.1:8420';
    const allowInsecureHttp = environment.READY4VIBE_MEMORY_CORE_ALLOW_INSECURE_HTTP === '1' || isLoopbackMemoryEndpoint(endpoint);
    const options: MemoryCoreProviderOptions = {
      endpoint,
      apiKey,
      serviceId: environment.READY4VIBE_MEMORY_CORE_SERVICE_ID ?? 'vibego',
      identity,
      ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
    };
    try { return new TencentMemoryCoreProvider(options); } catch { return undefined; }
  }
  if (settings.mode === 'proxy' || settings.mode === 'full-stack') {
    const endpoint = environment.READY4VIBE_MEMORY_PROXY_ENDPOINT ?? 'http://127.0.0.1:8096';
    const allowInsecureHttp = environment.READY4VIBE_MEMORY_PROXY_ALLOW_INSECURE_HTTP === '1' || isLoopbackMemoryEndpoint(endpoint);
    try {
      return new TencentMemoryProxyProvider({
        endpoint,
        identity,
        ...(environment.READY4VIBE_MEMORY_PROXY_API_KEY ? { proxyApiKey: environment.READY4VIBE_MEMORY_PROXY_API_KEY } : {}),
        ...(environment.READY4VIBE_MEMORY_PROXY_UPSTREAM_API_KEY ? { upstreamApiKey: environment.READY4VIBE_MEMORY_PROXY_UPSTREAM_API_KEY } : {}),
        ...(fallback ? { fallback } : {}),
        fallbackToDirectProvider: settings.fallbackToDirectProvider,
        mode: settings.mode,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      });
    } catch { return undefined; }
  }
  return undefined;
}

function isModelProvider(value: AgentMemoryProvider): value is AgentMemoryProvider & ModelProvider {
  return typeof (value as Partial<ModelProvider>).stream === 'function'
    && typeof (value as Partial<ModelProvider>).capabilities === 'object'
    && (value as Partial<ModelProvider>).capabilities !== null;
}

function isLoopbackMemoryEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1');
  } catch {
    return false;
  }
}
