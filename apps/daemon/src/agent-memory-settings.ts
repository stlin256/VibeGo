import type {
  AgentMemoryIdentity,
  AgentMemoryProvider,
  AgentMemorySettings,
  AgentMemorySettingsPatch,
  AgentMemorySettingsStatus,
  AgentMemoryStatus,
} from '@ready4vibe/contracts';
import {
  AgentMemoryIdentitySchema,
  AgentMemorySettingsPatchSchema,
  AgentMemorySettingsSchema,
  AgentMemorySettingsStatusSchema,
  AgentMemoryStatusSchema,
  AGENT_MEMORY_SETTINGS_SCHEMA_VERSION,
} from '@ready4vibe/contracts';
import type { SettingsStore } from '@ready4vibe/storage';
import { TencentMemoryCoreProvider, type MemoryCoreProviderOptions } from './memory-core-provider.js';

export const AGENT_MEMORY_SETTINGS_NAMESPACE = 'agent-memory' as const;
export const AGENT_MEMORY_SETTINGS_KEY = 'v1' as const;

export interface AgentMemoryRuntimeOperations {
  probe(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  update(signal?: AbortSignal): Promise<AgentMemoryStatus>;
  rollback(signal?: AbortSignal): Promise<AgentMemoryStatus>;
}

export interface AgentMemorySettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly provider?: AgentMemoryProvider;
  readonly providerFactory?: (identity: AgentMemoryIdentity) => AgentMemoryProvider | undefined;
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
  mode: 'memory-core',
  teamId: 'vibego',
  agentId: 'vibego-local-agent',
  userId: 'local-user',
  upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory',
  upstreamRef: 'feat/server_team',
  autoUpdate: true,
  updateIntervalMinutes: 60,
  fallbackToDirectProvider: true,
};

export class AgentMemorySettingsManager {
  private settingsValue: AgentMemorySettings;
  private provider: AgentMemoryProvider | undefined;
  private readonly providerFactory: ((identity: AgentMemoryIdentity) => AgentMemoryProvider | undefined) | undefined;
  private readonly providerWasInjected: boolean;
  private readonly runtime: AgentMemoryRuntimeOperations | undefined;
  private readonly settings: SettingsStore;
  private readonly environment: NodeJS.ProcessEnv;
  private lastStatus: AgentMemoryStatus;

  constructor(options: AgentMemorySettingsManagerOptions) {
    this.settings = options.settings;
    this.providerFactory = options.providerFactory;
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

  status(): AgentMemorySettingsStatus {
    return this.response();
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
      next = AgentMemorySettingsSchema.parse({ ...this.settingsValue, ...patch, schemaVersion: AGENT_MEMORY_SETTINGS_SCHEMA_VERSION });
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
    return this.response();
  }

  async probe(signal?: AbortSignal): Promise<AgentMemorySettingsStatus> {
    if (!this.settingsValue.enabled) {
      this.lastStatus = this.disabledStatus();
      return this.response();
    }
    try {
      const status = this.runtime
        ? await this.runtime.probe(signal)
        : this.settingsValue.mode === 'memory-core' && this.provider ? await this.provider.status(signal) : unavailableStatus(this.settingsValue.mode, 'unavailable');
      this.lastStatus = this.normalizeRuntimeStatus(status);
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
    if (!this.runtime) {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'update');
      return this.response();
    }
    try {
      this.lastStatus = this.normalizeRuntimeStatus(await this.runtime.update(signal));
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
    if (!this.runtime) {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'rollback');
      return this.response();
    }
    try {
      this.lastStatus = this.normalizeRuntimeStatus(await this.runtime.rollback(signal));
    } catch {
      this.lastStatus = actionUnavailableStatus(this.lastStatus, this.settingsValue.mode, 'rollback');
    }
    return this.response();
  }

  async close(): Promise<void> {
    await this.provider?.close();
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

  private createProvider(settings: AgentMemorySettings): AgentMemoryProvider | undefined {
    if (!settings.enabled || settings.mode !== 'memory-core') return undefined;
    if (this.providerFactory) {
      try { return this.providerFactory(identityFromSettings(settings)); } catch { return undefined; }
    }
    return createProviderFromEnvironment(identityFromSettings(settings), this.environment);
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

function identityFromSettings(settings: AgentMemorySettings): AgentMemoryIdentity {
  return AgentMemoryIdentitySchema.parse({ teamId: settings.teamId, agentId: settings.agentId, userId: settings.userId });
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

function createProviderFromEnvironment(identity: AgentMemoryIdentity, environment: NodeJS.ProcessEnv): AgentMemoryProvider | undefined {
  const apiKey = environment.READY4VIBE_MEMORY_CORE_API_KEY;
  if (!apiKey) return undefined;
  const endpoint = environment.READY4VIBE_MEMORY_CORE_ENDPOINT ?? 'http://127.0.0.1:8420';
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

function isLoopbackMemoryEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === '::1');
  } catch {
    return false;
  }
}
