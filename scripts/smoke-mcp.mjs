import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:mcp -- --transport <stdio|streamable-http> [--timeout-ms <100..30000>]';
const SMOKE_FIXTURE_ID = 'ready4vibe-smoke';
const SMOKE_MANIFEST_REVISION = 'fixture-v1';
const SMOKE_TOOL_REFERENCE = `${SMOKE_FIXTURE_ID}/tool/echo@1.0.0`;
const FIXTURE_PATH = fileURLToPath(new URL('./mcp-smoke-fixture.mjs', import.meta.url));

export function parseSmokeArgs(argv, environment = process.env) {
  let transport = environment.VIBEGO_MCP_SMOKE_TRANSPORT ?? 'stdio';
  let timeoutMs = Number(environment.VIBEGO_MCP_SMOKE_TIMEOUT_MS ?? 5_000);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--transport' || argument === '--timeout-ms') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--transport') transport = value;
      else timeoutMs = Number(value);
      continue;
    }
    throw new Error(USAGE);
  }

  if (transport !== 'stdio' && transport !== 'streamable-http') throw new Error(USAGE);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error(USAGE);
  return Object.freeze({ transport, timeoutMs });
}

export function exitCodeForSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'unavailable') return 2;
  if (status === 'cancelled') return 3;
  return 1;
}

export function createSmokeManifest(transport, options = {}) {
  const base = {
    kind: 'mcp-server',
    id: SMOKE_FIXTURE_ID,
    version: '1.0.0',
    name: 'ready4vibe local MCP smoke fixture',
    description: 'A fixed, bounded local transport fixture.',
    tools: [{ id: 'echo', version: '1.0.0', summary: 'Return a fixed smoke result.', risk: 'read', inputSchema: { type: 'object' } }],
    envAllowlist: options.envAllowlist ?? [],
    network: 'restricted',
  };
  if (transport === 'stdio') {
    return Object.freeze({
      ...base,
      transport: 'stdio',
      command: 'node',
      args: [options.fixturePath ?? FIXTURE_PATH, 'stdio'],
    });
  }
  if (transport === 'streamable-http' && typeof options.url === 'string') {
    return Object.freeze({ ...base, transport: 'streamable-http', url: options.url });
  }
  throw new Error('MCP smoke manifest transport is invalid.');
}

export function safeSmokeErrorCode(error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : 'MCP_SMOKE_FAILED';
}

export async function runMcpSmoke(options, dependencies = {}) {
  const startedAt = Date.now();
  let httpFixture;
  let candidate;
  try {
    const skillMcp = dependencies.skillMcp ?? await import('../packages/skill-mcp/dist/index.js');
    let manifest;
    let channelFactory;
    let env = {};
    if (options.transport === 'stdio') {
      env = stdioEnvironment();
      manifest = skillMcp.loadMcpServerManifest(createSmokeManifest('stdio', { fixturePath: FIXTURE_PATH, envAllowlist: Object.keys(env) }));
      channelFactory = new skillMcp.McpStdioChannelFactory({ maxMessageBytes: 16 * 1024 });
    } else {
      httpFixture = await startHttpFixture();
      manifest = skillMcp.loadMcpServerManifest(createSmokeManifest('streamable-http', { url: httpFixture.url }));
      channelFactory = new skillMcp.McpStreamableHttpChannelFactory({ maxMessageBytes: 16 * 1024 });
    }

    const provider = new skillMcp.McpSessionActivationProvider({
      manifest,
      channelFactory,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      timeoutMs: options.timeoutMs,
      clientInfo: { name: 'ready4vibe-smoke', version: '0.1.0' },
    });
    candidate = await provider.activate({
      serverId: manifest.id,
      serverVersion: manifest.version,
      manifestRevision: SMOKE_MANIFEST_REVISION,
      capabilityAllowlist: [SMOKE_TOOL_REFERENCE],
    }, new AbortController().signal);
    const descriptor = candidate.snapshot.capabilities.find((entry) => entry.kind === 'tool' && entry.id === 'echo');
    if (!descriptor) throw Object.assign(new Error('MCP smoke tool was not advertised.'), { code: 'MCP_SMOKE_CAPABILITY' });
    const result = await candidate.callPort.call({
      runId: 'smoke-run',
      turnId: 'smoke-turn',
      callId: 'smoke-call',
      descriptor,
      input: { text: SMOKE_FIXTURE_ID },
      signal: new AbortController().signal,
    });
    if (!isSmokeResult(result)) throw Object.assign(new Error('MCP smoke tool result is invalid.'), { code: 'MCP_SMOKE_RESULT' });
    return report(options.transport, 'healthy', startedAt, {
      protocolVersion: candidate.snapshot.protocolVersion,
      capabilityCount: candidate.snapshot.capabilities.length,
    });
  } catch (error) {
    const errorCode = safeSmokeErrorCode(error);
    const status = errorCode === 'MCP_ABORTED' ? 'cancelled' : errorCode === 'MCP_CHANNEL_UNAVAILABLE' ? 'unavailable' : 'failed';
    return report(options.transport, status, startedAt, { errorCode });
  } finally {
    if (candidate?.close) await candidate.close().catch(() => undefined);
    if (httpFixture) await httpFixture.close().catch(() => undefined);
  }
}

function report(transport, status, startedAt, details = {}) {
  return Object.freeze({
    schemaVersion: 'mcp-smoke/v1',
    fixture: SMOKE_FIXTURE_ID,
    transport,
    status,
    elapsedMs: Math.max(0, Math.min(120_000, Date.now() - startedAt)),
    ...details,
  });
}

function stdioEnvironment() {
  const result = {};
  const pathValue = process.env.PATH ?? process.env.Path;
  const systemRoot = process.env.SystemRoot;
  if (typeof pathValue === 'string' && pathValue.length > 0) result.PATH = pathValue.slice(0, 4096);
  if (typeof systemRoot === 'string' && systemRoot.length > 0) result.SystemRoot = systemRoot.slice(0, 4096);
  return Object.freeze(result);
}

function isSmokeResult(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.content)
    && value.content.some((entry) => entry && entry.type === 'text' && entry.text === SMOKE_FIXTURE_ID));
}

async function startHttpFixture() {
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response);
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolvePromise();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw Object.assign(new Error('MCP smoke fixture did not bind.'), { code: 'MCP_SMOKE_FIXTURE_UNAVAILABLE' });
  }
  return Object.freeze({
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => closeServer(server),
  });
}

async function handleHttpRequest(request, response) {
  if (request.method !== 'POST' || request.url !== '/mcp') {
    response.writeHead(404);
    response.end();
    return;
  }
  try {
    const body = await readRequestBody(request, 16 * 1024);
    const message = JSON.parse(body);
    if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw new Error('invalid request');
    if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
      response.writeHead(202);
      response.end();
      return;
    }
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: SMOKE_FIXTURE_ID, version: '1.0.0' } }
      : message.method === 'tools/list'
        ? { tools: [{ name: 'echo', description: 'Return a fixed smoke result.', inputSchema: { type: 'object' } }] }
        : message.method === 'tools/call'
          ? { content: [{ type: 'text', text: SMOKE_FIXTURE_ID }] }
          : {};
    const payload = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
    response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'smoke-session' });
    response.end(payload);
  } catch {
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } }));
  }
}

async function readRequestBody(request, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error('request too large');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
    } else {
      const result = await runMcpSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
  }
}
