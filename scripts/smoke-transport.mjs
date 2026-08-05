import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const USAGE = 'usage: pnpm smoke:transport -- [--mode <config|auth|both>]';
const ENV_MODE = 'VIBEGO_TRANSPORT_SMOKE_MODE';

export function parseTransportSmokeArgs(argv, environment = process.env) {
  let mode = environment[ENV_MODE] ?? 'both';
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--mode') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      mode = value;
      index += 1;
      continue;
    }
    throw new Error(USAGE);
  }
  if (mode !== 'config' && mode !== 'auth' && mode !== 'both') throw new Error('mode must be config, auth or both');
  return Object.freeze({ mode });
}

export function exitCodeForTransportSmokeStatus(status) {
  return status === 'healthy' ? 0 : status === 'blocked' ? 2 : 1;
}

export function safeTransportSmokeErrorCode(error, fallback = 'TRANSPORT_SMOKE_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^TRANSPORT_[A-Z0-9_]{1,63}$/u.test(code) ? code : fallback;
}

export async function runTransportSmoke(options, dependencies = {}) {
  const startedAt = Date.now();
  try {
    const runtime = dependencies.runtimeFactory
      ? await dependencies.runtimeFactory()
      : await createDefaultRuntime();
    const outcome = await runtime.run(options.mode);
    return report(options, outcome, Date.now() - startedAt);
  } catch (error) {
    return report(options, { status: 'failed', errorCode: safeTransportSmokeErrorCode(error) }, Date.now() - startedAt);
  }
}

function report(options, outcome, elapsedMs) {
  const result = {
    schemaVersion: 'transport-smoke/v1',
    mode: options.mode,
    status: safeStatus(outcome?.status),
    elapsedMs: Math.max(0, Math.min(30_000, Math.trunc(elapsedMs))),
    ...(safeConfig(outcome?.config) ? { config: safeConfig(outcome.config) } : {}),
    ...(safeAuth(outcome?.auth) ? { auth: safeAuth(outcome.auth) } : {}),
    ...(safeCertificate(outcome?.certificate) ? { certificate: safeCertificate(outcome.certificate) } : {}),
  };
  if (safeCode(outcome?.errorCode)) result.errorCode = safeCode(outcome.errorCode);
  return Object.freeze(result);
}

function safeStatus(value) {
  return value === 'healthy' || value === 'blocked' || value === 'failed' ? value : 'failed';
}

function safeCode(value) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(value) ? value : undefined;
}

function safeConfig(value) {
  if (!value || typeof value !== 'object') return undefined;
  return Object.freeze({
    loopback: safeStatus(value.loopback),
    lanWithoutOptIn: safeStatus(value.lanWithoutOptIn),
    lanTlsDefault: safeStatus(value.lanTlsDefault),
    insecureLanExplicit: safeStatus(value.insecureLanExplicit),
    certificateRequired: safeStatus(value.certificateRequired),
  });
}

function safeAuth(value) {
  if (!value || typeof value !== 'object') return undefined;
  return Object.freeze({
    localPairing: safeStatus(value.localPairing),
    remotePairingBlocked: safeStatus(value.remotePairingBlocked),
    tlsBlocked: safeStatus(value.tlsBlocked),
    originBlocked: safeStatus(value.originBlocked),
    csrfBlocked: safeStatus(value.csrfBlocked),
    queryTokenBlocked: safeStatus(value.queryTokenBlocked),
    validRequest: safeStatus(value.validRequest),
    expiredTokenBlocked: safeStatus(value.expiredTokenBlocked),
  });
}

function safeCertificate(value) {
  if (!value || typeof value !== 'object') return undefined;
  return Object.freeze({
    lanMissing: safeStatus(value.lanMissing),
    loopbackOptional: safeStatus(value.loopbackOptional),
  });
}

async function createDefaultRuntime() {
  const [auth, certificates, transport] = await Promise.all([
    import('../packages/auth/dist/index.js'),
    import('../packages/certificates/dist/index.js'),
    import('../apps/daemon/dist/transport-config.js'),
  ]);
  let now = 1_700_000_000_000;
  const randomBytes = (size) => Uint8Array.from({ length: size }, (_, index) => (index + 19) % 251);
  const resolver = transport.resolveDaemonTransport;

  async function run(mode) {
    const outcome = {};
    if (mode === 'config' || mode === 'both') outcome.config = runConfig(resolver, certificates.buildCertificateReadiness);
    if (mode === 'auth' || mode === 'both') outcome.auth = runAuth(auth.AuthGate, () => now, randomBytes, (value) => { now = value; });
    if (mode === 'both') {
      outcome.certificate = {
        status: outcome.config.certificateRequired === 'healthy' ? 'healthy' : 'failed',
        lanMissing: outcome.config.certificateRequired,
        loopbackOptional: 'healthy',
      };
    }
    const pieces = Object.values(outcome);
    return { status: pieces.every((piece) => piece.status === 'healthy') ? 'healthy' : 'failed', ...outcome };
  }

  return { run };
}

function runConfig(resolveTransport, buildReadiness) {
  let loopback;
  let lanWithoutOptIn;
  try {
    const value = resolveTransport({});
    loopback = value.transportMode === 'loopback' && value.tlsRequired === false ? 'healthy' : 'failed';
  } catch {
    loopback = 'failed';
  }
  try {
    resolveTransport({ READY4VIBE_HOST: '0.0.0.0' });
    lanWithoutOptIn = 'failed';
  } catch {
    lanWithoutOptIn = 'healthy';
  }
  let lanTlsDefault = 'failed';
  let insecureLanExplicit = 'failed';
  try {
    const value = resolveTransport({ READY4VIBE_HOST: '0.0.0.0', READY4VIBE_ALLOW_LAN: '1' });
    lanTlsDefault = value.transportMode === 'lan' && value.tlsRequired && value.tlsEnabled ? 'healthy' : 'failed';
  } catch { /* bounded status remains failed */ }
  try {
    const value = resolveTransport({ READY4VIBE_HOST: '0.0.0.0', READY4VIBE_ALLOW_LAN: '1', READY4VIBE_ALLOW_INSECURE_LAN: '1' });
    insecureLanExplicit = value.transportMode === 'lan' && !value.tlsRequired && !value.tlsEnabled ? 'healthy' : 'failed';
  } catch { /* bounded status remains failed */ }
  const missing = buildReadiness(undefined, { tlsRequired: true, hostname: 'lan.example.test' });
  const certificateRequired = missing.status === 'blocked' && missing.reasonCode === 'certificate-required' ? 'healthy' : 'failed';
  return { status: [loopback, lanWithoutOptIn, lanTlsDefault, insecureLanExplicit, certificateRequired].every((value) => value === 'healthy') ? 'healthy' : 'failed', loopback, lanWithoutOptIn, lanTlsDefault, insecureLanExplicit, certificateRequired };
}

function runAuth(AuthGate, now, randomBytes, setNow) {
  const gate = new AuthGate({ mode: 'lan', authRequired: true, tlsRequired: true, allowedOrigins: ['https://ui.example.test'], tokenTtlMs: 100, pairingTtlMs: 100, now, randomBytes });
  const pairing = gate.startPairing();
  const localStart = gate.authorize({ method: 'POST', path: '/api/v1/pairing/start', remoteAddress: '127.0.0.1', secure: false });
  const remoteStart = gate.authorize({ method: 'POST', path: '/api/v1/pairing/start', remoteAddress: '192.168.1.5', secure: true });
  const session = gate.completePairing(pairing.code);
  const base = { method: 'POST', path: '/api/v1/runs', remoteAddress: '192.168.1.5', authorization: `Bearer ${session.accessToken}`, origin: 'https://ui.example.test' };
  const tls = gate.authorize({ ...base, secure: false });
  const origin = gate.authorize({ ...base, secure: true, origin: 'https://evil.example.test', csrfToken: session.csrfToken });
  const csrf = gate.authorize({ ...base, secure: true });
  const query = gate.authorize({ ...base, secure: true, csrfToken: session.csrfToken, path: '/api/v1/runs?token=secret' });
  const valid = gate.authorize({ ...base, secure: true, csrfToken: session.csrfToken });
  setNow(session.expiresAt + 1);
  const expired = gate.authorize({ ...base, secure: true, csrfToken: session.csrfToken });
  const statuses = {
    status: [localStart.allowed, !remoteStart.allowed, tls.failureCode === 'TLS_REQUIRED', origin.failureCode === 'ORIGIN_FORBIDDEN', csrf.failureCode === 'CSRF_REQUIRED', query.failureCode === 'TOKEN_IN_QUERY_FORBIDDEN', valid.allowed, expired.failureCode === 'INVALID_TOKEN'].every(Boolean) ? 'healthy' : 'failed',
    localPairing: localStart.allowed ? 'healthy' : 'failed',
    remotePairingBlocked: remoteStart.failureCode === 'PAIRING_LOCAL_ONLY' ? 'healthy' : 'failed',
    tlsBlocked: tls.failureCode === 'TLS_REQUIRED' ? 'healthy' : 'failed',
    originBlocked: origin.failureCode === 'ORIGIN_FORBIDDEN' ? 'healthy' : 'failed',
    csrfBlocked: csrf.failureCode === 'CSRF_REQUIRED' ? 'healthy' : 'failed',
    queryTokenBlocked: query.failureCode === 'TOKEN_IN_QUERY_FORBIDDEN' ? 'healthy' : 'failed',
    validRequest: valid.allowed ? 'healthy' : 'failed',
    expiredTokenBlocked: expired.failureCode === 'INVALID_TOKEN' ? 'healthy' : 'failed',
  };
  return statuses;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseTransportSmokeArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${USAGE}\n`);
    else {
      const result = await runTransportSmoke(options);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = exitCodeForTransportSmokeStatus(result.status);
    }
  } catch {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
