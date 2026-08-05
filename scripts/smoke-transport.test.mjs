import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exitCodeForTransportSmokeStatus,
  parseTransportSmokeArgs,
  runTransportSmoke,
  safeTransportSmokeErrorCode,
} from './smoke-transport.mjs';

test('parses only bounded transport fixture modes', () => {
  assert.deepEqual(parseTransportSmokeArgs(['--mode', 'auth']), { mode: 'auth' });
  assert.deepEqual(parseTransportSmokeArgs([], { VIBEGO_TRANSPORT_SMOKE_MODE: 'config' }), { mode: 'config' });
  assert.throws(() => parseTransportSmokeArgs(['--mode', 'public']), /config, auth or both/u);
  assert.throws(() => parseTransportSmokeArgs(['--unknown']), /usage/u);
});

test('reports injected healthy transport evidence without tokens or paths', async () => {
  const result = await runTransportSmoke({ mode: 'both' }, {
    runtimeFactory: async () => ({
      run: async () => ({
        status: 'healthy',
        config: { status: 'healthy', loopback: 'healthy', lanWithoutOptIn: 'healthy', lanTlsDefault: 'healthy', insecureLanExplicit: 'healthy', certificateRequired: 'healthy' },
        auth: { status: 'healthy', localPairing: 'healthy', remotePairingBlocked: 'healthy', tlsBlocked: 'healthy', originBlocked: 'healthy', csrfBlocked: 'healthy', queryTokenBlocked: 'healthy', validRequest: 'healthy', expiredTokenBlocked: 'healthy' },
        certificate: { status: 'healthy', lanMissing: 'healthy', loopbackOptional: 'healthy' },
      }),
    }),
  });
  assert.equal(result.status, 'healthy');
  assert.equal(result.auth.validRequest, 'healthy');
  assert.doesNotMatch(JSON.stringify(result), /Bearer\s|secret[=:]|C:\\private|sk-/iu);
});

test('keeps failure mapping bounded', async () => {
  const failed = await runTransportSmoke({ mode: 'auth' }, {
    runtimeFactory: async () => { throw Object.assign(new Error('C:\\private secret'), { code: 'TRANSPORT_AUTH_BLOCKED' }); },
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'TRANSPORT_AUTH_BLOCKED');
  assert.doesNotMatch(JSON.stringify(failed), /C:\\private|secret/iu);
});

test('keeps exit/error mappings stable', () => {
  assert.equal(exitCodeForTransportSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForTransportSmokeStatus('blocked'), 2);
  assert.equal(exitCodeForTransportSmokeStatus('failed'), 1);
  assert.equal(safeTransportSmokeErrorCode({ code: 'TRANSPORT_TLS_REQUIRED', message: 'private key' }), 'TRANSPORT_TLS_REQUIRED');
  assert.equal(safeTransportSmokeErrorCode(new Error('private key')), 'TRANSPORT_SMOKE_FAILED');
});
