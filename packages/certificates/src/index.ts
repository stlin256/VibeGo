import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
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

export interface CertificateStatus {
  readonly subject: string;
  readonly issuer: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly daysRemaining: number;
  readonly fingerprint256: string;
  readonly subjectAltNames: readonly string[];
}

export interface X509CertificateLike {
  readonly subject: string;
  readonly issuer: string;
  readonly validFrom: string;
  readonly validTo: string;
  readonly fingerprint256: string;
  readonly subjectAltName?: string;
}

export type X509CertificateFactory = (certificate: Buffer) => X509CertificateLike;

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

/** Extracts non-secret certificate metadata for authenticated status surfaces. */
export function inspectTlsCertificate(
  certificate: Buffer,
  options: { createCertificate?: X509CertificateFactory } = {},
): CertificateStatus {
  try {
    if (!Buffer.isBuffer(certificate) || certificate.byteLength === 0) throw new Error('empty certificate');
    const parsed = (options.createCertificate ?? ((value: Buffer) => new X509Certificate(value)))(certificate);
    const validFrom = toIsoDate(parsed.validFrom);
    const validTo = toIsoDate(parsed.validTo);
    if (!parsed.subject || !parsed.issuer || !parsed.fingerprint256) throw new Error('certificate metadata is incomplete');
    return Object.freeze({
      subject: sanitizeMetadata(parsed.subject),
      issuer: sanitizeMetadata(parsed.issuer),
      validFrom,
      validTo,
      daysRemaining: Math.floor((Date.parse(validTo) - Date.now()) / 86_400_000),
      fingerprint256: sanitizeMetadata(parsed.fingerprint256),
      subjectAltNames: Object.freeze(parseSubjectAltNames(parsed.subjectAltName)),
    });
  } catch {
    throw new CertificateConfigError('TLS_CERTIFICATE_INVALID', 'TLS certificate metadata could not be inspected.');
  }
}

function toIsoDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('invalid certificate date');
  return new Date(timestamp).toISOString();
}

function parseSubjectAltNames(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('DNS:') || entry.startsWith('IP Address:'))
    .map((entry) => entry.slice(entry.indexOf(':') + 1).trim())
    .filter((entry) => entry.length > 0 && !/[\u0000-\u001F\u007F]/u.test(entry));
}

function sanitizeMetadata(value: string): string {
  return value.replace(/[\r\n\u0000-\u001F\u007F]/gu, ' ').trim();
}
