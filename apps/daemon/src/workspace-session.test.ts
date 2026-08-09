import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import { createRunRootResolver } from './workspace-session.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('createRunRootResolver', () => {
  it('routes default-workspace conversations into an on-demand session folder', async () => {
    const container = await mkdtemp(join(tmpdir(), 'ready4vibe-sessions-'));
    roots.push(container);
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: container });
    const resolveRunRoot = createRunRootResolver(container, registry);

    const root = resolveRunRoot({ workspaceId: 'default', conversationId: 'Conv_ABC 123' });
    expect(root).toBe(join(container, 'sessions', 'session-convabc123'));
    expect((await stat(root as string)).isDirectory()).toBe(true);
  });

  it('resolves the default workspace when no conversationId is present', async () => {
    const container = await mkdtemp(join(tmpdir(), 'ready4vibe-sessions-'));
    roots.push(container);
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: container });
    const resolveRunRoot = createRunRootResolver(container, registry);

    expect(resolveRunRoot({ workspaceId: 'default' })).toBe(registry.resolveRoot('default'));
    expect(resolveRunRoot(undefined)).toBe(registry.resolveRoot('default'));
    await expect(stat(join(container, 'sessions'))).rejects.toThrow();
  });

  it('ignores conversationId for explicit project workspaces', async () => {
    const container = await mkdtemp(join(tmpdir(), 'ready4vibe-sessions-'));
    roots.push(container);
    const project = await mkdtemp(join(tmpdir(), 'ready4vibe-project-'));
    roots.push(project);
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: container });
    registry.add({ id: 'proj', path: project });
    const resolveRunRoot = createRunRootResolver(container, registry);

    expect(resolveRunRoot({ workspaceId: 'proj', conversationId: 'chat-1' })).toBe(registry.resolveRoot('proj'));
    await expect(stat(join(container, 'sessions'))).rejects.toThrow();
  });
});
