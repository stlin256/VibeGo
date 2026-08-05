import type { AgentToolDescriptor, ToolRuntime, ToolRuntimeRequest, ToolRuntimeResult } from '@ready4vibe/agent';
import type { CapabilityProfile } from '@ready4vibe/contracts';

/**
 * Constrain an already-authorized runtime to the capability profile captured
 * for the run. The wrapper only narrows descriptors; it never creates a tool,
 * changes Approval/Sandbox policy or mutates the underlying runtime.
 */
export function constrainToolRuntime(runtime: ToolRuntime | undefined, profile: CapabilityProfile | undefined): ToolRuntime | undefined {
  if (!runtime || !profile) return runtime;
  const allowed = runtime.descriptors.filter((descriptor) => descriptorAllowed(descriptor, profile));
  if (allowed.length === 0) return undefined;
  const byName = new Map(allowed.map((descriptor) => [descriptor.name, descriptor]));
  const constrained: ToolRuntime = {
    descriptors: Object.freeze([...allowed]),
    execute: async (request): Promise<ToolRuntimeResult> => {
      const descriptor = byName.get(request.descriptor.name);
      if (!descriptor || descriptor.id !== request.descriptor.id || descriptor.version !== request.descriptor.version) {
        throw { code: 'TOOL_FORBIDDEN' };
      }
      return runtime.execute({ ...request, descriptor });
    },
    ...(runtime.approve ? {
      approve: async (request: ToolRuntimeRequest, ttlMs: number): Promise<void> => {
        const descriptor = byName.get(request.descriptor.name);
        if (!descriptor || descriptor.id !== request.descriptor.id || descriptor.version !== request.descriptor.version) throw { code: 'TOOL_FORBIDDEN' };
        await runtime.approve?.({ ...request, descriptor }, ttlMs);
      },
    } : {}),
    ...(runtime.approvalDetails ? {
      approvalDetails: (request: ToolRuntimeRequest) => {
        const descriptor = byName.get(request.descriptor.name);
        if (!descriptor || descriptor.id !== request.descriptor.id || descriptor.version !== request.descriptor.version) return undefined;
        return runtime.approvalDetails?.({ ...request, descriptor });
      },
    } : {}),
  };
  const dispose = (runtime as ToolRuntime & { dispose?: () => Promise<void> | void }).dispose;
  return dispose ? Object.assign(constrained, { dispose }) : constrained;
}

function descriptorAllowed(descriptor: AgentToolDescriptor, profile: CapabilityProfile): boolean {
  const id = descriptor.id;
  if (id.startsWith('filesystem.') || id.startsWith('git.')) {
    if (profile.filesystemMode === 'off') return false;
    return profile.filesystemMode !== 'workspace-read' || descriptor.risk === 'read';
  }
  if (id === 'shell.exec' || id.startsWith('shell.')) return profile.shellMode !== 'off';
  if (id.includes('/tool/') || id.startsWith('mcp.')) return profile.mcpSkillMode === 'configured';
  // Unknown runtimes are not implicitly enabled by a capability profile.
  return false;
}
