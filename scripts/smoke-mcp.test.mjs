import assert from 'node:assert/strict';
import test from 'node:test';
import { createSmokeManifest, exitCodeForSmokeStatus, parseSmokeArgs, safeSmokeErrorCode } from './smoke-mcp.mjs';

test('parses explicit MCP smoke transport and bounded timeout', () => {
  assert.deepEqual(parseSmokeArgs(['--transport', 'streamable-http', '--timeout-ms', '1200']), { transport: 'streamable-http', timeoutMs: 1200 });
  assert.deepEqual(parseSmokeArgs([], { VIBEGO_MCP_SMOKE_TRANSPORT: 'stdio', VIBEGO_MCP_SMOKE_TIMEOUT_MS: '1000' }), { transport: 'stdio', timeoutMs: 1000 });
  assert.deepEqual(parseSmokeArgs(['--help']), { help: true });
});

test('rejects unknown transport, unbounded timeout and unexpected arguments', () => {
  assert.throws(() => parseSmokeArgs(['--transport', 'https']), /usage/u);
  assert.throws(() => parseSmokeArgs(['--timeout-ms', '99']), /usage/u);
  assert.throws(() => parseSmokeArgs(['--url', 'https://example.test']), /usage/u);
});

test('builds secret-free manifests for both real transport fixtures', () => {
  const stdio = createSmokeManifest('stdio', { fixturePath: 'fixture.mjs', envAllowlist: ['PATH'] });
  const http = createSmokeManifest('streamable-http', { url: 'http://127.0.0.1:1234/mcp' });
  assert.deepEqual(stdio, {
    kind: 'mcp-server', id: 'ready4vibe-smoke', version: '1.0.0', name: 'ready4vibe local MCP smoke fixture',
    description: 'A fixed, bounded local transport fixture.',
    tools: [{ id: 'echo', version: '1.0.0', summary: 'Return a fixed smoke result.', risk: 'read', inputSchema: { type: 'object' } }],
    envAllowlist: ['PATH'], network: 'restricted', transport: 'stdio', command: 'node', args: ['fixture.mjs', 'stdio'],
  });
  assert.equal(http.url, 'http://127.0.0.1:1234/mcp');
  assert.doesNotMatch(JSON.stringify({ stdio, http }), /api[_-]?key|token|secret|password|C:\\\\|\/Users\//iu);
});

test('maps smoke status to stable exit codes and never echoes arbitrary errors', () => {
  assert.equal(exitCodeForSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForSmokeStatus('unavailable'), 2);
  assert.equal(exitCodeForSmokeStatus('cancelled'), 3);
  assert.equal(exitCodeForSmokeStatus('failed'), 1);
  assert.equal(safeSmokeErrorCode({ code: 'MCP_TIMEOUT', message: 'secret at C:\\private' }), 'MCP_TIMEOUT');
  assert.equal(safeSmokeErrorCode(new Error('secret at C:\\private')), 'MCP_SMOKE_FAILED');
});
