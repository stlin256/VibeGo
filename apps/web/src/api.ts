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

export interface StoredEvent {
  version: 1;
  id: string;
  seq: number;
  runId: string;
  type: string;
  at: string;
  payload: unknown;
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

  async certificateStatus(): Promise<CertificateStatus> {
    return this.request<CertificateStatus>('/api/v1/certificates/status', { method: 'GET' });
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
