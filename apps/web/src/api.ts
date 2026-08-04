import type { AgentMemoryKnowledgeSettingsPatch, AgentMemoryKnowledgeSettingsStatus as AgentMemoryKnowledgeSettingsStatusContract, AgentMemoryMode, AgentMemoryOperations, AgentMemorySettingsPatch, AgentMemorySettingsStatus as AgentMemorySettingsStatusContract, DeploymentReadiness, GoalProjection as GoalProjectionContract, GoalTodo, McpSettingsPatch, McpSettingsStatus as McpSettingsStatusContract, ModelProbeResult as ModelProbeResultContract, ObservabilityAuditResponse, ObservabilityOperationResponse, ObservabilityPricingResponse, ObservabilityRunUsage, ObservabilityTimeseries, ObservabilityUsageSummary } from '@ready4vibe/contracts';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  transport: { kind: string; tlsRequired: boolean; boundAddresses: readonly string[] };
  auth: { pairingRequired: boolean };
  storage: { kind: string; status: string };
  sandbox: { availableModes: readonly string[]; externalRequiredForUntrusted: boolean };
  approval: { supportedDecisions: readonly string[] };
}

export interface RunConfigInput {
  workspaceId: string;
  userMessage: string;
  model: { provider: string; name: string };
  taskTrust: 'trusted-workspace' | 'untrusted-content';
  sandbox: { mode: 'read-only' | 'workspace-write' | 'external-sandbox' | 'danger-full-access'; network?: 'restricted' | 'enabled'; writableRoots?: string[]; provider?: 'docker' | 'podman' | 'vm'; enabledBy?: 'explicit-user-only' };
  approval: 'untrusted' | 'on-request' | 'never' | { granular: { sandboxApproval: boolean; ruleApproval: boolean; skillApproval: boolean; permissionRequest: boolean; mcpElicitation: boolean } };
  limits: { maxTurns: number; maxWallTimeMs: number; maxModelInputTokens: number; maxModelOutputTokens: number; maxToolCalls: number; maxOutputBytes: number; maxContextBytes: number };
  createdBySessionId: string;
  clientRequestId: string;
}

export type RunProfile = Pick<RunConfigInput, 'workspaceId' | 'model' | 'taskTrust' | 'sandbox' | 'approval' | 'limits'>;
export type DeploymentReadinessStatus = DeploymentReadiness;

export const DEFAULT_RUN_PROFILE: RunProfile = {
  workspaceId: 'default',
  model: { provider: 'configured-default', name: 'deepseek-v4-flash' },
  taskTrust: 'trusted-workspace',
  sandbox: { mode: 'read-only', network: 'restricted' },
  approval: 'on-request',
  limits: {
    maxTurns: 12,
    maxWallTimeMs: 600_000,
    maxModelInputTokens: 8_000,
    maxModelOutputTokens: 4_000,
    maxToolCalls: 50,
    maxOutputBytes: 2_000_000,
    maxContextBytes: 64_000,
  },
};

export const RUN_PROFILE_STORAGE_KEY = 'vibego.run-profile.v1';
export interface RunProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadRunProfile(storage: RunProfileStorage | undefined = browserStorage()): RunProfile {
  if (!storage) return DEFAULT_RUN_PROFILE;
  try {
    const raw = storage.getItem(RUN_PROFILE_STORAGE_KEY);
    if (!raw || raw.length > 32 * 1024) return DEFAULT_RUN_PROFILE;
    const parsed: unknown = JSON.parse(raw);
    return parseRunProfile(parsed) ?? DEFAULT_RUN_PROFILE;
  } catch {
    return DEFAULT_RUN_PROFILE;
  }
}

export function saveRunProfile(profile: RunProfile, storage: RunProfileStorage | undefined = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(RUN_PROFILE_STORAGE_KEY, JSON.stringify(parseRunProfile(profile) ?? DEFAULT_RUN_PROFILE));
  } catch {
    // Disabled or full browser storage must never block a run.
  }
}

export function resetRunProfile(storage: RunProfileStorage | undefined = browserStorage()): void {
  try { storage?.removeItem(RUN_PROFILE_STORAGE_KEY); } catch { /* best effort */ }
}

function parseRunProfile(value: unknown): RunProfile | undefined {
  if (!isRecord(value)) return undefined;
  try {
    if (JSON.stringify(value).match(/api[_-]?key|access[_-]?token|csrf|private[_-]?key|pem|secret/iu)) return undefined;
  } catch { return undefined; }
  if (typeof value.workspaceId !== 'string' || value.workspaceId.length === 0 || value.workspaceId.length > 256) return undefined;
  if (!isRecord(value.model) || typeof value.model.provider !== 'string' || value.model.provider.length === 0 || value.model.provider.length > 128 || typeof value.model.name !== 'string' || value.model.name.length === 0 || value.model.name.length > 128) return undefined;
  if (value.taskTrust !== 'trusted-workspace' && value.taskTrust !== 'untrusted-content') return undefined;
  if (!isSandboxProfile(value.sandbox) || !isApprovalProfile(value.approval) || !isLimitsProfile(value.limits)) return undefined;
  return {
    workspaceId: value.workspaceId,
    model: { provider: value.model.provider, name: value.model.name },
    taskTrust: value.taskTrust,
    sandbox: value.sandbox,
    approval: value.approval,
    limits: value.limits,
  };
}

function isSandboxProfile(value: unknown): value is RunProfile['sandbox'] {
  if (!isRecord(value) || (value.mode !== 'read-only' && value.mode !== 'workspace-write' && value.mode !== 'external-sandbox')) return false;
  if (value.network !== 'restricted' && value.network !== 'enabled') return false;
  if (value.mode === 'workspace-write' && (!Array.isArray(value.writableRoots) || value.writableRoots.length === 0 || value.writableRoots.length > 32 || value.writableRoots.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 512))) return false;
  if (value.mode === 'external-sandbox' && value.provider !== 'docker' && value.provider !== 'podman' && value.provider !== 'vm') return false;
  if (value.mode === 'external-sandbox' && value.writableRoots !== undefined && (!Array.isArray(value.writableRoots) || value.writableRoots.length > 32 || value.writableRoots.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 512))) return false;
  return true;
}

function isApprovalProfile(value: unknown): value is RunProfile['approval'] {
  if (value === 'untrusted' || value === 'on-request' || value === 'never') return true;
  if (!isRecord(value) || !isRecord(value.granular)) return false;
  return ['sandboxApproval', 'ruleApproval', 'skillApproval', 'permissionRequest', 'mcpElicitation'].every((key) => typeof value.granular[key] === 'boolean');
}

function isLimitsProfile(value: unknown): value is RunProfile['limits'] {
  if (!isRecord(value)) return false;
  const keys = ['maxTurns', 'maxWallTimeMs', 'maxModelInputTokens', 'maxModelOutputTokens', 'maxToolCalls', 'maxOutputBytes', 'maxContextBytes'] as const;
  if (!keys.every((key) => typeof value[key] === 'number' && Number.isSafeInteger(value[key]) && value[key] > 0)) return false;
  return value.maxTurns <= 50 && value.maxWallTimeMs <= 1_800_000 && value.maxToolCalls <= 200 && value.maxOutputBytes <= 50 * 1024 * 1024;
}

function browserStorage(): RunProfileStorage | undefined {
  try { return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage; } catch { return undefined; }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface RunSnapshot {
  version: 1;
  runId: string;
  status: string;
  config: RunConfigInput;
  lastEventSeq: number;
  output: string;
  approvals?: readonly ApprovalSummary[];
  final?: { summary: string; exitReason: string };
  scheduler: { queuePosition: number | null; activeRunCount: number; workspaceLease: string | null };
}

export interface ApprovalSummary {
  approvalId: string;
  runId: string;
  turnId: string;
  callId: string;
  toolId: string;
  toolVersion: string;
  risk: 'read' | 'write' | 'destructive' | 'network';
  argumentBytes: number;
  details?: { sandboxProvider?: 'docker' | 'podman' | 'vm'; sandboxImageDigest?: string; network?: 'restricted' | 'enabled' };
  createdAt: number;
  expiresAt: number;
}

export interface CertificateStatus {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  fingerprint256: string;
  subjectAltNames: readonly string[];
}

export interface ModelSettingsStatus {
  configured: boolean;
  providerId: string;
  baseUrl: string | null;
  modelName: string | null;
  source: 'environment' | 'web-memory' | 'unconfigured';
}

export interface ModelSettingsInput {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ModelProbeResult = ModelProbeResultContract;

export interface ToolSettingsStatus {
  filesystemEnabled: boolean;
  workspaceLabel: string;
  availableTools: readonly string[];
}

export interface GitSettingsStatus {
  enabled: boolean;
  workspaceLabel: string;
  availableTools: readonly string[];
}

export interface WorkspaceStatus {
  id: string;
  label: string;
  isDefault: boolean;
  canRemove: boolean;
  capabilities: { filesystem: true; externalSandbox: true };
}

export interface WorkspaceRegistryStatus {
  workspaces: readonly WorkspaceStatus[];
}

export interface SandboxResourceSettings {
  maxMemoryBytes: number;
  maxCpuMillis: number;
  maxPids: number;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface SandboxSettingsStatus {
  provider: 'docker' | 'podman' | null;
  detected: boolean;
  healthy: boolean;
  enabled: boolean;
  imageDigest: string | null;
  network: 'restricted' | 'enabled';
  resources: SandboxResourceSettings;
  capabilities: { version: string; networkModes: readonly ('restricted' | 'enabled')[]; maxMemoryBytes: number; maxCpuMillis: number } | null;
}

export type AgentMemorySettingsStatus = AgentMemorySettingsStatusContract;
export type AgentMemorySettingsMode = AgentMemoryMode;
export type AgentMemorySettingsPatchInput = AgentMemorySettingsPatch;
export type AgentMemoryOperationsStatus = AgentMemoryOperations;
export type AgentMemoryKnowledgeSettingsStatus = AgentMemoryKnowledgeSettingsStatusContract;
export type AgentMemoryKnowledgeSettingsPatchInput = AgentMemoryKnowledgeSettingsPatch;
export type McpSettingsStatus = McpSettingsStatusContract;
export type McpSettingsPatchInput = McpSettingsPatch;

export type UsageSummary = ObservabilityUsageSummary;
export type UsageTimeseries = ObservabilityTimeseries;
export type RunUsage = ObservabilityRunUsage;
export type AuditEventsResponse = ObservabilityAuditResponse;
export type PricingResponse = ObservabilityPricingResponse;
export type ObservabilityOperation = ObservabilityOperationResponse;

export interface StoredEvent {
  version: 1;
  id: string;
  seq: number;
  runId: string;
  type: string;
  at: string;
  payload: unknown;
}

/**
 * The daemon deliberately removes the internal claim hash before this type is
 * exposed to the browser. Keep this projection type local to the API boundary
 * so a future Goal write API cannot accidentally reuse it as an input.
 */
export type SafeGoalTodo = Omit<GoalTodo, 'claimTokenHash'>;
export type SafeGoalProjection = Omit<GoalProjectionContract, 'todos'> & { todos: readonly SafeGoalTodo[] };

export const GOAL_API_SCHEMA_VERSION = 'ready4vibe_goal_api_v0' as const;

export interface GoalProjectionListResponse {
  readonly schemaVersion: typeof GOAL_API_SCHEMA_VERSION;
  readonly goals: readonly SafeGoalProjection[];
}

export interface PairingResult {
  accessToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message = 'Request failed.') {
    super(message);
    this.name = 'ApiError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiClient {
  private session: PairingResult | undefined;
  private readonly fetcher: FetchLike;
  private readonly baseUrl: string;

  constructor(baseUrl = '', fetcher: FetchLike = (input, init) => fetch(input, init)) {
    this.baseUrl = baseUrl.replace(/\/$/u, '');
    this.fetcher = fetcher;
  }

  hasSession(): boolean {
    return this.session !== undefined;
  }

  clearSession(): void {
    this.session = undefined;
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health', { method: 'GET' }, false);
  }

  async listGoals(): Promise<GoalProjectionListResponse> {
    return this.request<GoalProjectionListResponse>('/api/v1/goals', { method: 'GET' });
  }

  async usageSummary(range: '24h' | '7d' | '30d' = '24h'): Promise<UsageSummary> {
    return this.request<UsageSummary>(`/api/v1/usage/summary?range=${encodeURIComponent(range)}`, { method: 'GET' });
  }

  async usageTimeseries(metric: 'cpu' | 'memory' | 'disk' | 'tokens' | 'cost', range: '24h' | '7d' | '30d' = '24h'): Promise<UsageTimeseries> {
    return this.request<UsageTimeseries>(`/api/v1/usage/timeseries?metric=${encodeURIComponent(metric)}&range=${encodeURIComponent(range)}`, { method: 'GET' });
  }

  async runUsage(runId: string): Promise<RunUsage> {
    return this.request<RunUsage>(`/api/v1/runs/${encodeURIComponent(runId)}/usage`, { method: 'GET' });
  }

  async auditEvents(after = 0, filters: { action?: string; outcome?: string } = {}): Promise<AuditEventsResponse> {
    const query = new URLSearchParams({ after: String(after) });
    if (filters.action) query.set('action', filters.action);
    if (filters.outcome) query.set('outcome', filters.outcome);
    return this.request<AuditEventsResponse>(`/api/v1/audit/events?${query.toString()}`, { method: 'GET' });
  }

  async pricing(): Promise<PricingResponse> {
    return this.request<PricingResponse>('/api/v1/usage/pricing', { method: 'GET' });
  }

  async rebuildUsage(): Promise<ObservabilityOperation> {
    return this.request<ObservabilityOperation>('/api/v1/usage/rebuild', { method: 'POST' });
  }

  async verifyAudit(): Promise<ObservabilityOperation> {
    return this.request<ObservabilityOperation>('/api/v1/audit/verify', { method: 'POST' });
  }

  async certificateStatus(): Promise<CertificateStatus> {
    return this.request<CertificateStatus>('/api/v1/certificates/status', { method: 'GET' });
  }

  async deploymentReadiness(): Promise<DeploymentReadinessStatus> {
    return this.request<DeploymentReadinessStatus>('/api/v1/deployment/readiness', { method: 'GET' });
  }

  async modelSettings(): Promise<ModelSettingsStatus> {
    return this.request<ModelSettingsStatus>('/api/v1/settings/model', { method: 'GET' });
  }

  async configureModel(input: ModelSettingsInput): Promise<ModelSettingsStatus> {
    return this.request<ModelSettingsStatus>('/api/v1/settings/model', { method: 'POST', body: JSON.stringify(input) });
  }

  async clearModelSettings(): Promise<ModelSettingsStatus> {
    return this.request<ModelSettingsStatus>('/api/v1/settings/model', { method: 'DELETE' });
  }

  async probeModel(endpoint: string, timeoutMs = 5_000): Promise<ModelProbeResult> {
    return this.request<ModelProbeResult>('/api/v1/settings/model/probe', { method: 'POST', body: JSON.stringify({ endpoint, timeoutMs }) });
  }

  async agentMemorySettings(): Promise<AgentMemorySettingsStatus> {
    return this.request<AgentMemorySettingsStatus>('/api/v1/settings/agent-memory', { method: 'GET' });
  }

  async patchAgentMemorySettings(input: AgentMemorySettingsPatchInput): Promise<AgentMemorySettingsStatus> {
    return this.request<AgentMemorySettingsStatus>('/api/v1/settings/agent-memory', { method: 'PATCH', body: JSON.stringify(input) });
  }

  async probeAgentMemory(): Promise<AgentMemorySettingsStatus> {
    return this.request<AgentMemorySettingsStatus>('/api/v1/settings/agent-memory/probe', { method: 'POST' });
  }

  async updateAgentMemory(): Promise<AgentMemorySettingsStatus> {
    return this.request<AgentMemorySettingsStatus>('/api/v1/settings/agent-memory/update', { method: 'POST' });
  }

  async rollbackAgentMemory(): Promise<AgentMemorySettingsStatus> {
    return this.request<AgentMemorySettingsStatus>('/api/v1/settings/agent-memory/rollback', { method: 'POST' });
  }

  async agentMemoryOperations(): Promise<AgentMemoryOperationsStatus> {
    return this.request<AgentMemoryOperationsStatus>('/api/v1/settings/agent-memory/updates', { method: 'GET' });
  }

  async agentMemoryKnowledgeSettings(): Promise<AgentMemoryKnowledgeSettingsStatus> {
    return this.request<AgentMemoryKnowledgeSettingsStatus>('/api/v1/settings/agent-memory/knowledge', { method: 'GET' });
  }

  async patchAgentMemoryKnowledgeSettings(input: AgentMemoryKnowledgeSettingsPatchInput): Promise<AgentMemoryKnowledgeSettingsStatus> {
    return this.request<AgentMemoryKnowledgeSettingsStatus>('/api/v1/settings/agent-memory/knowledge', { method: 'PATCH', body: JSON.stringify(input) });
  }

  async probeAgentMemoryKnowledge(): Promise<AgentMemoryKnowledgeSettingsStatus> {
    return this.request<AgentMemoryKnowledgeSettingsStatus>('/api/v1/settings/agent-memory/knowledge/probe', { method: 'POST' });
  }

  async mcpSettings(): Promise<McpSettingsStatus> {
    return this.request<McpSettingsStatus>('/api/v1/settings/mcp', { method: 'GET' });
  }

  async patchMcpSettings(input: McpSettingsPatchInput): Promise<McpSettingsStatus> {
    return this.request<McpSettingsStatus>('/api/v1/settings/mcp', { method: 'PATCH', body: JSON.stringify(input) });
  }

  async probeMcp(): Promise<McpSettingsStatus> {
    return this.request<McpSettingsStatus>('/api/v1/settings/mcp/probe', { method: 'POST' });
  }

  async toolSettings(): Promise<ToolSettingsStatus> {
    return this.request<ToolSettingsStatus>('/api/v1/settings/tools', { method: 'GET' });
  }

  async setFilesystemToolsEnabled(filesystemEnabled: boolean): Promise<ToolSettingsStatus> {
    return this.request<ToolSettingsStatus>('/api/v1/settings/tools', { method: 'POST', body: JSON.stringify({ filesystemEnabled }) });
  }

  async gitSettings(): Promise<GitSettingsStatus> {
    return this.request<GitSettingsStatus>('/api/v1/settings/git', { method: 'GET' });
  }

  async setGitToolsEnabled(enabled: boolean): Promise<GitSettingsStatus> {
    return this.request<GitSettingsStatus>('/api/v1/settings/git', { method: 'POST', body: JSON.stringify({ enabled }) });
  }

  async workspaces(): Promise<WorkspaceRegistryStatus> {
    return this.request<WorkspaceRegistryStatus>('/api/v1/workspaces', { method: 'GET' });
  }

  async addWorkspace(input: { id: string; path: string; label?: string }): Promise<WorkspaceRegistryStatus> {
    return this.request<WorkspaceRegistryStatus>('/api/v1/workspaces', { method: 'POST', body: JSON.stringify({ ...input, confirmation: 'add-workspace' }) });
  }

  async removeWorkspace(id: string): Promise<WorkspaceRegistryStatus> {
    return this.request<WorkspaceRegistryStatus>(`/api/v1/workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async sandboxSettings(): Promise<SandboxSettingsStatus> {
    return this.request<SandboxSettingsStatus>('/api/v1/settings/sandbox', { method: 'GET' });
  }

  async probeSandbox(provider: 'docker' | 'podman'): Promise<SandboxSettingsStatus> {
    return this.request<SandboxSettingsStatus>('/api/v1/settings/sandbox/probe', { method: 'POST', body: JSON.stringify({ provider }) });
  }

  async setSandboxSettings(input: { provider: 'docker' | 'podman'; imageDigest: string; network: 'restricted' | 'enabled'; resources: Partial<SandboxResourceSettings>; enabled: boolean }): Promise<SandboxSettingsStatus> {
    return this.request<SandboxSettingsStatus>('/api/v1/settings/sandbox', { method: 'POST', body: JSON.stringify(input) });
  }

  async completePairing(code: string): Promise<PairingResult> {
    const result = await this.request<PairingResult>('/api/v1/pairing/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    }, false);
    this.session = result;
    return result;
  }

  async createRun(config: RunConfigInput): Promise<{ runId: string; status: string }> {
    return this.request('/api/v1/runs', { method: 'POST', body: JSON.stringify(config) });
  }

  async getRun(runId: string): Promise<RunSnapshot> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}`, { method: 'GET' });
  }

  async cancel(runId: string): Promise<{ runId: string; status: string }> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
  }

  async approveRun(runId: string, approvalId: string, decision: 'allow' | 'deny'): Promise<{ runId: string; approvalId: string; status: string }> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvalId, decision }),
    });
  }

  async retryRun(runId: string): Promise<{ runId: string; status: string; retryOf: string }> {
    return this.request(`/api/v1/runs/${encodeURIComponent(runId)}/retry`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'retry-as-new-run' }),
    });
  }

  async *streamEvents(runId: string, after = 0, signal?: AbortSignal): AsyncGenerator<StoredEvent> {
    const headers = this.authHeaders({ Accept: 'text/event-stream' });
    headers['Last-Event-ID'] = String(after);
    const streamInit: RequestInit = { method: 'GET', headers };
    if (signal) streamInit.signal = signal;
    const response = await this.fetcher(`${this.baseUrl}/api/v1/runs/${encodeURIComponent(runId)}/events?after=${after}`, streamInit);
    if (!response.ok) throw await this.toApiError(response);
    if (!response.body) throw new ApiError(response.status, 'STREAM_EMPTY', 'Event stream is unavailable.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastSeq = after;
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const event = parseSseFrame(frame);
        if (event && event.seq > lastSeq) {
          lastSeq = event.seq;
          yield event;
          if (isTerminalEvent(event.type)) return;
        }
        boundary = buffer.indexOf('\n\n');
      }
      if (chunk.done) break;
    }
  }

  private async request<T>(path: string, init: RequestInit, authenticated = true): Promise<T> {
    const initialHeaders: Record<string, string> = { Accept: 'application/json' };
    if (init.headers instanceof Headers) init.headers.forEach((value, key) => { initialHeaders[key] = value; });
    else if (Array.isArray(init.headers)) for (const [key, value] of init.headers) initialHeaders[key] = value;
    else if (init.headers) Object.assign(initialHeaders, init.headers);
    const headers = this.authHeaders(initialHeaders);
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) throw await this.toApiError(response);
    return await response.json() as T;
  }

  private authHeaders(initial: Record<string, string>): Record<string, string> {
    if (!this.session) {
      if (initial.Accept === 'application/json' || initial.Accept === 'text/event-stream') {
        return initial;
      }
      return initial;
    }
    const headers: Record<string, string> = { ...initial, Authorization: `Bearer ${this.session.accessToken}` };
    if (initial.Accept !== 'text/event-stream') headers['X-CSRF-Token'] = this.session.csrfToken;
    return headers;
  }

  private async toApiError(response: Response): Promise<ApiError> {
    try {
      const body = await response.json() as { error?: { code?: string; message?: string } };
      return new ApiError(response.status, body.error?.code ?? 'HTTP_ERROR', body.error?.message ?? 'Request failed.');
    } catch {
      return new ApiError(response.status, 'HTTP_ERROR');
    }
  }
}

export function parseSseFrame(frame: string): StoredEvent | undefined {
  let id: string | undefined;
  let eventType: string | undefined;
  let data = '';
  for (const line of frame.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('id:')) id = line.slice(3).trim();
    else if (line.startsWith('event:')) eventType = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  if (!id || !data) return undefined;
  const seq = Number(id);
  if (!Number.isSafeInteger(seq) || seq < 0) return undefined;
  try {
    const value = JSON.parse(data) as StoredEvent;
    if (value.seq !== seq || typeof value.runId !== 'string' || typeof value.type !== 'string') return undefined;
    return { ...value, ...(eventType ? { type: eventType } : {}) };
  } catch {
    return undefined;
  }
}

function isTerminalEvent(type: string): boolean {
  return type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled' || type === 'run.needs_recovery';
}
