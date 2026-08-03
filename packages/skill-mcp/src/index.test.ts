import { describe, expect, it } from 'vitest';
import {
  IntegrationAllowlist,
  McpTransportClient,
  McpTransportError,
  encodeMcpJsonRpcRequest,
  ManifestError,
  loadMcpServerManifest,
  loadSkillManifest,
  mcpToolReference,
} from './index.js';

const skill = {
  kind: 'skill',
  id: 'typescript',
  version: '1.0.0',
  name: 'TypeScript helper',
  description: 'Safe TypeScript assistance.',
  instructions: 'Use read-only inspection first.',
  allowedTools: ['filesystem.read@1.0.0'],
  allowedMcpServers: ['docs-server'],
  envAllowlist: ['DOCS_CACHE_DIR'],
};

const server = {
  kind: 'mcp-server',
  id: 'docs-server',
  version: '1.0.0',
  name: 'Documentation server',
  description: 'Local documentation lookup.',
  transport: 'stdio',
  command: 'node',
  args: ['server.mjs', '--stdio'],
  tools: [
    { id: 'search', version: '1.0.0', summary: 'Search docs.', risk: 'read', inputSchema: { type: 'object' } },
    { id: 'publish', version: '1.0.0', summary: 'Publish docs.', risk: 'write' },
  ],
  envAllowlist: ['DOCS_CACHE_DIR'],
  network: 'restricted',
};

describe('Skill/MCP manifest boundary', () => {
  it('loads a bounded Skill and freezes its lists', () => {
    const loaded = loadSkillManifest(JSON.stringify({ ...skill, instructions: 'Use read-only inspection first.\nRecord the source of every fact.' }));
    expect(loaded).toMatchObject({ id: 'typescript', version: '1.0.0' });
    expect(loaded.instructions).toContain('Record the source');
    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.allowedTools)).toBe(true);
  });

  it('rejects unknown fields, oversized input, and secret-shaped content', () => {
    expect(() => loadSkillManifest({ ...skill, unknown: true })).toThrowError(new ManifestError('MANIFEST_UNKNOWN_FIELD', 'Manifest contains an unsupported field.'));
    expect(() => loadSkillManifest({ ...skill, instructions: 'x'.repeat(33 * 1024) })).toThrowError(new ManifestError('MANIFEST_LIMIT_EXCEEDED', 'Manifest text field exceeds its limit.'));
    expect(() => loadSkillManifest({ ...skill, instructions: 'set api_key=sk-' + 'x'.repeat(24) })).toThrowError(new ManifestError('MANIFEST_SECRET_FIELD', 'Manifest contains secret-shaped content.'));
  });

  it('validates stdio argv and supports HTTPS or loopback HTTP', () => {
    const loaded = loadMcpServerManifest(server);
    expect(loaded.transport).toBe('stdio');
    expect(loaded).toMatchObject({ command: 'node', args: ['server.mjs', '--stdio'] });
    expect(loadMcpServerManifest({ ...server, transport: 'http', command: undefined, args: undefined, url: 'https://mcp.example.test/sse' })).toMatchObject({ transport: 'http', url: 'https://mcp.example.test/sse' });
    expect(loadMcpServerManifest({ ...server, transport: 'http', command: undefined, args: undefined, url: 'http://127.0.0.1:8788/mcp' })).toMatchObject({ transport: 'http' });
  });

  it('rejects shell-capable commands, public HTTP, and URL secrets', () => {
    expect(() => loadMcpServerManifest({ ...server, command: 'node.exe/path' })).toThrowError(new ManifestError('MCP_COMMAND_INVALID', 'MCP stdio command must be a bare executable name.'));
    expect(() => loadMcpServerManifest({ ...server, args: ['--query=$(whoami)'] })).toThrowError(new ManifestError('MCP_ARGV_INVALID', 'MCP stdio args are invalid.'));
    expect(() => loadMcpServerManifest({ ...server, transport: 'http', command: undefined, args: undefined, url: 'http://mcp.example.test/sse' })).toThrowError(new ManifestError('MCP_URL_INSECURE', 'MCP HTTP transport requires HTTPS outside loopback.'));
    expect(() => loadMcpServerManifest({ ...server, transport: 'http', command: undefined, args: undefined, url: 'https://user:pass@mcp.example.test/sse?token=abc' })).toThrowError(new ManifestError('MCP_URL_SECRET', 'MCP URL must not contain credentials or secret query parameters.'));
  });

  it('defaults to deny and only projects allowlisted public tool fields', () => {
    const loaded = loadMcpServerManifest(server);
    expect(new IntegrationAllowlist().publicTools(loaded)).toEqual([]);
    const allowlist = new IntegrationAllowlist({
      mcpServers: ['docs-server@1.0.0'],
      mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')],
    });
    expect(allowlist.allowsMcpServer(loaded)).toBe(true);
    expect(allowlist.publicTools(loaded)).toEqual([{ id: 'search', version: '1.0.0', summary: 'Search docs.', risk: 'read' }]);
    expect(allowlist.publicTools(loaded)[0]).not.toHaveProperty('inputSchema');
  });

  it('uses an injected one-shot channel for an allowlisted tool and keeps env values out of errors', async () => {
    let requestPayload: Uint8Array | undefined;
    let openedEnv: Readonly<Record<string, string>> | undefined;
    let closed = 0;
    const allowlist = new IntegrationAllowlist({
      mcpServers: ['docs-server@1.0.0'],
      mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')],
    });
    const client = new McpTransportClient(loadMcpServerManifest(server), {
      allowlist,
      env: { DOCS_CACHE_DIR: 'C:/private/cache' },
      channelFactory: {
        open: async ({ env }) => {
          openedEnv = env;
          return {
            request: async (payload) => {
              requestPayload = payload;
              const request = JSON.parse(new TextDecoder().decode(payload)) as { id: string };
              return new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { matches: 2 } }));
            },
            close: async () => { closed += 1; },
          };
        },
      },
    });

    await expect(client.callTool('search', '1.0.0', { query: 'typescript' })).resolves.toEqual({ matches: 2 });
    expect(openedEnv).toEqual({ DOCS_CACHE_DIR: 'C:/private/cache' });
    expect(JSON.parse(new TextDecoder().decode(requestPayload))).toMatchObject({ method: 'tools/call', params: { name: 'search' } });
    expect(closed).toBe(1);
  });

  it('denies unallowlisted servers, tools, and environment keys before opening a channel', async () => {
    const factory = { open: async () => { throw new Error('must not open'); } };
    const loaded = loadMcpServerManifest(server);
    await expect(new McpTransportClient(loaded, { allowlist: new IntegrationAllowlist(), channelFactory: factory }).callTool('search', '1.0.0', {})).rejects.toMatchObject({ code: 'MCP_SERVER_NOT_ALLOWED' });
    const allowlist = new IntegrationAllowlist({ mcpServers: ['docs-server@1.0.0'], mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')] });
    await expect(new McpTransportClient(loaded, { allowlist, channelFactory: factory }).callTool('publish', '1.0.0', {})).rejects.toMatchObject({ code: 'MCP_TOOL_NOT_ALLOWED' });
    expect(() => new McpTransportClient(loaded, { allowlist, env: { NOT_DECLARED: 'secret' }, channelFactory: factory })).toThrowError(new McpTransportError('MCP_ENV_NOT_ALLOWED'));
  });

  it('rejects malformed, oversized, and mismatched responses while closing the channel', async () => {
    const loaded = loadMcpServerManifest(server);
    const allowlist = new IntegrationAllowlist({ mcpServers: ['docs-server@1.0.0'], mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')] });
    let closed = 0;
    const responses: Array<{ payload: Uint8Array; expected: string }> = [
      { payload: new TextEncoder().encode('{'), expected: 'MCP_MESSAGE_INVALID' },
      { payload: new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: 'wrong', result: {} })), expected: 'MCP_RESPONSE_ID_MISMATCH' },
      { payload: new Uint8Array(200), expected: 'MCP_MESSAGE_TOO_LARGE' },
    ];
    for (const { payload: response, expected } of responses) {
      const client = new McpTransportClient(loaded, {
        allowlist,
        maxMessageBytes: 128,
        channelFactory: { open: async () => ({ request: async () => response, close: async () => { closed += 1; } }) },
      });
      await expect(client.callTool('search', '1.0.0', {})).rejects.toMatchObject({ code: expected });
    }
    expect(closed).toBe(3);
  });

  it('maps timeout, cancellation, and remote errors to stable codes', async () => {
    const loaded = loadMcpServerManifest(server);
    const allowlist = new IntegrationAllowlist({ mcpServers: ['docs-server@1.0.0'], mcpTools: [mcpToolReference('docs-server', 'search', '1.0.0')] });
    const waitingFactory = {
      open: async () => ({
        request: async (_payload: Uint8Array, signal: AbortSignal) => await new Promise<Uint8Array>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
        close: async () => undefined,
      }),
    };
    await expect(new McpTransportClient(loaded, { allowlist, timeoutMs: 5, channelFactory: waitingFactory }).callTool('search', '1.0.0', {})).rejects.toMatchObject({ code: 'MCP_TIMEOUT' });
    const controller = new AbortController();
    const cancelled = new McpTransportClient(loaded, { allowlist, timeoutMs: 1000, channelFactory: waitingFactory }).callTool('search', '1.0.0', {}, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'MCP_ABORTED' });
    const remote = new McpTransportClient(loaded, {
      allowlist,
      channelFactory: { open: async () => ({ request: async (payload) => {
        const request = JSON.parse(new TextDecoder().decode(payload)) as { id: string };
        return new TextEncoder().encode(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -1, message: 'contains secret' } }));
      }, close: async () => undefined }) },
    });
    await expect(remote.callTool('search', '1.0.0', {})).rejects.toEqual(new McpTransportError('MCP_REMOTE_ERROR'));
  });

  it('keeps request encoding bounded', () => {
    expect(() => encodeMcpJsonRpcRequest({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: 'x'.repeat(100) }, 16)).toThrowError(new McpTransportError('MCP_MESSAGE_TOO_LARGE'));
  });
});
