import { z } from 'zod';

export const HOST_INSTALL_MANIFEST_SCHEMA_VERSION = 'ready4vibe_host_manifest_v1' as const;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_SHAPED = /api[_-]?key|access[_-]?token|authorization|private[_-]?key|secret|password|credential|BEGIN(?:\s+|%20)(?:RSA|EC|OPENSSH|PRIVATE)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\//u;

const BoundedTokenSchema = z.string().min(1).max(128).regex(SAFE_TOKEN, 'value contains unsupported characters');

/**
 * A manifest reference is an opaque locator, not a download instruction. It
 * intentionally excludes query/hash components, credentials, absolute paths
 * and secret-shaped text so a later installer cannot accidentally treat a
 * token-bearing URL or local path as trusted metadata.
 */
const ManifestReferenceSchema = z.string().min(1).max(512)
  .refine((value) => !/[\u0000-\u001F\u007F\s]/u.test(value), 'reference contains control or whitespace characters')
  .refine((value) => !SECRET_SHAPED.test(value), 'secret-shaped reference is not allowed')
  .refine((value) => !WINDOWS_ABSOLUTE.test(value) && !UNC_ABSOLUTE.test(value) && !POSIX_ABSOLUTE.test(value), 'absolute path is not allowed')
  .refine((value) => !value.includes('?') && !value.includes('#') && !value.includes('\\'), 'reference must not contain query, fragment or backslash')
  .refine((value) => !value.includes('@'), 'reference credentials are not allowed');

export const HostInstallTargetSchema = z.object({
  os: z.enum(['windows', 'macos', 'linux']),
  arch: z.enum(['x64', 'arm64']),
  runtime: BoundedTokenSchema,
  libc: BoundedTokenSchema.optional(),
}).strict();

export const HostInstallManifestSchema = z.object({
  schemaVersion: z.literal(HOST_INSTALL_MANIFEST_SCHEMA_VERSION),
  productVersion: z.string().min(1).max(64).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, 'productVersion must be bounded semver'),
  channel: z.enum(['preview', 'beta', 'stable']),
  target: HostInstallTargetSchema,
  runtimeRevision: BoundedTokenSchema,
  webBuildRevision: BoundedTokenSchema,
  dbSchemaMin: z.number().int().nonnegative().max(1_000_000),
  dbSchemaMax: z.number().int().nonnegative().max(1_000_000),
  artifactDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u, 'artifactDigest must be a lowercase SHA-256 reference'),
  signatureRefs: z.array(ManifestReferenceSchema).max(16),
  attestationRefs: z.array(ManifestReferenceSchema).max(16),
  createdAt: z.string().datetime({ offset: true }).max(64),
}).strict().superRefine((value, context) => {
  if (value.dbSchemaMin > value.dbSchemaMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['dbSchemaMin'], message: 'dbSchemaMin must not exceed dbSchemaMax' });
  }
});

export type HostInstallTarget = z.infer<typeof HostInstallTargetSchema>;
export type HostInstallManifest = z.infer<typeof HostInstallManifestSchema>;

export function parseHostInstallManifest(input: unknown): HostInstallManifest {
  return HostInstallManifestSchema.parse(input);
}

export const HostUpdatePhaseSchema = z.enum([
  'idle',
  'discovered',
  'downloaded',
  'digest-verified',
  'signature-verified',
  'staged',
  'migration-preflight',
  'candidate-started',
  'health-checked',
  'smoke-checked',
  'switched',
  'previous-draining',
  'succeeded',
  'failed',
  'rollback-available',
  'rollback-started',
  'rollback-verified',
  'migration-blocked',
  'manual-recovery-required',
]);
export type HostUpdatePhase = z.infer<typeof HostUpdatePhaseSchema>;

const UpdateRevisionSchema = z.string().min(1).max(128).regex(SAFE_TOKEN, 'revision contains unsupported characters').nullable();
const UpdateReasonSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]{0,63}$/u, 'reasonCode is not bounded').nullable();

export const HostUpdateStateSchema = z.object({
  schemaVersion: z.literal('ready4vibe_host_update_state_v1'),
  phase: HostUpdatePhaseSchema,
  currentRevision: UpdateRevisionSchema,
  previousRevision: UpdateRevisionSchema,
  candidateRevision: UpdateRevisionSchema,
  reasonCode: UpdateReasonSchema,
  updatedAt: z.string().datetime({ offset: true }).max(64),
}).strict().superRefine((value, context) => {
  const failurePhase = value.phase === 'failed' || value.phase === 'migration-blocked' || value.phase === 'manual-recovery-required' || value.phase === 'rollback-available';
  if (failurePhase && !value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'failure states require a reasonCode' });
  if (!failurePhase && value.reasonCode) context.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'reasonCode is only allowed for failure/recovery states' });
  if (value.phase === 'rollback-available' && !value.previousRevision) context.addIssue({ code: z.ZodIssueCode.custom, path: ['previousRevision'], message: 'rollback requires a previous revision' });
  if (value.phase === 'idle' && (value.currentRevision || value.previousRevision || value.candidateRevision)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['phase'], message: 'idle state cannot point at a revision' });
});
export type HostUpdateState = z.infer<typeof HostUpdateStateSchema>;

const HOST_UPDATE_TRANSITIONS: Record<HostUpdatePhase, readonly HostUpdatePhase[]> = {
  idle: ['discovered'],
  discovered: ['downloaded', 'failed'],
  downloaded: ['digest-verified', 'failed'],
  'digest-verified': ['signature-verified', 'failed'],
  'signature-verified': ['staged', 'failed'],
  staged: ['migration-preflight', 'failed'],
  'migration-preflight': ['candidate-started', 'migration-blocked', 'failed'],
  'candidate-started': ['health-checked', 'failed'],
  'health-checked': ['smoke-checked', 'failed'],
  'smoke-checked': ['switched', 'failed'],
  switched: ['previous-draining', 'rollback-started'],
  'previous-draining': ['succeeded', 'rollback-started', 'failed'],
  succeeded: [],
  failed: ['rollback-available', 'manual-recovery-required'],
  'rollback-available': ['rollback-started', 'manual-recovery-required'],
  'rollback-started': ['rollback-verified', 'manual-recovery-required'],
  'rollback-verified': ['succeeded', 'manual-recovery-required'],
  'migration-blocked': ['manual-recovery-required'],
  'manual-recovery-required': [],
};

export class HostUpdateTransitionError extends Error {
  readonly code = 'INVALID_HOST_UPDATE_TRANSITION' as const;

  constructor(readonly from: HostUpdatePhase, readonly to: HostUpdatePhase) {
    super(`invalid host update transition: ${from} -> ${to}`);
    this.name = 'HostUpdateTransitionError';
  }
}

export function canTransitionHostUpdate(from: HostUpdatePhase, to: HostUpdatePhase): boolean {
  return HOST_UPDATE_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertHostUpdateTransition(from: HostUpdatePhase, to: HostUpdatePhase): void {
  if (!canTransitionHostUpdate(from, to)) throw new HostUpdateTransitionError(from, to);
}

export function parseHostUpdateState(input: unknown): HostUpdateState {
  return HostUpdateStateSchema.parse(input);
}
