import { describe, expect, it, vi } from 'vitest';
import {
  McpCapabilityError,
  McpSessionActivationProvider,
  McpTransportError,
  type McpChannel,
  type McpChannelFactory,
  type McpCapabilityDescriptor,
} from './index.js';

const manifest = {
  kind: 'mcp-server' as const,
  id: 'docs-server',
  version: '1.0.0',
  name: 'Documentation server',
  description: 'Bounded fixture.',
  transport: 'stdio' as const,
  command: 'node',
  args: ['fixture.mjs'],
  tools: [
    { id: 'search', version: '1.0.0', summary: 'Search docs.', risk: 'read' as const, inputSchema: { type: 'object' } },
  ],
  envAllowlist: [],
  network: 'restricted' as const,
};

function requestConfig(overrides: Record<string, unknown> = {}) {
  return {
    serverId: 'docs-server',
    serverVersion: '1.0.0',
    manifestRevision: 'manifest-1',
    capabilityAllowlist: ['docs-server/tool/search@1.0.0'],
    ...overrides,
  };
}

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function fakeFactory(options: { list?: unknown; delay?: boolean } = {}): { factory: McpChannelFactory; requests: string[]; close: ReturnType<typeof vi.fn> } {
  const requests: string[] = [];
  const close = vi.fn(async () => undefined);
  const channel: McpChannel = {
    request: async (payload, signal) => {
      const value = JSON.parse(new TextDecoder().decode(payload)) as { id: string; method: string };
      requests.push(value.method);
      if (options.delay) return await new Promise<Uint8Array>((_, reject) => signal.addEventListener('abort', () => reject(new McpTransportError('MCP_ABORTED')), { once: true }));
      if (value.method === 'initialize') return json({ jsonrpc: '2.0', id: value.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } });
      if (value.method === 'tools/list') return json({ jsonrpc: '2.0', id: value.id, result: options.list ?? { tools: [{ name: 'search', description: 'Find docs.', inputSchema: { type: 'object' } }] } });
      if (value.method === 'tools/call') return json({ jsonrpc: '2.0', id: value.id, result: { content: [{ type: 'text', text: 'two matches' }] } });
      return json({ jsonrpc: '2.0', id: value.id, result: {} });
    },
    close,
  };
  return { factory: { open: vi.fn(async () => channel) }, requests, close };
}

describe('McpSessionActivationProvider', () => {
  it('initializes, lists capabilities, and returns a session-backed call port', async () => {
    const fixture = fakeFactory();
    const provider = new McpSessionActivationProvider({ manifest, channelFactory: fixture.factory, timeoutMs: 100 });
    const candidate = await provider.activate(requestConfig(), new AbortController().signal);
    expect(candidate.snapshot.health).toBe('healthy-verified');
    expect(candidate.snapshot.capabilities).toHaveLength(1);
    expect(candidate.snapshot.capabilities[0]).toMatchObject({ id: 'search', revision: '1.0.0', executable: true });
    const descriptor = candidate.snapshot.capabilities[0] as McpCapabilityDescriptor;
    await expect(candidate.callPort.call({ runId: 'run-1', turnId: 'turn-1', callId: 'call-1', descriptor, input: { query: 'ts' }, signal: new AbortController().signal })).resolves.toEqual({ content: [{ type: 'text', text: 'two matches' }] });
    expect(fixture.requests).toEqual(['initialize', 'tools/list', 'tools/call']);
    await candidate.close?.();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it('rejects identity, allowlist and advertised-tool mismatches before activation', async () => {
    const fixture = fakeFactory();
    const provider = new McpSessionActivationProvider({ manifest, channelFactory: fixture.factory });
    await expect(provider.activate(requestConfig({ serverId: 'other' }), new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_ACTIVATION_IDENTITY' });
    await expect(provider.activate(requestConfig({ capabilityAllowlist: [] }), new AbortController().signal)).rejects.toEqual(new McpCapabilityError('MCP_CAPABILITY_NOT_ALLOWED'));
    const unknown = fakeFactory({ list: { tools: [{ name: 'unknown', inputSchema: { type: 'object' } }] } });
    const unknownProvider = new McpSessionActivationProvider({ manifest, channelFactory: unknown.factory });
    await expect(unknownProvider.activate(requestConfig(), new AbortController().signal)).rejects.toEqual(new McpCapabilityError('MCP_CAPABILITY_NOT_DECLARED'));
  });

  it('maps session timeout and cancellation to bounded errors and closes the session', async () => {
    const fixture = fakeFactory({ delay: true });
    const provider = new McpSessionActivationProvider({ manifest, channelFactory: fixture.factory, timeoutMs: 5 });
    await expect(provider.activate(requestConfig(), new AbortController().signal)).rejects.toEqual(new McpTransportError('MCP_TIMEOUT'));
    expect(fixture.close).toHaveBeenCalledOnce();
    const cancelledFixture = fakeFactory({ delay: true });
    const cancelledProvider = new McpSessionActivationProvider({ manifest, channelFactory: cancelledFixture.factory, timeoutMs: 100 });
    const controller = new AbortController();
    const pending = cancelledProvider.activate(requestConfig(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toEqual(new McpTransportError('MCP_ABORTED'));
    expect(cancelledFixture.close).toHaveBeenCalledOnce();
  });
});
