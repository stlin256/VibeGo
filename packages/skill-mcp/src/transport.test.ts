import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  McpProtocolSession,
  McpStdioChannelFactory,
  McpStreamableHttpChannelFactory,
  McpTransportError,
  type McpFetchImplementation,
  type McpJsonRpcNotification,
  type McpStdioSpawnFunction,
} from './index.js';

const stdioManifest = {
  kind: 'mcp-server' as const,
  id: 'docs-server',
  version: '1.0.0',
  name: 'Documentation server',
  description: 'A bounded fixture server.',
  transport: 'stdio' as const,
  command: 'node',
  args: ['server.mjs'],
  tools: [],
  envAllowlist: ['DOCS_CACHE_DIR'],
  network: 'restricted' as const,
};

const httpManifest = {
  ...stdioManifest,
  transport: 'streamable-http' as const,
  url: 'https://mcp.example.test/v1/mcp',
};

class FakeChild extends EventEmitter {
  readonly stdin = new FakeWritable();
  readonly stdout = new EventEmitter();
  killed = false;

  kill(): boolean {
    this.killed = true;
    queueMicrotask(() => this.emit('close', 0, null));
    return true;
  }
}

class FakeWritable {
  readonly writes: Uint8Array[] = [];
  ended = false;
  on(): this { return this; }
  once(): this { return this; }
  removeListener(): this { return this; }
  write(chunk: Uint8Array | string): boolean {
    this.writes.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk));
    return true;
  }
  end(): void { this.ended = true; }
}

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe('MCP injected transport channels', () => {
  it('starts stdio only through the injected spawn port and frames bounded JSONL', async () => {
    const child = new FakeChild();
    let spawnCall: { command: string; args: readonly string[]; options: Record<string, unknown> } | undefined;
    const spawn: McpStdioSpawnFunction = ((command, args, options) => {
      spawnCall = { command, args, options: options as unknown as Record<string, unknown> };
      return child as never;
    });
    const factory = new McpStdioChannelFactory({ spawn, maxMessageBytes: 1024 });
    const channel = await factory.open({ manifest: stdioManifest, env: { DOCS_CACHE_DIR: 'C:/private/cache' }, signal: new AbortController().signal });
    const response = channel.request(jsonBytes({ jsonrpc: '2.0', id: 'stdio-1', method: 'ping' }), new AbortController().signal);
    const input = (child.stdin as FakeWritable).writes[0];
    expect(new TextDecoder().decode(input)).toMatch(/"id":"stdio-1".*\n$/u);
    child.stdout.emit('data', new TextEncoder().encode('{"jsonrpc":"2.0","id":"stdio-1",'));
    child.stdout.emit('data', new TextEncoder().encode('"result":{"ok":true}}\n'));
    await expect(response).resolves.toEqual(jsonBytes({ jsonrpc: '2.0', id: 'stdio-1', result: { ok: true } }));
    expect(spawnCall).toMatchObject({ command: 'node', args: ['server.mjs'], options: { shell: false, env: { DOCS_CACHE_DIR: 'C:/private/cache' } } });
    await channel.close();
    expect(child.killed).toBe(true);
  });

  it('routes progress notifications and maps malformed, oversized and disconnected stdio output', async () => {
    const child = new FakeChild();
    const factory = new McpStdioChannelFactory({ spawn: (() => child as never) as McpStdioSpawnFunction, maxMessageBytes: 256 });
    const channel = await factory.open({ manifest: stdioManifest, env: {}, signal: new AbortController().signal });
    const notifications: unknown[] = [];
    channel.onNotification?.((notification) => notifications.push(notification));
    const pending = channel.request(jsonBytes({ jsonrpc: '2.0', id: 'stdio-2', method: 'ping' }), new AbortController().signal);
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1, total: 2, message: 'working' } })}\n`));
    child.stdout.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', id: 'stdio-2', result: { ok: true } })}\n`));
    await expect(pending).resolves.toBeTruthy();
    expect(notifications).toEqual([{ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1, total: 2, message: 'working' } }]);

    const malformed = channel.request(jsonBytes({ jsonrpc: '2.0', id: 'stdio-3', method: 'ping' }), new AbortController().signal);
    child.stdout.emit('data', Buffer.from('{not-json}\n'));
    await expect(malformed).rejects.toMatchObject({ code: 'MCP_MESSAGE_INVALID' });

    const oversized = channel.request(jsonBytes({ jsonrpc: '2.0', id: 'stdio-4', method: 'ping' }), new AbortController().signal);
    child.stdout.emit('data', Buffer.from(`${'x'.repeat(300)}\n`));
    await expect(oversized).rejects.toMatchObject({ code: 'MCP_MESSAGE_TOO_LARGE' });

    const disconnected = channel.request(jsonBytes({ jsonrpc: '2.0', id: 'stdio-5', method: 'ping' }), new AbortController().signal);
    child.stdout.emit('close');
    await expect(disconnected).rejects.toMatchObject({ code: 'MCP_PROTOCOL_DISCONNECTED' });
  });

  it('posts Streamable HTTP to the exact manifest URL with bounded runtime auth headers', async () => {
    let call: { url: string; init: { headers: Readonly<Record<string, string>>; body: Uint8Array } } | undefined;
    const fetchImpl: McpFetchImplementation = (async (url, init) => {
      call = { url, init: { headers: init.headers, body: init.body } };
      return { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' }, arrayBuffer: async () => jsonBytes({ jsonrpc: '2.0', id: 'http-1', result: { ok: true } }).buffer };
    });
    const factory = new McpStreamableHttpChannelFactory({ fetchImpl, authHeaders: { Authorization: 'Bearer runtime-only' } });
    const channel = await factory.open({ manifest: httpManifest, env: {}, signal: new AbortController().signal });
    await expect(channel.request(jsonBytes({ jsonrpc: '2.0', id: 'http-1', method: 'ping' }), new AbortController().signal)).resolves.toEqual(jsonBytes({ jsonrpc: '2.0', id: 'http-1', result: { ok: true } }));
    expect(call?.url).toBe('https://mcp.example.test/v1/mcp');
    expect(call?.init.headers).toMatchObject({ Authorization: 'Bearer runtime-only', 'content-type': 'application/json' });
    expect(call?.init.headers).not.toHaveProperty('x-api-key');
  });

  it.each([
    [401, 'MCP_HTTP_401'],
    [403, 'MCP_HTTP_403'],
    [429, 'MCP_HTTP_429'],
    [500, 'MCP_HTTP_5XX'],
  ] as const)('maps HTTP %s without exposing response bodies', async (status, code) => {
    const fetchImpl: McpFetchImplementation = async () => ({ status, text: async () => 'Bearer secret-body' });
    const factory = new McpStreamableHttpChannelFactory({ fetchImpl });
    const channel = await factory.open({ manifest: httpManifest, env: {}, signal: new AbortController().signal });
    await expect(channel.request(jsonBytes({ jsonrpc: '2.0', id: 'http-error', method: 'ping' }), new AbortController().signal)).rejects.toEqual(new McpTransportError(code));
  });

  it('maps malformed and oversized HTTP responses and supports cancellation', async () => {
    const fetchImpl: McpFetchImplementation = async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      return { status: 200, text: async () => '{' };
    };
    const factory = new McpStreamableHttpChannelFactory({ fetchImpl, maxMessageBytes: 32 });
    const channel = await factory.open({ manifest: httpManifest, env: {}, signal: new AbortController().signal });
    const controller = new AbortController();
    const pending = channel.request(jsonBytes({ jsonrpc: '2.0', id: 'http-cancel', method: 'ping' }), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'MCP_ABORTED' });

    const malformed = new McpStreamableHttpChannelFactory({ fetchImpl: async () => ({ status: 200, text: async () => '{' }) });
    const malformedChannel = await malformed.open({ manifest: httpManifest, env: {}, signal: new AbortController().signal });
    await expect(malformedChannel.request(jsonBytes({ jsonrpc: '2.0', id: 'http-malformed', method: 'ping' }), new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_MESSAGE_INVALID' });

    const oversized = new McpStreamableHttpChannelFactory({ fetchImpl: async () => ({ status: 200, text: async () => 'x'.repeat(100) }), maxMessageBytes: 16 });
    const oversizedChannel = await oversized.open({ manifest: httpManifest, env: {}, signal: new AbortController().signal });
    await expect(oversizedChannel.request(jsonBytes({ jsonrpc: '2.0', id: 'http-large', method: 'ping' }), new AbortController().signal)).rejects.toMatchObject({ code: 'MCP_MESSAGE_TOO_LARGE' });
  });
});

describe('McpProtocolSession', () => {
  it('initializes once, correlates ids, forwards progress and closes deterministically', async () => {
    let sequence = 0;
    let closed = 0;
    const progress = vi.fn();
    const listeners = new Set<(notification: McpJsonRpcNotification) => void>();
    const channel = {
      onNotification(listener: (notification: McpJsonRpcNotification) => void): () => void {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      request: async (payload: Uint8Array) => {
        const request = JSON.parse(new TextDecoder().decode(payload)) as { id: string; method: string };
        sequence += 1;
        if (request.method === 'initialize') {
          listeners.forEach((listener) => listener({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1, total: 1 } }));
          return jsonBytes({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1.0.0' } } });
        }
        return jsonBytes({ jsonrpc: '2.0', id: request.id, result: { sequence } });
      },
      notify: async () => undefined,
      close: async () => { closed += 1; },
    };
    const session = new McpProtocolSession({ manifest: stdioManifest, channelFactory: { open: async () => channel }, onProgress: progress });
    await expect(session.initialize()).resolves.toMatchObject({ protocolVersion: '2025-06-18' });
    await expect(session.initialize()).resolves.toMatchObject({ protocolVersion: '2025-06-18' });
    await expect(session.request('tools/list')).resolves.toEqual({ sequence: 2 });
    expect(progress).toHaveBeenCalledOnce();
    await session.close();
    await session.close();
    expect(closed).toBe(1);
  });

  it('maps session timeout and cancellation and closes the channel', async () => {
    let closed = 0;
    const session = new McpProtocolSession({
      manifest: stdioManifest,
      timeoutMs: 5,
      channelFactory: {
        open: async () => ({
          request: async () => await new Promise<Uint8Array>(() => undefined),
          close: async () => { closed += 1; },
        }),
      },
    });
    await expect(session.initialize()).rejects.toMatchObject({ code: 'MCP_TIMEOUT' });
    expect(closed).toBe(1);
  });
});
