import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteEventStore } from './index.js';
import {
  InMemorySettingsStore,
  SETTINGS_VALUE_LIMIT_BYTES,
  SqliteSettingsStore,
} from './settings.js';

function databasePath(): string {
  return join(tmpdir(), `ready4vibe-settings-${randomUUID()}.sqlite`);
}

function cleanup(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

describe('InMemorySettingsStore', () => {
  it('keeps validated snapshots and rejects secret-shaped names and fields', () => {
    const store = new InMemorySettingsStore();
    store.set('workspace-registry', 'v1', { schemaVersion: 1, label: 'Workspace' });
    expect(store.get('workspace-registry', 'v1')).toEqual({ schemaVersion: 1, label: 'Workspace' });
    expect(() => store.set('model', 'api-key', { value: 'fake' })).toThrowError(expect.objectContaining({ code: 'SETTINGS_SECRET_FIELD' }));
    expect(() => store.set('safe', 'v1', { nested: { accessToken: 'fake' } })).toThrowError(expect.objectContaining({ code: 'SETTINGS_SECRET_FIELD' }));
    store.close();
    expect(() => store.get('workspace-registry', 'v1')).toThrowError(expect.objectContaining({ code: 'SETTINGS_CLOSED' }));
  });
});

describe('SqliteSettingsStore', () => {
  it('persists a bounded value across close and reopen', () => {
    const path = databasePath();
    const first = new SqliteSettingsStore(path);
    first.set('workspace-registry', 'v1', { schemaVersion: 1, workspaces: [] });
    first.close();

    const reopened = new SqliteSettingsStore(path);
    expect(reopened.get('workspace-registry', 'v1')).toEqual({ schemaVersion: 1, workspaces: [] });
    reopened.close();
    cleanup(path);
  });

  it('keeps settings in a separate table from run events', async () => {
    const path = databasePath();
    const events = new SqliteEventStore(path);
    const settings = new SqliteSettingsStore(path);
    await events.append({ runId: 'run_settings_1', type: 'run.created', source: 'system', correlationId: 'corr_settings_1', payload: { ok: true } });
    settings.set('workspace-registry', 'v1', { schemaVersion: 1, workspaces: [] });
    expect(await events.read('run_settings_1')).toHaveLength(1);
    settings.close();
    events.close();
    cleanup(path);
  });

  it('rejects cyclic, oversized, secret, and invalid-name values', () => {
    const store = new SqliteSettingsStore(':memory:');
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => store.set('safe', 'v1', cyclic)).toThrowError(expect.objectContaining({ code: 'SETTINGS_NOT_SERIALIZABLE' }));
    expect(() => store.set('safe', 'v1', { value: 'x'.repeat(SETTINGS_VALUE_LIMIT_BYTES) })).toThrowError(expect.objectContaining({ code: 'SETTINGS_TOO_LARGE' }));
    expect(() => store.set('safe', 'v1', { environment: { PATH: 'fake' } })).toThrowError(expect.objectContaining({ code: 'SETTINGS_SECRET_FIELD' }));
    expect(() => store.set('safe!', 'v1', {})).toThrowError(expect.objectContaining({ code: 'SETTINGS_INVALID_NAME' }));
    store.close();
  });

  it('updates and deletes atomically and rejects operations after close', () => {
    const store = new SqliteSettingsStore(':memory:');
    store.set('safe', 'v1', { value: 1 });
    store.set('safe', 'v1', { value: 2 });
    expect(store.get('safe', 'v1')).toEqual({ value: 2 });
    store.delete('safe', 'v1');
    expect(store.get('safe', 'v1')).toBeUndefined();
    store.close();
    expect(() => store.delete('safe', 'v1')).toThrowError(expect.objectContaining({ code: 'SETTINGS_CLOSED' }));
  });

});
