import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import {
  decodeMcpJsonRpcResponse,
  encodeMcpJsonRpcRequest,
  McpTransportError,
  type McpChannel,
  type McpChannelFactory,
  type McpChannelOpenRequest,
  type McpJsonRpcNotification,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpProgressNotification,
  type McpServerManifest,
} from './index.js';

const DEFAULT_MAX_MESSAGE_BYTES = 128 * 1024;
const DEFAULT_SESSION_TIMEOUT_MS = 30_000;
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const MAX_HEADERS = 32;
const MAX_HEADER_BYTES = 4096;
const MAX_TOTAL_HEADER_BYTES = 16 * 1024;
const MAX_PROGRESS_MESSAGE_BYTES = 1024;
const SAFE_METHOD = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u;
const CONTROL = /[\u0000-\u001F\u007F]/u;

export interface McpStdioWritablePort {
  write(chunk: Uint8Array | string): boolean;
  end?(): void;
}

export interface McpStdioReadablePort {
  on(event: string, listener: (...args: any[]) => void): this;
  once?(event: string, listener: (...args: any[]) => void): this;
  removeListener?(event: string, listener: (...args: any[]) => void): this;
}

export interface McpStdioChildPort {
  readonly stdin: McpStdioWritablePort;
  readonly stdout: McpStdioReadablePort;
  on(event: string, listener: (...args: any[]) => void): this;
  once?(event: string, listener: (...args: any[]) => void): this;
  removeListener?(event: string, listener: (...args: any[]) => void): this;
  kill(signal?: string): boolean;
}

export interface McpStdioSpawnOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly stdio: readonly ['pipe', 'pipe', 'ignore'];
  readonly windowsHide?: boolean;
}

export type McpStdioSpawnFunction = (
  command: string,
  args: readonly string[],
  options: McpStdioSpawnOptions,
) => McpStdioChildPort;

export interface McpStdioChannelFactoryOptions {
  readonly spawn?: McpStdioSpawnFunction;
  readonly spawnImpl?: McpStdioSpawnFunction;
  readonly maxMessageBytes?: number;
}

export class McpStdioChannelFactory implements McpChannelFactory {
  private readonly spawn: McpStdioSpawnFunction;
  private readonly maxMessageBytes: number;

  constructor(options: McpStdioChannelFactoryOptions = {}) {
    this.spawn = options.spawn ?? options.spawnImpl ?? defaultStdioSpawn;
    this.maxMessageBytes = positiveBound(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
  }

  async open(request: McpChannelOpenRequest): Promise<McpStdioChannel> {
    if (request.signal.aborted) throw new McpTransportError('MCP_ABORTED');
    if (request.manifest.transport !== 'stdio') throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    if (!isSafeStdioCommand(request.manifest.command) || request.manifest.args.some((arg) => !isSafeStdioArg(arg))) {
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    }
    const env = validateStdioEnv(request.manifest, request.env);
    let child: McpStdioChildPort;
    try {
      child = this.spawn(request.manifest.command, [...request.manifest.args], {
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    }
    return new McpStdioChannel(child, this.maxMessageBytes);
  }
}

class McpStdioChannel implements McpChannel {
  private readonly pending = new Map<string, PendingResponse>();
  private readonly listeners = new Set<(notification: McpJsonRpcNotification) => void>();
  private buffer = new Uint8Array(0);
  private closed = false;

  constructor(private readonly child: McpStdioChildPort, private readonly maxMessageBytes: number) {
    child.stdout.on('data', (chunk: unknown) => this.consume(chunk));
    child.stdout.on('error', () => this.failPending(new McpTransportError('MCP_CHANNEL_UNAVAILABLE')));
    child.stdout.on('end', () => this.disconnect());
    child.stdout.on('close', () => this.disconnect());
    child.on('error', () => this.failPending(new McpTransportError('MCP_CHANNEL_UNAVAILABLE')));
    child.on('close', () => this.disconnect());
  }

  onNotification(listener: (notification: McpJsonRpcNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(payload: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
    if (this.closed) throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    if (signal.aborted) throw new McpTransportError('MCP_ABORTED');
    const id = requestIdFromPayload(payload);
    return await new Promise<Uint8Array>((resolve, reject) => {
      const onAbort = (): void => {
        this.pending.delete(id);
        reject(new McpTransportError('MCP_ABORTED'));
      };
      const pending: PendingResponse = {
        resolve: (response) => {
          signal.removeEventListener('abort', onAbort);
          resolve(response);
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      this.pending.set(id, pending);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        this.child.stdin.write(withNewline(payload));
      } catch {
        this.pending.delete(id);
        signal.removeEventListener('abort', onAbort);
        reject(new McpTransportError('MCP_CHANNEL_UNAVAILABLE'));
      }
    });
  }

  async notify(payload: Uint8Array, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    if (signal.aborted) throw new McpTransportError('MCP_ABORTED');
    try {
      this.child.stdin.write(withNewline(payload));
    } catch {
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failPending(new McpTransportError('MCP_PROTOCOL_DISCONNECTED'));
    try { this.child.stdin.end?.(); } catch { /* deterministic close */ }
    try { this.child.kill('SIGTERM'); } catch { /* deterministic close */ }
  }

  private consume(chunk: unknown): void {
    if (this.closed) return;
    let bytes: Uint8Array;
    try {
      bytes = chunkToBytes(chunk);
    } catch {
      this.failPending(new McpTransportError('MCP_MESSAGE_INVALID'));
      return;
    }
    this.buffer = concatBytes(this.buffer, bytes);
    let newline = indexOfByte(this.buffer, 0x0a);
    while (newline >= 0) {
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.byteLength > 0 && line[line.byteLength - 1] === 0x0d) line = line.slice(0, -1);
      if (line.byteLength > 0) this.consumeLine(line);
      newline = indexOfByte(this.buffer, 0x0a);
    }
    if (this.buffer.byteLength > this.maxMessageBytes) {
      this.buffer = new Uint8Array(0);
      this.failPending(new McpTransportError('MCP_MESSAGE_TOO_LARGE'));
    }
  }

  private consumeLine(line: Uint8Array): void {
    if (line.byteLength > this.maxMessageBytes) {
      this.failPending(new McpTransportError('MCP_MESSAGE_TOO_LARGE'));
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) as unknown;
    } catch {
      this.failPending(new McpTransportError('MCP_MESSAGE_INVALID'));
      return;
    }
    if (!isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string' && !('id' in value)) {
      this.failPending(new McpTransportError('MCP_MESSAGE_INVALID'));
      return;
    }
    if (typeof value.method === 'string' && !('id' in value)) {
      const notification = normalizeNotification(value);
      if (notification) this.listeners.forEach((listener) => listener(notification));
      return;
    }
    if ((typeof value.id !== 'string' && typeof value.id !== 'number') || (!('result' in value) && !('error' in value))) {
      this.failPending(new McpTransportError('MCP_MESSAGE_INVALID'));
      return;
    }
    const id = String(value.id);
    const pending = this.pending.get(id);
    if (pending) {
      this.pending.delete(id);
      pending.resolve(line);
      return;
    }
    if (this.pending.size === 1) this.failPending(new McpTransportError('MCP_RESPONSE_ID_MISMATCH'));
  }

  private disconnect(): void {
    if (!this.closed) this.failPending(new McpTransportError('MCP_PROTOCOL_DISCONNECTED'));
  }

  private failPending(error: McpTransportError): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    pending.forEach((entry) => entry.reject(error));
  }
}

interface PendingResponse {
  readonly resolve: (payload: Uint8Array) => void;
  readonly reject: (error: McpTransportError) => void;
}

export interface McpHttpRequestInit {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly signal: AbortSignal;
}

export interface McpHttpHeadersPort {
  get?(name: string): string | null;
}

export type McpHttpBodyChunk = Uint8Array | ArrayBuffer | string;

export interface McpHttpBodyPort {
  [Symbol.asyncIterator]?(): AsyncIterator<McpHttpBodyChunk>;
  getReader?(): { read(): Promise<{ done: boolean; value?: McpHttpBodyChunk }>; releaseLock?(): void };
}

export interface McpFetchResponse {
  readonly status: number;
  readonly headers?: McpHttpHeadersPort | Readonly<Record<string, string>> | undefined;
  readonly body?: McpHttpBodyPort | Uint8Array | undefined;
  readonly arrayBuffer?: (() => Promise<ArrayBuffer>) | undefined;
  readonly text?: (() => Promise<string>) | undefined;
}

export type McpFetchImplementation = (url: string, init: McpHttpRequestInit) => Promise<McpFetchResponse>;

export type McpAuthHeaders = Readonly<Record<string, string>>;
export type McpAuthHeadersProvider = (request: McpChannelOpenRequest) => McpAuthHeaders | Promise<McpAuthHeaders>;

export interface McpStreamableHttpChannelFactoryOptions {
  readonly fetchImpl?: McpFetchImplementation;
  readonly fetch?: McpFetchImplementation;
  readonly authHeaders?: McpAuthHeaders | McpAuthHeadersProvider;
  readonly getAuthHeaders?: McpAuthHeadersProvider;
  readonly maxMessageBytes?: number;
}

export class McpStreamableHttpChannelFactory implements McpChannelFactory {
  private readonly fetchImpl: McpFetchImplementation;
  private readonly authHeaders: McpAuthHeaders | McpAuthHeadersProvider | undefined;
  private readonly maxMessageBytes: number;

  constructor(options: McpStreamableHttpChannelFactoryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? options.fetch ?? defaultFetch;
    this.authHeaders = options.authHeaders ?? options.getAuthHeaders;
    this.maxMessageBytes = positiveBound(options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
  }

  async open(request: McpChannelOpenRequest): Promise<McpStreamableHttpChannel> {
    if (request.signal.aborted) throw new McpTransportError('MCP_ABORTED');
    if (request.manifest.transport !== 'http' && request.manifest.transport !== 'streamable-http') {
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    }
    if (!isSafeHttpEndpoint(request.manifest.url)) throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    let authHeaders: McpAuthHeaders = {};
    try {
      const supplied = this.authHeaders;
      authHeaders = typeof supplied === 'function' ? await supplied(request) : supplied ?? {};
      validateHeaders(authHeaders);
    } catch (error) {
      if (error instanceof McpTransportError) throw error;
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    }
    return new McpStreamableHttpChannel(request.manifest.url, authHeaders, this.fetchImpl, this.maxMessageBytes);
  }
}

class McpStreamableHttpChannel implements McpChannel {
  private readonly listeners = new Set<(notification: McpJsonRpcNotification) => void>();
  private readonly active = new Set<AbortController>();
  private sessionId: string | undefined;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly authHeaders: McpAuthHeaders,
    private readonly fetchImpl: McpFetchImplementation,
    private readonly maxMessageBytes: number,
  ) {}

  onNotification(listener: (notification: McpJsonRpcNotification) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async request(payload: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
    const id = requestIdFromPayload(payload);
    const response = await this.post(payload, signal, false);
    const contentType = headerValue(response.headers, 'content-type') ?? '';
    const body = await readBoundedBody(response, this.maxMessageBytes);
    return this.parseBody(body, contentType, id);
  }

  async notify(payload: Uint8Array, signal: AbortSignal): Promise<void> {
    const response = await this.post(payload, signal, true);
    if (response.status < 200 || response.status >= 300) throw httpStatusError(response.status);
    if (response.body || response.arrayBuffer || response.text) await readBoundedBody(response, this.maxMessageBytes);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.active.forEach((controller) => controller.abort());
    this.active.clear();
  }

  private async post(payload: Uint8Array, signal: AbortSignal, allowEmpty: boolean): Promise<McpFetchResponse> {
    if (this.closed) throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    if (signal.aborted) throw new McpTransportError('MCP_ABORTED');
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    this.active.add(controller);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.authHeaders,
    };
    if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
    try {
      const response = await this.fetchImpl(this.url, { method: 'POST', headers: Object.freeze(headers), body: payload, signal: controller.signal });
      this.captureSessionId(response.headers);
      if (!allowEmpty || response.status < 200 || response.status >= 300) {
        if (response.status < 200 || response.status >= 300) throw httpStatusError(response.status);
      }
      return response;
    } catch (error) {
      if (error instanceof McpTransportError) throw error;
      if (signal.aborted || controller.signal.aborted) throw new McpTransportError('MCP_ABORTED');
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    } finally {
      signal.removeEventListener('abort', onAbort);
      this.active.delete(controller);
    }
  }

  private parseBody(body: Uint8Array, contentType: string, expectedId: string): Uint8Array {
    if (body.byteLength === 0) throw new McpTransportError('MCP_MESSAGE_INVALID');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { throw new McpTransportError('MCP_MESSAGE_INVALID'); }
    if (contentType.toLowerCase().includes('text/event-stream') || /^\s*data:/u.test(text)) {
      const events = parseSse(text, this.maxMessageBytes);
      let response: Uint8Array | undefined;
      for (const event of events) {
        if (isNotification(event.value)) {
          const notification = normalizeNotification(event.value);
          if (notification) this.listeners.forEach((listener) => listener(notification));
        } else if (isJsonRpcResponse(event.value)) {
          if (String(event.value.id) === expectedId) response = event.bytes;
        }
      }
      if (!response) throw new McpTransportError('MCP_RESPONSE_ID_MISMATCH');
      return response;
    }
    let value: unknown;
    try { value = JSON.parse(text) as unknown; } catch { throw new McpTransportError('MCP_MESSAGE_INVALID'); }
    if (!isJsonRpcResponse(value)) throw new McpTransportError('MCP_MESSAGE_INVALID');
    if (String(value.id) !== expectedId) throw new McpTransportError('MCP_RESPONSE_ID_MISMATCH');
    return body;
  }

  private captureSessionId(headers: McpFetchResponse['headers']): void {
    const value = headerValue(headers, 'mcp-session-id');
    if (!value) return;
    if (value.length > 256 || CONTROL.test(value)) return;
    this.sessionId = value;
  }
}

export interface McpProtocolClientInfo {
  readonly name?: string;
  readonly version?: string;
}

export interface McpProtocolSessionOptions {
  readonly manifest: McpServerManifest;
  readonly channelFactory: McpChannelFactory;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxMessageBytes?: number;
  readonly timeoutMs?: number;
  readonly protocolVersion?: string;
  readonly clientInfo?: McpProtocolClientInfo;
  readonly onProgress?: (notification: McpProgressNotification) => void;
}

export interface McpInitializeResult {
  readonly protocolVersion: string;
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly serverInfo?: Readonly<Record<string, unknown>>;
}

export type McpProtocolSessionState = 'new' | 'initializing' | 'ready' | 'closed' | 'failed';

let sessionRequestSequence = 0;

/**
 * A bounded MCP lifecycle wrapper. It owns initialize/request correlation but
 * deliberately has no ToolRegistry, Approval, Scheduler or Sandbox authority.
 */
export class McpProtocolSession {
  private readonly options: McpProtocolSessionOptions;
  private readonly maxMessageBytes: number;
  private readonly timeoutMs: number;
  private channel: McpChannel | undefined;
  private unsubscribeNotifications: (() => void) | undefined;
  private initializing: Promise<McpInitializeResult> | undefined;
  private result: McpInitializeResult | undefined;
  private sessionState: McpProtocolSessionState = 'new';

  constructor(options: McpProtocolSessionOptions);
  constructor(manifest: McpServerManifest, options: Omit<McpProtocolSessionOptions, 'manifest'>);
  constructor(first: McpProtocolSessionOptions | McpServerManifest, second?: Omit<McpProtocolSessionOptions, 'manifest'>) {
    this.options = 'manifest' in first
      ? first
      : { ...second, manifest: first } as McpProtocolSessionOptions;
    this.maxMessageBytes = positiveBound(this.options.maxMessageBytes, DEFAULT_MAX_MESSAGE_BYTES);
    this.timeoutMs = positiveBound(this.options.timeoutMs, DEFAULT_SESSION_TIMEOUT_MS);
  }

  get state(): McpProtocolSessionState { return this.sessionState; }
  get initializeResult(): McpInitializeResult | undefined { return this.result; }

  /** Alias for callers that model the lifecycle as open -> request -> close. */
  async open(signal?: AbortSignal): Promise<McpInitializeResult> {
    return await this.initialize(signal);
  }

  async initialize(signal?: AbortSignal): Promise<McpInitializeResult> {
    if (this.sessionState === 'closed' || this.sessionState === 'failed') throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    if (this.result) return this.result;
    if (this.initializing) return await this.initializing;
    this.sessionState = 'initializing';
    this.initializing = this.performInitialize(signal).finally(() => { this.initializing = undefined; });
    try {
      return await this.initializing;
    } catch (error) {
      this.sessionState = 'failed';
      throw error;
    }
  }

  async request(method: string, params?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (this.sessionState !== 'ready' || !this.channel) throw new McpTransportError('MCP_SESSION_NOT_INITIALIZED');
    if (!SAFE_METHOD.test(method) || CONTROL.test(method)) throw new McpTransportError('MCP_MESSAGE_INVALID');
    try {
      return await this.sendRequest(method, params, signal);
    } catch (error) {
      await this.close();
      this.sessionState = 'failed';
      throw normalizeSessionError(error, signal);
    }
  }

  async close(): Promise<void> {
    if (this.sessionState === 'closed') return;
    this.sessionState = 'closed';
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = undefined;
    const channel = this.channel;
    this.channel = undefined;
    if (channel) await channel.close().catch(() => undefined);
  }

  private async performInitialize(signal?: AbortSignal): Promise<McpInitializeResult> {
    try {
      this.channel = await withDeadline(signal, this.timeoutMs, (innerSignal) => this.options.channelFactory.open({ manifest: this.options.manifest, env: this.options.env ?? {}, signal: innerSignal }));
      this.unsubscribeNotifications = this.channel.onNotification?.((notification) => this.handleNotification(notification));
      const result = await this.sendRequest('initialize', {
        protocolVersion: this.options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: this.options.clientInfo?.name ?? 'ready4vibe',
          version: this.options.clientInfo?.version ?? '0.1.0',
        },
      }, signal);
      const initialized = validateInitializeResult(result);
      if (this.channel.notify) {
        const payload = encodeNotification({ jsonrpc: '2.0', method: 'notifications/initialized' });
        await withDeadline(signal, this.timeoutMs, (innerSignal) => this.channel?.notify?.(payload, innerSignal) ?? Promise.resolve());
      }
      this.result = initialized;
      this.sessionState = 'ready';
      return initialized;
    } catch (error) {
      await this.close();
      throw normalizeSessionError(error, signal);
    }
  }

  private async sendRequest(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const channel = this.channel;
    if (!channel) throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    const request: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      id: `session-${++sessionRequestSequence}`,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const payload = encodeMcpJsonRpcRequest(request, this.maxMessageBytes);
    return await withDeadline(signal, this.timeoutMs, async (innerSignal) => {
      const responseBytes = await channel.request(payload, innerSignal);
      const response = decodeMcpJsonRpcResponse(responseBytes, this.maxMessageBytes);
      if (response.id !== request.id) throw new McpTransportError('MCP_RESPONSE_ID_MISMATCH');
      if (response.error) throw new McpTransportError('MCP_REMOTE_ERROR');
      return response.result;
    });
  }

  private handleNotification(notification: McpJsonRpcNotification): void {
    if (notification.method !== 'notifications/progress') return;
    const progress = normalizeProgress(notification);
    if (progress) this.options.onProgress?.(progress);
  }
}

function defaultStdioSpawn(command: string, args: readonly string[], options: McpStdioSpawnOptions): McpStdioChildPort {
  return nodeSpawn(command, [...args], options as unknown as SpawnOptions) as unknown as McpStdioChildPort;
}

const defaultFetch: McpFetchImplementation = async (url, init) => {
  const response = await globalThis.fetch(url, {
    method: init.method,
    headers: { ...init.headers },
    body: init.body as unknown as BodyInit,
    signal: init.signal,
  });
  return {
    status: response.status,
    headers: response.headers,
    body: response.body as unknown as McpHttpBodyPort | undefined,
    arrayBuffer: () => response.arrayBuffer(),
    text: () => response.text(),
  };
};

function validateStdioEnv(manifest: Extract<McpServerManifest, { transport: 'stdio' }>, env: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const allowlisted = new Set(manifest.envAllowlist);
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!allowlisted.has(key) || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof value !== 'string' || CONTROL.test(value) || value.length > 4096) {
      throw new McpTransportError('MCP_ENV_NOT_ALLOWED');
    }
    copy[key] = value;
  }
  return Object.freeze(copy);
}

function isSafeStdioCommand(command: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(command);
}

function isSafeStdioArg(arg: string): boolean {
  return typeof arg === 'string' && arg.length > 0 && !CONTROL.test(arg) && !/[;&|<>`$()]/u.test(arg) && Buffer.byteLength(arg, 'utf8') <= 4096;
}

function isSafeHttpEndpoint(value: string): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  if ([...url.searchParams.keys()].some((key) => /^(?:token|access_token|api[_-]?key|key|secret|password)$/iu.test(key))) return false;
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback);
}

function validateHeaders(headers: McpAuthHeaders): void {
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADERS) throw new McpTransportError('MCP_MESSAGE_INVALID');
  let total = 0;
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u.test(key) || typeof value !== 'string' || CONTROL.test(value) || value.length > MAX_HEADER_BYTES) {
      throw new McpTransportError('MCP_MESSAGE_INVALID');
    }
    total += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (total > MAX_TOTAL_HEADER_BYTES) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
  }
}

function requestIdFromPayload(payload: Uint8Array): string {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload)) as unknown; } catch { throw new McpTransportError('MCP_MESSAGE_INVALID'); }
  if (!isRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) throw new McpTransportError('MCP_MESSAGE_INVALID');
  return value.id;
}

function withNewline(payload: Uint8Array): Uint8Array {
  const result = new Uint8Array(payload.byteLength + 1);
  result.set(payload);
  result[result.byteLength - 1] = 0x0a;
  return result;
}

function chunkToBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return new Uint8Array(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  throw new Error('unsupported chunk');
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function indexOfByte(bytes: Uint8Array, target: number): number {
  for (let index = 0; index < bytes.byteLength; index += 1) if (bytes[index] === target) return index;
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcResponse(value: unknown): value is McpJsonRpcResponse {
  return isRecord(value) && value.jsonrpc === '2.0' && (typeof value.id === 'string' || typeof value.id === 'number') && ('result' in value || 'error' in value);
}

function isNotification(value: unknown): value is McpJsonRpcNotification {
  return isRecord(value) && value.jsonrpc === '2.0' && typeof value.method === 'string' && !('id' in value);
}

function normalizeNotification(input: unknown): McpJsonRpcNotification | undefined {
  if (!isRecord(input)) return undefined;
  if (input.jsonrpc !== '2.0' || typeof input.method !== 'string' || input.method.length === 0 || input.method.length > 128 || CONTROL.test(input.method) || 'id' in input) return undefined;
  if (input.method !== 'notifications/progress') return Object.freeze({ jsonrpc: '2.0', method: input.method });
  const progress = normalizeProgress({ method: 'notifications/progress', params: input.params });
  return progress;
}

function normalizeProgress(notification: Pick<McpJsonRpcNotification, 'method' | 'params'>): McpProgressNotification | undefined {
  if (notification.method !== 'notifications/progress' || !isRecord(notification.params)) return undefined;
  const params = notification.params;
  const progressToken = typeof params.progressToken === 'string' || typeof params.progressToken === 'number' ? params.progressToken : undefined;
  const progress = typeof params.progress === 'number' && Number.isFinite(params.progress) && params.progress >= 0 ? params.progress : undefined;
  const total = typeof params.total === 'number' && Number.isFinite(params.total) && params.total >= 0 ? params.total : undefined;
  const message = typeof params.message === 'string' && !CONTROL.test(params.message) && Buffer.byteLength(params.message, 'utf8') <= MAX_PROGRESS_MESSAGE_BYTES ? params.message : undefined;
  if (progress === undefined && total === undefined && message === undefined && progressToken === undefined) return undefined;
  return Object.freeze({ jsonrpc: '2.0', method: 'notifications/progress', params: Object.freeze({
    ...(progressToken === undefined ? {} : { progressToken }),
    ...(progress === undefined ? {} : { progress }),
    ...(total === undefined ? {} : { total }),
    ...(message === undefined ? {} : { message }),
  }) });
}

function headerValue(headers: McpFetchResponse['headers'], name: string): string | undefined {
  if (!headers) return undefined;
  if ('get' in headers && typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const record = headers as Readonly<Record<string, unknown>>;
  const wanted = name.toLowerCase();
  const found = Object.entries(record).find(([key]) => key.toLowerCase() === wanted)?.[1];
  return typeof found === 'string' ? found : undefined;
}

async function readBoundedBody(response: McpFetchResponse, maxBytes: number): Promise<Uint8Array> {
  try {
    if (response.body instanceof Uint8Array) {
      if (response.body.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
      return new Uint8Array(response.body);
    }
    if (response.body && typeof response.body !== 'string' && Symbol.asyncIterator in response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
      let result = new Uint8Array(0);
      for await (const chunk of response.body as AsyncIterable<McpHttpBodyChunk>) {
        result = appendBounded(result, chunkToBytes(chunk), maxBytes);
      }
      return result;
    }
    if (response.body && 'getReader' in response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      let result = new Uint8Array(0);
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if (next.value !== undefined) result = appendBounded(result, chunkToBytes(next.value), maxBytes);
        }
      } finally { reader.releaseLock?.(); }
      return result;
    }
    if (response.arrayBuffer) {
      const array = new Uint8Array(await response.arrayBuffer());
      if (array.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
      return array;
    }
    if (response.text) {
      const text = await response.text();
      const bytes = new TextEncoder().encode(text);
      if (bytes.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
      return bytes;
    }
    return new Uint8Array(0);
  } catch (error) {
    if (error instanceof McpTransportError) throw error;
    throw new McpTransportError('MCP_MESSAGE_INVALID');
  }
}

function appendBounded(left: Uint8Array, right: Uint8Array, maxBytes: number): Uint8Array {
  if (left.byteLength + right.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
  return concatBytes(left, right);
}

function httpStatusError(status: number): McpTransportError {
  if (status === 401) return new McpTransportError('MCP_HTTP_401');
  if (status === 403) return new McpTransportError('MCP_HTTP_403');
  if (status === 429) return new McpTransportError('MCP_HTTP_429');
  if (status >= 500 && status <= 599) return new McpTransportError('MCP_HTTP_5XX');
  if (status >= 400 && status <= 499) return new McpTransportError('MCP_HTTP_4XX');
  return new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
}

interface SseEvent {
  readonly value: unknown;
  readonly bytes: Uint8Array;
}

function parseSse(text: string, maxBytes: number): readonly SseEvent[] {
  const events: SseEvent[] = [];
  let dataLines: string[] = [];
  const dispatch = (): void => {
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    dataLines = [];
    let value: unknown;
    try { value = JSON.parse(data) as unknown; } catch { throw new McpTransportError('MCP_MESSAGE_INVALID'); }
    const bytes = new TextEncoder().encode(data);
    if (bytes.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
    events.push({ value, bytes });
  };
  for (const line of text.split(/\r?\n/u)) {
    if (line === '') { dispatch(); continue; }
    if (line.startsWith(':')) continue;
    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /u, ''));
  }
  dispatch();
  return events;
}

function validateInitializeResult(value: unknown): McpInitializeResult {
  if (!isRecord(value) || typeof value.protocolVersion !== 'string' || value.protocolVersion.length === 0 || CONTROL.test(value.protocolVersion) || !isRecord(value.capabilities) || (value.serverInfo !== undefined && !isRecord(value.serverInfo))) {
    throw new McpTransportError('MCP_MESSAGE_INVALID');
  }
  return Object.freeze({
    protocolVersion: value.protocolVersion,
    capabilities: Object.freeze({ ...value.capabilities }),
    ...(isRecord(value.serverInfo) ? { serverInfo: Object.freeze({ ...value.serverInfo }) } : {}),
  });
}

function encodeNotification(notification: McpJsonRpcNotification): Uint8Array {
  let encoded: Uint8Array;
  try { encoded = new TextEncoder().encode(JSON.stringify(notification)); } catch { throw new McpTransportError('MCP_MESSAGE_INVALID'); }
  if (encoded.byteLength > DEFAULT_MAX_MESSAGE_BYTES) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
  return encoded;
}

async function withDeadline<T>(externalSignal: AbortSignal | undefined, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let rejectAbort: ((reason: McpTransportError) => void) | undefined;
  const abortPromise = externalSignal
    ? new Promise<never>((_, reject) => { rejectAbort = reject; })
    : undefined;
  const onAbort = (): void => {
    controller.abort();
    rejectAbort?.(new McpTransportError('MCP_ABORTED'));
  };
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  if (externalSignal?.aborted) onAbort();
  let rejectTimeout: ((reason: McpTransportError) => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout?.(new McpTransportError('MCP_TIMEOUT'));
  }, timeoutMs);
  let operationPromise: Promise<T>;
  try {
    operationPromise = Promise.resolve(operation(controller.signal));
  } catch (error) {
    operationPromise = Promise.reject(error);
  }
  // The operation may be backed by an injected port that does not observe
  // AbortSignal. Attach a handler so a bounded timeout never creates an
  // unhandled rejection after the race has already settled.
  void operationPromise.catch(() => undefined);
  try {
    const contenders: Promise<T | never>[] = [operationPromise, timeoutPromise];
    if (abortPromise) contenders.push(abortPromise);
    return await Promise.race(contenders);
  } catch (error) {
    if (timedOut) throw new McpTransportError('MCP_TIMEOUT');
    if (externalSignal?.aborted) throw new McpTransportError('MCP_ABORTED');
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
}

function normalizeSessionError(error: unknown, signal?: AbortSignal): McpTransportError {
  if (error instanceof McpTransportError) return error;
  if (signal?.aborted) return new McpTransportError('MCP_ABORTED');
  return new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
}

function positiveBound(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new McpTransportError('MCP_MESSAGE_INVALID');
  return value;
}
