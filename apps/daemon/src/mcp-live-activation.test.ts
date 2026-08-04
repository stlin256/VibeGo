import { describe, expect, it, vi } from 'vitest';
import type { McpCapabilityDescriptor, McpCapabilitySnapshot, McpToolCallPort } from '@ready4vibe/skill-mcp';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { InMemoryWorkspaceRegistry } from '@ready4vibe/workspaces';
import { McpSettingsManager } from './mcp-settings.js';
import { McpRunBindingManager } from './mcp-runtime-binding.js';
import { McpLiveActivationService, type McpActivationCandidate, type McpActivationProvider } from './mcp-live-activation.js';

const enabledPatch = {
  enabled: true,
  serverId: 'demo-mcp',
  serverVersion: '1.2.3',
  transport: 'streamable-http' as const,
  endpointLabel: 'Demo integration',
  manifestRevision: 'manifest-20260804',
  capabilityAllowlist: ['demo-mcp/tool/search@1.0.0'],
};

const config = {
  workspaceId: 'default', userMessage: 'search', model: { provider: 'fixture', name: 'fixture' },
  taskTrust: 'trusted-workspace' as const, sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 1, maxWallTimeMs: 30_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 2, maxOutputBytes: 8_192, maxContextBytes: 8_192 },
  createdBySessionId: 'session-1', clientRequestId: 'client-1',
};

function descriptor(overrides: Partial<McpCapabilityDescriptor> = {}): McpCapabilityDescriptor {
  return {
    schemaVersion: 'mcp-capability/v1', source: 'mcp', serverId: 'demo-mcp', serverVersion: '1.2.3', protocolVersion: '2025-06-18',
    kind: 'tool', id: 'search', name: 'search', version: '1.0.0', revision: '1.0.0', qualifiedName: 'demo-mcp/tool/search@1.0.0',
    summary: 'Search docs.', risk: 'read', sandboxMode: 'workspace-read', networkAccess: 'disabled', approvalMode: 'none', executable: true,
    inputSchema: { type: 'object' }, ...overrides,
  };
}

function snapshot(overrides: Partial<McpCapabilitySnapshot> = {}): McpCapabilitySnapshot {
  return {
    schemaVersion: 'mcp-capability-snapshot/v1', serverId: 'demo-mcp', serverVersion: '1.2.3', protocolVersion: '2025-06-18',
    health: 'healthy-verified', healthCheckId: 1, capabilities: [descriptor()], fingerprint: 'a'.repeat(64), ...overrides,
  };
}

function candidate(overrides: Partial<McpActivationCandidate> = {}): McpActivationCandidate {
  return {
    manifestRevision: 'manifest-20260804', currentRevision: 'cap-1', previousRevision: null,
    snapshot: snapshot(), callPort: { call: vi.fn(async () => ({ ok: true })) }, ...overrides,
  };
}

function makeService(provider: McpActivationProvider) {
  const settings = new McpSettingsManager({ settings: new InMemorySettingsStore() });
  const binding = new McpRunBindingManager(new InMemoryWorkspaceRegistry({ defaultRoot: process.cwd() }));
  return { settings, binding, service: new McpLiveActivationService({ settings, binding, provider }) };
}

describe('McpLiveActivationService', () => {
  it('keeps disabled settings side-effect free', async () => {
    const provider = { activate: vi.fn(async () => candidate()) };
    const { service: activation, settings } = makeService(provider);
    const result = await activation.activate();
    expect(result).toMatchObject({ activated: false, status: { status: 'disabled' } });
    expect(provider.activate).not.toHaveBeenCalled();
    expect(settings.status().status).toBe('disabled');
  });

  it('activates a matching verified candidate and records bounded status', async () => {
    const callPort: McpToolCallPort = { call: vi.fn(async () => ({ ok: true })) };
    const provider = { activate: vi.fn(async () => candidate({ callPort })) };
    const { service: activation, settings, binding } = makeService(provider);
    settings.patch(enabledPatch);
    const result = await activation.activate();
    expect(result).toMatchObject({ activated: true, status: { status: 'ready', health: 'healthy-verified', available: true, currentRevision: 'cap-1', capabilityCount: 1 } });
    expect(binding.status()).toMatchObject({ enabled: true, capabilityCount: 1 });
    expect(JSON.stringify(result)).not.toMatch(/secret|token|C:\\|\/Users\//iu);
    expect(provider.activate).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'demo-mcp', manifestRevision: 'manifest-20260804' }), expect.any(AbortSignal));
  });

  it.each([
    ['manifest mismatch', candidate({ manifestRevision: 'other-manifest' }), 'schema'],
    ['server mismatch', candidate({ snapshot: snapshot({ serverId: 'other-mcp' }) }), 'schema'],
    ['unverified health', candidate({ snapshot: { ...snapshot(), health: 'healthy-connectivity-only' as const } as unknown as McpCapabilitySnapshot }), 'schema'],
    ['disallowed tool', candidate({ snapshot: snapshot({ capabilities: [descriptor({ id: 'publish', name: 'publish', qualifiedName: 'demo-mcp/tool/publish@1.0.0' })] }) }), 'not-allowed'],
  ] as const)('fails closed for %s', async (_label, value, code) => {
    const provider = { activate: vi.fn(async () => value) };
    const { service: activation, settings, binding } = makeService(provider);
    settings.patch(enabledPatch);
    const result = await activation.activate();
    expect(result).toMatchObject({ activated: false, status: { status: 'degraded', available: false, degraded: true, lastErrorCode: code } });
    expect(binding.status()).toMatchObject({ enabled: false, capabilityCount: 0 });
  });

  it('maps provider failure to bounded degraded status and forwards cancellation', async () => {
    const controller = new AbortController();
    const provider = { activate: vi.fn(async (_settings: unknown, signal: AbortSignal) => { expect(signal).toBe(controller.signal); throw new Error('secret token at C:\\private'); }) };
    const { service: activation, settings } = makeService(provider);
    settings.patch(enabledPatch);
    const result = await activation.activate(controller.signal);
    expect(result).toMatchObject({ activated: false, status: { status: 'degraded', lastErrorCode: 'unavailable' } });
    expect(JSON.stringify(result)).not.toMatch(/secret|private/iu);
  });

  it('replaces only future run bindings on refresh', async () => {
    const first = candidate();
    const second = candidate({ snapshot: snapshot({ fingerprint: 'b'.repeat(64), capabilities: [descriptor({ version: '2.0.0', revision: '2.0.0', qualifiedName: 'demo-mcp/tool/search@2.0.0' })] }), currentRevision: 'cap-2' });
    const provider = { activate: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second) };
    const { service: activation, settings, binding } = makeService(provider);
    settings.patch(enabledPatch);
    await activation.activate();
    const before = binding.runtimeForRun(config)!;
    settings.patch({ capabilityAllowlist: ['demo-mcp/tool/search@1.0.0', 'demo-mcp/tool/search@2.0.0'] });
    await activation.activate();
    const after = binding.runtimeForRun(config)!;
    expect(before.descriptors[0]?.version).toBe('1.0.0');
    expect(after.descriptors[0]?.version).toBe('2.0.0');
  });
});
