import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type TransportMode = 'loopback' | 'lan' | 'tailscale' | 'ssh';

export type AuthFailureCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_TOKEN'
  | 'PAIRING_LOCAL_ONLY'
  | 'PAIRING_REQUIRED'
  | 'PAIRING_EXPIRED'
  | 'TLS_REQUIRED'
  | 'ORIGIN_FORBIDDEN'
  | 'CSRF_REQUIRED'
  | 'INVALID_CSRF'
  | 'TOKEN_IN_QUERY_FORBIDDEN';

export interface AuthGateOptions {
  mode: TransportMode;
  authRequired?: boolean;
  tlsRequired?: boolean;
  tokenTtlMs?: number;
  pairingTtlMs?: number;
  allowedOrigins?: readonly string[];
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
}

export interface PairingStartResult {
  code: string;
  expiresAt: number;
}

export interface PairingCompleteResult {
  accessToken: string;
  csrfToken: string;
  sessionId: string;
  expiresAt: number;
}

export interface AuthRequest {
  method: string;
  path: string;
  remoteAddress?: string;
  secure: boolean;
  authorization?: string;
  origin?: string;
  csrfToken?: string;
  hasQueryToken?: boolean;
}

export interface AuthDecision {
  allowed: boolean;
  sessionId?: string;
  failureCode?: AuthFailureCode;
}

export interface AuthStatus {
  mode: TransportMode;
  authRequired: boolean;
  tlsRequired: boolean;
  pairingRequired: boolean;
  insecureTransport: boolean;
}

interface Session {
  sessionId: string;
  tokenHash: Uint8Array;
  csrfHash: Uint8Array;
  expiresAt: number;
}

interface PairingCode {
  codeHash: Uint8Array;
  expiresAt: number;
}

export class AuthGate {
  private readonly mode: TransportMode;
  private readonly authRequired: boolean;
  private readonly tlsRequired: boolean;
  private readonly tokenTtlMs: number;
  private readonly pairingTtlMs: number;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly sessions = new Map<string, Session>();
  private pairingCode: PairingCode | undefined;

  constructor(options: AuthGateOptions) {
    this.mode = options.mode;
    this.authRequired = options.authRequired ?? options.mode === 'lan';
    this.tlsRequired = options.tlsRequired ?? options.mode === 'lan';
    this.tokenTtlMs = positiveLimit(options.tokenTtlMs ?? 24 * 60 * 60 * 1_000, 'token ttl');
    this.pairingTtlMs = positiveLimit(options.pairingTtlMs ?? 5 * 60 * 1_000, 'pairing ttl');
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? ((size) => randomBytes(size));
  }

  status(at = this.now()): AuthStatus {
    this.purgeExpired(at);
    return {
      mode: this.mode,
      authRequired: this.authRequired,
      tlsRequired: this.tlsRequired,
      pairingRequired: this.authRequired && this.sessions.size === 0,
      insecureTransport: !this.tlsRequired,
    };
  }

  startPairing(at = this.now()): PairingStartResult {
    const code = encodeCode(this.randomBytes(8));
    const expiresAt = at + this.pairingTtlMs;
    this.pairingCode = { codeHash: digest(code), expiresAt };
    return { code, expiresAt };
  }

  completePairing(code: string, at = this.now()): PairingCompleteResult {
    const pairing = this.pairingCode;
    if (!pairing) throw new AuthGateError('PAIRING_REQUIRED');
    this.pairingCode = undefined;
    if (pairing.expiresAt <= at) throw new AuthGateError('PAIRING_EXPIRED');
    if (typeof code !== 'string' || code.length === 0 || code.length > 64) throw new AuthGateError('PAIRING_REQUIRED');
    if (!safeEqual(pairing.codeHash, digest(code))) throw new AuthGateError('PAIRING_REQUIRED');
    return this.issueSession(at);
  }

  revoke(sessionId: string): boolean {
    for (const [key, session] of this.sessions) {
      if (session.sessionId === sessionId) {
        this.sessions.delete(key);
        return true;
      }
    }
    return false;
  }

  authorize(request: AuthRequest, at = this.now()): AuthDecision {
    this.purgeExpired(at);
    const path = request.path.split('?')[0] ?? request.path;
    if (request.hasQueryToken === true || /(?:^|[?&])(token|access_token)=/iu.test(request.path)) {
      return this.fail('TOKEN_IN_QUERY_FORBIDDEN');
    }
    if (path === '/health' || path === '/api/v1/health') return { allowed: true };
    if (path === '/api/v1/pairing/start') {
      return isLoopbackAddress(request.remoteAddress) ? { allowed: true } : this.fail('PAIRING_LOCAL_ONLY');
    }
    if (path === '/api/v1/pairing/complete') {
      if (this.tlsRequired && !request.secure && !isLoopbackAddress(request.remoteAddress)) return this.fail('TLS_REQUIRED');
      return { allowed: true };
    }
    if (this.tlsRequired && !request.secure && this.mode !== 'loopback') return this.fail('TLS_REQUIRED');
    if (!this.authRequired) return { allowed: true };

    const token = parseBearer(request.authorization);
    if (!token) return this.fail('AUTH_REQUIRED');
    const session = this.findSession(token);
    if (!session) return this.fail('INVALID_TOKEN');
    if (request.origin !== undefined) {
      if (!this.allowedOrigins.has(request.origin)) return this.fail('ORIGIN_FORBIDDEN');
      if (!isSafeMethod(request.method)) {
        if (!request.csrfToken) return this.fail('CSRF_REQUIRED');
        if (!safeEqual(session.csrfHash, digest(request.csrfToken))) return this.fail('INVALID_CSRF');
      }
    }
    return { allowed: true, sessionId: session.sessionId };
  }

  private issueSession(at: number): PairingCompleteResult {
    const accessToken = encodeToken(this.randomBytes(32));
    const csrfToken = encodeToken(this.randomBytes(24));
    const sessionId = `session_${encodeToken(this.randomBytes(12))}`;
    const expiresAt = at + this.tokenTtlMs;
    this.sessions.set(hex(digest(accessToken)), {
      sessionId,
      tokenHash: digest(accessToken),
      csrfHash: digest(csrfToken),
      expiresAt,
    });
    return { accessToken, csrfToken, sessionId, expiresAt };
  }

  private findSession(token: string): Session | undefined {
    const tokenHash = digest(token);
    const key = hex(tokenHash);
    const session = this.sessions.get(key);
    if (!session || !safeEqual(session.tokenHash, tokenHash)) return undefined;
    return session;
  }

  private purgeExpired(at: number): void {
    for (const [key, session] of this.sessions) if (session.expiresAt <= at) this.sessions.delete(key);
    if (this.pairingCode?.expiresAt !== undefined && this.pairingCode.expiresAt <= at) this.pairingCode = undefined;
  }

  private fail(failureCode: AuthFailureCode): AuthDecision {
    return { allowed: false, failureCode };
  }
}

export class AuthGateError extends Error {
  constructor(readonly code: AuthFailureCode) {
    super('Authentication request was rejected.');
    this.name = 'AuthGateError';
  }
}

function positiveLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function digest(value: string): Uint8Array {
  return createHash('sha256').update(value, 'utf8').digest();
}

function safeEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function encodeToken(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function encodeCode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url').replace(/[-_]/g, '').slice(0, 10).toUpperCase();
}

function hex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex');
}

function parseBearer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(value.trim());
  return match?.[1];
}

function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/^::ffff:/u, '');
  return normalized === '::1' || normalized.startsWith('127.');
}
