import { describe, expect, it } from 'vitest';
import { resolveDaemonTransport } from './transport-config.js';

describe('daemon transport configuration', () => {
  it('defaults to loopback HTTP without LAN privileges', () => {
    expect(resolveDaemonTransport({})).toMatchObject({
      host: '127.0.0.1',
      transportMode: 'loopback',
      tlsRequired: false,
      tlsEnabled: false,
    });
  });

  it('requires explicit LAN opt-in and TLS credentials are required by the caller', () => {
    expect(() => resolveDaemonTransport({ READY4VIBE_HOST: '0.0.0.0' })).toThrow('READY4VIBE_ALLOW_LAN=1');
    expect(resolveDaemonTransport({ READY4VIBE_HOST: '0.0.0.0', READY4VIBE_ALLOW_LAN: '1' })).toMatchObject({
      transportMode: 'lan',
      tlsRequired: true,
      tlsEnabled: true,
    });
  });

  it('allows explicit insecure LAN only when requested', () => {
    expect(resolveDaemonTransport({ READY4VIBE_HOST: '::', READY4VIBE_ALLOW_LAN: '1', READY4VIBE_ALLOW_INSECURE_LAN: '1' })).toMatchObject({
      host: '::',
      transportMode: 'lan',
      tlsRequired: false,
      tlsEnabled: false,
    });
  });

  it('supports optional loopback TLS and rejects unknown hosts', () => {
    expect(resolveDaemonTransport({ READY4VIBE_TLS_ENABLED: '1', READY4VIBE_TLS_CERT_FILE: 'cert.pem', READY4VIBE_TLS_KEY_FILE: 'key.pem' })).toMatchObject({
      tlsRequired: false,
      tlsEnabled: true,
      certificatePaths: { certFile: expect.stringContaining('cert.pem'), keyFile: expect.stringContaining('key.pem') },
    });
    expect(() => resolveDaemonTransport({ READY4VIBE_HOST: '192.168.1.10' })).toThrow('READY4VIBE_HOST');
  });
});
