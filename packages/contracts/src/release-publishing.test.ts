import { describe, expect, it } from 'vitest';
import {
  RELEASE_MANIFEST_SCHEMA_VERSION,
  RELEASE_PROMOTION_SCHEMA_VERSION,
  ReleaseManifestSchema,
  ReleasePromotionTransitionError,
  assertReleasePromotionTransition,
  canTransitionReleasePromotion,
  parseReleaseManifest,
  parseReleasePromotionState,
} from './release-publishing.js';

const artifact = {
  schemaVersion: 'ready4vibe_release_artifact_v1' as const,
  artifactId: 'host-windows-x64',
  fileName: 'vibego-1.2.3-win-x64.exe',
  target: { os: 'windows' as const, arch: 'x64' as const },
  digest: 'sha256:' + 'a'.repeat(64),
  sizeBytes: 12_345,
  signatureRefs: ['sigstore://example/v1'],
  attestationRefs: ['https://github.com/stlin256/VibeGo/attestations/v1'],
  sbomRef: 'https://github.com/stlin256/VibeGo/sbom/v1',
};

const manifest = {
  schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
  productVersion: '1.2.3',
  tag: 'v1.2.3',
  channel: 'stable' as const,
  sourceCommit: 'a'.repeat(40),
  minimumHostVersion: '1.0.0',
  dbSchemaMin: 1,
  dbSchemaMax: 2,
  rollbackTarget: '1.2.2',
  createdAt: '2026-08-05T00:00:00.000Z',
  artifacts: [artifact],
  releaseNotesRef: 'https://github.com/stlin256/VibeGo/releases/tag/v1.2.3',
};

describe('release manifest and promotion contract', () => {
  it('accepts an immutable stable manifest with bounded artifacts', () => {
    expect(parseReleaseManifest(manifest)).toEqual(manifest);
    expect(manifest.artifacts[0]?.fileName).not.toContain('latest');
  });

  it('rejects mutable/latest references, secrets, paths, invalid channel tags and unknown fields', () => {
    expect(() => parseReleaseManifest({ ...manifest, latest: true })).toThrow();
    expect(() => parseReleaseManifest({ ...manifest, releaseNotesRef: 'https://example.test/latest' })).toThrow(/latest/iu);
    expect(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, fileName: 'C:\\private\\vibego.exe' }] })).toThrow(/basename|latest|file/iu);
    expect(() => parseReleaseManifest({ ...manifest, releaseNotesRef: 'https://example.test/?api_key=secret' })).toThrow(/secret|query/iu);
    expect(() => parseReleaseManifest({ ...manifest, tag: 'v1.2.4' })).toThrow(/tag|productVersion/iu);
    expect(() => parseReleaseManifest({ ...manifest, artifacts: [{ ...artifact, artifactId: 'latest' }] })).toThrow(/latest/iu);
    expect(() => parseReleaseManifest({ ...manifest, channel: 'preview', productVersion: '1.2.3' })).toThrow(/preview|rc/iu);
    expect(() => parseReleaseManifest({ ...manifest, channel: 'stable', productVersion: '1.2.3-rc.1' })).toThrow(/stable|prerelease/iu);
    expect(() => parseReleaseManifest({ ...manifest, channel: 'stable', rollbackTarget: null })).toThrow(/rollback/iu);
  });

  it('keeps artifact identity, digest and schema bounds strict', () => {
    expect(() => ReleaseManifestSchema.parse({ ...manifest, artifacts: [{ ...artifact, digest: 'sha256:' + 'A'.repeat(64) }] })).toThrow(/SHA-256/iu);
    expect(() => ReleaseManifestSchema.parse({ ...manifest, artifacts: [{ ...artifact, signatureRefs: ['https://example.test/?token=secret'] }] })).toThrow(/secret|query/iu);
    expect(() => ReleaseManifestSchema.parse({ ...manifest, artifacts: [{ ...artifact, artifactId: 'same' }, { ...artifact, artifactId: 'same', fileName: 'other.zip' }] })).toThrow(/unique/iu);
    expect(() => ReleaseManifestSchema.parse({ ...manifest, dbSchemaMin: 3, dbSchemaMax: 2 })).toThrow(/dbSchema/iu);
  });

  it('enforces ordered promotion and permits only published-to-withdrawn after publication', () => {
    expect(canTransitionReleasePromotion('preflight', 'gates-verified')).toBe(true);
    expect(canTransitionReleasePromotion('published', 'withdrawn')).toBe(true);
    expect(canTransitionReleasePromotion('published', 'approved')).toBe(false);
    expect(() => assertReleasePromotionTransition('draft', 'published')).toThrow(ReleasePromotionTransitionError);
    expect(() => assertReleasePromotionTransition('published', 'approved')).toThrow(/invalid/iu);
    const state = { schemaVersion: RELEASE_PROMOTION_SCHEMA_VERSION, phase: 'approved' as const, channel: 'stable' as const, manifestDigest: 'sha256:' + 'b'.repeat(64), updatedAt: '2026-08-05T00:00:00.000Z' };
    expect(parseReleasePromotionState(state)).toEqual(state);
  });

  it('does not serialize credentials, paths or build environment data', () => {
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toMatch(/api[_-]?key|token=|private[_-]?key|C:\\\\|\/Users\//iu);
    expect(serialized).not.toContain('NODE_OPTIONS');
  });
});
