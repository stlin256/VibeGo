import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore, SqliteSettingsStore } from '@ready4vibe/storage';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import {
  SqliteWorkspaceRegistryPersistence,
  WORKSPACE_SETTINGS_SCHEMA_VERSION,
  parseWorkspaceSettingsPayload,
} from './workspace-persistence.js';

const root = join(tmpdir(), 'ready4vibe-workspace');

describe('SqliteWorkspaceRegistryPersistence', () => {
  it('stores a versioned bounded snapshot without adding a second event stream', () => {
    const settings = new InMemorySettingsStore();
    const persistence = new SqliteWorkspaceRegistryPersistence(settings);
    persistence.save([{ id: 'repo', path: root, label: 'Repository' }]);
    expect(persistence.load()).toEqual([{ id: 'repo', path: root, label: 'Repository' }]);
    expect(settings.get('workspace-registry', 'v1')).toEqual({
      schemaVersion: WORKSPACE_SETTINGS_SCHEMA_VERSION,
      workspaces: [{ id: 'repo', path: root, label: 'Repository' }],
    });
  });

  it('fails closed for unknown schema, extra fields, duplicate ids, relative roots, and oversized lists', () => {
    const invalidPayloads: unknown[] = [
      { schemaVersion: 2, workspaces: [] },
      { schemaVersion: 1, workspaces: [], extra: true },
      { schemaVersion: 1, workspaces: [{ id: 'repo', path: root }, { id: 'repo', path: root }] },
      { schemaVersion: 1, workspaces: [{ id: 'repo', path: 'relative/path' }] },
      { schemaVersion: 1, workspaces: Array.from({ length: 129 }, (_, index) => ({ id: `repo-${index}`, path: root })) },
    ];
    for (const payload of invalidPayloads) {
      expect(() => parseWorkspaceSettingsPayload(payload)).toThrowError(expect.objectContaining({ code: 'INVALID_WORKSPACE_SETTINGS' }));
    }
  });

  it('accepts only the safe workspace fields and preserves optional labels', () => {
    expect(parseWorkspaceSettingsPayload({ schemaVersion: 1, workspaces: [{ id: 'repo', path: root }] })).toEqual({
      schemaVersion: 1,
      workspaces: [{ id: 'repo', path: root }],
    });
    expect(() => parseWorkspaceSettingsPayload({ schemaVersion: 1, workspaces: [{ id: 'default', path: root }] })).toThrowError();
    expect(() => parseWorkspaceSettingsPayload({ schemaVersion: 1, workspaces: [{ id: 'repo', path: root, label: 'bad\nlabel' }] })).toThrowError();
  });

  it('restores a workspace through the real SQLite adapter after a daemon-style reopen', () => {
    const databasePath = join(tmpdir(), `ready4vibe-workspace-${randomUUID()}.sqlite`);
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ready4vibe-root-'));
    const firstSettings = new SqliteSettingsStore(databasePath);
    const firstRegistry = new InMemoryWorkspaceRegistry({
      defaultRoot: workspaceRoot,
      persistence: new SqliteWorkspaceRegistryPersistence(firstSettings),
    });
    firstRegistry.add({ id: 'repo', path: workspaceRoot, label: 'Repository' });
    firstSettings.close();

    const reopenedSettings = new SqliteSettingsStore(databasePath);
    const reopenedRegistry = new InMemoryWorkspaceRegistry({
      defaultRoot: workspaceRoot,
      persistence: new SqliteWorkspaceRegistryPersistence(reopenedSettings),
    });
    expect(reopenedRegistry.status().workspaces.map((workspace) => workspace.id)).toEqual(['default', 'repo']);
    expect(JSON.stringify(reopenedRegistry.status())).not.toContain(workspaceRoot);
    reopenedSettings.close();
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
  });
});
