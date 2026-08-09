import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RunConfig } from '@ready4vibe/contracts';
import type { WorkspaceRegistry } from '@ready4vibe/workspaces';

/** Run config fields consulted when picking a tool-runtime root. */
export type RunRootConfig = Pick<RunConfig, 'workspaceId' | 'conversationId'>;

/**
 * Resolves the tool-runtime root for a run. Chats without an explicit project
 * (workspaceId 'default') that carry a conversationId get an on-demand session
 * folder under `<workspacesContainer>/sessions/`; everything else resolves
 * through the registry unchanged.
 */
export function createRunRootResolver(
  workspacesContainer: string,
  workspaceRegistry: WorkspaceRegistry,
): (config?: RunRootConfig) => string | undefined {
  return (config?: RunRootConfig): string | undefined => {
    const workspaceId = config?.workspaceId ?? 'default';
    if (workspaceId === 'default' && typeof config?.conversationId === 'string') {
      const slug = config.conversationId.toLowerCase().replace(/[^a-z0-9-]/gu, '').slice(0, 64);
      if (slug.length > 0) {
        const dir = join(workspacesContainer, 'sessions', `session-${slug}`);
        mkdirSync(dir, { recursive: true });
        return dir;
      }
    }
    return workspaceRegistry.resolveRoot(workspaceId);
  };
}
