import {
  IntegrationAllowlist,
  McpCapabilityError,
  McpCapabilityRegistry,
  McpProtocolSession,
  McpProtocolToolCallPort,
  McpTransportError,
  type McpCapabilityAdvertisement,
  type McpCapabilitySnapshot,
  type McpChannelFactory,
  type McpServerManifest,
} from './index.js';

export interface McpSessionActivationRequest {
  readonly serverId: string;
  readonly serverVersion: string;
  readonly manifestRevision: string;
  /** R3 settings references use server/tool/name@version. */
  readonly capabilityAllowlist: readonly string[];
}

export interface McpTransportActivationCandidate {
  readonly manifestRevision: string;
  readonly currentRevision: string;
  readonly previousRevision: string | null;
  readonly snapshot: McpCapabilitySnapshot;
  readonly callPort: McpProtocolToolCallPort;
  readonly close: () => Promise<void>;
}

export interface McpSessionActivationProviderOptions {
  readonly manifest: McpServerManifest;
  readonly channelFactory: McpChannelFactory;
  readonly env?: Readonly<Record<string, string>>;
  readonly maxMessageBytes?: number;
  readonly timeoutMs?: number;
  readonly clientInfo?: { readonly name?: string; readonly version?: string };
}

export type McpActivationErrorCode = 'MCP_ACTIVATION_IDENTITY';

export class McpActivationError extends Error {
  constructor(readonly code: McpActivationErrorCode, message = 'The MCP activation identity is invalid.') {
    super(message);
    this.name = 'McpActivationError';
  }
}

/**
 * Public-protocol activation provider. It owns only an injected manifest,
 * channel factory and optional runtime env; it has no daemon startup side
 * effect and returns a session that the application may explicitly bind.
 */
export class McpSessionActivationProvider {
  private readonly manifest: McpServerManifest;
  private readonly channelFactory: McpChannelFactory;
  private readonly env: Readonly<Record<string, string>>;
  private readonly maxMessageBytes: number | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly clientInfo: { readonly name?: string; readonly version?: string } | undefined;
  private checkId = 0;

  constructor(options: McpSessionActivationProviderOptions) {
    this.manifest = options.manifest;
    this.channelFactory = options.channelFactory;
    this.env = Object.freeze({ ...(options.env ?? {}) });
    this.maxMessageBytes = options.maxMessageBytes;
    this.timeoutMs = options.timeoutMs;
    this.clientInfo = options.clientInfo;
  }

  async activate(request: McpSessionActivationRequest, signal: AbortSignal): Promise<McpTransportActivationCandidate> {
    if (request.serverId !== this.manifest.id || request.serverVersion !== this.manifest.version) {
      throw new McpActivationError('MCP_ACTIVATION_IDENTITY');
    }
    const allowlist = createAllowlist(this.manifest, request.capabilityAllowlist);
    const session = new McpProtocolSession({
      manifest: this.manifest,
      channelFactory: this.channelFactory,
      env: this.env,
      ...(this.maxMessageBytes === undefined ? {} : { maxMessageBytes: this.maxMessageBytes }),
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      ...(this.clientInfo === undefined ? {} : { clientInfo: this.clientInfo }),
    });
    try {
      const initialized = await session.initialize(signal);
      const listed = await session.request('tools/list', undefined, signal);
      const advertisement = toAdvertisement(listed, this.manifest, initialized.protocolVersion, ++this.checkId);
      const snapshot = new McpCapabilityRegistry({ allowlist }).register(this.manifest, advertisement);
      const callPort = new McpProtocolToolCallPort(session);
      return {
        manifestRevision: request.manifestRevision,
        currentRevision: snapshot.fingerprint,
        previousRevision: null,
        snapshot,
        callPort,
        close: () => session.close(),
      };
    } catch (error) {
      await session.close().catch(() => undefined);
      if (error instanceof McpTransportError || error instanceof McpCapabilityError || error instanceof McpActivationError) throw error;
      throw new McpTransportError('MCP_CHANNEL_UNAVAILABLE');
    }
  }
}

function createAllowlist(manifest: McpServerManifest, references: readonly string[]): IntegrationAllowlist {
  const serverReference = `${manifest.id}@${manifest.version}`;
  const toolReferences = references
    .filter((reference) => reference.startsWith(`${manifest.id}/tool/`))
    .map((reference) => reference.replace(`${manifest.id}/tool/`, `${manifest.id}/`));
  const capabilityReferences = references.filter((reference) => reference.startsWith(`${manifest.id}/`));
  return new IntegrationAllowlist({
    mcpServers: [serverReference],
    mcpTools: toolReferences,
    mcpCapabilities: capabilityReferences,
  });
}

function toAdvertisement(value: unknown, manifest: McpServerManifest, protocolVersion: string, checkId: number): McpCapabilityAdvertisement {
  if (!isRecord(value) || !Array.isArray(value.tools) || value.tools.length === 0 || value.tools.length > 128) {
    throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  }
  const tools = value.tools.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.length === 0 || entry.name.length > 128) {
      throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
    }
    const description = entry.description;
    const inputSchema = entry.inputSchema;
    const outputSchema = entry.outputSchema;
    const declared = manifest.tools.find((tool) => tool.id === entry.name);
    return {
      name: entry.name,
      version: declared?.version ?? '0.0.0',
      ...(typeof description === 'string' ? { description } : {}),
      ...(isRecord(inputSchema) ? { inputSchema } : {}),
      ...(isRecord(outputSchema) ? { outputSchema } : {}),
    };
  });
  return {
    schemaVersion: 'mcp-capability-advertisement/v1',
    protocolVersion,
    health: { state: 'healthy-verified', checkId },
    tools,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
