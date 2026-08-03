import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSecureContext, type SecureContext, type SecureContextOptions } from 'node:tls';

export interface TlsCertificatePaths {
  certFile: string;
  keyFile: string;
}

export interface TlsCredentials {
  cert: Buffer;
  key: Buffer;
}

export type CertificateErrorCode =
  | 'TLS_CONFIG_INCOMPLETE'
  | 'TLS_CERTIFICATE_READ_FAILED'
  | 'TLS_KEY_READ_FAILED'
  | 'TLS_CERTIFICATE_INVALID';

export class CertificateConfigError extends Error {
  constructor(readonly code: CertificateErrorCode, message: string) {
    super(message);
    this.name = 'CertificateConfigError';
  }
}

export type FileReader = (path: string) => Buffer;
export type SecureContextFactory = (options: SecureContextOptions) => SecureContext | unknown;

/** Resolves the explicit PEM file pair without reading or logging their contents. */
export function resolveTlsCertificatePaths(
  env: Readonly<Record<string, string | undefined>> = process.env,
): TlsCertificatePaths | undefined {
  const certFile = env.READY4VIBE_TLS_CERT_FILE?.trim();
  const keyFile = env.READY4VIBE_TLS_KEY_FILE?.trim();
  if (!certFile && !keyFile) return undefined;
  if (!certFile || !keyFile) {
    throw new CertificateConfigError(
      'TLS_CONFIG_INCOMPLETE',
      'READY4VIBE_TLS_CERT_FILE and READY4VIBE_TLS_KEY_FILE must be configured together.',
    );
  }
  return { certFile: resolve(certFile), keyFile: resolve(keyFile) };
}

/** Reads and validates a certificate/private-key pair, keeping both values in memory only. */
export function loadTlsCredentials(
  paths: TlsCertificatePaths,
  options: { readFile?: FileReader; createSecureContext?: SecureContextFactory } = {},
): TlsCredentials {
  const readFile = options.readFile ?? ((path: string) => readFileSync(path));
  let cert: Buffer;
  try {
    cert = readFile(paths.certFile);
  } catch {
    throw new CertificateConfigError('TLS_CERTIFICATE_READ_FAILED', 'TLS certificate file could not be read.');
  }
  let key: Buffer;
  try {
    key = readFile(paths.keyFile);
  } catch {
    throw new CertificateConfigError('TLS_KEY_READ_FAILED', 'TLS private key file could not be read.');
  }
  try {
    (options.createSecureContext ?? createSecureContext)({ cert, key });
  } catch {
    throw new CertificateConfigError('TLS_CERTIFICATE_INVALID', 'TLS certificate and private key could not be validated.');
  }
  return { cert, key };
}
