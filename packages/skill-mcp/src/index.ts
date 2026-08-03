export type ManifestErrorCode =
  | 'MANIFEST_INVALID'
  | 'MANIFEST_TOO_LARGE'
  | 'MANIFEST_LIMIT_EXCEEDED'
  | 'MANIFEST_UNKNOWN_FIELD'
  | 'MANIFEST_SECRET_FIELD'
  | 'MCP_COMMAND_INVALID'
  | 'MCP_ARGV_INVALID'
  | 'MCP_URL_INSECURE'
  | 'MCP_URL_SECRET';

export class ManifestError extends Error {
  constructor(readonly code: ManifestErrorCode, message = 'The manifest was rejected.') {
    super(message);
    this.name = 'ManifestError';
  }
}

export type ManifestInput = string | Uint8Array | unknown;
export type ToolRisk = 'read' | 'write' | 'destructive' | 'network';

export interface SkillManifest {
  readonly kind: 'skill';
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly allowedTools: readonly string[];
  readonly allowedMcpServers: readonly string[];
  readonly envAllowlist: readonly string[];
}

export interface McpToolManifest {
  readonly id: string;
  readonly version: string;
  readonly summary: string;
  readonly risk: ToolRisk;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

interface McpServerManifestBase {
  readonly kind: 'mcp-server';
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly tools: readonly McpToolManifest[];
  readonly envAllowlist: readonly string[];
  readonly network: 'restricted' | 'enabled';
}

export interface McpStdioManifest extends McpServerManifestBase {
  readonly transport: 'stdio';
  readonly command: string;
  readonly args: readonly string[];
}

export interface McpHttpManifest extends McpServerManifestBase {
  readonly transport: 'http';
  readonly url: string;
}

export type McpServerManifest = McpStdioManifest | McpHttpManifest;

export interface ManifestLimits {
  readonly maxBytes?: number;
  readonly maxInstructionsBytes?: number;
  readonly maxTools?: number;
}

export interface ManifestAllowlist {
  readonly skills?: readonly string[];
  readonly mcpServers?: readonly string[];
  readonly mcpTools?: readonly string[];
}

export interface PublicMcpTool {
  readonly id: string;
  readonly version: string;
  readonly summary: string;
  readonly risk: ToolRisk;
}

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_INSTRUCTIONS_BYTES = 32 * 1024;
const DEFAULT_MAX_TOOLS = 128;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const TOOL_REFERENCE = /^[a-z0-9][a-z0-9._-]{0,63}@\d+\.\d+\.\d+$/u;
const SHELL_METACHARACTER = /[;&|<>`$()]/u;
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const CONTROL_OR_NEWLINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\r\n]/u;
const SECRET_KEY = /(?:^|[_-])(api[_-]?key|access[_-]?token|token|password|secret|private[_-]?key)(?:$|[_-])/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+)/iu;

export function loadSkillManifest(input: ManifestInput, limits: ManifestLimits = {}): SkillManifest {
  const record = readManifestRecord(input, limits);
  assertKeys(record, ['kind', 'id', 'version', 'name', 'description', 'instructions', 'allowedTools', 'allowedMcpServers', 'envAllowlist']);
  assertKind(record, 'skill');
  const instructions = stringField(record, 'instructions', limits.maxInstructionsBytes ?? DEFAULT_MAX_INSTRUCTIONS_BYTES, 'MANIFEST_LIMIT_EXCEEDED');
  const manifest: SkillManifest = {
    kind: 'skill',
    id: identifierField(record, 'id'),
    version: versionField(record, 'version'),
    name: stringField(record, 'name', 256),
    description: stringField(record, 'description', 4 * 1024),
    instructions,
    allowedTools: stringListField(record, 'allowedTools', 128, TOOL_REFERENCE),
    allowedMcpServers: stringListField(record, 'allowedMcpServers', 64, IDENTIFIER),
    envAllowlist: envListField(record, 'envAllowlist', 32),
  };
  assertNoSecretLikeStrings(manifest);
  return freezeSkillManifest(manifest);
}

export function loadMcpServerManifest(input: ManifestInput, limits: ManifestLimits = {}): McpServerManifest {
  const record = readManifestRecord(input, limits);
  assertKeys(record, ['kind', 'id', 'version', 'name', 'description', 'transport', 'command', 'args', 'url', 'tools', 'envAllowlist', 'network']);
  assertKind(record, 'mcp-server');
  const transport = record.transport;
  if (transport !== 'stdio' && transport !== 'http') throw new ManifestError('MANIFEST_INVALID', 'MCP transport is invalid.');
  if (transport === 'stdio' && record.url !== undefined) throw new ManifestError('MANIFEST_INVALID', 'stdio MCP manifest must not include an HTTP URL.');
  if (transport === 'http' && (record.command !== undefined || record.args !== undefined)) throw new ManifestError('MANIFEST_INVALID', 'HTTP MCP manifest must not include stdio argv.');
  const base = {
    kind: 'mcp-server' as const,
    id: identifierField(record, 'id'),
    version: versionField(record, 'version'),
    name: stringField(record, 'name', 256),
    description: stringField(record, 'description', 4 * 1024),
    tools: toolListField(record, 'tools', limits.maxTools ?? DEFAULT_MAX_TOOLS),
    envAllowlist: envListField(record, 'envAllowlist', 32, true),
    network: networkField(record),
  };
  const manifest: McpServerManifest = transport === 'stdio'
    ? {
        ...base,
        transport,
        command: commandField(record),
        args: argvField(record),
      }
    : {
        ...base,
        transport,
        url: urlField(record),
      };
  assertNoSecretLikeStrings(manifest);
  return freezeMcpManifest(manifest);
}

export class IntegrationAllowlist {
  private readonly skills: ReadonlySet<string>;
  private readonly mcpServers: ReadonlySet<string>;
  private readonly mcpTools: ReadonlySet<string>;

  constructor(allowlist: ManifestAllowlist = {}) {
    this.skills = new Set(allowlist.skills ?? []);
    this.mcpServers = new Set(allowlist.mcpServers ?? []);
    this.mcpTools = new Set(allowlist.mcpTools ?? []);
  }

  allowsSkill(manifest: SkillManifest): boolean {
    return this.skills.has(manifestReference(manifest.id, manifest.version));
  }

  allowsMcpServer(manifest: McpServerManifest): boolean {
    return this.mcpServers.has(manifestReference(manifest.id, manifest.version));
  }

  publicTools(manifest: McpServerManifest): readonly PublicMcpTool[] {
    if (!this.allowsMcpServer(manifest)) return [];
    return Object.freeze(manifest.tools
      .filter((tool) => this.mcpTools.has(mcpToolReference(manifest.id, tool.id, tool.version)))
      .map(({ id, version, summary, risk }) => ({ id, version, summary, risk })));
  }
}

export type McpTransportErrorCode =
  | 'MCP_SERVER_NOT_ALLOWED'
  | 'MCP_TOOL_NOT_ALLOWED'
  | 'MCP_ENV_NOT_ALLOWED'
  | 'MCP_MESSAGE_TOO_LARGE'
  | 'MCP_MESSAGE_INVALID'
  | 'MCP_RESPONSE_ID_MISMATCH'
  | 'MCP_REMOTE_ERROR'
  | 'MCP_TIMEOUT'
  | 'MCP_ABORTED'
  | 'MCP_CHANNEL_UNAVAILABLE';

export class McpTransportError extends Error {
  constructor(readonly code: McpTransportErrorCode, message = safeTransportMessage(code)) {
    super(message);
    this.name = 'McpTransportError';
  }
}

export interface McpJsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string;
  readonly method: string;
  readonly params?: unknown;
}

export interface McpJsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface McpJsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: McpJsonRpcError;
}

export interface McpChannel {
  request(payload: Uint8Array, signal: AbortSignal): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface McpChannelOpenRequest {
  readonly manifest: McpServerManifest;
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface McpChannelFactory {
  open(request: McpChannelOpenRequest): Promise<McpChannel>;
}

export interface McpTransportClientOptions {
  readonly allowlist: IntegrationAllowlist;
  readonly channelFactory: McpChannelFactory;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxMessageBytes?: number;
  readonly timeoutMs?: number;
}

const DEFAULT_MCP_MESSAGE_BYTES = 128 * 1024;
const DEFAULT_MCP_TIMEOUT_MS = 30_000;
let requestSequence = 0;

export function encodeMcpJsonRpcRequest(request: McpJsonRpcRequest, maxBytes = DEFAULT_MCP_MESSAGE_BYTES): Uint8Array {
  if (!isValidRequest(request)) throw new McpTransportError('MCP_MESSAGE_INVALID');
  const encoded = new TextEncoder().encode(JSON.stringify(request));
  if (encoded.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
  return encoded;
}

export function decodeMcpJsonRpcResponse(payload: Uint8Array, maxBytes = DEFAULT_MCP_MESSAGE_BYTES): McpJsonRpcResponse {
  if (payload.byteLength > maxBytes) throw new McpTransportError('MCP_MESSAGE_TOO_LARGE');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(payload)) as unknown;
  } catch {
    throw new McpTransportError('MCP_MESSAGE_INVALID');
  }
  if (!isValidResponse(value)) throw new McpTransportError('MCP_MESSAGE_INVALID');
  return value;
}

/**
 * A bounded, one-shot MCP caller. The channel is always closed before the
 * promise settles; concrete stdio/HTTP channels are intentionally injected.
 */
export class McpTransportClient {
  private readonly allowlist: IntegrationAllowlist;
  private readonly channelFactory: McpChannelFactory;
  private readonly env: Readonly<Record<string, string>>;
  private readonly maxMessageBytes: number;
  private readonly timeoutMs: number;

  constructor(private readonly manifest: McpServerManifest, options: McpTransportClientOptions) {
    this.allowlist = options.allowlist;
    this.channelFactory = options.channelFactory;
    this.env = Object.freeze({ ...(options.env ?? {}) });
    this.maxMessageBytes = positiveLimit(options.maxMessageBytes, DEFAULT_MCP_MESSAGE_BYTES);
    this.timeoutMs = positiveLimit(options.timeoutMs, DEFAULT_MCP_TIMEOUT_MS);
    const declared = new Set(manifest.envAllowlist);
    if (Object.keys(this.env).some((key) => !declared.has(key))) throw new McpTransportError('MCP_ENV_NOT_ALLOWED');
  }

  async callTool(toolId: string, toolVersion: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!this.allowlist.allowsMcpServer(this.manifest)) throw new McpTransportError('MCP_SERVER_NOT_ALLOWED');
    const tool = this.manifest.tools.find((entry) => entry.id === toolId && entry.version === toolVersion);
    if (!tool || !this.allowlist.publicTools(this.manifest).some((entry) => entry.id === toolId && entry.version === toolVersion)) {
      throw new McpTransportError('MCP_TOOL_NOT_ALLOWED');
    }
    const request: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      id: `mcp-${++requestSequence}`,
      method: 'tools/call',
      params: { name: tool.id, arguments: input },
    };
    const payload = encodeMcpJsonRpcRequest(request, this.maxMessageBytes);
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let channel: McpChannel | undefined;
    try {
      if (controller.signal.aborted) throw new McpTransportError(signal?.aborted ? 'MCP_ABORTED' : 'MCP_TIMEOUT');
      try {
        channel = await this.channelFactory.open({ manifest: this.manifest, env: this.env, signal: controller.signal });
      } catch {
        if (timedOut) throw new McpTransportError('MCP_TIMEOUT');
        if (signal?.aborted) throw new McpTransportError('MCP_ABORTED');
        throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
      }
      if (controller.signal.aborted) {
        if (timedOut) throw new McpTransportError('MCP_TIMEOUT');
        throw new McpTransportError('MCP_ABORTED');
      }
      let responseBytes: Uint8Array;
      try {
        responseBytes = await channel.request(payload, controller.signal);
      } catch (error) {
        if (error instanceof McpTransportError) throw error;
        if (timedOut) throw new McpTransportError('MCP_TIMEOUT');
        if (signal?.aborted) throw new McpTransportError('MCP_ABORTED');
        throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
      }
      const response = decodeMcpJsonRpcResponse(responseBytes, this.maxMessageBytes);
      if (response.id !== request.id) throw new McpTransportError('MCP_RESPONSE_ID_MISMATCH');
      if (response.error) throw new McpTransportError('MCP_REMOTE_ERROR');
      return response.result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      await channel?.close().catch(() => undefined);
    }
  }
}

export function manifestReference(id: string, version: string): string {
  return `${id}@${version}`;
}

export function mcpToolReference(serverId: string, toolId: string, version: string): string {
  return `${serverId}/${toolId}@${version}`;
}

function readManifestRecord(input: ManifestInput, limits: ManifestLimits): Record<string, unknown> {
  const maxBytes = limits.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ManifestError('MANIFEST_LIMIT_EXCEEDED', 'Manifest byte limit is invalid.');
  let serialized: string;
  let value: unknown;
  if (typeof input === 'string') {
    serialized = input;
    try {
      value = JSON.parse(input) as unknown;
    } catch {
      throw new ManifestError('MANIFEST_INVALID', 'Manifest JSON is invalid.');
    }
  } else if (input instanceof Uint8Array) {
    serialized = new TextDecoder().decode(input);
    try {
      value = JSON.parse(serialized) as unknown;
    } catch {
      throw new ManifestError('MANIFEST_INVALID', 'Manifest JSON is invalid.');
    }
  } else {
    try {
      serialized = JSON.stringify(input);
      value = input;
    } catch {
      throw new ManifestError('MANIFEST_INVALID', 'Manifest value is not serializable.');
    }
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new ManifestError('MANIFEST_TOO_LARGE', 'Manifest exceeds the byte limit.');
  if (!isRecord(value)) throw new ManifestError('MANIFEST_INVALID', 'Manifest must be a JSON object.');
  return value;
}

function assertKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new ManifestError('MANIFEST_UNKNOWN_FIELD', 'Manifest contains an unsupported field.');
  }
}

function assertKind(record: Record<string, unknown>, expected: string): void {
  if (record.kind !== expected) throw new ManifestError('MANIFEST_INVALID', 'Manifest kind is invalid.');
}

function stringField(record: Record<string, unknown>, key: string, maxBytes: number, limitCode: ManifestErrorCode = 'MANIFEST_INVALID'): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0 || CONTROL_CHARACTER.test(value)) {
    throw new ManifestError('MANIFEST_INVALID', 'Manifest text field is invalid.');
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new ManifestError(limitCode, 'Manifest text field exceeds its limit.');
  }
  return value;
}

function identifierField(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key, 128);
  if (!IDENTIFIER.test(value)) throw new ManifestError('MANIFEST_INVALID', 'Manifest identifier is invalid.');
  return value;
}

function versionField(record: Record<string, unknown>, key: string): string {
  const value = stringField(record, key, 64);
  if (!VERSION.test(value)) throw new ManifestError('MANIFEST_INVALID', 'Manifest version is invalid.');
  return value;
}

function stringListField(record: Record<string, unknown>, key: string, maxItems: number, pattern: RegExp): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length > maxItems) throw new ManifestError('MANIFEST_LIMIT_EXCEEDED', 'Manifest list exceeds its limit.');
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !pattern.test(item) || seen.has(item)) throw new ManifestError('MANIFEST_INVALID', 'Manifest list item is invalid.');
    seen.add(item);
    result.push(item);
  }
  return result;
}

function envListField(record: Record<string, unknown>, key: string, maxItems: number, optional = false): readonly string[] {
  if (record[key] === undefined && optional) return [];
  return stringListField(record, key, maxItems, ENV_NAME);
}

function commandField(record: Record<string, unknown>): string {
  const value = record.command;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
    throw new ManifestError('MCP_COMMAND_INVALID', 'MCP stdio command must be a bare executable name.');
  }
  return value;
}

function argvField(record: Record<string, unknown>): readonly string[] {
  if (record.args === undefined) return [];
  if (!Array.isArray(record.args) || record.args.length > 64) throw new ManifestError('MCP_ARGV_INVALID', 'MCP stdio args exceed their limit.');
  const args: string[] = [];
  for (const arg of record.args) {
    if (typeof arg !== 'string' || arg.length === 0 || CONTROL_OR_NEWLINE.test(arg) || SHELL_METACHARACTER.test(arg) || Buffer.byteLength(arg, 'utf8') > 4096) {
      throw new ManifestError('MCP_ARGV_INVALID', 'MCP stdio args are invalid.');
    }
    args.push(arg);
  }
  return args;
}

function urlField(record: Record<string, unknown>): string {
  const value = record.url;
  if (typeof value !== 'string' || value.length > 2048) throw new ManifestError('MANIFEST_INVALID', 'MCP URL is invalid.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ManifestError('MANIFEST_INVALID', 'MCP URL is invalid.');
  }
  if (url.username || url.password || url.hash || [...url.searchParams.keys()].some((key) => /^(?:token|access_token|api[_-]?key|key|secret|password)$/iu.test(key))) {
    throw new ManifestError('MCP_URL_SECRET', 'MCP URL must not contain credentials or secret query parameters.');
  }
  const hostname = url.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ManifestError('MCP_URL_INSECURE', 'MCP HTTP transport requires HTTPS outside loopback.');
  }
  return url.toString();
}

function networkField(record: Record<string, unknown>): 'restricted' | 'enabled' {
  const value = record.network ?? 'restricted';
  if (value !== 'restricted' && value !== 'enabled') throw new ManifestError('MANIFEST_INVALID', 'MCP network mode is invalid.');
  return value;
}

function toolListField(record: Record<string, unknown>, key: string, maxTools: number): readonly McpToolManifest[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length > maxTools) throw new ManifestError('MANIFEST_LIMIT_EXCEEDED', 'MCP tool list exceeds its limit.');
  const tools: McpToolManifest[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) throw new ManifestError('MANIFEST_INVALID', 'MCP tool descriptor is invalid.');
    assertKeys(item, ['id', 'version', 'summary', 'risk', 'inputSchema']);
    const id = identifierField(item, 'id');
    const version = versionField(item, 'version');
    const keyValue = manifestReference(id, version);
    if (seen.has(keyValue)) throw new ManifestError('MANIFEST_INVALID', 'MCP tool descriptor is duplicated.');
    seen.add(keyValue);
    const risk = item.risk;
    if (risk !== 'read' && risk !== 'write' && risk !== 'destructive' && risk !== 'network') throw new ManifestError('MANIFEST_INVALID', 'MCP tool risk is invalid.');
    const tool: McpToolManifest = {
      id,
      version,
      summary: stringField(item, 'summary', 4 * 1024),
      risk,
      ...(item.inputSchema === undefined ? {} : { inputSchema: schemaField(item.inputSchema) }),
    };
    tools.push(tool);
  }
  return tools;
}

function schemaField(value: unknown): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new ManifestError('MANIFEST_INVALID', 'MCP input schema must be an object.');
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 8 * 1024) throw new ManifestError('MANIFEST_LIMIT_EXCEEDED', 'MCP input schema exceeds its limit.');
  } catch (error) {
    if (error instanceof ManifestError) throw error;
    throw new ManifestError('MANIFEST_INVALID', 'MCP input schema is not serializable.');
  }
  return value;
}

function assertNoSecretLikeStrings(value: unknown): void {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) throw new ManifestError('MANIFEST_SECRET_FIELD', 'Manifest contains secret-shaped content.');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretLikeStrings(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new ManifestError('MANIFEST_SECRET_FIELD', 'Manifest contains a secret-shaped field.');
    assertNoSecretLikeStrings(child);
  }
}

function freezeSkillManifest(manifest: SkillManifest): SkillManifest {
  return Object.freeze({
    ...manifest,
    allowedTools: Object.freeze([...manifest.allowedTools]),
    allowedMcpServers: Object.freeze([...manifest.allowedMcpServers]),
    envAllowlist: Object.freeze([...manifest.envAllowlist]),
  });
}

function freezeMcpManifest(manifest: McpServerManifest): McpServerManifest {
  const tools = Object.freeze(manifest.tools.map((tool) => Object.freeze({ ...tool })));
  const envAllowlist = Object.freeze([...manifest.envAllowlist]);
  if (manifest.transport === 'stdio') return Object.freeze({ ...manifest, args: Object.freeze([...manifest.args]), tools, envAllowlist });
  return Object.freeze({ ...manifest, tools, envAllowlist });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new McpTransportError('MCP_MESSAGE_INVALID');
  return value;
}

function isValidRequest(value: unknown): value is McpJsonRpcRequest {
  return isRecord(value) && value.jsonrpc === '2.0' && typeof value.id === 'string' && value.id.length > 0 && typeof value.method === 'string' && value.method.length > 0;
}

function isValidResponse(value: unknown): value is McpJsonRpcResponse {
  if (!isRecord(value) || value.jsonrpc !== '2.0' || (typeof value.id !== 'string' && typeof value.id !== 'number')) return false;
  if (!('result' in value) && !('error' in value)) return false;
  if ('error' in value && value.error !== undefined) {
    if (!isRecord(value.error) || typeof value.error.code !== 'number' || !Number.isSafeInteger(value.error.code) || typeof value.error.message !== 'string') return false;
  }
  return true;
}

function safeTransportMessage(code: McpTransportErrorCode): string {
  const messages: Record<McpTransportErrorCode, string> = {
    MCP_SERVER_NOT_ALLOWED: 'The MCP server is not allowlisted.',
    MCP_TOOL_NOT_ALLOWED: 'The MCP tool is not allowlisted.',
    MCP_ENV_NOT_ALLOWED: 'The MCP environment is not allowlisted.',
    MCP_MESSAGE_TOO_LARGE: 'The MCP message exceeds its byte limit.',
    MCP_MESSAGE_INVALID: 'The MCP message is invalid.',
    MCP_RESPONSE_ID_MISMATCH: 'The MCP response id did not match the request.',
    MCP_REMOTE_ERROR: 'The MCP server returned an error.',
    MCP_TIMEOUT: 'The MCP request timed out.',
    MCP_ABORTED: 'The MCP request was cancelled.',
    MCP_CHANNEL_UNAVAILABLE: 'The MCP transport is unavailable.',
  };
  return messages[code];
}
