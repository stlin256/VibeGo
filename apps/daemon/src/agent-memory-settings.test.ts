import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentMemoryProvider, AgentMemoryStatus, AgentMemoryIdentity } from '@ready4vibe/contracts';
import { InMemorySettingsStore, SqliteSettingsStore } from '@ready4vibe/storage';
import { AgentMemorySettingsError, AgentMemorySettingsManager } from './agent-memory-settings.js';

const identity: AgentMemoryIdentity = { teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' };

function readyStatus(overrides: Partial<AgentMemoryStatus> = {}): AgentMemoryStatus {
  return {
    schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: true, mode: 'memory-core', available: true,
    degraded: false, revision: 'rev_123', previousRevision: 'rev_122', lastHealthAt: '2026-08-04T00:00:00.000Z',
    lastUpdateAt: null, updateState: 'ready', lastErrorCode: null, capabilities: ['recall', 'write-back'], ...overrides,
  };
}

function provider(status: AgentMemoryStatus = readyStatus()): AgentMemoryProvider {
  return {
    id: 'tencentdb-agent-memory', mode: 'memory-core',
    status: vi.fn(async () => status),
    recall: vi.fn(async () => ({ items: [], sourceRevision: status.revision, elapsedMs: 0, degraded: false })),
    enqueueWrite: vi.fn(async () => ({ accepted: true, queued: true })),
    close: vi.fn(async () => undefined),
  };
}

describe('AgentMemorySettingsManager', () => {
  it('loads defaults and persists only the versioned non-secret snapshot', () => {
    const settings = new InMemorySettingsStore();
    const manager = new AgentMemorySettingsManager({ settings });
    expect(manager.status()).toMatchObject({ settings: { enabled: false, mode: 'memory-core', teamId: 'vibego' }, status: { mode: 'off', updateState: 'disabled' } });
    const patched = manager.patch({ enabled: true, ...identity, updateIntervalMinutes: 15 });
    expect(patched).toMatchObject({ settings: { enabled: true, userId: 'user_demo', updateIntervalMinutes: 15 }, status: { degraded: true, lastErrorCode: 'unavailable' } });
    const persisted = settings.get<Record<string, unknown>>('agent-memory', 'v1');
    expect(persisted).toMatchObject({ schemaVersion: 'ready4vibe_agent_memory_settings_v1', enabled: true, userId: 'user_demo' });
    expect(JSON.stringify(persisted)).not.toMatch(/api[_-]?key|token|secret|C:\\private/iu);
  });

  it('recreates provider identity on patch and probes without changing run authorities', async () => {
    const settings = new InMemorySettingsStore();
    const first = provider();
    const factory = vi.fn<(next: AgentMemoryIdentity) => AgentMemoryProvider>(() => first);
    const manager = new AgentMemorySettingsManager({ settings, providerFactory: factory });
    await manager.patch({ enabled: true, ...identity });
    const result = await manager.probe();
    expect(result).toMatchObject({ status: { available: true, revision: 'rev_123' }, currentRevision: 'rev_123', previousRevision: 'rev_122' });
    expect(factory).toHaveBeenCalledWith(identity);
    expect(first.status).toHaveBeenCalledTimes(1);
  });

  it('restores the non-secret snapshot after a SQLite-backed daemon reopen', () => {
    const path = join(tmpdir(), `ready4vibe-agent-memory-${randomUUID()}.sqlite`);
    const firstStore = new SqliteSettingsStore(path);
    const first = new AgentMemorySettingsManager({ settings: firstStore });
    first.patch({ enabled: true, ...identity, upstreamRef: 'main', updateIntervalMinutes: 30 });
    firstStore.close();
    const reopenedStore = new SqliteSettingsStore(path);
    const reopened = new AgentMemorySettingsManager({ settings: reopenedStore });
    expect(reopened.settingsSnapshot()).toMatchObject({ enabled: true, teamId: 'team_demo', userId: 'user_demo', upstreamRef: 'main', updateIntervalMinutes: 30 });
    reopenedStore.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  });

  it('returns stable degraded update/rollback status until a supervisor is supplied', async () => {
    const manager = new AgentMemorySettingsManager({ settings: new InMemorySettingsStore(), provider: provider() });
    await manager.patch({ enabled: true, ...identity });
    await manager.probe();
    const updated = await manager.update();
    expect(updated).toMatchObject({ status: { degraded: true, lastErrorCode: 'update', updateState: 'degraded' }, currentRevision: 'rev_123', previousRevision: 'rev_122' });
    const rolledBack = await manager.rollback();
    expect(rolledBack).toMatchObject({ status: { degraded: true, lastErrorCode: 'rollback', updateState: 'rollback' } });
  });

  it('fails closed on invalid patch or corrupt durable values', () => {
    const settings = new InMemorySettingsStore();
    const manager = new AgentMemorySettingsManager({ settings });
    expect(() => manager.patch({ upstreamRepo: 'C:\\private\\repo' })).toThrowError(AgentMemorySettingsError);
    expect(() => manager.patch({ mode: 'proxy', userId: 'token=secret' })).toThrowError(AgentMemorySettingsError);
    expect(() => manager.patch({ enabled: true, mode: 'off' })).toThrowError(AgentMemorySettingsError);
    settings.set('agent-memory', 'v1', { schemaVersion: 1, enabled: true });
    expect(() => new AgentMemorySettingsManager({ settings })).toThrowError(expect.objectContaining({ code: 'CORRUPT_SETTINGS' }));
  });
});
