import type { McpSettings, McpSettingsStatus } from '@ready4vibe/contracts';
import type { McpCapabilitySnapshot, McpToolCallPort } from '@ready4vibe/skill-mcp';
import { McpSettingsManager } from './mcp-settings.js';
import { McpRunBindingManager } from './mcp-runtime-binding.js';

export interface McpActivationCandidate {
  readonly manifestRevision: string;
  readonly currentRevision: string;
  readonly previousRevision: string | null;
  readonly snapshot: McpCapabilitySnapshot;
  readonly callPort: McpToolCallPort;
}

export interface McpActivationProvider {
  /** Runtime credentials/session ownership stays inside this injected port. */
  activate(settings: McpSettings, signal: AbortSignal): Promise<McpActivationCandidate>;
}

export interface McpLiveActivationServiceOptions {
  readonly settings: McpSettingsManager;
  readonly binding: McpRunBindingManager;
  readonly provider?: McpActivationProvider;
}

export interface McpActivationResult {
  readonly activated: boolean;
  readonly status: McpSettingsStatus;
}

export type McpLiveActivationErrorCode = 'INVALID_CANDIDATE' | 'NOT_ALLOWED' | 'STALE_REVISION';

export class McpLiveActivationError extends Error {
  constructor(readonly code: McpLiveActivationErrorCode, message = 'The MCP activation candidate is invalid.') {
    super(message);
    this.name = 'McpLiveActivationError';
  }
}

/**
 * Application gate between a live transport provider and the run binding.
 * There is intentionally no default provider: disabled/degraded settings are
 * fail-soft and cannot start a process or make a network request.
 */
export class McpLiveActivationService {
  private readonly settings: McpSettingsManager;
  private readonly binding: McpRunBindingManager;
  private readonly provider: McpActivationProvider | undefined;

  constructor(options: McpLiveActivationServiceOptions) {
    this.settings = options.settings;
    this.binding = options.binding;
    this.provider = options.provider;
  }

  async activate(signal?: AbortSignal): Promise<McpActivationResult> {
    const settings = this.settings.settingsSnapshot();
    if (!settings.enabled || !this.provider) {
      this.binding.deactivate();
      return { activated: false, status: this.settings.status() };
    }
    const activationSignal = signal ?? new AbortController().signal;
    try {
      const candidate = await this.provider.activate(settings, activationSignal);
      validateCandidate(settings, candidate);
      this.binding.activate(candidate.snapshot, candidate.callPort);
      const status = this.settings.recordProbeResult({
        schemaVersion: 'ready4vibe_mcp_probe_result_v0',
        serverId: settings.serverId,
        manifestRevision: settings.manifestRevision,
        health: 'healthy-verified',
        currentRevision: candidate.currentRevision,
        previousRevision: candidate.previousRevision,
        capabilityCount: candidate.snapshot.capabilities.length,
      });
      if (status.health !== 'healthy-verified' || !status.available) {
        this.binding.deactivate();
        return { activated: false, status };
      }
      return { activated: true, status };
    } catch (error) {
      this.binding.deactivate();
      const code = error instanceof McpLiveActivationError
        ? error.code === 'NOT_ALLOWED' ? 'not-allowed' : error.code === 'STALE_REVISION' ? 'schema' : 'schema'
        : 'unavailable';
      return { activated: false, status: this.settings.degrade(code) };
    }
  }

  deactivate(): McpActivationResult {
    this.binding.deactivate();
    return { activated: false, status: this.settings.settingsSnapshot().enabled ? this.settings.degrade('unavailable') : this.settings.status() };
  }
}

function validateCandidate(settings: McpSettings, candidate: McpActivationCandidate): void {
  if (!isRecord(candidate) || typeof candidate.manifestRevision !== 'string' || candidate.manifestRevision !== settings.manifestRevision) {
    throw new McpLiveActivationError('STALE_REVISION');
  }
  if (!isRecord(candidate.snapshot) || candidate.snapshot.serverId !== settings.serverId || candidate.snapshot.serverVersion !== settings.serverVersion) {
    throw new McpLiveActivationError('STALE_REVISION');
  }
  if (candidate.snapshot.health !== 'healthy-verified' || !Array.isArray(candidate.snapshot.capabilities) || candidate.snapshot.capabilities.length === 0) {
    throw new McpLiveActivationError('INVALID_CANDIDATE');
  }
  if (!candidate.callPort || typeof candidate.callPort.call !== 'function') throw new McpLiveActivationError('INVALID_CANDIDATE');
  const allowlist = new Set(settings.capabilityAllowlist);
  for (const descriptor of candidate.snapshot.capabilities) {
    if (!isRecord(descriptor)) throw new McpLiveActivationError('INVALID_CANDIDATE');
    if (descriptor.kind === 'tool' && descriptor.executable === true && (typeof descriptor.qualifiedName !== 'string' || !allowlist.has(descriptor.qualifiedName))) {
      throw new McpLiveActivationError('NOT_ALLOWED');
    }
  }
  if (typeof candidate.currentRevision !== 'string' || candidate.currentRevision.length === 0 || candidate.currentRevision.length > 128 || /[^A-Za-z0-9._-]/u.test(candidate.currentRevision)) {
    throw new McpLiveActivationError('INVALID_CANDIDATE');
  }
  if (candidate.previousRevision !== null && (typeof candidate.previousRevision !== 'string' || candidate.previousRevision.length === 0 || candidate.previousRevision.length > 128 || /[^A-Za-z0-9._-]/u.test(candidate.previousRevision))) {
    throw new McpLiveActivationError('INVALID_CANDIDATE');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
