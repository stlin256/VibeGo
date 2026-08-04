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
  readonly close?: () => Promise<void> | void;
  references: number;
  retired: boolean;
  closePromise?: Promise<void>;
}

export interface McpBindingLifecycle {
  readonly close?: () => Promise<void> | void;
}

/**
 * Application-level, opt-in binding. RunManager captures the returned
 * ToolRuntime just like every existing runtime; this manager owns no model,
 * approval, scheduler, sandbox or event authority.
 */
export class McpRunBindingManager {
  private binding: ActiveBinding | undefined;
  private readonly retired = new Set<ActiveBinding>();
  private closed = false;

  constructor(private readonly workspaceRegistry: WorkspaceRegistry) {}

  status(): McpRunBindingStatus {
    return {
      enabled: this.binding !== undefined,
      currentRevision: this.binding?.snapshot.fingerprint ?? null,
      capabilityCount: this.binding?.snapshot.capabilities.length ?? 0,
    };
  }

  activate(snapshot: McpCapabilitySnapshot, callPort: McpToolCallPort, lifecycle: McpBindingLifecycle = {}): McpRunBindingStatus {
    if (this.closed || snapshot.health !== 'healthy-verified' || snapshot.capabilities.length === 0 || !callPort || typeof callPort.call !== 'function') {
      throw new McpRunBindingError('INVALID_SNAPSHOT');
    }
    const executable = snapshot.capabilities.filter((descriptor) => descriptor.kind === 'tool' && descriptor.executable === true);
    if (executable.length === 0 || executable.some((descriptor) => descriptor.serverId !== snapshot.serverId || !isSafeDescriptor(descriptor))) {
      throw new McpRunBindingError('CAPABILITY_MISMATCH');
    }
    const previous = this.binding;
    this.binding = {
      snapshot: cloneSnapshot(snapshot),
      callPort,
      ...(lifecycle.close ? { close: lifecycle.close } : {}),
      references: 0,
      retired: false,
    };
    if (previous) this.retire(previous);
    return this.status();
  }

  deactivate(): McpRunBindingStatus {
    const previous = this.binding;
    this.binding = undefined;
    if (previous) this.retire(previous);
    return this.status();
  }

  runtimeForRun(config: RunConfig): ToolRuntime | undefined {
    if (this.closed) return undefined;
    const binding = this.binding;
    if (!binding) return undefined;
    const workspaceRoot = this.workspaceRegistry.resolveRoot(config.workspaceId);
    if (!workspaceRoot) return undefined;
    const runtime = new McpToolExecutorRuntime({
      snapshot: binding.snapshot,
      callPort: binding.callPort,
      resolveWorkspaceRoot: (request) => request.config.workspaceId === config.workspaceId ? workspaceRoot : '',
    });
    binding.references += 1;
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      this.release(binding);
    };
    return Object.assign(runtime, { dispose: release });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const active = this.binding;
    this.binding = undefined;
    const bindings = [...this.retired, ...(active ? [active] : [])];
    this.retired.clear();
    await Promise.all(bindings.map((binding) => this.closeBinding(binding)));
  }

  private retire(binding: ActiveBinding): void {
    if (binding.retired) return;
    binding.retired = true;
    this.retired.add(binding);
    if (binding.references === 0) {
      this.scheduleRetiredClose(binding);
      return;
    }
  }

  private release(binding: ActiveBinding): void {
    if (binding.references > 0) binding.references -= 1;
    if (binding.retired && binding.references === 0) {
      this.scheduleRetiredClose(binding);
    }
  }

  private scheduleRetiredClose(binding: ActiveBinding): void {
    void this.closeBinding(binding).finally(() => this.retired.delete(binding));
  }

  private closeBinding(binding: ActiveBinding): Promise<void> {
    if (binding.closePromise) return binding.closePromise;
    binding.closePromise = Promise.resolve()
      .then(() => binding.close?.())
      .catch(() => undefined);
    return binding.closePromise;
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
