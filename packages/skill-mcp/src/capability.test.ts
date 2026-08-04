import { describe, expect, it } from 'vitest';
import {
  IntegrationAllowlist,
  McpCapabilityError,
  McpCapabilityRegistry,
  mcpCapabilityReference,
  mcpToolReference,
  type McpCapabilityAdvertisement,
  type McpServerManifest,
} from './index.js';

const manifest: McpServerManifest = {
  kind: 'mcp-server',
  id: 'docs-server',
  version: '1.0.0',
  name: 'Documentation server',
  description: 'Bounded documentation lookup.',
  transport: 'stdio',
  command: 'node',
  args: ['server.mjs'],
  tools: [
    { id: 'search', version: '1.0.0', summary: 'Search docs.', risk: 'read', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
    { id: 'publish', version: '1.0.0', summary: 'Publish docs.', risk: 'write', inputSchema: { type: 'object' } },
  ],
  envAllowlist: [],
  network: 'restricted',
};

const allowlist = new IntegrationAllowlist({
  mcpServers: ['docs-server@1.0.0'],
  mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')],
});

function advertisement(overrides: Partial<Omit<McpCapabilityAdvertisement, 'schemaVersion'>> & { readonly schemaVersion?: string } = {}): McpCapabilityAdvertisement {
  const { schemaVersion: _schemaVersion, ...rest } = overrides;
  return {
    schemaVersion: (_schemaVersion ?? 'mcp-capability-advertisement/v1') as 'mcp-capability-advertisement/v1',
    protocolVersion: '2025-06-18',
    health: { state: 'healthy-verified', checkId: 1 },
    tools: [{ name: 'search', version: '1.0.0', description: 'Search docs.', inputSchema: { type: 'object' } }],
    ...rest,
  };
}

function registry(): McpCapabilityRegistry {
  return new McpCapabilityRegistry({ allowlist });
}

describe('MCP capability snapshot and registry boundary', () => {
  it('projects an allowlisted verified tool into a bounded immutable snapshot', () => {
    const current = registry().register(manifest, advertisement());
    const second = registry().register(manifest, advertisement());
    expect(current).toMatchObject({ schemaVersion: 'mcp-capability-snapshot/v1', serverId: 'docs-server', health: 'healthy-verified' });
    expect(current.capabilities[0]).toMatchObject({ kind: 'tool', id: 'search', version: '1.0.0', risk: 'read', sandboxMode: 'workspace-read', networkAccess: 'disabled', approvalMode: 'none' });
    expect(current.fingerprint).toBe(second.fingerprint);
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.capabilities)).toBe(true);
    expect(Object.isFrozen(current.capabilities[0])).toBe(true);
    expect(() => (current.capabilities as unknown as Array<unknown>).push({})).toThrow();
  });

  it('rejects unknown servers, undeclared tools, incompatible protocol/schema and unallowlisted capabilities', () => {
    expect(() => registry().register({ ...manifest, id: 'unknown-server' }, advertisement())).toThrowError(new McpCapabilityError('MCP_CAPABILITY_SERVER_NOT_ALLOWED'));
    expect(() => registry().register(manifest, advertisement({ protocolVersion: '1999-01-01' }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_PROTOCOL_UNSUPPORTED'));
    expect(() => registry().register(manifest, advertisement({ schemaVersion: 'mcp-capability-advertisement/v9' }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID'));
    expect(() => registry().register(manifest, advertisement({ tools: [{ name: 'missing', version: '1.0.0', inputSchema: { type: 'object' } }] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_NOT_DECLARED'));
    expect(() => registry().register(manifest, advertisement({ tools: [{ name: 'publish', version: '1.0.0', inputSchema: { type: 'object' } }] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_NOT_ALLOWED'));
  });

  it('keeps manifest risk and fails closed on server risk downgrade, secrets and absolute paths', () => {
    expect(() => registry().register(manifest, advertisement({ tools: [{ name: 'search', version: '1.0.0', risk: 'write', inputSchema: { type: 'object' } }] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_RISK_MISMATCH'));
    expect(() => registry().register(manifest, advertisement({ tools: [{ name: 'search', version: '1.0.0', description: 'api_key=sk-' + 'x'.repeat(24), inputSchema: { type: 'object' } }] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_SECRET_FIELD'));
    expect(() => registry().register(manifest, advertisement({ tools: [{ name: 'search', version: '1.0.0', description: 'C:\\private\\workspace', inputSchema: { type: 'object' } }] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_ABSOLUTE_PATH'));
  });

  it('rejects duplicate revisions and preserves the current snapshot on a revision conflict', () => {
    const value = new McpCapabilityRegistry({ allowlist: new IntegrationAllowlist({
      mcpServers: ['docs-server@1.0.0', 'docs-server@2.0.0'],
      mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0'), mcpToolReference('docs-server', 'search', '2.0.0')],
    }) });
    const first = value.register(manifest, advertisement({ health: { state: 'healthy-verified', checkId: 10 } }));
    expect(() => value.register(manifest, advertisement({ health: { state: 'healthy-verified', checkId: 11 }, tools: [
      { name: 'search', version: '1.0.0', inputSchema: { type: 'object' } },
      { name: 'search', version: '1.0.0', inputSchema: { type: 'object' } },
    ] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_DUPLICATE'));
    const changedManifest: McpServerManifest = { ...manifest, version: '2.0.0', tools: [{ id: 'search', version: '2.0.0', summary: 'Search docs.', risk: 'read', inputSchema: { type: 'object' } }] };
    const changedAllowlist = new IntegrationAllowlist({ mcpServers: ['docs-server@2.0.0'], mcpTools: [mcpToolReference('docs-server', 'search', '2.0.0')] });
    expect(() => new McpCapabilityRegistry({ allowlist: changedAllowlist }).register(changedManifest, advertisement({ tools: [{ name: 'search', version: '2.0.0', inputSchema: { type: 'object' } }] }))).not.toThrow();
    expect(() => value.register(changedManifest, advertisement({ health: { state: 'healthy-verified', checkId: 12 }, tools: [{ name: 'search', version: '2.0.0', inputSchema: { type: 'object' } }] }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_REVISION_CONFLICT'));
    expect(value.snapshot('docs-server')?.fingerprint).toBe(first.fingerprint);
  });

  it('fails closed for stale or merely connected health and keeps run snapshots stable across refresh', () => {
    const value = registry();
    const current = value.register(manifest, advertisement({ health: { state: 'healthy-verified', checkId: 10 } }));
    const runSnapshot = value.captureRunSnapshot('docs-server');
    expect(runSnapshot.fingerprint).toBe(current.fingerprint);
    expect(() => value.register(manifest, advertisement({ health: { state: 'healthy-verified', checkId: 9 } }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_HEALTH_STALE'));
    expect(() => value.register(manifest, advertisement({ health: { state: 'healthy-connectivity-only', checkId: 11 } }))).toThrowError(new McpCapabilityError('MCP_CAPABILITY_HEALTH_UNVERIFIED'));
    expect(value.snapshot('docs-server')?.fingerprint).toBe(current.fingerprint);
    expect(runSnapshot.fingerprint).toBe(current.fingerprint);
    expect(Object.isFrozen(runSnapshot.capabilities)).toBe(true);
  });

  it('supports explicitly allowlisted read-only resources and prompts without making them executable', () => {
    const resourceRef = mcpCapabilityReference('docs-server', 'resource', 'handbook', '1.0.0');
    const promptRef = mcpCapabilityReference('docs-server', 'prompt', 'summarize', '1.0.0');
    const value = new McpCapabilityRegistry({ allowlist: new IntegrationAllowlist({
      mcpServers: ['docs-server@1.0.0'],
      mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')],
      mcpCapabilities: [resourceRef, promptRef],
    }) });
    const snapshot = value.register(manifest, advertisement({
      resources: [{ name: 'handbook', version: '1.0.0', description: 'Read-only handbook.' }],
      prompts: [{ name: 'summarize', version: '1.0.0', description: 'Summarize a document.' }],
    }));
    expect(snapshot.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resource', id: 'handbook', risk: 'read', executable: false }),
      expect.objectContaining({ kind: 'prompt', id: 'summarize', risk: 'read', executable: false }),
    ]));
  });

  it('does not allow a network-risk capability to weaken sandbox, network or approval policy', () => {
    const networkManifest: McpServerManifest = {
      ...manifest,
      version: '3.0.0',
      network: 'enabled',
      tools: [{ id: 'fetch', version: '1.0.0', summary: 'Fetch a bounded resource.', risk: 'network', inputSchema: { type: 'object' } }],
    };
    const networkAllowlist = new IntegrationAllowlist({ mcpServers: ['docs-server@3.0.0'], mcpTools: [mcpToolReference('docs-server', 'fetch', '1.0.0')] });
    const ad = advertisement({ tools: [{ name: 'fetch', version: '1.0.0', inputSchema: { type: 'object' } }] });
    expect(() => new McpCapabilityRegistry({ allowlist: networkAllowlist }).register(networkManifest, ad)).toThrowError(new McpCapabilityError('MCP_CAPABILITY_NETWORK_FORBIDDEN'));
    const snapshot = new McpCapabilityRegistry({ allowlist: networkAllowlist, policy: { networkAccess: 'enabled', approvalMode: 'none' } }).register(networkManifest, ad);
    expect(snapshot.capabilities[0]).toMatchObject({ risk: 'network', sandboxMode: 'external-sandbox', networkAccess: 'enabled', approvalMode: 'ask' });
  });
});
