import { describe, expect, it } from 'vitest';
import { AuthGate, AuthGateError, defaultLoopbackOrigins, isLoopbackAddress } from './index.js';

function deterministicRandom(): (size: number) => Uint8Array {
  let value = 0;
  return (size) => Uint8Array.from({ length: size }, () => (value += 1) % 255);
}

describe('AuthGate', () => {
  it('requires a local pairing start and consumes a code exactly once', () => {
    let now = 1_000;
    const gate = new AuthGate({ mode: 'lan', now: () => now, randomBytes: deterministicRandom(), allowedOrigins: ['http://localhost:5173'] });
    expect(gate.authorize({ method: 'POST', path: '/api/v1/pairing/start', remoteAddress: '192.168.1.5', secure: true })).toMatchObject({ allowed: false, failureCode: 'PAIRING_LOCAL_ONLY' });
    const pairing = gate.startPairing();
    const session = gate.completePairing(pairing.code);
    expect(session.accessToken).not.toContain(pairing.code);
    expect(gate.status()).toMatchObject({ authRequired: true, pairingRequired: false, tlsRequired: true });
    expect(() => gate.completePairing(pairing.code)).toThrowError(new AuthGateError('PAIRING_REQUIRED'));
  });

  it('fails closed for expired and incorrect pairing codes', () => {
    let now = 1_000;
    const gate = new AuthGate({ mode: 'lan', pairingTtlMs: 10, now: () => now, randomBytes: deterministicRandom() });
    gate.startPairing();
    expect(() => gate.completePairing('wrong')).toThrowError(new AuthGateError('PAIRING_REQUIRED'));
    gate.startPairing();
    now = 2_000;
    expect(() => gate.completePairing('wrong')).toThrowError(new AuthGateError('PAIRING_EXPIRED'));
  });

  it('authorizes bearer sessions, enforces expiry/revocation and never accepts query tokens', () => {
    let now = 1_000;
    const gate = new AuthGate({ mode: 'lan', tokenTtlMs: 10, now: () => now, randomBytes: deterministicRandom() });
    const pairing = gate.startPairing();
    const session = gate.completePairing(pairing.code);
    const request = { method: 'GET', path: '/api/v1/runs/run_1', remoteAddress: '192.168.1.5', secure: true, authorization: `Bearer ${session.accessToken}` };
    expect(gate.authorize(request)).toMatchObject({ allowed: true, sessionId: session.sessionId });
    expect(gate.authorize({ ...request, path: '/api/v1/runs/run_1?access_token=' + session.accessToken })).toMatchObject({ allowed: false, failureCode: 'TOKEN_IN_QUERY_FORBIDDEN' });
    gate.revoke(session.sessionId);
    expect(gate.authorize(request)).toMatchObject({ allowed: false, failureCode: 'INVALID_TOKEN' });
    const second = gate.completePairing(gate.startPairing().code);
    now = 2_000;
    expect(gate.authorize({ ...request, authorization: `Bearer ${second.accessToken}` })).toMatchObject({ allowed: false, failureCode: 'INVALID_TOKEN' });
  });

  it('enforces TLS, Origin and CSRF on LAN browser writes', () => {
    let now = 1_000;
    const gate = new AuthGate({ mode: 'lan', now: () => now, randomBytes: deterministicRandom(), allowedOrigins: ['https://ui.example'] });
    const session = gate.completePairing(gate.startPairing().code);
    const base = { method: 'POST', path: '/api/v1/runs', remoteAddress: '192.168.1.5', authorization: `Bearer ${session.accessToken}`, origin: 'https://ui.example' };
    expect(gate.authorize({ ...base, secure: false })).toMatchObject({ allowed: false, failureCode: 'TLS_REQUIRED' });
    expect(gate.authorize({ ...base, secure: true })).toMatchObject({ allowed: false, failureCode: 'CSRF_REQUIRED' });
    expect(gate.authorize({ ...base, secure: true, csrfToken: 'wrong' })).toMatchObject({ allowed: false, failureCode: 'INVALID_CSRF' });
    expect(gate.authorize({ ...base, secure: true, csrfToken: session.csrfToken })).toMatchObject({ allowed: true });
    expect(gate.authorize({ ...base, secure: true, origin: 'https://evil.example', csrfToken: session.csrfToken })).toMatchObject({ allowed: false, failureCode: 'ORIGIN_FORBIDDEN' });
    now = 2_000;
  });

  it('allows explicit insecure mode and keeps loopback health/pairing local', () => {
    const gate = new AuthGate({ mode: 'lan', tlsRequired: false, authRequired: false, randomBytes: deterministicRandom() });
    expect(gate.authorize({ method: 'GET', path: '/health', remoteAddress: '192.168.1.5', secure: false })).toMatchObject({ allowed: true });
    expect(gate.authorize({ method: 'GET', path: '/api/v1/runs/run_1', remoteAddress: '192.168.1.5', secure: false })).toMatchObject({ allowed: true });
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddress('192.168.1.5')).toBe(false);
  });
});

describe('defaultLoopbackOrigins', () => {
  it('covers the loopback host variants for the daemon-hosted UI', () => {
    expect(defaultLoopbackOrigins(61562)).toEqual(['http://127.0.0.1:61562', 'http://localhost:61562', 'http://[::1]:61562']);
    expect(defaultLoopbackOrigins(443, true)).toEqual(['https://127.0.0.1:443', 'https://localhost:443', 'https://[::1]:443']);
  });

  it('rejects invalid ports and keeps browser writes authorized for the hosted origin', () => {
    expect(() => defaultLoopbackOrigins(0)).toThrow();
    expect(() => defaultLoopbackOrigins(70000)).toThrow();
    const gate = new AuthGate({ mode: 'loopback', authRequired: true, randomBytes: deterministicRandom(), allowedOrigins: [...defaultLoopbackOrigins(8787)] });
    const session = gate.completePairing(gate.startPairing().code);
    const write = { method: 'POST', path: '/api/v1/settings/deepseek', remoteAddress: '127.0.0.1', secure: false, authorization: `Bearer ${session.accessToken}`, origin: 'http://localhost:8787', csrfToken: session.csrfToken };
    expect(gate.authorize(write)).toMatchObject({ allowed: true });
    expect(gate.authorize({ ...write, origin: 'https://evil.example' })).toMatchObject({ allowed: false, failureCode: 'ORIGIN_FORBIDDEN' });
  });
});
