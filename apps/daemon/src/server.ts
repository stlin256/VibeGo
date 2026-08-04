import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { StoredEvent } from '@ready4vibe/contracts';
import { ObservabilityMetricSchema, ObservabilityRangeSchema, type AuditEvent, type DeploymentReadiness, type ObservabilityMetric, type ObservabilityRange } from '@ready4vibe/contracts';
import { AuthGate, AuthGateError, type AuthFailureCode, type AuthRequest, type TransportMode } from '@ready4vibe/auth';
import type { CertificateReadiness, CertificateStatus } from '@ready4vibe/certificates';
import { WorkspaceRegistryError, type WorkspaceRegistry } from '@ready4vibe/workspaces';
import { GoalProjectionError, GoalWriteError, GoalWriteService, type GoalMutationResult } from '@ready4vibe/goal-control';
import { buildAuditResponse, buildPricingResponse, buildRunUsage, buildUsageSummary, buildUsageTimeseries, verifyAuditChain } from '@ready4vibe/observability';
import type { ObservabilityLedger } from '@ready4vibe/storage';
import type { PricingCatalog } from '@ready4vibe/observability';
import { ModelSettingsError, type ModelSettingsInput, type ModelSettingsManager } from './model-config.js';
import { RunManager, RunManagerError } from './run-manager.js';
import { SandboxSettingsError, type SandboxSettingsInput, type SandboxSettingsManager } from './sandbox-settings.js';
import { ToolSettingsError, type ToolSettingsManager } from './tool-settings.js';
import { GitSettingsError, type GitSettingsManager } from './git-settings.js';
import { AgentMemorySettingsError, type AgentMemorySettingsManager } from './agent-memory-settings.js';
import { AgentMemoryKnowledgeSettingsError, type AgentMemoryKnowledgeSettingsManager } from './agent-memory-knowledge-settings.js';
import { McpSettingsError, type McpSettingsManager } from './mcp-settings.js';
import { DEFAULT_GOAL_EVENT_PAGE_SIZE, MAX_GOAL_EVENT_PAGE_SIZE, listGoalProjections, readGoalEventPage, readGoalProjection, redactGoalProjection, type GoalProjectionStore } from './goal-api.js';
import { serveStaticWeb } from './static-web.js';

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
  certificateReadiness?: CertificateReadiness;
  deploymentReadiness?: DeploymentReadiness;
  modelSettings?: ModelSettingsManager;
  toolSettings?: ToolSettingsManager;
  gitSettings?: GitSettingsManager;
  sandboxSettings?: SandboxSettingsManager;
  workspaceRegistry?: WorkspaceRegistry;
  goalEventStore?: GoalProjectionStore;
  goalWriteService?: GoalWriteService;
  agentMemorySettings?: AgentMemorySettingsManager;
  agentMemoryKnowledgeSettings?: AgentMemoryKnowledgeSettingsManager;
  mcpSettings?: McpSettingsManager;
  observabilityLedger?: ObservabilityLedger;
  pricingCatalog?: PricingCatalog;
  /** Absolute path to a built React/Vite dist directory; omitted in dev. */
  webDistDir?: string;
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
  certificateReadiness?: CertificateReadiness;
  deploymentReadiness?: DeploymentReadiness;
  modelSettings?: ModelSettingsManager;
  toolSettings?: ToolSettingsManager;
  gitSettings?: GitSettingsManager;
  sandboxSettings?: SandboxSettingsManager;
  workspaceRegistry?: WorkspaceRegistry;
  goalEventStore?: GoalProjectionStore;
  goalWriteService?: GoalWriteService;
  agentMemorySettings?: AgentMemorySettingsManager;
  agentMemoryKnowledgeSettings?: AgentMemoryKnowledgeSettingsManager;
  mcpSettings?: McpSettingsManager;
  observabilityLedger?: ObservabilityLedger;
  pricingCatalog?: PricingCatalog;
  webDistDir?: string;
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
    ...(options.certificateReadiness ? { certificateReadiness: options.certificateReadiness } : {}),
    ...(options.deploymentReadiness ? { deploymentReadiness: options.deploymentReadiness } : {}),
    ...(options.modelSettings ? { modelSettings: options.modelSettings } : {}),
    ...(options.toolSettings ? { toolSettings: options.toolSettings } : {}),
    ...(options.gitSettings ? { gitSettings: options.gitSettings } : {}),
    ...(options.sandboxSettings ? { sandboxSettings: options.sandboxSettings } : {}),
    ...(options.workspaceRegistry ? { workspaceRegistry: options.workspaceRegistry } : {}),
    ...(options.goalEventStore ? { goalEventStore: options.goalEventStore } : {}),
    ...(options.goalWriteService ? { goalWriteService: options.goalWriteService } : {}),
    ...(options.agentMemorySettings ? { agentMemorySettings: options.agentMemorySettings } : {}),
    ...(options.agentMemoryKnowledgeSettings ? { agentMemoryKnowledgeSettings: options.agentMemoryKnowledgeSettings } : {}),
    ...(options.mcpSettings ? { mcpSettings: options.mcpSettings } : {}),
    ...(options.observabilityLedger ? { observabilityLedger: options.observabilityLedger } : {}),
    ...(options.pricingCatalog ? { pricingCatalog: options.pricingCatalog } : {}),
    ...(options.webDistDir ? { webDistDir: options.webDistDir } : {}),
  };

  const requestListener = (request: IncomingMessage, response: ServerResponse): void => {
    void handleRequest(request, response, resolved).catch((error: unknown) => {
      if (response.headersSent || response.writableEnded) return;
      if (error instanceof RequestError) {
        writeJson(response, error.statusCode, { error: { code: error.code, message: error.safeMessage } });
        return;
      }
      if (error instanceof RunManagerError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof GoalProjectionError) {
        writeJson(response, 503, { error: { code: 'GOAL_PROJECTION_UNAVAILABLE', message: 'Goal projection is unavailable.' } });
        return;
      }
      if (error instanceof GoalWriteError) {
        writeJson(response, error.statusCode, { error: { code: error.code, message: error.safeMessage } });
        return;
      }
      if (error instanceof McpSettingsError) {
        const status = error.code === 'CORRUPT_SETTINGS' || error.code === 'PERSISTENCE_FAILED' ? 503 : 400;
        writeJson(response, status, { error: { code: error.code, message: error.message } });
        return;
      }
      const goalError = goalMutationError(error);
      if (goalError) {
        writeJson(response, goalError.statusCode, { error: { code: goalError.code, message: goalError.message } });
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

  if (await serveStaticWeb(request, response, options.webDistDir ? { rootDir: options.webDistDir } : undefined)) return;

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

  if (pathname === '/api/v1/certificates/readiness') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.certificateReadiness) {
      writeJson(response, 503, { error: { code: 'CERTIFICATE_READINESS_UNAVAILABLE', message: 'Certificate readiness is unavailable.' } });
      return;
    }
    writeJson(response, 200, options.certificateReadiness);
    return;
  }

  if (pathname === '/api/v1/deployment/readiness') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.deploymentReadiness) {
      writeJson(response, 503, { error: { code: 'DEPLOYMENT_READINESS_UNAVAILABLE', message: 'Deployment readiness is unavailable.' } });
      return;
    }
    writeJson(response, 200, options.deploymentReadiness);
    return;
  }

  if (pathname === '/api/v1/usage/summary') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.observabilityLedger) {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
      return;
    }
    const range = parseObservabilityRange(url.searchParams.get('range'));
    try {
      const [models, tools, samples] = await Promise.all([
        options.observabilityLedger.listModelUsage(),
        options.observabilityLedger.listToolUsage(),
        options.observabilityLedger.listResourceSamples(),
      ]);
      writeJson(response, 200, buildUsageSummary(models, tools, samples, range));
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_READ_FAILED', message: 'Observability projection is unavailable.' } });
    }
    return;
  }

  if (pathname === '/api/v1/usage/timeseries') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.observabilityLedger) {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
      return;
    }
    const range = parseObservabilityRange(url.searchParams.get('range'));
    const metric = parseObservabilityMetric(url.searchParams.get('metric'));
    try {
      const [models, samples] = await Promise.all([
        options.observabilityLedger.listModelUsage(),
        options.observabilityLedger.listResourceSamples(),
      ]);
      writeJson(response, 200, buildUsageTimeseries(models, samples, metric, range));
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_READ_FAILED', message: 'Observability projection is unavailable.' } });
    }
    return;
  }

  if (pathname === '/api/v1/usage/pricing') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.pricingCatalog) {
      writeJson(response, 200, {
        schemaVersion: 'ready4vibe_observability_api_v1', status: 'degraded', generatedAt: new Date().toISOString(), rules: [],
      });
      return;
    }
    try {
      writeJson(response, 200, buildPricingResponse(options.pricingCatalog.list()));
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_PRICING_UNAVAILABLE', message: 'Pricing projection is unavailable.' } });
    }
    return;
  }

  if (pathname === '/api/v1/usage/rebuild') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.observabilityLedger) {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
      return;
    }
    try {
      const rollups = await options.observabilityLedger.rebuildRollups();
      writeJson(response, 200, { schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: new Date().toISOString(), rollupsRebuilt: rollups.length });
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_REBUILD_FAILED', message: 'Usage rollup rebuild failed.' } });
    }
    return;
  }

  if (pathname === '/api/v1/audit/verify') {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.observabilityLedger) {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
      return;
    }
    try {
      const events = await options.observabilityLedger.listAuditEvents();
      const verified = verifyAuditEvents(events);
      writeJson(response, 200, { schemaVersion: 'ready4vibe_observability_api_v1', status: verified ? 'ready' : 'degraded', generatedAt: new Date().toISOString(), verified });
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_VERIFY_FAILED', message: 'Audit verification is unavailable.' } });
    }
    return;
  }

  if (pathname === '/api/v1/audit/events') {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.observabilityLedger) {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
      return;
    }
    const after = parseObservabilityAuditCursor(url.searchParams.get('after'));
    const action = parseObservabilityFilter(url.searchParams.get('action'));
    const outcome = parseObservabilityFilter(url.searchParams.get('outcome'));
    try {
      writeJson(response, 200, buildAuditResponse(await options.observabilityLedger.listAuditEvents(), after, {
        ...(action === undefined ? {} : { action }), ...(outcome === undefined ? {} : { outcome }),
      }));
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_READ_FAILED', message: 'Audit projection is unavailable.' } });
    }
    return;
  }

  if (pathname === '/api/v1/goals') {
    if (request.method === 'POST') {
      if (!options.goalWriteService) {
        writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
        return;
      }
      const result = await options.goalWriteService.createGoal(await readJson(request, options.bodyLimitBytes));
      writeJson(response, 201, safeGoalMutation(result));
      return;
    }
    if (!options.goalEventStore) {
      writeJson(response, 503, { error: { code: 'GOALS_UNAVAILABLE', message: 'Goal projection is unavailable.' } });
      return;
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    writeJson(response, 200, await listGoalProjections(options.goalEventStore));
    return;
  }

  const completeTodoMatch = /^\/api\/v1\/goals\/([^/]+)\/todos\/([^/]+)\/complete$/u.exec(pathname);
  if (completeTodoMatch) {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.goalWriteService) {
      writeJson(response, 503, { error: { code: 'GOAL_WRITES_UNAVAILABLE', message: 'Goal writes are unavailable.' } });
      return;
    }
    const result = await options.goalWriteService.completeTodo(decodeGoalId(completeTodoMatch[1]), decodeTodoId(completeTodoMatch[2]), await readJson(request, options.bodyLimitBytes));
    writeJson(response, 200, safeGoalMutation(result));
    return;
  }

  const resolveGateMatch = /^\/api\/v1\/goals\/([^/]+)\/gates\/([^/]+)\/resolve$/u.exec(pathname);
  if (resolveGateMatch) {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.goalWriteService) {
      writeJson(response, 503, { error: { code: 'GOAL_WRITES_UNAVAILABLE', message: 'Goal writes are unavailable.' } });
      return;
    }
    const result = await options.goalWriteService.resolveGate(decodeGoalId(resolveGateMatch[1]), decodeGateId(resolveGateMatch[2]), await readJson(request, options.bodyLimitBytes));
    writeJson(response, 200, safeGoalMutation(result));
    return;
  }

  const addTodoMatch = /^\/api\/v1\/goals\/([^/]+)\/todos$/u.exec(pathname);
  if (addTodoMatch) {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.goalWriteService) {
      writeJson(response, 503, { error: { code: 'GOAL_WRITES_UNAVAILABLE', message: 'Goal writes are unavailable.' } });
      return;
    }
    const result = await options.goalWriteService.addTodo(decodeGoalId(addTodoMatch[1]), await readJson(request, options.bodyLimitBytes));
    writeJson(response, 200, safeGoalMutation(result));
    return;
  }

  const openGateMatch = /^\/api\/v1\/goals\/([^/]+)\/gates$/u.exec(pathname);
  if (openGateMatch) {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.goalWriteService) {
      writeJson(response, 503, { error: { code: 'GOAL_WRITES_UNAVAILABLE', message: 'Goal writes are unavailable.' } });
      return;
    }
    const result = await options.goalWriteService.openGate(decodeGoalId(openGateMatch[1]), await readJson(request, options.bodyLimitBytes));
    writeJson(response, 200, safeGoalMutation(result));
    return;
  }

  const evidenceMatch = /^\/api\/v1\/goals\/([^/]+)\/evidence$/u.exec(pathname);
  if (evidenceMatch) {
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    if (!options.goalWriteService) {
      writeJson(response, 503, { error: { code: 'GOAL_WRITES_UNAVAILABLE', message: 'Goal writes are unavailable.' } });
      return;
    }
    const result = await options.goalWriteService.attachEvidence(decodeGoalId(evidenceMatch[1]), await readJson(request, options.bodyLimitBytes));
    writeJson(response, 200, safeGoalMutation(result));
    return;
  }

  const goalMatch = /^\/api\/v1\/goals\/([^/]+)(?:\/(events))?$/u.exec(pathname);
  if (goalMatch) {
    if (!options.goalEventStore) {
      writeJson(response, 503, { error: { code: 'GOALS_UNAVAILABLE', message: 'Goal projection is unavailable.' } });
      return;
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    const goalId = decodeGoalId(goalMatch[1]);
    if (goalMatch[2] === 'events') {
      const after = parseCursor(url.searchParams.get('after'));
      const limit = parseGoalEventLimit(url.searchParams.get('limit'));
      const page = await readGoalEventPage(options.goalEventStore, goalId, after, limit);
      if (!page) {
        writeJson(response, 404, { error: { code: 'GOAL_NOT_FOUND', message: 'goal not found' } });
        return;
      }
      writeJson(response, 200, page);
      return;
    }
    const projection = await readGoalProjection(options.goalEventStore, goalId);
    if (!projection) {
      writeJson(response, 404, { error: { code: 'GOAL_NOT_FOUND', message: 'goal not found' } });
      return;
    }
    writeJson(response, 200, projection);
    return;
  }

  if (pathname === '/api/v1/workspaces') {
    if (!options.workspaceRegistry) {
      writeJson(response, 503, { error: { code: 'WORKSPACES_UNAVAILABLE', message: 'Workspace registry is unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.workspaceRegistry.status());
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required' } }, { Allow: 'GET, POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isWorkspaceAddInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Workspace id, daemon path, and explicit confirmation are required.' } });
      return;
    }
    try {
      options.workspaceRegistry.add({ id: input.id, path: input.path, ...(input.label ? { label: input.label } : {}) });
      writeJson(response, 200, options.workspaceRegistry.status());
    } catch (error) {
      if (error instanceof WorkspaceRegistryError) {
        const status = error.code === 'PERSISTENCE_FAILED'
          ? 503
          : error.code === 'WORKSPACE_DUPLICATE' || error.code === 'WORKSPACE_PROTECTED' ? 409 : 400;
        writeJson(response, status, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  const workspaceDeleteMatch = /^\/api\/v1\/workspaces\/([^/]+)$/u.exec(pathname);
  if (workspaceDeleteMatch) {
    if (!options.workspaceRegistry) {
      writeJson(response, 503, { error: { code: 'WORKSPACES_UNAVAILABLE', message: 'Workspace registry is unavailable.' } });
      return;
    }
    if (request.method !== 'DELETE') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'DELETE required' } }, { Allow: 'DELETE' });
      return;
    }
    let workspaceId: string;
    try { workspaceId = decodeURIComponent(workspaceDeleteMatch[1] ?? ''); } catch { workspaceId = ''; }
    try {
      options.workspaceRegistry.remove(workspaceId);
      writeJson(response, 200, options.workspaceRegistry.status());
    } catch (error) {
      if (error instanceof WorkspaceRegistryError) {
        const status = error.code === 'PERSISTENCE_FAILED'
          ? 503
          : error.code === 'WORKSPACE_NOT_FOUND' || error.code === 'WORKSPACE_PROTECTED' ? 409 : 400;
        writeJson(response, status, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
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

  if (pathname === '/api/v1/settings/model/probe') {
    if (!options.modelSettings) {
      writeJson(response, 503, { error: { code: 'MODEL_SETTINGS_UNAVAILABLE', message: 'Model settings are unavailable.' } });
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isModelProbeInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'A complete model-list endpoint is required.' } });
      return;
    }
    try {
      writeJson(response, 200, await options.modelSettings.probe(input));
    } catch (error) {
      if (error instanceof ModelSettingsError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/agent-memory') {
    if (!options.agentMemorySettings) {
      writeJson(response, 503, { error: { code: 'AGENT_MEMORY_SETTINGS_UNAVAILABLE', message: 'Agent memory settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.agentMemorySettings.status());
      return;
    }
    if (request.method !== 'PATCH') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or PATCH required' } }, { Allow: 'GET, PATCH' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    try {
      writeJson(response, 200, options.agentMemorySettings.patch(input));
    } catch (error) {
      if (error instanceof AgentMemorySettingsError) {
        const status = error.code === 'CORRUPT_SETTINGS' || error.code === 'PERSISTENCE_FAILED' ? 503 : 400;
        writeJson(response, status, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/agent-memory/knowledge') {
    if (!options.agentMemoryKnowledgeSettings) {
      writeJson(response, 503, { error: { code: 'AGENT_MEMORY_KNOWLEDGE_SETTINGS_UNAVAILABLE', message: 'Agent memory knowledge settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.agentMemoryKnowledgeSettings.status());
      return;
    }
    if (request.method !== 'PATCH') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or PATCH required' } }, { Allow: 'GET, PATCH' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    try {
      writeJson(response, 200, options.agentMemoryKnowledgeSettings.patch(input));
    } catch (error) {
      if (error instanceof AgentMemoryKnowledgeSettingsError) {
        const status = error.code === 'CORRUPT_SETTINGS' || error.code === 'PERSISTENCE_FAILED' ? 503 : 400;
        writeJson(response, status, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/mcp') {
    if (!options.mcpSettings) {
      writeJson(response, 503, { error: { code: 'MCP_SETTINGS_UNAVAILABLE', message: 'MCP settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.mcpSettings.status());
      return;
    }
    if (request.method !== 'PATCH') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or PATCH required' } }, { Allow: 'GET, PATCH' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    try {
      writeJson(response, 200, options.mcpSettings.patch(input));
    } catch (error) {
      if (error instanceof McpSettingsError) {
        const status = error.code === 'CORRUPT_SETTINGS' || error.code === 'PERSISTENCE_FAILED' ? 503 : 400;
        writeJson(response, status, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  if (pathname === '/api/v1/settings/mcp/probe') {
    if (!options.mcpSettings) {
      writeJson(response, 503, { error: { code: 'MCP_SETTINGS_UNAVAILABLE', message: 'MCP settings are unavailable.' } });
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    writeJson(response, 200, await options.mcpSettings.probe());
    return;
  }

  if (pathname === '/api/v1/settings/agent-memory/knowledge/probe') {
    if (!options.agentMemoryKnowledgeSettings) {
      writeJson(response, 503, { error: { code: 'AGENT_MEMORY_KNOWLEDGE_SETTINGS_UNAVAILABLE', message: 'Agent memory knowledge settings are unavailable.' } });
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    writeJson(response, 200, await options.agentMemoryKnowledgeSettings.probe());
    return;
  }

  if (pathname === '/api/v1/settings/agent-memory/updates') {
    if (!options.agentMemorySettings) {
      writeJson(response, 503, { error: { code: 'AGENT_MEMORY_SETTINGS_UNAVAILABLE', message: 'Agent memory settings are unavailable.' } });
      return;
    }
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    writeJson(response, 200, options.agentMemorySettings.operations());
    return;
  }

  const agentMemoryAction = /^\/api\/v1\/settings\/agent-memory\/(probe|update|rollback|webhook)$/u.exec(pathname)?.[1];
  if (agentMemoryAction) {
    if (!options.agentMemorySettings) {
      writeJson(response, 503, { error: { code: 'AGENT_MEMORY_SETTINGS_UNAVAILABLE', message: 'Agent memory settings are unavailable.' } });
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required' } }, { Allow: 'POST' });
      return;
    }
    const result = agentMemoryAction === 'probe'
      ? await options.agentMemorySettings.probe()
      : agentMemoryAction === 'update' ? await options.agentMemorySettings.update()
        : agentMemoryAction === 'webhook' ? await options.agentMemorySettings.enqueueUpdate()
          : await options.agentMemorySettings.rollback();
    writeJson(response, 200, result);
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

  if (pathname === '/api/v1/settings/git') {
    if (!options.gitSettings) {
      writeJson(response, 503, { error: { code: 'GIT_SETTINGS_UNAVAILABLE', message: 'Git settings are unavailable.' } });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 200, options.gitSettings.status());
      return;
    }
    if (request.method !== 'POST') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET or POST required' } }, { Allow: 'GET, POST' });
      return;
    }
    const input = await readJson(request, options.bodyLimitBytes);
    if (!isGitSettingsInput(input)) {
      writeJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'enabled boolean is required.' } });
      return;
    }
    try {
      writeJson(response, 200, options.gitSettings.setGitEnabled(input.enabled));
    } catch (error) {
      if (error instanceof GitSettingsError) {
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
      if (error instanceof ModelSettingsError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      if (error instanceof RunManagerError) {
        writeJson(response, 400, { error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
    return;
  }

  const runUsageMatch = /^\/api\/v1\/runs\/([^/]+)\/usage$/u.exec(pathname);
  if (runUsageMatch) {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    if (!options.observabilityLedger) {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_UNAVAILABLE', message: 'Observability ledger is unavailable.' } });
      return;
    }
    const runId = decodeRunId(runUsageMatch[1]);
    try {
      const [models, tools] = await Promise.all([
        options.observabilityLedger.listModelUsage(),
        options.observabilityLedger.listToolUsage(),
      ]);
      writeJson(response, 200, buildRunUsage(runId, models, tools));
    } catch {
      writeJson(response, 503, { error: { code: 'OBSERVABILITY_READ_FAILED', message: 'Run usage projection is unavailable.' } });
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

function isModelProbeInput(value: unknown): value is { endpoint: string; timeoutMs?: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !Object.keys(value).every((key) => key === 'endpoint' || key === 'timeoutMs') || !('endpoint' in value) || typeof value.endpoint !== 'string' || value.endpoint.length === 0 || value.endpoint.length > 2_048) return false;
  if (!('timeoutMs' in value) || value.timeoutMs === undefined) return true;
  return typeof value.timeoutMs === 'number' && Number.isSafeInteger(value.timeoutMs) && value.timeoutMs >= 50 && value.timeoutMs <= 30_000;
}

function isToolSettingsInput(value: unknown): value is { filesystemEnabled: boolean } {
  return typeof value === 'object' && value !== null && 'filesystemEnabled' in value && typeof value.filesystemEnabled === 'boolean';
}

function isGitSettingsInput(value: unknown): value is { enabled: boolean } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => key === 'enabled') && 'enabled' in value && typeof value.enabled === 'boolean';
}

function isSandboxProbeInput(value: unknown): value is { provider: 'docker' | 'podman' } {
  return typeof value === 'object' && value !== null && 'provider' in value && (value.provider === 'docker' || value.provider === 'podman');
}

function isSandboxSettingsInput(value: unknown): value is SandboxSettingsInput {
  if (typeof value !== 'object' || value === null || !('provider' in value) || (value.provider !== 'docker' && value.provider !== 'podman') || !('imageDigest' in value) || typeof value.imageDigest !== 'string' || !('network' in value) || (value.network !== 'restricted' && value.network !== 'enabled') || !('enabled' in value) || typeof value.enabled !== 'boolean') return false;
  if (!('resources' in value) || typeof value.resources !== 'object' || value.resources === null || Array.isArray(value.resources)) return false;
  return Object.values(value.resources).every((entry) => typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0);
}

function isWorkspaceAddInput(value: unknown): value is { id: string; path: string; label?: string; confirmation: 'add-workspace' } {
  if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string' || !('path' in value) || typeof value.path !== 'string' || !('confirmation' in value) || value.confirmation !== 'add-workspace') return false;
  return !('label' in value) || value.label === undefined || typeof value.label === 'string';
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

function parseObservabilityRange(value: string | null): ObservabilityRange {
  const candidate = value === null || value.trim() === '' ? '24h' : value;
  const parsed = ObservabilityRangeSchema.safeParse(candidate);
  if (!parsed.success) throw new RequestError(400, 'INVALID_OBSERVABILITY_RANGE', 'Range must be 24h, 7d, or 30d.');
  return parsed.data;
}

function parseObservabilityMetric(value: string | null): ObservabilityMetric {
  const parsed = ObservabilityMetricSchema.safeParse(value ?? 'cpu');
  if (!parsed.success) throw new RequestError(400, 'INVALID_OBSERVABILITY_METRIC', 'Metric must be cpu, memory, disk, tokens, or cost.');
  return parsed.data;
}

function parseObservabilityAuditCursor(value: string | null): number {
  if (value === null || value.trim() === '') return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000_000_000) throw new RequestError(400, 'INVALID_AUDIT_CURSOR', 'Invalid audit cursor.');
  return parsed;
}

function parseObservabilityFilter(value: string | null): string | undefined {
  if (value === null || value.trim() === '') return undefined;
  if (value.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(value)) throw new RequestError(400, 'INVALID_AUDIT_FILTER', 'Invalid audit filter.');
  return value;
}

function verifyAuditEvents(events: readonly AuditEvent[]): boolean {
  return verifyAuditChain(events);
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

function decodeGoalId(value: string | undefined): string {
  if (!value) throw new RequestError(400, 'INVALID_GOAL_ID', 'Invalid goal id.');
  try {
    const goalId = decodeURIComponent(value);
    if (!/^goal_[A-Za-z0-9_-]{8,128}$/u.test(goalId)) throw new Error('invalid');
    return goalId;
  } catch {
    throw new RequestError(400, 'INVALID_GOAL_ID', 'Invalid goal id.');
  }
}

function decodeTodoId(value: string | undefined): string {
  if (!value) throw new RequestError(400, 'INVALID_TODO_ID', 'Invalid todo id.');
  try {
    const todoId = decodeURIComponent(value);
    if (!/^todo_[A-Za-z0-9_-]{8,128}$/u.test(todoId)) throw new Error('invalid');
    return todoId;
  } catch {
    throw new RequestError(400, 'INVALID_TODO_ID', 'Invalid todo id.');
  }
}

function decodeGateId(value: string | undefined): string {
  if (!value) throw new RequestError(400, 'INVALID_GATE_ID', 'Invalid gate id.');
  try {
    const gateId = decodeURIComponent(value);
    if (!/^gate_[A-Za-z0-9_-]{8,128}$/u.test(gateId)) throw new Error('invalid');
    return gateId;
  } catch {
    throw new RequestError(400, 'INVALID_GATE_ID', 'Invalid gate id.');
  }
}

function parseGoalEventLimit(value: string | null): number {
  if (value === null || value.trim() === '') return DEFAULT_GOAL_EVENT_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_GOAL_EVENT_PAGE_SIZE) {
    throw new RequestError(400, 'INVALID_GOAL_EVENT_LIMIT', `Goal event limit must be between 1 and ${MAX_GOAL_EVENT_PAGE_SIZE}.`);
  }
  return parsed;
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

function safeGoalMutation(result: GoalMutationResult): Record<string, unknown> {
  return {
    schemaVersion: result.schemaVersion,
    eventId: result.eventId,
    controlRevision: result.controlRevision,
    projection: redactGoalProjection(result.projection),
  };
}

function goalMutationError(error: unknown): { code: string; message: string; statusCode: number } | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return undefined;
  switch (error.code) {
    case 'GOAL_EVENT_CONFLICT':
      return { code: error.code, message: 'Goal event id is already used with different content.', statusCode: 409 };
    case 'GOAL_CONTROL_REVISION_STALE':
      return { code: error.code, message: 'Goal control revision is stale.', statusCode: 409 };
    case 'GOAL_TODO_VALIDATION_REQUIRED':
      return { code: error.code, message: 'Validated Evidence is required before Todo completion.', statusCode: 422 };
    case 'GOAL_EVENT_INVALID':
    case 'GOAL_EVENT_STORAGE_ERROR':
      return { code: 'GOAL_STORAGE_UNAVAILABLE', message: 'Goal storage is unavailable.', statusCode: 503 };
    default:
      return undefined;
  }
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
