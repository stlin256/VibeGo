import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryWorkspaceRegistry, WorkspaceRegistryError, type WorkspaceRegistrationInput, type WorkspaceRegistryPersistence } from './index.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `vibego-${name}-`));
  temporaryRoots.push(root);
  return root;
}

class MemoryWorkspacePersistence implements WorkspaceRegistryPersistence {
  entries: readonly WorkspaceRegistrationInput[] = [];
  fail = false;

  load(): readonly WorkspaceRegistrationInput[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  save(workspaces: readonly WorkspaceRegistrationInput[]): void {
    if (this.fail) throw new Error('simulated persistence failure');
    this.entries = workspaces.map((entry) => ({ ...entry }));
  }
}

describe('InMemoryWorkspaceRegistry', () => {
  it('lists a safe default without exposing its absolute root', () => {
    const root = directory('default');
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root });
    const status = registry.status();
    expect(status.workspaces).toEqual([{ id: 'default', label: expect.any(String), isDefault: true, canRemove: false, capabilities: { filesystem: true, externalSandbox: true } }]);
    expect(JSON.stringify(status)).not.toContain(root);
    expect(registry.resolveRoot('default')).toBe(root);
  });

  it('adds a normalized directory and returns only safe metadata', () => {
    const root = directory('add');
    const child = join(root, 'repo');
    mkdirSync(child);
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root });
    const added = registry.add({ id: 'repo-a', path: child, label: 'Project A' });
    expect(added).toMatchObject({ id: 'repo-a', label: 'Project A', isDefault: false, canRemove: true });
    expect(JSON.stringify(registry.status())).not.toContain(child);
    expect(registry.resolveRoot('repo-a')).toBe(child);
  });

  it('rejects duplicate, malformed, missing and protected operations', () => {
    const root = directory('validation');
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root });
    expect(() => registry.add({ id: 'Bad Id', path: root })).toThrowError(WorkspaceRegistryError);
    expect(() => registry.add({ id: 'missing', path: join(root, 'missing') })).toThrowError(expect.objectContaining({ code: 'INVALID_PATH' }));
    registry.add({ id: 'repo', path: root });
    expect(() => registry.add({ id: 'repo', path: root })).toThrowError(expect.objectContaining({ code: 'WORKSPACE_DUPLICATE' }));
    expect(() => registry.remove('default')).toThrowError(expect.objectContaining({ code: 'WORKSPACE_PROTECTED' }));
    expect(() => registry.remove('unknown')).toThrowError(expect.objectContaining({ code: 'WORKSPACE_NOT_FOUND' }));
  });

  it('removes only non-default entries and never falls back for unknown ids', () => {
    const root = directory('remove');
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root });
    registry.add({ id: 'repo', path: root });
    expect(registry.resolveRoot('unknown')).toBeUndefined();
    registry.remove('repo');
    expect(registry.resolveRoot('repo')).toBeUndefined();
    expect(registry.status().workspaces.map((entry) => entry.id)).toEqual(['default']);
  });

  it('restores custom registrations through the injected persistence port', () => {
    const root = directory('restore');
    const persistence = new MemoryWorkspacePersistence();
    const first = new InMemoryWorkspaceRegistry({ defaultRoot: root, persistence });
    first.add({ id: 'repo', path: root, label: 'Persisted repo' });

    const reopened = new InMemoryWorkspaceRegistry({ defaultRoot: root, persistence });
    expect(reopened.status().workspaces.map((entry) => entry.id)).toEqual(['default', 'repo']);
    expect(reopened.status().workspaces[1]).toMatchObject({ id: 'repo', label: 'Persisted repo', isDefault: false });
    expect(reopened.resolveRoot('repo')).toBe(root);
    expect(JSON.stringify(reopened.status())).not.toContain(root);
  });

  it('persists add/remove mutations and fails closed with rollback on save errors', () => {
    const root = directory('rollback');
    const persistence = new MemoryWorkspacePersistence();
    const registry = new InMemoryWorkspaceRegistry({ defaultRoot: root, persistence });

    persistence.fail = true;
    expect(() => registry.add({ id: 'repo', path: root })).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_FAILED' }));
    expect(registry.resolveRoot('repo')).toBeUndefined();
    expect(persistence.entries).toEqual([]);

    persistence.fail = false;
    registry.add({ id: 'repo', path: root });
    expect(persistence.entries).toHaveLength(1);

    persistence.fail = true;
    expect(() => registry.remove('repo')).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_FAILED' }));
    expect(registry.resolveRoot('repo')).toBe(root);
    expect(persistence.entries).toHaveLength(1);
  });

  it('rejects malformed or stale persisted entries without falling back to default', () => {
    const root = directory('stale');
    const persistence = new MemoryWorkspacePersistence();
    persistence.entries = [{ id: 'missing', path: join(root, 'does-not-exist') }];
    expect(() => new InMemoryWorkspaceRegistry({ defaultRoot: root, persistence })).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_FAILED' }));
  });
});
