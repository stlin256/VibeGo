import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export type LoopbackHost = '127.0.0.1' | '::1';
export type StorageKind = 'sqlite' | 'memory';

export interface DaemonServerOptions {
  host?: LoopbackHost;
  version?: string;
  storageKind?: StorageKind;
  storageStatus?: 'ready' | 'degraded';
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: 'ready4vibe-daemon';
  version: string;
  transport: {
    kind: 'http-loopback';
    tlsRequired: false;
    boundAddresses: readonly LoopbackHost[];
  };
  auth: {
    pairingRequired: false;
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

export function createDaemonServer(options: DaemonServerOptions = {}): Server {
  const resolved = {
    host: options.host ?? '127.0.0.1',
    version: options.version ?? '0.1.0',
    storageKind: options.storageKind ?? 'memory',
    storageStatus: options.storageStatus ?? 'ready',
  } satisfies Required<DaemonServerOptions>;

  return createServer((request, response) => handleRequest(request, response, resolved));
}

export function isLoopbackHost(value: string): value is LoopbackHost {
  return value === '127.0.0.1' || value === '::1';
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<DaemonServerOptions>,
): void {
  const pathname = new URL(request.url ?? '/', 'http://loopback.invalid').pathname;
  if (HEALTH_PATHS.has(pathname)) {
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required' } }, { Allow: 'GET' });
      return;
    }
    const health: HealthResponse = {
      status: options.storageStatus === 'ready' ? 'ok' : 'degraded',
      service: 'ready4vibe-daemon',
      version: options.version,
      transport: {
        kind: 'http-loopback',
        tlsRequired: false,
        boundAddresses: [options.host],
      },
      auth: { pairingRequired: false },
      storage: { kind: options.storageKind, status: options.storageStatus },
      sandbox: {
        availableModes: ['read-only', 'workspace-write', 'external-sandbox'],
        externalRequiredForUntrusted: true,
      },
      approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] },
    };
    writeJson(response, 200, health);
    return;
  }

  writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
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
