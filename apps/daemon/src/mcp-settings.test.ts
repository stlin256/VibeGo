import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { McpSettingsProbeResult } from '@ready4vibe/contracts';
import { InMemorySettingsStore, SqliteSettingsStore } from '@ready4vibe/storage';
import { McpSettingsError, McpSettingsManager } from './mcp-settings.js';

const enabledPatch = {
  enabled: true,
  serverId: 'demo-mcp',
  serverVersion: '1.2.3',
  transport: 'streamable-http' as const,
  endpointLabel: 'Demo integration',
  manifestRevision: 'manifest-20260804',
  capabilityAllowlist: ['demo-mcp/tool/read_file@1.0.0'],
};

function readyProbe(overrides: Partial<McpSettingsProbeResult> = {}): McpSettingsProbeResult {
  return {
    schemaVersion: 'ready4vibe_mcp_probe_result_v0',
    serverId: 'demo-mcp',
    manifestRevision: 'manifest-20260804',
    health: 'healthy-verified',
    currentRevision: 'cap-20260804',
    previousRevision: null,
    capabilityCount: 1,
    ...overrides,
  };
}

describe('McpSettingsManager', () => {
  it('persists a disabled, non-secret default and restores it from SQLite', () => {
    const path = join(tmpdir(), `ready4vibe-mcp-settings-${randomUUID()}.sqlite`);
    const firstStore = new SqliteSettingsStore(path);
    const first = new McpSettingsManager({ settings: firstStore });
    first.patch(enabledPatch);
    firstStore.close();
    const reopenedStore = new SqliteSettingsStore(path);
    const reopened = new McpSettingsManager({ settings: reopenedStore });
    expect(reopened.settingsSnapshot()).toMatchObject({ enabled: true, serverId: 'demo-mcp', transport: 'streamable-http' });
    expect(JSON.stringify(reopened.settingsSnapshot())).not.toMatch(/api[_-]?key|token|secret|C:\\\\private/iu);
    reopenedStore.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  });

  it('does not call a probe while disabled and reports a bounded degraded state without one', async () => {
    const probe = { probe: vi.fn(async () => readyProbe()) };
    const manager = new McpSettingsManager({ settings: new InMemorySettingsStore(), probe });
    expect(manager.status()).toMatchObject({ status: 'disabled', health: null, nextAction: 'enable' });
    await expect(manager.probe()).resolves.toMatchObject({ status: 'disabled' });
    expect(probe.probe).not.toHaveBeenCalled();

    manager.patch(enabledPatch);
    expect(manager.status()).toMatchObject({ status: 'degraded', available: false, degraded: true, lastErrorCode: 'unavailable', nextAction: 'probe' });
    expect(probe.probe).not.toHaveBeenCalled();
    const withoutProbe = new McpSettingsManager({ settings: new InMemorySettingsStore() });
    withoutProbe.patch(enabledPatch);
    await expect(withoutProbe.probe()).resolves.toMatchObject({ status: 'degraded', health: 'failed', lastErrorCode: 'unavailable' });
  });

  it('accepts only a matching verified probe and exposes bounded revision metadata', async () => {
    const probe = { probe: vi.fn(async () => readyProbe()) };
    const manager = new McpSettingsManager({ settings: new InMemorySettingsStore(), probe, clock: () => new Date('2026-08-04T00:00:00.000Z') });
    manager.patch(enabledPatch);
    const status = await manager.probe();
    expect(status).toMatchObject({ status: 'ready', health: 'healthy-verified', available: true, degraded: false, currentRevision: 'cap-20260804', capabilityCount: 1, nextAction: 'none' });
    expect(status.lastHealthAt).toBe('2026-08-04T00:00:00.000Z');
    expect(JSON.stringify(status)).not.toMatch(/rawResponse|token|secret|C:\\\\|\/(?:Users|home)\//iu);
    expect(probe.probe).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'demo-mcp' }), expect.any(AbortSignal));
  });

  it('fails closed on revision mismatch, probe errors, and unsafe patches', async () => {
    const mismatch = { probe: vi.fn(async () => readyProbe({ serverId: 'other-mcp' })) };
    const manager = new McpSettingsManager({ settings: new InMemorySettingsStore(), probe: mismatch });
    manager.patch(enabledPatch);
    const mismatchStatus = await manager.probe();
    expect(mismatchStatus).toMatchObject({ status: 'degraded', health: 'failed', lastErrorCode: 'schema', nextAction: 'probe' });

    const failing = new McpSettingsManager({ settings: new InMemorySettingsStore(), probe: { probe: vi.fn(async () => { throw new Error('secret token at C:\\private'); }) } });
    failing.patch(enabledPatch);
    const failedStatus = await failing.probe();
    expect(failedStatus).toMatchObject({ status: 'degraded', lastErrorCode: 'unavailable' });
    expect(JSON.stringify(failedStatus)).not.toMatch(/secret|C:\\\\private/iu);
    expect(() => failing.patch({ endpointLabel: 'https://example.test' })).toThrowError(McpSettingsError);
    expect(() => failing.patch({ endpointLabel: 'C:\\private\\mcp.exe' })).toThrowError(McpSettingsError);
  });

  it('turning the integration off clears live health and revisions for future runs', async () => {
    const manager = new McpSettingsManager({ settings: new InMemorySettingsStore(), probe: { probe: vi.fn(async () => readyProbe()) } });
    manager.patch(enabledPatch);
    await manager.probe();
    const disabled = manager.patch({ enabled: false });
    expect(disabled).toMatchObject({ status: 'disabled', health: null, currentRevision: null, previousRevision: null, nextAction: 'enable' });
  });
});
