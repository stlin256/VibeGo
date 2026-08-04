import { describe, expect, it } from 'vitest';
import { HostInstallManifestSchema, HOST_INSTALL_MANIFEST_SCHEMA_VERSION, parseHostInstallManifest } from './host-release.js';

const manifest = {
  schemaVersion: HOST_INSTALL_MANIFEST_SCHEMA_VERSION,
  productVersion: '0.1.0-beta.1',
  channel: 'beta' as const,
  target: { os: 'windows' as const, arch: 'x64' as const, runtime: 'node-22', libc: 'msvc' },
  runtimeRevision: 'node-22.12.0',
  webBuildRevision: 'web-20260805',
  dbSchemaMin: 1,
  dbSchemaMax: 4,
  artifactDigest: `sha256:${'a'.repeat(64)}`,
  signatureRefs: ['https://github.com/ready4vibe/vibego/attestations/1'],
  attestationRefs: ['urn:ready4vibe:attestation:1'],
  createdAt: '2026-08-05T00:00:00.000Z',
};

describe('host-manifest/v1 contract', () => {
  it('accepts a bounded platform manifest and preserves its safe fields', () => {
    expect(parseHostInstallManifest(manifest)).toMatchObject({
      schemaVersion: HOST_INSTALL_MANIFEST_SCHEMA_VERSION,
      target: { os: 'windows', arch: 'x64' },
      artifactDigest: `sha256:${'a'.repeat(64)}`,
    });
  });

  it('rejects unknown fields, invalid digest/time and incompatible schema range', () => {
    expect(() => HostInstallManifestSchema.parse({ ...manifest, unexpected: true })).toThrow();
    expect(() => HostInstallManifestSchema.parse({ ...manifest, artifactDigest: `sha256:${'A'.repeat(64)}` })).toThrow();
    expect(() => HostInstallManifestSchema.parse({ ...manifest, createdAt: 'not-a-date' })).toThrow();
    expect(() => HostInstallManifestSchema.parse({ ...manifest, dbSchemaMin: 5, dbSchemaMax: 4 })).toThrow(/dbSchemaMin/iu);
  });

  it('rejects secrets, query credentials and absolute paths in references/target labels', () => {
    expect(() => HostInstallManifestSchema.parse({ ...manifest, signatureRefs: ['https://example.test/release?api_key=hidden'] })).toThrow(/secret-shaped|query/iu);
    expect(() => HostInstallManifestSchema.parse({ ...manifest, attestationRefs: ['C:\\Users\\private\\attestation.json'] })).toThrow(/absolute path/iu);
    expect(() => HostInstallManifestSchema.parse({ ...manifest, target: { ...manifest.target, runtime: 'C:\\Program Files\\node' } })).toThrow();
  });

  it('keeps references bounded and rejects path-like or credential-bearing values', () => {
    expect(() => HostInstallManifestSchema.parse({ ...manifest, signatureRefs: ['/tmp/signature'] })).toThrow(/absolute path/iu);
    expect(() => HostInstallManifestSchema.parse({ ...manifest, signatureRefs: ['https://user@example.test/signature'] })).toThrow(/credentials/iu);
    expect(() => HostInstallManifestSchema.parse({ ...manifest, signatureRefs: ['x'.repeat(513)] })).toThrow();
  });
});
