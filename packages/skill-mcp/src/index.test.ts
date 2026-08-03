import { describe, expect, it } from 'vitest';
import {
  IntegrationAllowlist,
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
});
