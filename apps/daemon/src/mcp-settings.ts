import type {
  McpSettings,
  McpSettingsErrorCode,
  McpSettingsHealth,
  McpSettingsPatch,
  McpSettingsProbeResult,
  McpSettingsStatus,
  McpSettingsStatusKind,
} from '@ready4vibe/contracts';
import {
  McpSettingsPatchSchema,
  McpSettingsProbeResultSchema,
  McpSettingsSchema,
  McpSettingsStatusSchema,
  MCP_SETTINGS_SCHEMA_VERSION,
} from '@ready4vibe/contracts';
import type { SettingsStore } from '@ready4vibe/storage';

export const MCP_SETTINGS_NAMESPACE = 'mcp' as const;
export const MCP_SETTINGS_KEY = 'v1' as const;

export interface McpSettingsProbe {
  probe(settings: McpSettings, signal: AbortSignal): Promise<unknown>;
}

export interface McpSettingsManagerOptions {
  readonly settings: SettingsStore;
  readonly probe?: McpSettingsProbe;
  readonly clock?: () => Date;
}

export class McpSettingsError extends Error {
  constructor(readonly code: 'INVALID_SETTINGS' | 'CORRUPT_SETTINGS' | 'PERSISTENCE_FAILED', message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'McpSettingsError';
  }
}

const DEFAULT_SETTINGS: McpSettings = {
  schemaVersion: MCP_SETTINGS_SCHEMA_VERSION,
  enabled: false,
  serverId: 'local-mcp',
  serverVersion: '1.0.0',
  transport: 'stdio',
  endpointLabel: 'Local MCP server',
  manifestRevision: 'unconfigured',
  capabilityAllowlist: [],
};

export class McpSettingsManager {
  private readonly settings: SettingsStore;
  private readonly probePort: McpSettingsProbe | undefined;
  private readonly clock: () => Date;
  private settingsValue: McpSettings;
  private state: McpSettingsStatusKind;
  private health: McpSettingsHealth | null;
  private available: boolean;
  private degraded: boolean;
  private currentRevision: string | null;
  private previousRevision: string | null;
  private capabilityCount: number;
  private lastHealthAt: string | null;
  private lastErrorCode: McpSettingsErrorCode | null;

  constructor(options: McpSettingsManagerOptions) {
    this.settings = options.settings;
    this.probePort = options.probe;
    this.clock = options.clock ?? (() => new Date());
    this.settingsValue = this.loadSettings();
    this.state = this.settingsValue.enabled ? 'degraded' : 'disabled';
    this.health = null;
    this.available = false;
    this.degraded = this.settingsValue.enabled;
    this.currentRevision = null;
    this.previousRevision = null;
    this.capabilityCount = 0;
    this.lastHealthAt = null;
    this.lastErrorCode = this.settingsValue.enabled ? 'unavailable' : 'disabled';
  }

  settingsSnapshot(): McpSettings {
    return { ...this.settingsValue, capabilityAllowlist: [...this.settingsValue.capabilityAllowlist] };
  }

  status(): McpSettingsStatus {
    return McpSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_mcp_settings_status_v0',
      settings: this.settingsSnapshot(),
      status: this.state,
      health: this.health,
      available: this.available,
      degraded: this.degraded,
      currentRevision: this.currentRevision,
      previousRevision: this.previousRevision,
      capabilityCount: this.capabilityCount,
      lastHealthAt: this.lastHealthAt,
      lastErrorCode: this.lastErrorCode,
      nextAction: !this.settingsValue.enabled ? 'enable' : this.available ? 'none' : this.health === 'healthy-connectivity-only' ? 'review-capabilities' : 'probe',
    });
  }

  patch(input: unknown): McpSettingsStatus {
    let patch: McpSettingsPatch;
    try {
      patch = McpSettingsPatchSchema.parse(input);
    } catch (error) {
      throw new McpSettingsError('INVALID_SETTINGS', 'MCP settings are invalid.', { cause: error });
    }
    let next: McpSettings;
    try {
      next = McpSettingsSchema.parse({ ...this.settingsValue, ...patch, schemaVersion: MCP_SETTINGS_SCHEMA_VERSION });
    } catch (error) {
      throw new McpSettingsError('INVALID_SETTINGS', 'MCP settings are invalid.', { cause: error });
    }
    try {
      this.settings.set(MCP_SETTINGS_NAMESPACE, MCP_SETTINGS_KEY, next);
    } catch (error) {
      throw new McpSettingsError('PERSISTENCE_FAILED', 'MCP settings could not be saved.', { cause: error });
    }

    const wasEnabled = this.settingsValue.enabled;
    const identityChanged = next.serverId !== this.settingsValue.serverId
      || next.serverVersion !== this.settingsValue.serverVersion
      || next.manifestRevision !== this.settingsValue.manifestRevision
      || next.transport !== this.settingsValue.transport;
    this.settingsValue = next;
    if (!next.enabled) {
      this.resetDisabled();
    } else if (identityChanged || !wasEnabled) {
      this.resetPending();
    } else if (this.state === 'disabled') {
      this.resetPending();
    }
    return this.status();
  }

  async probe(signal?: AbortSignal): Promise<McpSettingsStatus> {
    if (!this.settingsValue.enabled) return this.status();
    this.lastHealthAt = this.clock().toISOString();
    if (!this.probePort) return this.markDegraded('unavailable');
    const probeSignal = signal ?? new AbortController().signal;
    let result: McpSettingsProbeResult;
    try {
      result = McpSettingsProbeResultSchema.parse(await this.probePort.probe(this.settingsSnapshot(), probeSignal));
    } catch (error) {
      void error;
      return this.markDegraded('unavailable');
    }
    if (result.serverId !== this.settingsValue.serverId || result.manifestRevision !== this.settingsValue.manifestRevision) {
      return this.markDegraded('schema');
    }
    this.health = result.health;
    this.currentRevision = result.currentRevision;
    this.previousRevision = result.previousRevision;
    this.capabilityCount = result.capabilityCount;
    if (result.health === 'healthy-verified') {
      this.state = 'ready';
      this.available = true;
      this.degraded = false;
      this.lastErrorCode = null;
    } else if (result.health === 'healthy-connectivity-only') {
      this.state = 'ready';
      this.available = false;
      this.degraded = true;
      this.lastErrorCode = null;
    } else {
      this.markDegraded('unavailable');
    }
    return this.status();
  }

  private loadSettings(): McpSettings {
    const value = this.settings.get<unknown>(MCP_SETTINGS_NAMESPACE, MCP_SETTINGS_KEY);
    if (value === undefined) {
      try {
        this.settings.set(MCP_SETTINGS_NAMESPACE, MCP_SETTINGS_KEY, DEFAULT_SETTINGS);
      } catch (error) {
        throw new McpSettingsError('PERSISTENCE_FAILED', 'MCP settings could not be initialized.', { cause: error });
      }
      return { ...DEFAULT_SETTINGS, capabilityAllowlist: [] };
    }
    try {
      return McpSettingsSchema.parse(value);
    } catch (error) {
      throw new McpSettingsError('CORRUPT_SETTINGS', 'Stored MCP settings are invalid.', { cause: error });
    }
  }

  private resetDisabled(): void {
    this.state = 'disabled';
    this.health = null;
    this.available = false;
    this.degraded = false;
    this.currentRevision = null;
    this.previousRevision = null;
    this.capabilityCount = 0;
    this.lastHealthAt = null;
    this.lastErrorCode = 'disabled';
  }

  private resetPending(): void {
    this.state = 'degraded';
    this.health = null;
    this.available = false;
    this.degraded = true;
    this.currentRevision = null;
    this.previousRevision = null;
    this.capabilityCount = 0;
    this.lastHealthAt = null;
    this.lastErrorCode = 'unavailable';
  }

  private markDegraded(code: McpSettingsErrorCode): McpSettingsStatus {
    this.state = 'degraded';
    this.health = 'failed';
    this.available = false;
    this.degraded = true;
    this.lastErrorCode = code;
    return this.status();
  }
}
