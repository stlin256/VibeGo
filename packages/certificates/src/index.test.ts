import { resolve } from 'node:path';
import type { SecureContextOptions } from 'node:tls';
import { describe, expect, it } from 'vitest';
import { CertificateConfigError, inspectTlsCertificate, loadTlsCredentials, resolveTlsCertificatePaths } from './index.js';

describe('TLS certificate configuration', () => {
  it('requires a complete explicit PEM file pair', () => {
    expect(resolveTlsCertificatePaths({})).toBeUndefined();
    expect(resolveTlsCertificatePaths({ READY4VIBE_TLS_CERT_FILE: 'cert.pem', READY4VIBE_TLS_KEY_FILE: 'key.pem' })).toEqual({
      certFile: resolve('cert.pem'),
      keyFile: resolve('key.pem'),
    });
    expect(() => resolveTlsCertificatePaths({ READY4VIBE_TLS_CERT_FILE: 'cert.pem' })).toThrowError(
      new CertificateConfigError('TLS_CONFIG_INCOMPLETE', 'READY4VIBE_TLS_CERT_FILE and READY4VIBE_TLS_KEY_FILE must be configured together.'),
    );
  });

  it('reads and validates credentials without exposing PEM contents', () => {
    const calls: SecureContextOptions[] = [];
    const credentials = loadTlsCredentials(
      { certFile: 'cert.pem', keyFile: 'key.pem' },
      {
        readFile: (path) => Buffer.from(path === 'cert.pem' ? 'CERTIFICATE' : 'PRIVATE KEY'),
        createSecureContext: (options) => {
          calls.push(options);
          return {};
        },
      },
    );
    expect(credentials).toEqual({ cert: Buffer.from('CERTIFICATE'), key: Buffer.from('PRIVATE KEY') });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cert: credentials.cert, key: credentials.key });
  });

  it('returns stable errors for unreadable files and mismatched material', () => {
    expect(() => loadTlsCredentials({ certFile: 'cert.pem', keyFile: 'key.pem' }, { readFile: () => { throw new Error('nope'); } })).toThrowError(
      new CertificateConfigError('TLS_CERTIFICATE_READ_FAILED', 'TLS certificate file could not be read.'),
    );
    expect(() => loadTlsCredentials(
      { certFile: 'cert.pem', keyFile: 'key.pem' },
      { readFile: (path) => { if (path === 'key.pem') throw new Error('nope'); return Buffer.from('cert'); } },
    )).toThrowError(new CertificateConfigError('TLS_KEY_READ_FAILED', 'TLS private key file could not be read.'));
    expect(() => loadTlsCredentials(
      { certFile: 'cert.pem', keyFile: 'key.pem' },
      { readFile: (path) => Buffer.from(path), createSecureContext: () => { throw new Error('mismatch'); } },
    )).toThrowError(new CertificateConfigError('TLS_CERTIFICATE_INVALID', 'TLS certificate and private key could not be validated.'));
  });

  it('extracts safe X.509 metadata without returning certificate material', () => {
    const status = inspectTlsCertificate(Buffer.from('CERTIFICATE'), {
      createCertificate: () => ({
        subject: 'CN=dev.example.test',
        issuer: 'CN=Test CA',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2030-01-01T00:00:00.000Z',
        fingerprint256: 'AA:BB:CC',
        subjectAltName: 'DNS:dev.example.test, IP Address:192.0.2.10, URI:ignored',
      }),
    });
    expect(status).toMatchObject({ subject: 'CN=dev.example.test', issuer: 'CN=Test CA', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2030-01-01T00:00:00.000Z', fingerprint256: 'AA:BB:CC', subjectAltNames: ['dev.example.test', '192.0.2.10'] });
    expect(JSON.stringify(status)).not.toContain('CERTIFICATE');
    expect(JSON.stringify(status)).not.toContain('PRIVATE');
  });

  it('rejects invalid certificate metadata with a stable error', () => {
    expect(() => inspectTlsCertificate(Buffer.from('CERTIFICATE'), { createCertificate: () => ({ subject: '', issuer: '', validFrom: 'nope', validTo: 'nope', fingerprint256: '' }) })).toThrowError(
      new CertificateConfigError('TLS_CERTIFICATE_INVALID', 'TLS certificate metadata could not be inspected.'),
    );
  });
});
