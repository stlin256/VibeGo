import type {
  AgentMemoryKnowledgeProvider,
  AgentMemoryKnowledgeSettings,
  AgentMemoryKnowledgeSettingsPatch,
  AgentMemoryKnowledgeSettingsResource,
  AgentMemoryKnowledgeSettingsStatus,
  AgentMemoryKnowledgeSettingsTool,
  AgentMemoryKnowledgeRunSnapshot,
} from '@ready4vibe/contracts';
import {
  AgentMemoryKnowledgeSettingsPatchSchema,
  AgentMemoryKnowledgeSettingsSchema,
  AgentMemoryKnowledgeSettingsStatusSchema,
  AGENT_MEMORY_KNOWLEDGE_SETTINGS_SCHEMA_VERSION,
} from '@ready4vibe/contracts';
import type { SettingsStore } from '@ready4vibe/storage';
import { TencentMemoryKnowledgeProvider, type MemoryKnowledgeProviderOptions } from './memory-knowledge-provider.js';

export const AGENT_MEMORY_KNOWLEDGE_SETTINGS_NAMESPACE = 'agent-memory-knowledge' as const;
export const AGENT_MEMORY_KNOWLEDGE_SETTINGS_KEY = 'v1' as const;

export interface AgentMemoryKnowledgeSettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly provider?: AgentMemoryKnowledgeProvider;
  readonly providerFactory?: (knowledgeId: string) => AgentMemoryKnowledgeProvider | undefined;
  readonly environment?: NodeJS.ProcessEnv;
}

export class AgentMemoryKnowledgeSettingsError extends Error {
  constructor(readonly code: 'INVALID_SETTINGS' | 'CORRUPT_SETTINGS' | 'PERSISTENCE_FAILED', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgentMemoryKnowledgeSettingsError';
  }
}

const DEFAULT_SETTINGS: AgentMemoryKnowledgeSettings = {
  schemaVersion: AGENT_MEMORY_KNOWLEDGE_SETTINGS_SCHEMA_VERSION,
  enabled: false,
  knowledgeId: 'wiki_demo',
  autoRetrieve: false,
  maxItems: 8,
  maxBytes: 8 * 1024,
  timeoutMs: 750,
};

interface ProviderLease {
  readonly provider: AgentMemoryKnowledgeProvider;
  readonly owned: boolean;
}

export class AgentMemoryKnowledgeSettingsManager {
  private readonly settings: SettingsStore;
  private readonly providerFactory: ((knowledgeId: string) => AgentMemoryKnowledgeProvider | undefined) | undefined;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly injectedProvider: AgentMemoryKnowledgeProvider | undefined;
  private readonly ownedProviders = new Set<AgentMemoryKnowledgeProvider>();
  private settingsValue: AgentMemoryKnowledgeSettings;
  private resource: AgentMemoryKnowledgeSettingsResource = emptyResource();
  private lastHealthAt: string | null = null;
  private lastErrorCode: AgentMemoryKnowledgeSettingsStatus['lastErrorCode'] = null;
  private closed = false;

  constructor(options: AgentMemoryKnowledgeSettingsManagerOptions) {
    this.settings = options.settings;
    this.providerFactory = options.providerFactory;
    this.environment = options.environment ?? process.env;
    this.injectedProvider = options.provider;
    this.settingsValue = this.loadSettings();
  }

  settingsSnapshot(): AgentMemoryKnowledgeSettings {
    return { ...this.settingsValue };
  }

  status(): AgentMemoryKnowledgeSettingsStatus {
    const disabled = !this.settingsValue.enabled;
    return AgentMemoryKnowledgeSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_status_v0',
      settings: this.settingsValue,
      available: disabled ? false : this.resource.resourceType !== null && this.lastErrorCode === null,
      degraded: disabled ? false : this.lastErrorCode !== null,
      resourceType: disabled ? null : this.resource.resourceType,
      resourceName: disabled ? null : this.resource.resourceName,
      sourceRevision: disabled ? null : this.resource.sourceRevision,
      tools: disabled ? [] : this.resource.tools,
      lastHealthAt: disabled ? null : this.lastHealthAt,
      lastErrorCode: disabled ? null : this.lastErrorCode,
    });
  }

  patch(input: unknown): AgentMemoryKnowledgeSettingsStatus {
    let parsed: AgentMemoryKnowledgeSettingsPatch;
    try {
      parsed = AgentMemoryKnowledgeSettingsPatchSchema.parse(input);
    } catch (error) {
      throw new AgentMemoryKnowledgeSettingsError('INVALID_SETTINGS', 'Agent memory knowledge settings are invalid.', { cause: error });
    }
    const previousSettings = this.settingsValue;
    let next: AgentMemoryKnowledgeSettings;
    try {
      next = AgentMemoryKnowledgeSettingsSchema.parse({ ...this.settingsValue, ...parsed, schemaVersion: AGENT_MEMORY_KNOWLEDGE_SETTINGS_SCHEMA_VERSION });
    } catch (error) {
      throw new AgentMemoryKnowledgeSettingsError('INVALID_SETTINGS', 'Agent memory knowledge settings are invalid.', { cause: error });
    }
    try {
      this.settings.set(AGENT_MEMORY_KNOWLEDGE_SETTINGS_NAMESPACE, AGENT_MEMORY_KNOWLEDGE_SETTINGS_KEY, next);
    } catch (error) {
      throw new AgentMemoryKnowledgeSettingsError('PERSISTENCE_FAILED', 'Agent memory knowledge settings could not be saved.', { cause: error });
    }
    this.settingsValue = next;
    if (!next.enabled) {
      this.resource = emptyResource();
      this.lastHealthAt = null;
      this.lastErrorCode = null;
    } else if (next.knowledgeId !== previousSettings.knowledgeId) {
      // A resource change invalidates the previous descriptor. The next probe
      // or run will obtain a descriptor for the new explicit resource.
      this.resource = emptyResource();
      this.lastErrorCode = null;
    }
    return this.status();
  }

  /** Probe only the bounded public tools/list surface. */
  async probe(signal?: AbortSignal): Promise<AgentMemoryKnowledgeSettingsStatus> {
    if (!this.settingsValue.enabled) return this.status();
    const lease = this.acquireProvider(this.settingsValue.knowledgeId);
    if (!lease) return this.markDegraded('unavailable');
    try {
      const listed = await lease.provider.listTools({ knowledgeId: this.settingsValue.knowledgeId, ...(signal ? { signal } : {}) });
      if (listed.degraded) {
        this.resource = {
          resourceType: listed.resourceType,
          resourceName: listed.name,
          sourceRevision: listed.sourceRevision,
          tools: toSafeTools(listed.tools),
        };
        return this.markDegraded(listed.errorCode ?? 'unavailable');
      }
      this.resource = {
        resourceType: listed.resourceType,
        resourceName: listed.name,
        sourceRevision: listed.sourceRevision,
        tools: toSafeTools(listed.tools),
      };
      this.lastHealthAt = new Date().toISOString();
      this.lastErrorCode = null;
      return this.status();
    } catch {
      return this.markDegraded('protocol');
    } finally {
      if (lease.owned) await this.disposeProvider(lease.provider);
    }
  }

  /** Freeze provider ownership, resource ID and limits for one new run. */
  createRunSnapshot(): AgentMemoryKnowledgeRunSnapshot | undefined {
    const settings = this.settingsValue;
    if (this.closed || !settings.enabled || !settings.autoRetrieve) return undefined;
    const lease = this.acquireProvider(settings.knowledgeId);
    if (!lease) return undefined;
    return {
      provider: lease.provider,
      knowledgeId: settings.knowledgeId,
      maxItems: settings.maxItems,
      maxBytes: settings.maxBytes,
      timeoutMs: settings.timeoutMs,
      sourceRevision: this.resource.sourceRevision,
      dispose: lease.owned ? () => this.disposeProvider(lease.provider) : async () => undefined,
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    const providers = [...this.ownedProviders];
    this.ownedProviders.clear();
    await Promise.allSettled(providers.map((provider) => provider.close()));
    if (this.injectedProvider) {
      try { await this.injectedProvider.close(); } catch { /* bounded shutdown */ }
    }
  }

  private loadSettings(): AgentMemoryKnowledgeSettings {
    const value = this.settings.get<unknown>(AGENT_MEMORY_KNOWLEDGE_SETTINGS_NAMESPACE, AGENT_MEMORY_KNOWLEDGE_SETTINGS_KEY);
    if (value === undefined) {
      this.settings.set(AGENT_MEMORY_KNOWLEDGE_SETTINGS_NAMESPACE, AGENT_MEMORY_KNOWLEDGE_SETTINGS_KEY, DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    try {
      return AgentMemoryKnowledgeSettingsSchema.parse(value);
    } catch (error) {
      throw new AgentMemoryKnowledgeSettingsError('CORRUPT_SETTINGS', 'Stored agent memory knowledge settings are invalid.', { cause: error });
    }
  }

  private acquireProvider(knowledgeId: string): ProviderLease | undefined {
    if (this.injectedProvider) return { provider: this.injectedProvider, owned: false };
    let provider: AgentMemoryKnowledgeProvider | undefined;
    try {
      provider = this.providerFactory?.(knowledgeId) ?? this.createProviderFromEnvironment();
    } catch {
      provider = undefined;
    }
    if (!provider) return undefined;
    this.ownedProviders.add(provider);
    return { provider, owned: true };
  }

  private createProviderFromEnvironment(): AgentMemoryKnowledgeProvider | undefined {
    const endpoint = this.environment.READY4VIBE_MEMORY_KNOWLEDGE_ENDPOINT ?? 'http://127.0.0.1:8421';
    const serviceId = this.environment.READY4VIBE_MEMORY_KNOWLEDGE_SERVICE_ID ?? 'vibego';
    const allowInsecureHttp = this.environment.READY4VIBE_MEMORY_KNOWLEDGE_ALLOW_INSECURE_HTTP === '1' || isLoopback(endpoint);
    const options: MemoryKnowledgeProviderOptions = {
      endpoint,
      serviceId,
      ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      ...(this.environment.READY4VIBE_MEMORY_KNOWLEDGE_TIMEOUT_MS ? { timeoutMs: Number(this.environment.READY4VIBE_MEMORY_KNOWLEDGE_TIMEOUT_MS) } : {}),
    };
    return new TencentMemoryKnowledgeProvider(options);
  }

  private async disposeProvider(provider: AgentMemoryKnowledgeProvider): Promise<void> {
    if (!this.ownedProviders.delete(provider)) return;
    try { await provider.close(); } catch { /* bounded best effort */ }
  }

  private markDegraded(code: AgentMemoryKnowledgeSettingsStatus['lastErrorCode']): AgentMemoryKnowledgeSettingsStatus {
    this.lastHealthAt = new Date().toISOString();
    this.lastErrorCode = code;
    return this.status();
  }
}

function emptyResource(): AgentMemoryKnowledgeSettingsResource {
  return { resourceType: null, resourceName: null, sourceRevision: null, tools: [] };
}

function toSafeTools(tools: readonly AgentMemoryKnowledgeSettingsStatus['tools'][number][]): AgentMemoryKnowledgeSettingsTool[] {
  return tools.map((tool) => ({ name: tool.name, description: tool.description }));
}

function isLoopback(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]');
  } catch {
    return false;
  }
}
