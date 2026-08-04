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
