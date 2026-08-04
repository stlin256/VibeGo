import { z } from 'zod';

export const DEPLOYMENT_PROFILE_SCHEMA_VERSION = 'ready4vibe_deployment_v1' as const;
export const DEPLOYMENT_READINESS_SCHEMA_VERSION = 'ready4vibe_deployment_readiness_v1' as const;

const CONTROL_TEXT = /^[^\u0000-\u001F\u007F\r\n]*$/u;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/]|$))/u;
const HOSTNAME = /^(?:localhost|(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}|(?:\d{1,3}\.){3}\d{1,3})$/u;
const PROXY_CIDR = /^(?:(?:\d{1,3}\.){3}\d{1,3}\/(?:3[0-2]|[12]?\d)|[0-9A-Fa-f:]+\/(?:12[0-8]|1[01]\d|[1-9]?\d))$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

const optionalHostname = z.string().min(1).max(253).regex(CONTROL_TEXT).regex(HOSTNAME, 'hostname is invalid')
  .refine((value) => !SECRET_VALUE.test(value), 'secret-shaped hostname is not allowed')
  .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute path is not allowed');

const trustedProxyCidr = z.string().min(1).max(64).regex(CONTROL_TEXT).regex(PROXY_CIDR, 'trusted proxy CIDR is invalid')
  .refine((value) => !SECRET_VALUE.test(value), 'secret-shaped proxy value is not allowed')
  .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute path is not allowed');

export const DeploymentModeSchema = z.enum(['loopback', 'lan', 'tailscale', 'ssh', 'public-direct', 'public-proxy']);
export type DeploymentMode = z.infer<typeof DeploymentModeSchema>;

export const DeploymentCertificateSourceSchema = z.enum(['none', 'file', 'acme', 'reverse-proxy']);
export type DeploymentCertificateSource = z.infer<typeof DeploymentCertificateSourceSchema>;

export const DeploymentCertificateChallengeSchema = z.enum(['none', 'http-01', 'dns-01']);
export type DeploymentCertificateChallenge = z.infer<typeof DeploymentCertificateChallengeSchema>;

export const DeploymentProfileSchema = z.object({
  schemaVersion: z.literal(DEPLOYMENT_PROFILE_SCHEMA_VERSION),
  mode: DeploymentModeSchema,
  tlsRequired: z.boolean(),
  allowInsecureLan: z.boolean(),
  certificateSource: DeploymentCertificateSourceSchema,
  certificateChallenge: DeploymentCertificateChallengeSchema,
  publicHostname: optionalHostname.nullable(),
  trustedProxyCidrs: z.array(trustedProxyCidr).max(8),
  renewalWindowDays: z.number().int().min(0).max(365),
  connectionLimit: z.number().int().min(1).max(256),
  requestsPerMinute: z.number().int().min(1).max(6_000),
}).strict().superRefine((value, context) => {
  if (value.allowInsecureLan && value.mode !== 'lan') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['allowInsecureLan'], message: 'insecure LAN override is only valid for lan mode' });
  }
  if (value.certificateChallenge !== 'none' && value.certificateSource !== 'acme') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['certificateChallenge'], message: 'ACME challenge requires the acme certificate source' });
  }
  if (value.mode === 'public-direct' && value.certificateSource === 'reverse-proxy') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['certificateSource'], message: 'public-direct cannot use reverse-proxy certificate source' });
  }
  if (value.mode === 'public-proxy' && value.certificateSource === 'acme') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['certificateSource'], message: 'public-proxy certificate is owned by the reverse proxy' });
  }
});
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const DeploymentReadinessStatusSchema = z.enum(['ready', 'degraded', 'blocked', 'unknown']);
export type DeploymentReadinessStatus = z.infer<typeof DeploymentReadinessStatusSchema>;

export const DeploymentReadinessReasonCodeSchema = z.enum([
  'loopback-ready',
  'deployment-ready',
  'tls-required',
  'insecure-transport-disabled',
  'certificate-required',
  'certificate-invalid',
  'certificate-degraded',
  'hostname-required',
  'proxy-trust-required',
  'proxy-trust-invalid',
  'adapter-health-unknown',
  'adapter-unavailable',
]);
export type DeploymentReadinessReasonCode = z.infer<typeof DeploymentReadinessReasonCodeSchema>;

export const DeploymentReadinessNextStepSchema = z.enum([
  'none',
  'configure-tls',
  'configure-certificate',
  'check-certificate',
  'configure-hostname',
  'configure-proxy-trust',
  'check-adapter',
]);
export type DeploymentReadinessNextStep = z.infer<typeof DeploymentReadinessNextStepSchema>;

export const DeploymentReadinessSchema = z.object({
  schemaVersion: z.literal(DEPLOYMENT_READINESS_SCHEMA_VERSION),
  mode: DeploymentModeSchema,
  status: DeploymentReadinessStatusSchema,
  reasonCode: DeploymentReadinessReasonCodeSchema,
  nextStep: DeploymentReadinessNextStepSchema,
  affectsInteractiveRun: z.boolean(),
  evaluatedAt: z.string().regex(ISO_TIMESTAMP).refine((value) => Number.isFinite(Date.parse(value)), 'evaluatedAt must be an ISO timestamp'),
}).strict();
export type DeploymentReadiness = z.infer<typeof DeploymentReadinessSchema>;

export const DeploymentEvidenceStateSchema = z.enum(['ready', 'degraded', 'blocked', 'unknown']);
export type DeploymentEvidenceState = z.infer<typeof DeploymentEvidenceStateSchema>;

export interface DeploymentReadinessEvidence {
  readonly certificate?: DeploymentEvidenceState;
  readonly adapter?: DeploymentEvidenceState;
  readonly proxyTrust?: DeploymentEvidenceState;
}

export const DEFAULT_DEPLOYMENT_PROFILE: DeploymentProfile = Object.freeze({
  schemaVersion: DEPLOYMENT_PROFILE_SCHEMA_VERSION,
  mode: 'loopback',
  tlsRequired: false,
  allowInsecureLan: false,
  certificateSource: 'none',
  certificateChallenge: 'none',
  publicHostname: null,
  trustedProxyCidrs: [],
  renewalWindowDays: 30,
  connectionLimit: 64,
  requestsPerMinute: 600,
});

export function createDeploymentProfile(mode: DeploymentMode): DeploymentProfile {
  const tlsRequired = mode !== 'loopback';
  const certificateSource: DeploymentCertificateSource = mode === 'public-proxy' ? 'reverse-proxy' : 'none';
  return DeploymentProfileSchema.parse({
    ...DEFAULT_DEPLOYMENT_PROFILE,
    mode,
    tlsRequired,
    certificateSource,
  });
}

export function parseDeploymentProfile(value: unknown): DeploymentProfile {
  return DeploymentProfileSchema.parse(value);
}

export function parseDeploymentReadiness(value: unknown): DeploymentReadiness {
  return DeploymentReadinessSchema.parse(value);
}

export function buildDeploymentReadiness(
  profile: DeploymentProfile,
  evidence: DeploymentReadinessEvidence = {},
  evaluatedAt = new Date().toISOString(),
): DeploymentReadiness {
  const checked = DeploymentProfileSchema.parse(profile);
  const base = { schemaVersion: DEPLOYMENT_READINESS_SCHEMA_VERSION, mode: checked.mode, evaluatedAt } as const;
  if (checked.mode === 'loopback') return readiness({ ...base, status: 'ready', reasonCode: 'loopback-ready', nextStep: 'none', affectsInteractiveRun: false });
  if (!checked.tlsRequired) return readiness({ ...base, status: 'blocked', reasonCode: checked.mode === 'lan' ? 'insecure-transport-disabled' : 'tls-required', nextStep: 'configure-tls', affectsInteractiveRun: true });
  if (checked.mode === 'lan' || checked.mode === 'public-direct') {
    if (checked.mode === 'public-direct' && checked.publicHostname === null) return readiness({ ...base, status: 'blocked', reasonCode: 'hostname-required', nextStep: 'configure-hostname', affectsInteractiveRun: true });
    const certificate = evidence.certificate ?? 'unknown';
    if (certificate === 'ready') return readiness({ ...base, status: 'ready', reasonCode: 'deployment-ready', nextStep: 'none', affectsInteractiveRun: false });
    if (certificate === 'degraded') return readiness({ ...base, status: 'degraded', reasonCode: 'certificate-degraded', nextStep: 'check-certificate', affectsInteractiveRun: false });
    return readiness({ ...base, status: 'blocked', reasonCode: certificate === 'blocked' ? 'certificate-invalid' : 'certificate-required', nextStep: 'configure-certificate', affectsInteractiveRun: true });
  }
  if (checked.mode === 'public-proxy') {
    if (checked.trustedProxyCidrs.length === 0) return readiness({ ...base, status: 'blocked', reasonCode: 'proxy-trust-required', nextStep: 'configure-proxy-trust', affectsInteractiveRun: true });
    const proxyTrust = evidence.proxyTrust ?? 'unknown';
    if (proxyTrust === 'ready') return readiness({ ...base, status: 'ready', reasonCode: 'deployment-ready', nextStep: 'none', affectsInteractiveRun: false });
    if (proxyTrust === 'blocked') return readiness({ ...base, status: 'blocked', reasonCode: 'proxy-trust-invalid', nextStep: 'configure-proxy-trust', affectsInteractiveRun: true });
    return readiness({ ...base, status: 'unknown', reasonCode: 'adapter-health-unknown', nextStep: 'check-adapter', affectsInteractiveRun: false });
  }
  const adapter = evidence.adapter ?? 'unknown';
  if (adapter === 'ready') return readiness({ ...base, status: 'ready', reasonCode: 'deployment-ready', nextStep: 'none', affectsInteractiveRun: false });
  if (adapter === 'blocked') return readiness({ ...base, status: 'blocked', reasonCode: 'adapter-unavailable', nextStep: 'check-adapter', affectsInteractiveRun: true });
  return readiness({ ...base, status: adapter === 'degraded' ? 'degraded' : 'unknown', reasonCode: 'adapter-health-unknown', nextStep: 'check-adapter', affectsInteractiveRun: false });
}

function readiness(value: DeploymentReadiness): DeploymentReadiness {
  return DeploymentReadinessSchema.parse(value);
}
