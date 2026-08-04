import { z } from 'zod';

export const RELEASE_MANIFEST_SCHEMA_VERSION = 'ready4vibe_release_manifest_v1' as const;
export const RELEASE_ARTIFACT_SCHEMA_VERSION = 'ready4vibe_release_artifact_v1' as const;
export const RELEASE_PROMOTION_SCHEMA_VERSION = 'ready4vibe_release_promotion_v1' as const;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const COMMIT = /^[0-9a-f]{40,64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_SHAPED = /api[_-]?key|access[_-]?token|authorization|private[_-]?key|secret|password|credential|BEGIN(?:\s+|%20)(?:RSA|EC|OPENSSH|PRIVATE)/iu;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007F]/u;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\|\/)/u;
const IMMUTABLE_REFERENCE = z.string().min(1).max(512)
  .refine((value) => !CONTROL_OR_SPACE.test(value), 'reference contains control or whitespace characters')
  .refine((value) => !SECRET_SHAPED.test(value), 'secret-shaped reference is not allowed')
  .refine((value) => !ABSOLUTE_PATH.test(value), 'absolute path is not allowed')
  .refine((value) => !value.includes('?') && !value.includes('#') && !value.includes('\\'), 'reference must not contain query, fragment or backslash')
  .refine((value) => !value.includes('@'), 'reference credentials are not allowed')
  .refine((value) => !/\blatest\b/iu.test(value), 'mutable latest references are not allowed');

const RevisionSchema = z.string().min(1).max(128).regex(SAFE_TOKEN, 'revision is not bounded')
  .refine((value) => !/^latest$/iu.test(value), 'mutable latest revisions are not allowed');
const SemverSchema = z.string().min(5).max(64).regex(SEMVER, 'version must be bounded semver');
const TimestampSchema = z.string().datetime({ offset: true }).max(64);

export const ReleaseChannelSchema = z.enum(['nightly', 'preview', 'stable']);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const ReleaseTargetSchema = z.object({
  os: z.enum(['windows', 'macos', 'linux']),
  arch: z.enum(['x64', 'arm64']),
}).strict();
export type ReleaseTarget = z.infer<typeof ReleaseTargetSchema>;

export const ReleaseArtifactSchema = z.object({
  schemaVersion: z.literal(RELEASE_ARTIFACT_SCHEMA_VERSION),
  artifactId: RevisionSchema,
  fileName: z.string().min(1).max(128).regex(FILE_NAME, 'artifact file name must be a safe basename').refine((value) => !/\blatest\b/iu.test(value), 'mutable latest artifact names are not allowed'),
  target: ReleaseTargetSchema,
  digest: z.string().regex(DIGEST, 'artifact digest must be a lowercase SHA-256 reference'),
  sizeBytes: z.number().int().positive().max(5_000_000_000),
  signatureRefs: z.array(IMMUTABLE_REFERENCE).max(8),
  attestationRefs: z.array(IMMUTABLE_REFERENCE).max(8),
  sbomRef: IMMUTABLE_REFERENCE.nullable(),
}).strict();
export type ReleaseArtifact = z.infer<typeof ReleaseArtifactSchema>;

export const ReleaseManifestSchema = z.object({
  schemaVersion: z.literal(RELEASE_MANIFEST_SCHEMA_VERSION),
  productVersion: SemverSchema,
  tag: z.string().min(5).max(64).regex(RELEASE_TAG, 'release tag must be an immutable vSemVer tag'),
  channel: ReleaseChannelSchema,
  sourceCommit: z.string().regex(COMMIT, 'sourceCommit must be a full hexadecimal commit'),
  minimumHostVersion: SemverSchema,
  dbSchemaMin: z.number().int().nonnegative().max(1_000_000),
  dbSchemaMax: z.number().int().nonnegative().max(1_000_000),
  rollbackTarget: SemverSchema.nullable(),
  createdAt: TimestampSchema,
  artifacts: z.array(ReleaseArtifactSchema).min(1).max(16),
  releaseNotesRef: IMMUTABLE_REFERENCE.nullable(),
}).strict().superRefine((value, context) => {
  if (value.dbSchemaMin > value.dbSchemaMax) context.addIssue({ code: z.ZodIssueCode.custom, path: ['dbSchemaMin'], message: 'dbSchemaMin must not exceed dbSchemaMax' });
  if (`v${value.productVersion}` !== value.tag) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tag'], message: 'tag must match productVersion' });
  const prerelease = value.productVersion.includes('-');
  if (value.channel === 'stable' && prerelease) context.addIssue({ code: z.ZodIssueCode.custom, path: ['productVersion'], message: 'stable releases cannot use a prerelease version' });
  if (value.channel === 'stable' && !value.rollbackTarget) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rollbackTarget'], message: 'stable releases require a rollback target' });
  if (value.channel === 'preview' && !/-rc(?:\.|$)/u.test(value.productVersion)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['productVersion'], message: 'preview releases require an rc prerelease' });
  if (value.channel === 'nightly' && !/-nightly(?:\.|$)/u.test(value.productVersion)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['productVersion'], message: 'nightly releases require a nightly prerelease' });
  if (value.rollbackTarget === value.productVersion) context.addIssue({ code: z.ZodIssueCode.custom, path: ['rollbackTarget'], message: 'rollback target must differ from productVersion' });
  const artifactIds = value.artifacts.map((artifact) => artifact.artifactId);
  if (new Set(artifactIds).size !== artifactIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['artifacts'], message: 'artifactId values must be unique' });
  const fileNames = value.artifacts.map((artifact) => artifact.fileName);
  if (new Set(fileNames).size !== fileNames.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['artifacts'], message: 'artifact file names must be unique' });
});
export type ReleaseManifest = z.infer<typeof ReleaseManifestSchema>;

export const ReleasePromotionPhaseSchema = z.enum(['preflight', 'gates-verified', 'draft', 'approved', 'published', 'withdrawn']);
export type ReleasePromotionPhase = z.infer<typeof ReleasePromotionPhaseSchema>;

export const ReleasePromotionStateSchema = z.object({
  schemaVersion: z.literal(RELEASE_PROMOTION_SCHEMA_VERSION),
  phase: ReleasePromotionPhaseSchema,
  channel: ReleaseChannelSchema,
  manifestDigest: z.string().regex(DIGEST, 'manifestDigest must be a lowercase SHA-256 reference'),
  updatedAt: TimestampSchema,
}).strict();
export type ReleasePromotionState = z.infer<typeof ReleasePromotionStateSchema>;

const PROMOTION_TRANSITIONS: Record<ReleasePromotionPhase, readonly ReleasePromotionPhase[]> = {
  preflight: ['gates-verified'],
  'gates-verified': ['draft'],
  draft: ['approved'],
  approved: ['published'],
  published: ['withdrawn'],
  withdrawn: [],
};

export class ReleasePromotionTransitionError extends Error {
  readonly code = 'INVALID_RELEASE_PROMOTION_TRANSITION' as const;

  constructor(readonly from: ReleasePromotionPhase, readonly to: ReleasePromotionPhase) {
    super(`invalid release promotion transition: ${from} -> ${to}`);
    this.name = 'ReleasePromotionTransitionError';
  }
}

export function canTransitionReleasePromotion(from: ReleasePromotionPhase, to: ReleasePromotionPhase): boolean {
  return PROMOTION_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertReleasePromotionTransition(from: ReleasePromotionPhase, to: ReleasePromotionPhase): void {
  if (!canTransitionReleasePromotion(from, to)) throw new ReleasePromotionTransitionError(from, to);
}

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  return ReleaseManifestSchema.parse(input);
}

export function parseReleasePromotionState(input: unknown): ReleasePromotionState {
  return ReleasePromotionStateSchema.parse(input);
}
