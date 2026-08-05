import type { AgentToolDescriptor, ToolRuntime, ToolRuntimeRequest, ToolRuntimeResult } from '@ready4vibe/agent';
import type { PermissionProfile } from '@ready4vibe/contracts';
import { permissionToolAllowed } from '@ready4vibe/policy';

/**
 * Narrow an already-authorized runtime to a permission profile snapshot. The
 * wrapper owns no executor or approval state; all calls remain delegated to
 * the runtime captured for the run.
 */
export function constrainPermissionToolRuntime(runtime: ToolRuntime | undefined, profile: PermissionProfile | undefined): ToolRuntime | undefined {
  if (!runtime || !profile) return runtime;
  const allowed = runtime.descriptors.filter((descriptor) => permissionToolAllowed(profile, descriptor));
  if (allowed.length === 0) return undefined;
  const byName = new Map(allowed.map((descriptor) => [descriptor.name, descriptor]));
  const constrained: ToolRuntime = {
    descriptors: Object.freeze([...allowed]),
    execute: async (request): Promise<ToolRuntimeResult> => {
      const descriptor = byName.get(request.descriptor.name);
      if (!descriptor || descriptor.id !== request.descriptor.id || descriptor.version !== request.descriptor.version) throw { code: 'TOOL_FORBIDDEN' };
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
