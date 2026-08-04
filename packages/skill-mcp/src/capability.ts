import { createHash } from 'node:crypto';
import {
  IntegrationAllowlist,
  type McpServerManifest,
  type McpToolManifest,
  type ToolRisk,
} from './index.js';

export const MCP_CAPABILITY_ADVERTISEMENT_SCHEMA_VERSION = 'mcp-capability-advertisement/v1' as const;
export const MCP_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION = 'mcp-capability/v1' as const;
export const MCP_CAPABILITY_SNAPSHOT_SCHEMA_VERSION = 'mcp-capability-snapshot/v1' as const;

export type McpCapabilityKind = 'tool' | 'resource' | 'prompt';
export type McpCapabilityHealthState = 'failed' | 'healthy-connectivity-only' | 'healthy-verified';
export type McpCapabilitySandboxMode = 'none' | 'workspace-read' | 'workspace-write' | 'external-sandbox';
export type McpCapabilityNetworkAccess = 'disabled' | 'enabled';
export type McpCapabilityApprovalMode = 'none' | 'ask' | 'always';

export type McpCapabilityErrorCode =
  | 'MCP_CAPABILITY_INVALID'
  | 'MCP_CAPABILITY_LIMIT_EXCEEDED'
  | 'MCP_CAPABILITY_SCHEMA_INVALID'
  | 'MCP_CAPABILITY_PROTOCOL_UNSUPPORTED'
  | 'MCP_CAPABILITY_SERVER_NOT_ALLOWED'
  | 'MCP_CAPABILITY_NOT_DECLARED'
  | 'MCP_CAPABILITY_NOT_ALLOWED'
  | 'MCP_CAPABILITY_DUPLICATE'
  | 'MCP_CAPABILITY_REVISION_CONFLICT'
  | 'MCP_CAPABILITY_HEALTH_STALE'
  | 'MCP_CAPABILITY_HEALTH_UNVERIFIED'
  | 'MCP_CAPABILITY_HEALTH_FAILED'
  | 'MCP_CAPABILITY_RISK_MISMATCH'
  | 'MCP_CAPABILITY_NETWORK_FORBIDDEN'
  | 'MCP_CAPABILITY_SECRET_FIELD'
  | 'MCP_CAPABILITY_ABSOLUTE_PATH';

export class McpCapabilityError extends Error {
  constructor(readonly code: McpCapabilityErrorCode, message = capabilityMessage(code)) {
    super(message);
    this.name = 'McpCapabilityError';
  }
}

export interface McpCapabilityHealthObservation {
  readonly state: McpCapabilityHealthState;
  readonly checkId: number;
  readonly errorCode?: string;
}

export interface McpAdvertisedTool {
  readonly name: string;
  readonly version?: string;
  readonly revision?: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  /** Optional echo of the manifest risk; a mismatch is never trusted. */
  readonly risk?: ToolRisk;
}

export interface McpAdvertisedResource {
  readonly name: string;
  readonly version?: string;
  readonly revision?: string;
  readonly description?: string;
  readonly mimeType?: string;
}

export interface McpAdvertisedPrompt {
  readonly name: string;
  readonly version?: string;
  readonly revision?: string;
  readonly description?: string;
}

export interface McpCapabilityAdvertisement {
  readonly schemaVersion: typeof MCP_CAPABILITY_ADVERTISEMENT_SCHEMA_VERSION;
  readonly protocolVersion: string;
  readonly health: McpCapabilityHealthObservation;
  readonly tools?: readonly McpAdvertisedTool[];
  readonly resources?: readonly McpAdvertisedResource[];
  readonly prompts?: readonly McpAdvertisedPrompt[];
}

export interface McpCapabilityPolicy {
  readonly supportedProtocolVersions?: readonly string[];
  readonly maxCapabilities?: number;
  readonly maxSummaryBytes?: number;
  readonly maxSchemaBytes?: number;
  readonly sandboxMode?: McpCapabilitySandboxMode;
  readonly networkAccess?: McpCapabilityNetworkAccess;
  readonly approvalMode?: McpCapabilityApprovalMode;
  readonly allowedSandboxModes?: readonly McpCapabilitySandboxMode[];
}

export interface McpCapabilityDescriptor {
  readonly schemaVersion: typeof MCP_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION;
  readonly source: 'mcp';
  readonly serverId: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
  readonly kind: McpCapabilityKind;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly revision: string;
  readonly qualifiedName: string;
  readonly summary: string;
  readonly risk: ToolRisk;
  readonly sandboxMode: McpCapabilitySandboxMode;
  readonly networkAccess: McpCapabilityNetworkAccess;
  readonly approvalMode: McpCapabilityApprovalMode;
  readonly executable: boolean;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly mimeType?: string;
}

export interface McpCapabilitySnapshot {
  readonly schemaVersion: typeof MCP_CAPABILITY_SNAPSHOT_SCHEMA_VERSION;
  readonly serverId: string;
  readonly serverVersion: string;
  readonly protocolVersion: string;
  readonly health: 'healthy-verified';
  readonly healthCheckId: number;
  readonly capabilities: readonly McpCapabilityDescriptor[];
  readonly fingerprint: string;
}

export interface McpCapabilityRegistryOptions {
  readonly allowlist?: IntegrationAllowlist;
  readonly policy?: McpCapabilityPolicy;
}

const DEFAULT_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2024-11-05']);
const DEFAULT_MAX_CAPABILITIES = 128;
const DEFAULT_MAX_SUMMARY_BYTES = 4 * 1024;
const DEFAULT_MAX_SCHEMA_BYTES = 8 * 1024;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const VERSION = /^\d+\.\d+\.\d+$/u;
const CONTROL = /[\u0000-\u001F\u007F]/u;
const SECRET_KEY = /(?:^|[_-])(api[_-]?key|access[_-]?token|token|password|secret|private[_-]?key)(?:$|[_-])/iu;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const POSIX_ABSOLUTE_PATH = /^\/(?:[A-Za-z0-9._-]+[\\/]|$)/u;

type ResolvedCapabilityPolicy = Required<Pick<McpCapabilityPolicy, 'supportedProtocolVersions' | 'maxCapabilities' | 'maxSummaryBytes' | 'maxSchemaBytes' | 'sandboxMode' | 'networkAccess' | 'approvalMode' | 'allowedSandboxModes'>>;

/**
 * Pure, in-memory capability projection. It never opens a transport or
 * registers the application's executable ToolRegistry.
 */
export class McpCapabilityRegistry {
  private readonly allowlist: IntegrationAllowlist;
  private readonly policy: ResolvedCapabilityPolicy;
  private readonly current = new Map<string, McpCapabilitySnapshot>();
  private readonly health = new Map<string, McpCapabilityHealthObservation>();

  constructor(options: McpCapabilityRegistryOptions = {}) {
    this.allowlist = options.allowlist ?? new IntegrationAllowlist();
    this.policy = {
      supportedProtocolVersions: Object.freeze([...(options.policy?.supportedProtocolVersions ?? DEFAULT_PROTOCOL_VERSIONS)]),
      maxCapabilities: positiveLimit(options.policy?.maxCapabilities, DEFAULT_MAX_CAPABILITIES),
      maxSummaryBytes: positiveLimit(options.policy?.maxSummaryBytes, DEFAULT_MAX_SUMMARY_BYTES),
      maxSchemaBytes: positiveLimit(options.policy?.maxSchemaBytes, DEFAULT_MAX_SCHEMA_BYTES),
      sandboxMode: options.policy?.sandboxMode ?? 'none',
      networkAccess: options.policy?.networkAccess ?? 'disabled',
      approvalMode: options.policy?.approvalMode ?? 'ask',
      allowedSandboxModes: Object.freeze([...(options.policy?.allowedSandboxModes ?? ['none', 'workspace-read', 'workspace-write', 'external-sandbox'])]),
    };
    if (this.policy.supportedProtocolVersions.length === 0 || this.policy.allowedSandboxModes.length === 0) {
      throw new McpCapabilityError('MCP_CAPABILITY_INVALID');
    }
  }

  register(manifest: McpServerManifest, advertisement: McpCapabilityAdvertisement): McpCapabilitySnapshot {
    if (!this.allowlist.allowsMcpServer(manifest)) throw new McpCapabilityError('MCP_CAPABILITY_SERVER_NOT_ALLOWED');
    validateAdvertisement(advertisement);
    if (!this.policy.supportedProtocolVersions.includes(advertisement.protocolVersion)) {
      throw new McpCapabilityError('MCP_CAPABILITY_PROTOCOL_UNSUPPORTED');
    }
    const previousHealth = this.health.get(manifest.id);
    if (previousHealth && advertisement.health.checkId < previousHealth.checkId) {
      throw new McpCapabilityError('MCP_CAPABILITY_HEALTH_STALE');
    }
    this.health.set(manifest.id, freezeHealth(advertisement.health));
    if (advertisement.health.state === 'failed') throw new McpCapabilityError('MCP_CAPABILITY_HEALTH_FAILED');
    if (advertisement.health.state !== 'healthy-verified') throw new McpCapabilityError('MCP_CAPABILITY_HEALTH_UNVERIFIED');

    const descriptors = buildDescriptors(manifest, advertisement, this.allowlist, this.policy);
    const snapshot = makeSnapshot(manifest, advertisement, descriptors);
    const existing = this.current.get(manifest.id);
    if (existing) {
      if (existing.serverVersion !== snapshot.serverVersion || !sameRevisions(existing.capabilities, snapshot.capabilities)) {
        throw new McpCapabilityError('MCP_CAPABILITY_REVISION_CONFLICT');
      }
      if (existing.fingerprint === snapshot.fingerprint) return existing;
      this.current.set(manifest.id, snapshot);
      return snapshot;
    }
    this.current.set(manifest.id, snapshot);
    return snapshot;
  }

  /** Explicit name for callers that treat this as a projection operation. */
  project(manifest: McpServerManifest, advertisement: McpCapabilityAdvertisement): McpCapabilitySnapshot {
    return this.register(manifest, advertisement);
  }

  snapshot(serverId: string): McpCapabilitySnapshot | undefined {
    return this.current.get(serverId);
  }

  captureRunSnapshot(serverId: string): McpCapabilitySnapshot {
    const snapshot = this.current.get(serverId);
    if (!snapshot) throw new McpCapabilityError('MCP_CAPABILITY_SERVER_NOT_ALLOWED');
    return cloneSnapshot(snapshot);
  }

  healthObservation(serverId: string): McpCapabilityHealthObservation | undefined {
    const observation = this.health.get(serverId);
    return observation ? { ...observation } : undefined;
  }
}

function validateAdvertisement(advertisement: McpCapabilityAdvertisement): void {
  if (!isRecord(advertisement) || advertisement.schemaVersion !== MCP_CAPABILITY_ADVERTISEMENT_SCHEMA_VERSION) {
    throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  }
  assertKnownKeys(advertisement, ['schemaVersion', 'protocolVersion', 'health', 'tools', 'resources', 'prompts']);
  boundedText(advertisement.protocolVersion, 128);
  if (!isRecord(advertisement.health) || !Number.isSafeInteger(advertisement.health.checkId) || advertisement.health.checkId <= 0 || !isHealthState(advertisement.health.state)) {
    throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  }
  if (advertisement.health.errorCode !== undefined) boundedText(advertisement.health.errorCode, 128);
  validateList(advertisement.tools, 128, 'tool');
  validateList(advertisement.resources, 128, 'resource');
  validateList(advertisement.prompts, 128, 'prompt');
}

function buildDescriptors(
  manifest: McpServerManifest,
  advertisement: McpCapabilityAdvertisement,
  allowlist: IntegrationAllowlist,
  policy: ResolvedCapabilityPolicy,
): readonly McpCapabilityDescriptor[] {
  const entries: McpCapabilityDescriptor[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const add = (descriptor: McpCapabilityDescriptor): void => {
    const nameKey = `${descriptor.serverId}/${descriptor.kind}/${descriptor.id}`;
    if (seenNames.has(nameKey)) throw new McpCapabilityError('MCP_CAPABILITY_DUPLICATE');
    seenNames.add(nameKey);
    if (seen.has(descriptor.qualifiedName)) throw new McpCapabilityError('MCP_CAPABILITY_DUPLICATE');
    seen.add(descriptor.qualifiedName);
    entries.push(descriptor);
    if (entries.length > policy.maxCapabilities) throw new McpCapabilityError('MCP_CAPABILITY_LIMIT_EXCEEDED');
  };
  for (const tool of advertisement.tools ?? []) add(projectTool(manifest, tool, allowlist, policy));
  for (const resource of advertisement.resources ?? []) add(projectReadOnly(manifest, 'resource', resource, allowlist, policy));
  for (const prompt of advertisement.prompts ?? []) add(projectReadOnly(manifest, 'prompt', prompt, allowlist, policy));
  if (entries.length === 0) throw new McpCapabilityError('MCP_CAPABILITY_INVALID');
  return Object.freeze(entries);
}

function projectTool(manifest: McpServerManifest, advertised: McpAdvertisedTool, allowlist: IntegrationAllowlist, policy: ResolvedCapabilityPolicy): McpCapabilityDescriptor {
  const version = capabilityVersion(advertised);
  const declared = manifest.tools.find((tool) => tool.id === advertised.name && tool.version === version);
  if (!declared) throw new McpCapabilityError('MCP_CAPABILITY_NOT_DECLARED');
  if (!allowlist.publicTools(manifest).some((tool) => tool.id === declared.id && tool.version === declared.version)) {
    throw new McpCapabilityError('MCP_CAPABILITY_NOT_ALLOWED');
  }
  if (advertised.risk !== undefined && advertised.risk !== declared.risk) throw new McpCapabilityError('MCP_CAPABILITY_RISK_MISMATCH');
  const summary = safeSummary(advertised.description ?? declared.summary, policy.maxSummaryBytes);
  const inputSchema = validateSchema(advertised.inputSchema ?? declared.inputSchema, policy.maxSchemaBytes);
  const outputSchema = advertised.outputSchema === undefined ? undefined : validateSchema(advertised.outputSchema, policy.maxSchemaBytes);
  return makeDescriptor(manifest, 'tool', advertised.name, version, summary, declared.risk, policy, {
    inputSchema,
    ...(outputSchema === undefined ? {} : { outputSchema }),
  });
}

function projectReadOnly(
  manifest: McpServerManifest,
  kind: 'resource' | 'prompt',
  advertised: McpAdvertisedResource | McpAdvertisedPrompt,
  allowlist: IntegrationAllowlist,
  policy: ResolvedCapabilityPolicy,
): McpCapabilityDescriptor {
  const version = capabilityVersion(advertised);
  const reference = mcpCapabilityReference(manifest.id, kind, advertised.name, version);
  if (!allowlist.allowsMcpCapability(reference)) throw new McpCapabilityError('MCP_CAPABILITY_NOT_ALLOWED');
  const summary = safeSummary(advertised.description ?? `${kind} ${advertised.name}`, policy.maxSummaryBytes);
  const extra = kind === 'resource' && 'mimeType' in advertised && advertised.mimeType !== undefined
    ? { mimeType: safeSummary(advertised.mimeType, 256) }
    : {};
  return makeDescriptor(manifest, kind, advertised.name, version, summary, 'read', policy, { executable: false, ...extra });
}

function makeDescriptor(
  manifest: McpServerManifest,
  kind: McpCapabilityKind,
  name: string,
  version: string,
  summary: string,
  risk: ToolRisk,
  policy: ResolvedCapabilityPolicy,
  extras: Partial<Pick<McpCapabilityDescriptor, 'inputSchema' | 'outputSchema' | 'mimeType' | 'executable'>> = {},
): McpCapabilityDescriptor {
  identifier(name);
  const sandboxMode = extras.executable === false ? 'workspace-read' : policy.sandboxMode === 'none' ? defaultSandbox(risk) : policy.sandboxMode;
  if (!policy.allowedSandboxModes.includes(sandboxMode)) throw new McpCapabilityError('MCP_CAPABILITY_INVALID');
  const networkAccess = risk === 'network' ? 'enabled' : policy.networkAccess;
  if (risk === 'network' && (manifest.network !== 'enabled' || policy.networkAccess !== 'enabled')) throw new McpCapabilityError('MCP_CAPABILITY_NETWORK_FORBIDDEN');
  const approvalMode = extras.executable === false ? 'none' : minimumApproval(risk, policy.approvalMode);
  const descriptor: McpCapabilityDescriptor = {
    schemaVersion: MCP_CAPABILITY_DESCRIPTOR_SCHEMA_VERSION,
    source: 'mcp',
    serverId: manifest.id,
    serverVersion: manifest.version,
    protocolVersion: '',
    kind,
    id: name,
    name,
    version,
    revision: version,
    qualifiedName: mcpCapabilityReference(manifest.id, kind, name, version),
    summary,
    risk,
    sandboxMode,
    networkAccess,
    approvalMode,
    executable: extras.executable ?? true,
    ...(extras.inputSchema === undefined ? {} : { inputSchema: extras.inputSchema }),
    ...(extras.outputSchema === undefined ? {} : { outputSchema: extras.outputSchema }),
    ...(extras.mimeType === undefined ? {} : { mimeType: extras.mimeType }),
  };
  return descriptor;
}

function makeSnapshot(manifest: McpServerManifest, advertisement: McpCapabilityAdvertisement, descriptors: readonly McpCapabilityDescriptor[]): McpCapabilitySnapshot {
  const withProtocol = descriptors.map((descriptor) => Object.freeze({ ...descriptor, protocolVersion: advertisement.protocolVersion }));
  const body = {
    schemaVersion: MCP_CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
    serverId: manifest.id,
    serverVersion: manifest.version,
    protocolVersion: advertisement.protocolVersion,
    health: 'healthy-verified' as const,
    healthCheckId: advertisement.health.checkId,
    capabilities: withProtocol,
  };
  const fingerprint = sha256(canonicalJson(body));
  return deepFreeze({ ...body, capabilities: Object.freeze(withProtocol), fingerprint });
}

function cloneSnapshot(snapshot: McpCapabilitySnapshot): McpCapabilitySnapshot {
  return deepFreeze(JSON.parse(JSON.stringify(snapshot)) as McpCapabilitySnapshot);
}

function sameRevisions(left: readonly McpCapabilityDescriptor[], right: readonly McpCapabilityDescriptor[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((descriptor, index) => descriptor.qualifiedName === right[index]?.qualifiedName && descriptor.revision === right[index]?.revision);
}

function capabilityVersion(value: { readonly version?: string; readonly revision?: string }): string {
  if (value.version !== undefined && value.revision !== undefined && value.version !== value.revision) throw new McpCapabilityError('MCP_CAPABILITY_REVISION_CONFLICT');
  const result = value.revision ?? value.version;
  if (typeof result !== 'string' || !result || !VERSION.test(result)) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  return result;
}

function validateList(value: readonly unknown[] | undefined, max: number, kind: McpCapabilityKind): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > max) throw new McpCapabilityError('MCP_CAPABILITY_LIMIT_EXCEEDED');
  value.forEach((entry) => {
    if (!isRecord(entry)) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
    const keys = kind === 'tool' ? ['name', 'version', 'revision', 'description', 'inputSchema', 'outputSchema', 'risk']
      : kind === 'resource' ? ['name', 'version', 'revision', 'description', 'mimeType']
        : ['name', 'version', 'revision', 'description'];
    assertKnownKeys(entry, keys);
    if (typeof entry.name !== 'string') throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
    identifier(entry.name);
    if (entry.version !== undefined) {
      const revision = entry.revision as string | undefined;
      capabilityVersion(revision === undefined ? { version: entry.version as string } : { version: entry.version as string, revision });
    }
    else if (entry.revision !== undefined) capabilityVersion({ revision: entry.revision as string });
    if (entry.description !== undefined) safeSummary(entry.description as string, DEFAULT_MAX_SUMMARY_BYTES);
    if (kind === 'tool' && entry.risk !== undefined && !isRisk(entry.risk)) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
    if (kind === 'resource' && entry.mimeType !== undefined) safeSummary(entry.mimeType as string, 256);
  });
}

function validateSchema(value: unknown, maxBytes: number): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  if (typeof value.type !== 'string' || !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(value.type)) {
    throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  }
  assertSafeValue(value, maxBytes);
  return deepFreeze({ ...value });
}

function safeSummary(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || CONTROL.test(value) || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new McpCapabilityError(value && typeof value === 'string' && Buffer.byteLength(value, 'utf8') > maxBytes ? 'MCP_CAPABILITY_LIMIT_EXCEEDED' : 'MCP_CAPABILITY_SCHEMA_INVALID');
  }
  assertSafeString(value);
  return value;
}

function boundedText(value: unknown, maxBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || CONTROL.test(value) || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  }
  assertSafeString(value);
  return value;
}

function assertSafeValue(value: unknown, maxBytes: number): void {
  let encoded: string;
  try { encoded = canonicalJson(value); } catch { throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID'); }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new McpCapabilityError('MCP_CAPABILITY_LIMIT_EXCEEDED');
  const visit = (entry: unknown): void => {
    if (typeof entry === 'string') { assertSafeString(entry); return; }
    if (Array.isArray(entry)) { entry.forEach(visit); return; }
    if (!isRecord(entry)) return;
    Object.entries(entry).forEach(([key, child]) => {
      if (SECRET_KEY.test(key)) throw new McpCapabilityError('MCP_CAPABILITY_SECRET_FIELD');
      visit(key);
      visit(child);
    });
  };
  visit(value);
}

function assertSafeString(value: string): void {
  if (SECRET_VALUE.test(value)) throw new McpCapabilityError('MCP_CAPABILITY_SECRET_FIELD');
  if (WINDOWS_ABSOLUTE_PATH.test(value) || POSIX_ABSOLUTE_PATH.test(value)) throw new McpCapabilityError('MCP_CAPABILITY_ABSOLUTE_PATH');
}

function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
}

function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
}

function isRisk(value: unknown): value is ToolRisk {
  return value === 'read' || value === 'write' || value === 'destructive' || value === 'network';
}

function isHealthState(value: unknown): value is McpCapabilityHealthState {
  return value === 'failed' || value === 'healthy-connectivity-only' || value === 'healthy-verified';
}

function defaultSandbox(risk: ToolRisk): McpCapabilitySandboxMode {
  if (risk === 'read') return 'workspace-read';
  if (risk === 'write') return 'workspace-write';
  return 'external-sandbox';
}

function minimumApproval(risk: ToolRisk, configured: McpCapabilityApprovalMode): McpCapabilityApprovalMode {
  if (risk === 'read') return configured === 'always' ? 'always' : 'none';
  if (configured === 'always') return 'always';
  return 'ask';
}

export function mcpCapabilityReference(serverId: string, kind: McpCapabilityKind, id: string, version: string): string {
  identifier(serverId);
  identifier(id);
  if (!VERSION.test(version)) throw new McpCapabilityError('MCP_CAPABILITY_SCHEMA_INVALID');
  return `${serverId}/${kind}/${id}@${version}`;
}

function freezeHealth(observation: McpCapabilityHealthObservation): McpCapabilityHealthObservation {
  return Object.freeze({ ...observation });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  throw new Error('non-json value');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new McpCapabilityError('MCP_CAPABILITY_LIMIT_EXCEEDED');
  return value;
}

function capabilityMessage(code: McpCapabilityErrorCode): string {
  const messages: Record<McpCapabilityErrorCode, string> = {
    MCP_CAPABILITY_INVALID: 'The MCP capability advertisement is invalid.',
    MCP_CAPABILITY_LIMIT_EXCEEDED: 'The MCP capability exceeds its bound.',
    MCP_CAPABILITY_SCHEMA_INVALID: 'The MCP capability schema is invalid.',
    MCP_CAPABILITY_PROTOCOL_UNSUPPORTED: 'The MCP protocol version is unsupported.',
    MCP_CAPABILITY_SERVER_NOT_ALLOWED: 'The MCP server is not allowlisted.',
    MCP_CAPABILITY_NOT_DECLARED: 'The MCP capability is not declared by the manifest.',
    MCP_CAPABILITY_NOT_ALLOWED: 'The MCP capability is not allowlisted.',
    MCP_CAPABILITY_DUPLICATE: 'The MCP capability revision is duplicated.',
    MCP_CAPABILITY_REVISION_CONFLICT: 'The MCP capability revision conflicts with the current snapshot.',
    MCP_CAPABILITY_HEALTH_STALE: 'The MCP capability health observation is stale.',
    MCP_CAPABILITY_HEALTH_UNVERIFIED: 'The MCP capability health is not verified.',
    MCP_CAPABILITY_HEALTH_FAILED: 'The MCP capability health check failed.',
    MCP_CAPABILITY_RISK_MISMATCH: 'The MCP capability risk does not match its manifest.',
    MCP_CAPABILITY_NETWORK_FORBIDDEN: 'The MCP capability requires forbidden network access.',
    MCP_CAPABILITY_SECRET_FIELD: 'The MCP capability contains secret-shaped content.',
    MCP_CAPABILITY_ABSOLUTE_PATH: 'The MCP capability contains an absolute path.',
  };
  return messages[code];
}
