import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildReleaseManifest,
  parseReleasePreflightArgs,
  safeReleasePreflightErrorCode,
  writeReleaseManifest,
} from './release-preflight.mjs';

const contracts = await import('../packages/contracts/dist/index.js');

function baseOptions(root, output, overrides = {}) {
  return {
    productVersion: '0.1.0-nightly.20260806',
    channel: 'nightly',
    sourceCommit: 'a'.repeat(40),
    minimumHostVersion: '0.1.0',
    artifactRoot: root,
    output,
    rollbackTarget: null,
    dbSchemaMin: 0,
    dbSchemaMax: 0,
    createdAt: '2026-08-06T00:00:00.000Z',
    releaseNotesRef: 'notes/nightly-20260806',
    artifacts: [
      { artifactId: 'host-win-x64', os: 'windows', arch: 'x64', fileName: 'ready4vibe-win-x64.zip' },
    ],
    ...overrides,
  };
}

test('parses explicit release metadata and rejects unsafe arguments', () => {
  const parsed = parseReleasePreflightArgs([
    '--version', '0.1.0-nightly.20260806', '--channel', 'nightly',
    '--source-commit', 'a'.repeat(40), '--minimum-host-version', '0.1.0',
    '--artifact-root', 'stage', '--artifact', 'host-win-x64:windows:x64:ready4vibe-win-x64.zip',
    '--output', 'manifest.json', '--created-at', '2026-08-06T00:00:00Z',
  ]);
  assert.equal(parsed.sourceCommit, 'a'.repeat(40));
  assert.throws(() => parseReleasePreflightArgs(['--version', '0.1.0', '--channel', 'nightly']), /COMMIT_INVALID/u);
  assert.throws(() => parseReleasePreflightArgs(['--version', '0.1.0-nightly.1', '--channel', 'nightly', '--source-commit', 'a'.repeat(40), '--minimum-host-version', '0.1.0', '--artifact-root', 'stage', '--artifact', 'id:windows:x64:../secret', '--output', 'manifest.json']), /DESCRIPTOR_INVALID/u);
});

test('hashes bounded artifacts deterministically and validates multi-target output', async () => {
  const root = await mkdtemp(join(process.cwd(), '.ready4vibe', 'release-preflight-'));
  try {
    await writeFile(join(root, 'ready4vibe-win-x64.zip'), 'windows-artifact\n', 'utf8');
    await writeFile(join(root, 'ready4vibe-linux-arm64.tar.gz'), 'linux-artifact\n', 'utf8');
    const options = baseOptions(root, join(root, 'manifest.json'), {
      artifacts: [
        { artifactId: 'host-linux-arm64', os: 'linux', arch: 'arm64', fileName: 'ready4vibe-linux-arm64.tar.gz' },
        { artifactId: 'host-win-x64', os: 'windows', arch: 'x64', fileName: 'ready4vibe-win-x64.zip' },
      ],
    });
    const first = await buildReleaseManifest(options, { contracts });
    const second = await buildReleaseManifest(options, { contracts });
    assert.deepEqual(first, second);
    assert.equal(first.artifacts.length, 2);
    assert.match(first.artifacts[0].digest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(first.artifacts[0].signatureRefs.length, 0);
    const report = await writeReleaseManifest(first, options.output, { contracts });
    const persisted = JSON.parse(await readFile(options.output, 'utf8'));
    assert.deepEqual(persisted, first);
    assert.equal(report.status, 'healthy');
    assert.equal(report.artifactCount, 2);
    assert.doesNotMatch(JSON.stringify(persisted), /release-preflight-|C:\\|token|secret|api[_-]?key/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed for missing, traversal and symlink artifacts', async () => {
  const root = await mkdtemp(join(process.cwd(), '.ready4vibe', 'release-preflight-'));
  try {
    await assert.rejects(() => buildReleaseManifest(baseOptions(root, join(root, 'manifest.json'), {
      artifacts: [{ artifactId: 'missing', os: 'windows', arch: 'x64', fileName: 'missing.zip' }],
    }), { contracts }), (error) => safeReleasePreflightErrorCode(error) === 'RELEASE_PREFLIGHT_ARTIFACT_MISSING');
    await assert.rejects(() => buildReleaseManifest(baseOptions(root, join(root, 'manifest.json'), {
      artifacts: [{ artifactId: 'link', os: 'windows', arch: 'x64', fileName: 'link.zip' }],
    }), {
      contracts,
      lstat: async (path) => path.endsWith('link.zip') ? { isSymbolicLink: () => true, isFile: () => false } : lstat(path),
    }), (error) => safeReleasePreflightErrorCode(error) === 'RELEASE_PREFLIGHT_ARTIFACT_SYMLINK');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stable manifest requires an explicit distinct rollback target', async () => {
  const root = await mkdtemp(join(process.cwd(), '.ready4vibe', 'release-preflight-'));
  try {
    await writeFile(join(root, 'ready4vibe.zip'), 'stable-artifact', 'utf8');
    const options = baseOptions(root, join(root, 'manifest.json'), {
      productVersion: '0.1.0',
      channel: 'stable',
      artifacts: [{ artifactId: 'host', os: 'windows', arch: 'x64', fileName: 'ready4vibe.zip' }],
    });
    await assert.rejects(() => buildReleaseManifest(options, { contracts }), (error) => safeReleasePreflightErrorCode(error) === 'RELEASE_PREFLIGHT_SCHEMA_INVALID');
    const valid = await buildReleaseManifest({ ...options, rollbackTarget: '0.0.9' }, { contracts });
    assert.equal(valid.rollbackTarget, '0.0.9');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('safe error projection omits raw filesystem details', () => {
  assert.equal(safeReleasePreflightErrorCode({ code: 'RELEASE_PREFLIGHT_ARTIFACT_MISSING', message: 'C:\\private\\secret' }), 'RELEASE_PREFLIGHT_ARTIFACT_MISSING');
  assert.equal(safeReleasePreflightErrorCode(new Error('C:\\private\\secret')), 'RELEASE_PREFLIGHT_FAILED');
});
