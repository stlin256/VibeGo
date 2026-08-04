import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createSecureContext, type SecureContext, type SecureContextOptions } from 'node:tls';
import { isIP } from 'node:net';

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

export type CertificateReadinessState = 'ready' | 'degraded' | 'blocked';

export type CertificateReadinessReasonCode =
  | 'certificate-ready'
  | 'tls-not-required'
  | 'certificate-required'
  | 'certificate-expiring'
  | 'certificate-expired'
  | 'certificate-hostname-mismatch'
  | 'certificate-invalid';

export interface CertificateReadiness {
  readonly schemaVersion: 'ready4vibe_certificate_readiness_v1';
  readonly status: CertificateReadinessState;
  readonly reasonCode: CertificateReadinessReasonCode;
  readonly nextStep: string;
  readonly affectsTransport: boolean;
  readonly daysRemaining: number | null;
  readonly hostname: string | null;
  readonly certificate?: CertificateStatus;
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

export interface CertificateReadinessOptions {
  readonly tlsRequired: boolean;
  readonly hostname?: string;
  readonly renewalWindowDays?: number;
}

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

/**
 * Classifies whether the already loaded certificate is usable for the current
 * transport. This function is pure: it never reads a file or contacts ACME.
 */
export function buildCertificateReadiness(
  certificate: CertificateStatus | undefined,
  options: CertificateReadinessOptions,
): CertificateReadiness {
  const requestedHostname = options.hostname?.trim();
  const hostname = normalizeHostname(options.hostname);
  const renewalWindowDays = boundedRenewalWindow(options.renewalWindowDays);
  if (!certificate) {
    return Object.freeze({
      schemaVersion: 'ready4vibe_certificate_readiness_v1',
      status: options.tlsRequired ? 'blocked' : 'degraded',
      reasonCode: options.tlsRequired ? 'certificate-required' : 'tls-not-required',
      nextStep: options.tlsRequired
        ? 'Configure a valid certificate and matching private key before enabling LAN or public HTTPS.'
        : 'Loopback HTTP is active; configure TLS before enabling LAN or public HTTPS.',
      affectsTransport: options.tlsRequired,
      daysRemaining: null,
      hostname: hostname ?? null,
    });
  }
  if (certificate.daysRemaining < 0) {
    return readinessWithCertificate(certificate, {
      status: 'blocked',
      reasonCode: 'certificate-expired',
      nextStep: 'Replace or renew the certificate before accepting TLS connections.',
      affectsTransport: options.tlsRequired,
      hostname: hostname ?? null,
    });
  }
  if ((requestedHostname && !hostname) || (hostname && !certificateMatchesHostname(certificate, hostname))) {
    return readinessWithCertificate(certificate, {
      status: 'blocked',
      reasonCode: 'certificate-hostname-mismatch',
      nextStep: 'Use a certificate whose DNS or IP SAN matches the configured Host name.',
      affectsTransport: options.tlsRequired,
      hostname: hostname ?? null,
    });
  }
  if (certificate.daysRemaining <= renewalWindowDays) {
    return readinessWithCertificate(certificate, {
      status: 'degraded',
      reasonCode: 'certificate-expiring',
      nextStep: 'Plan an explicit certificate renewal before the validity window closes.',
      affectsTransport: false,
      hostname: hostname ?? null,
    });
  }
  return readinessWithCertificate(certificate, {
    status: 'ready',
    reasonCode: 'certificate-ready',
    nextStep: 'No certificate action is required.',
    affectsTransport: false,
    hostname: hostname ?? null,
  });
}

/** Maps a loader failure to bounded UI guidance without exposing its cause. */
export function buildCertificateReadinessFromError(
  error: unknown,
  options: CertificateReadinessOptions,
): CertificateReadiness {
  const reasonCode: CertificateReadinessReasonCode = error instanceof CertificateConfigError && error.code === 'TLS_CERTIFICATE_INVALID'
    ? 'certificate-invalid'
    : 'certificate-required';
  return Object.freeze({
    schemaVersion: 'ready4vibe_certificate_readiness_v1',
    status: options.tlsRequired ? 'blocked' : 'degraded',
    reasonCode,
    nextStep: options.tlsRequired
      ? 'Check the certificate chain and private-key match, then retry the TLS probe.'
      : 'Loopback HTTP remains available; fix the certificate before enabling LAN or public HTTPS.',
    affectsTransport: options.tlsRequired,
    daysRemaining: null,
    hostname: normalizeHostname(options.hostname) ?? null,
  });
}

export function certificateMatchesHostname(certificate: CertificateStatus, hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  if (!normalizedHostname) return false;
  return certificate.subjectAltNames.some((entry) => matchesSanEntry(entry, normalizedHostname));
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

function readinessWithCertificate(
  certificate: CertificateStatus,
  value: Pick<CertificateReadiness, 'status' | 'reasonCode' | 'nextStep' | 'affectsTransport' | 'hostname'>,
): CertificateReadiness {
  return Object.freeze({
    schemaVersion: 'ready4vibe_certificate_readiness_v1',
    ...value,
    daysRemaining: certificate.daysRemaining,
    certificate,
  });
}

function boundedRenewalWindow(value: number | undefined): number {
  return Number.isInteger(value) && value !== undefined && value >= 0 && value <= 365 ? value : 30;
}

function normalizeHostname(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\.$/u, '').toLowerCase();
  if (!normalized || normalized.length > 253 || /[\u0000-\u001F\u007F\s/]/u.test(normalized)) return undefined;
  return normalized;
}

function matchesSanEntry(entry: string, hostname: string): boolean {
  const normalizedEntry = entry.trim().replace(/\.$/u, '').toLowerCase();
  if (!normalizedEntry || normalizedEntry.length > 253) return false;
  if (isIP(hostname) !== 0) return normalizedEntry === hostname;
  if (normalizedEntry.startsWith('*.')) {
    const suffix = normalizedEntry.slice(1);
    return hostname.endsWith(suffix) && hostname.split('.').length === normalizedEntry.split('.').length;
  }
  return normalizedEntry === hostname;
}

function sanitizeMetadata(value: string): string {
  return value.replace(/[\r\n\u0000-\u001F\u007F]/gu, ' ').trim();
}
