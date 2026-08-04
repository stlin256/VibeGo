import type { ToolRuntime } from '@ready4vibe/agent';
import type { RunConfig } from '@ready4vibe/contracts';
import type { McpCapabilityDescriptor, McpCapabilitySnapshot, McpToolCallPort } from '@ready4vibe/skill-mcp';
import { McpToolExecutorRuntime } from '@ready4vibe/tool-adapters';
import type { WorkspaceRegistry } from '@ready4vibe/workspaces';

export interface McpRunBindingStatus {
  readonly enabled: boolean;
  readonly currentRevision: string | null;
  readonly capabilityCount: number;
}

export class McpRunBindingError extends Error {
  constructor(readonly code: 'INVALID_SNAPSHOT' | 'CAPABILITY_MISMATCH', message = 'The MCP run binding is invalid.') {
    super(message);
    this.name = 'McpRunBindingError';
  }
}

interface ActiveBinding {
  readonly snapshot: McpCapabilitySnapshot;
  readonly callPort: McpToolCallPort;
}

/**
 * Application-level, opt-in binding. RunManager captures the returned
 * ToolRuntime just like every existing runtime; this manager owns no model,
 * approval, scheduler, sandbox or event authority.
 */
export class McpRunBindingManager {
  private binding: ActiveBinding | undefined;

  constructor(private readonly workspaceRegistry: WorkspaceRegistry) {}

  status(): McpRunBindingStatus {
    return {
      enabled: this.binding !== undefined,
      currentRevision: this.binding?.snapshot.fingerprint ?? null,
      capabilityCount: this.binding?.snapshot.capabilities.length ?? 0,
    };
  }

  activate(snapshot: McpCapabilitySnapshot, callPort: McpToolCallPort): McpRunBindingStatus {
    if (snapshot.health !== 'healthy-verified' || snapshot.capabilities.length === 0 || !callPort || typeof callPort.call !== 'function') {
      throw new McpRunBindingError('INVALID_SNAPSHOT');
    }
    const executable = snapshot.capabilities.filter((descriptor) => descriptor.kind === 'tool' && descriptor.executable === true);
    if (executable.length === 0 || executable.some((descriptor) => descriptor.serverId !== snapshot.serverId || !isSafeDescriptor(descriptor))) {
      throw new McpRunBindingError('CAPABILITY_MISMATCH');
    }
    this.binding = { snapshot: cloneSnapshot(snapshot), callPort };
    return this.status();
  }

  deactivate(): McpRunBindingStatus {
    this.binding = undefined;
    return this.status();
  }

  runtimeForRun(config: RunConfig): ToolRuntime | undefined {
    const binding = this.binding;
    if (!binding) return undefined;
    const workspaceRoot = this.workspaceRegistry.resolveRoot(config.workspaceId);
    if (!workspaceRoot) return undefined;
    return new McpToolExecutorRuntime({
      snapshot: binding.snapshot,
      callPort: binding.callPort,
      resolveWorkspaceRoot: (request) => request.config.workspaceId === config.workspaceId ? workspaceRoot : '',
    });
  }
}

function isSafeDescriptor(descriptor: McpCapabilityDescriptor): boolean {
  return descriptor.kind === 'tool'
    && descriptor.executable === true
    && descriptor.serverId.length > 0
    && descriptor.id.length > 0
    && descriptor.qualifiedName.length > 0
    && descriptor.revision.length > 0;
}

function cloneSnapshot(snapshot: McpCapabilitySnapshot): McpCapabilitySnapshot {
  const clone = JSON.parse(JSON.stringify(snapshot)) as McpCapabilitySnapshot;
  return deepFreeze(clone);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}
