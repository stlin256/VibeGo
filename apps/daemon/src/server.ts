import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { StoredEvent } from '@ready4vibe/contracts';
import { AuthGate, AuthGateError, type AuthFailureCode, type AuthRequest, type TransportMode } from '@ready4vibe/auth';
import type { CertificateStatus } from '@ready4vibe/certificates';
import { ModelSettingsError, type ModelSettingsInput, type ModelSettingsManager } from './model-config.js';
import { RunManager } from './run-manager.js';
import { SandboxSettingsError, type SandboxSettingsInput, type SandboxSettingsManager } from './sandbox-settings.js';
import { ToolSettingsError, type ToolSettingsManager } from './tool-settings.js';

export type LoopbackHost = '127.0.0.1' | '::1';
export type LanHost = '0.0.0.0' | '::';
export type DaemonHost = LoopbackHost | LanHost;
export type StorageKind = 'sqlite' | 'memory';

export interface DaemonTlsOptions {
  cert: Buffer;
  key: Buffer;
}

export interface DaemonServerOptions {
  host?: DaemonHost;
  transportMode?: TransportMode;
  authGate?: AuthGate;
  version?: string;
  storageKind?: StorageKind;
  storageStatus?: 'ready' | 'degraded';
  runManager?: RunManager;
  bodyLimitBytes?: number;
  tls?: DaemonTlsOptions;
  certificateStatus?: CertificateStatus;
  modelSettings?: ModelSettingsManager;
  toolSettings?: ToolSettingsManager;
  sandboxSettings?: SandboxSettingsManager;
}

interface ResolvedDaemonServerOptions {
  host: DaemonHost;
  transportMode: TransportMode;
  authGate?: AuthGate;
  version: string;
  storageKind: StorageKind;
  storageStatus: 'ready' | 'degraded';
  bodyLimitBytes: number;
  runManager?: RunManager;
  tls?: DaemonTlsOptions;
  certificateStatus?: CertificateStatus;
  modelSettings?: ModelSettingsManager;
  toolSettings?: ToolSettingsManager;
  sandboxSettings?: SandboxSettingsManager;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'ready4vibe-daemon';
  version: string;
  transport: {
    kind: 'http-loopback' | 'https-loopback' | 'http-lan' | 'https-lan' | 'http-tailscale' | 'https-tailscale' | 'ssh';
    tlsRequired: boolean;
    boundAddresses: readonly DaemonHost[];
  };
  auth: {
    pairingRequired: boolean;
  };
  storage: {
    kind: StorageKind;
    status: 'ready' | 'degraded';
  };
  sandbox: {
    availableModes: readonly ['read-only', 'workspace-write', 'external-sandbox'];
    externalRequiredForUntrusted: true;
  };
  approval: {
    supportedDecisions: readonly ['allow', 'prompt', 'forbidden'];
  };
}

const HEALTH_PATHS = new Set(['/health', '/api/v1/health']);
const TERMINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.needs_recovery']);

export function createDaemonServer(options: DaemonServerOptions = {}): Server {
  const host = options.host ?? '127.0.0.1';
  const transportMode = options.transportMode ?? (isLoopbackHost(host) ? 'loopback' : 'lan');
  const authGate = options.authGate ?? (transportMode === 'loopback' ? undefined : new AuthGate({ mode: transportMode }));
  const resolved: ResolvedDaemonServerOptions = {
    host,
    transportMode,
    ...(authGate ? { authGate } : {}),
    version: options.version ?? '0.1.0',
    storageKind: options.storageKind ?? 'memory',
    storageStatus: options.storageStatus ?? 'ready',
    bodyLimitBytes: options.bodyLimitBytes ?? 1024 * 1024,
    ...(options.runManager ? { runManager: options.runManager } : {}),
    ...(options.tls ? { tls: options.tls } : {}),
    ...(options.certificateStatus ? { certificateStatus: options.certificateStatus } : {}),
    ...(options.modelSettings ? { modelSettings: options.modelSettings } : {}),
    ...(options.toolSettings ? { toolSettings: options.toolSettings } : {}),
    ...(options.sandboxSettings ? { sandboxSettings: options.sandboxSettings } : {}),
  };

  const requestListener = (request: IncomingMessage, response: ServerResponse): void => {
    void handleRequest(request, response, resolved).catch((error: unknown) => {
      if (response.headersSent || response.writableEnded) return;
      if (error instanceof RequestError) {
        writeJson(response, error.statusCode, { error: { code: error.code, message: error.safeMessage } });
        return;
      }
      writeJson(response, 500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
    });
  };
  return options.tls ? createHttpsServer(options.tls, requestListener) : createServer(requestListener);
}

export function isLoopbackHost(value: string): value is LoopbackHost {
  return value === '127.0.0.1' || value === '::1';
}

export function isLanHost(value: string): value is LanHost {
  return value === '0.0.0.0' || value === '::';
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ResolvedDaemonServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://loopback.invalid');
  const pathname = url.pathname;
  if (HEALTH_PATHS.has(pathname)) {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    writeJson(response, 200, createHealthResponse(options));
    return;
  }

  const remoteAddress = request.socket.remoteAddress;
  const authorization = firstHeader(request.headers.authorization);
  const origin = firstHeader(request.headers.origin);
  const csrfToken = firstHeader(request.headers['x-csrf-token']);
  const authRequest: AuthRequest = {
    method: request.method ?? 'GET',
    path: request.url ?? '/',
    secure: (request.socket as { encrypted?: boolean }).encrypted === true,
    hasQueryToken: url.searchParams.has('token') || url.searchParams.has('access_token'),
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(authorization ? { authorization } : {}),
    ...(origin ? { origin } : {}),
    ...(csrfToken ? { csrfToken } : {}),
  };
  const authDecision = options.authGate?.authorize(authRequest);
  if (authDecision && !authDecision.allowed) {
    writeAuthError(response, authDecision.failureCode ?? 'AUTH_REQUIRED');
    return;
  }

  if (pathname === '/api/v1/pairing/start') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.authGate) {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
      return;
    }
    writeJson(response, 200, options.authGate.startPairing());
    return;
  }

  if (pathname === '/api/v1/pairing/complete') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.authGate) {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isPairingInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Pairing code is required.' } });
      return;
    }
    try {
      writeJson(response, 200, options.authGate.completePairing(input.code));
    } catch (error) {
      if (error instanceof AuthGateError) {
        writeJson(response, error.code === 'PAIRING_EXPIRED' ? 410 : 400, { error: { code: error.code, message: 'Pairing could not be completed.' } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/certificates/status') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.certificateStatus) {
      writeJson(response, 503, { error: { code: 'CERTIFICATE_STATUS_UNAVAILABLE', message: 'Certificate status is unavailable.' } });
      return;
    }
    writeJson(response, 200, options.certificateStatus);
    return;
  }

  if (pathname === '/api/v1/settings/model') {
    if (!options.modelSettings) {
      writeJson(response, 503, { error: { code: 'MODEL_SETTINGS_UNAVAILABLE', message: 'Model settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.modelSettings.status());
      return;
    }
    if (request.method === 'DELETE') {
      writeJson(response, 200, options.modelSettings.clear());
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET, POST, or DELETE required' } }, { Allow: 'GET, POST, DELETE' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isModelSettingsInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Provider, HTTPS base URL, model, and API key are required.' } });
      return;
    }
    try {
      writeJson(response, 200, options.modelSettings.configure(input));
    } catch (error) {
      if (error instanceof ModelSettingsError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/tools') {
    if (!options.toolSettings) {
      writeJson(response, 503, { error: { code: 'TOOL_SETTINGS_UNAVAILABLE', message: 'Tool settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.toolSettings.status());
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required' } }, { Allow: 'GET, POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isToolSettingsInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'filesystemEnabled boolean is required.' } });
      return;
    }
    try {
      writeJson(response, 200, options.toolSettings.setFilesystemEnabled(input.filesystemEnabled));
    } catch (error) {
      if (error instanceof ToolSettingsError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/sandbox') {
    if (!options.sandboxSettings) {
      writeJson(response, 503, { error: { code: 'SANDBOX_SETTINGS_UNAVAILABLE', message: 'Sandbox settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.sandboxSettings.status());
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required' } }, { Allow: 'GET, POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isSandboxSettingsInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Validated sandbox settings are required.' } });
      return;
    }
    try {
      writeJson(response, 200, await options.sandboxSettings.configure(input));
    } catch (error) {
      if (error instanceof SandboxSettingsError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/sandbox/probe') {
    if (!options.sandboxSettings) {
      writeJson(response, 503, { error: { code: 'SANDBOX_SETTINGS_UNAVAILABLE', message: 'Sandbox settings are unavailable.' } });
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isSandboxProbeInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Docker or Podman provider is required.' } });
      return;
    }
    try {
      writeJson(response, 200, await options.sandboxSettings.probe(input.provider));
    } catch (error) {
      if (error instanceof SandboxSettingsError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/runs') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.runManager) {
      writeJson(response, 503, { error: { code: 'RUNS_UNAVAILABLE', message: 'Run manager is not configured.' } });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    try {
      const started = await options.runManager.start(input);
      writeJson(response, 202, started);
    } catch (error) {
      if (isValidationError(error)) {
        writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'RunConfig validation failed.' } });
        return;
      }
      throw error;
    }
    return;
  }

  const runMatch = /^\/api\/v1\/runs\/([^/]+)(?:\/(events|approve|cancel|retry))?$/.exec(pathname);
  if (!runMatch) {
    writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
    return;
  }
  if (!options.runManager) {
    writeJson(response, 503, { error: { code: 'RUNS_UNAVAILABLE', message: 'Run manager is not configured.' } });
    return;
  }
  const runId = decodeRunId(runMatch[1]);
  const subresource = runMatch[2];
  if (subresource === 'events') {
    await handleSse(request, response, options.runManager, runId);
    return;
  }
  if (subresource === 'cancel') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    const outcome = await options.runManager.cancel(runId);
    if (outcome === 'not-found') {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'run not found' } });
      return;
    }
    writeJson(response, 202, { runId, status: outcome === 'accepted' ? 'cancelling' : 'terminal' });
    return;
  }
  if (subresource === 'approve') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isApprovalInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'approvalId and decision are required.' } });
      return;
    }
    const outcome = options.runManager.approve(runId, input.approvalId, input.decision);
    if (outcome === 'run-not-found') {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'approval request not found.' } });
      return;
    }
    if (outcome !== 'accepted') {
      writeJson(response, 409, { error: { code: 'CONFLICT', message: 'approval request is no longer pending.' } });
      return;
    }
    writeJson(response, 202, { runId, approvalId: input.approvalId, status: 'accepted' });
    return;
  }
  if (subresource === 'retry') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isRetryInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Explicit retry confirmation is required.' } });
      return;
    }
    const outcome = await options.runManager.retryRecovered(runId);
    if (outcome === 'not-found') {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'run not found' } });
      return;
    }
    if (outcome === 'not-recoverable') {
      writeJson(response, 409, { error: { code: 'RECOVERY_CONFIRMATION_REQUIRED', message: 'Only a recovered run can be retried.' } });
      return;
    }
    writeJson(response, 202, outcome);
    return;
  }
  if (request.method !== 'GET') {
    writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
    return;
  }
  const snapshot = await options.runManager.snapshot(runId);
  if (!snapshot) {
    writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'run not found' } });
    return;
  }
  writeJson(response, 200, snapshot);
}

function createHealthResponse(options: ResolvedDaemonServerOptions): HealthResponse {
  const authStatus = options.authGate?.status();
  return {
    status: options.storageStatus === 'ready' ? 'ok' : 'degraded',
    service: 'ready4vibe-daemon',
    version: options.version,
    transport: {
      kind: transportKind(options.transportMode, options.tls !== undefined),
      tlsRequired: authStatus?.tlsRequired ?? false,
      boundAddresses: [options.host],
    },
    auth: { pairingRequired: authStatus?.pairingRequired ?? false },
    storage: { kind: options.storageKind, status: options.storageStatus },
    sandbox: {
      availableModes: ['read-only', 'workspace-write', 'external-sandbox'],
      externalRequiredForUntrusted: true,
    },
    approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] },
  };
}

function transportKind(mode: TransportMode, tlsEnabled: boolean): HealthResponse['transport']['kind'] {
  if (mode === 'loopback') return tlsEnabled ? 'https-loopback' : 'http-loopback';
  if (mode === 'lan') return tlsEnabled ? 'https-lan' : 'http-lan';
  if (mode === 'tailscale') return tlsEnabled ? 'https-tailscale' : 'http-tailscale';
  return 'ssh';
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isPairingInput(value: unknown): value is { code: string } {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string' && value.code.length > 0 && value.code.length <= 64;
}

function isApprovalInput(value: unknown): value is { approvalId: string; decision: 'allow' | 'deny' } {
  return typeof value === 'object' && value !== null && 'approvalId' in value && typeof value.approvalId === 'string' && /^[A-Za-z0-9_-]{8,128}$/u.test(value.approvalId) && 'decision' in value && (value.decision === 'allow' || value.decision === 'deny');
}

function isRetryInput(value: unknown): value is { confirmation: 'retry-as-new-run' } {
  return typeof value === 'object' && value !== null && 'confirmation' in value && value.confirmation === 'retry-as-new-run';
}

function isModelSettingsInput(value: unknown): value is ModelSettingsInput {
  return typeof value === 'object' && value !== null
    && 'provider' in value && value.provider === 'openai-compatible'
    && 'baseUrl' in value && typeof value.baseUrl === 'string'
    && 'apiKey' in value && typeof value.apiKey === 'string'
    && 'model' in value && typeof value.model === 'string';
}

function isToolSettingsInput(value: unknown): value is { filesystemEnabled: boolean } {
  return typeof value === 'object' && value !== null && 'filesystemEnabled' in value && typeof value.filesystemEnabled === 'boolean';
}

function isSandboxProbeInput(value: unknown): value is { provider: 'docker' | 'podman' } {
  return typeof value === 'object' && value !== null && 'provider' in value && (value.provider === 'docker' || value.provider === 'podman');
}

function isSandboxSettingsInput(value: unknown): value is SandboxSettingsInput {
  if (typeof value !== 'object' || value === null || !('provider' in value) || (value.provider !== 'docker' && value.provider !== 'podman') || !('imageDigest' in value) || typeof value.imageDigest !== 'string' || !('network' in value) || (value.network !== 'restricted' && value.network !== 'enabled') || !('enabled' in value) || typeof value.enabled !== 'boolean') return false;
  if (!('resources' in value) || typeof value.resources !== 'object' || value.resources === null || Array.isArray(value.resources)) return false;
  return Object.values(value.resources).every((entry) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0);
}

function writeAuthError(response: ServerResponse, code: AuthFailureCode): void {
  const status = code === 'AUTH_REQUIRED' || code === 'INVALID_TOKEN' ? 401 : code === 'TLS_REQUIRED' ? 426 : 403;
  const body = { error: { code, message: 'Authentication or transport policy rejected the request.' } };
  if (status === 401) {
    writeJson(response, status, body, { 'WWW-Authenticate': 'Bearer' });
  } else {
    writeJson(response, status, body);
  }
}

async function handleSse(request: IncomingMessage, response: ServerResponse, manager: RunManager, runId: string): Promise<void> {
  if (request.method !== 'GET') {
    writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
    return;
  }
  const url = new URL(request.url ?? '/', 'http://loopback.invalid');
  const after = parseCursor(url.searchParams.get('after') ?? request.headers['last-event-id'] ?? null);
  let closed = false;
  let replayDone = false;
  let sentSeq = after;
  let pending: StoredEvent[] = [];
  let heartbeat: NodeJS.Timeout | undefined;
  let unsubscribe = (): void => undefined;

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
    if (!response.writableEnded) response.end();
  };
  const send = (event: StoredEvent): void => {
    if (closed || event.seq <= sentSeq || response.writableEnded) return;
    sentSeq = event.seq;
    const safeType = event.type.replace(/[\r\n]/g, '');
    response.write(`id: ${event.seq}\nevent: ${safeType}\ndata: ${JSON.stringify(event)}\n\n`);
    if (TERMINAL_EVENT_TYPES.has(event.type)) close();
  };
  const onEvent = (event: StoredEvent): void => {
    if (replayDone) send(event);
    else if (event.seq > sentSeq) pending.push(event);
  };
  unsubscribe = manager.subscribe(runId, onEvent);
  const snapshot = await manager.snapshot(runId);
  if (!snapshot) {
    unsubscribe();
    writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'run not found' } });
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Accel-Buffering': 'no',
  });
  request.once('close', close);
  const replay = await manager.readEvents(runId, after);
  for (const event of replay) send(event);
  replayDone = true;
  const queued = pending;
  pending = [];
  for (const event of queued.sort((a, b) => a.seq - b.seq)) send(event);
  if (closed) return;
  heartbeat = setInterval(() => {
    if (!closed && !response.writableEnded) response.write(': heartbeat\n\n');
  }, 15_000);
}

function parseCursor(value: string | string[] | null): number {
  if (value === null) return 0;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.trim() === '') return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new RequestError(400, 'INVALID_CURSOR', 'Invalid event cursor.');
  return parsed;
}

function decodeRunId(value: string | undefined): string {
  if (!value) throw new RequestError(400, 'INVALID_RUN_ID', 'Invalid run id.');
  try {
    const runId = decodeURIComponent(value);
    if (!/^run_[A-Za-z0-9_-]+$/.test(runId)) throw new Error('invalid');
    return runId;
  } catch {
    throw new RequestError(400, 'INVALID_RUN_ID', 'Invalid run id.');
  }
}

function readJson(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > limitBytes) {
        tooLarge = true;
        return;
      }
      chunks.push(buffer);
    });
    request.once('error', reject);
    request.once('end', () => {
      if (tooLarge) {
        reject(new RequestError(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new RequestError(400, 'INVALID_REQUEST', 'Request body must be valid JSON.'));
      }
    });
  });
}

function isValidationError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'issues' in error;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

class RequestError extends Error {
  constructor(readonly statusCode: number, readonly code: string, readonly safeMessage: string) {
    super(safeMessage);
    this.name = 'RequestError';
  }
}
