import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: pnpm release:manifest -- --version <semver> --channel <nightly|preview|stable> --source-commit <40..64-hex> --minimum-host-version <semver> --artifact-root <dir> --artifact <id:os:arch:fileName> [--artifact <id:os:arch:fileName> ...] --output <file> [--rollback-target <semver>] [--db-schema-min <n>] [--db-schema-max <n>] [--created-at <ISO>] [--release-notes-ref <ref>]';
const PREVIEW_SCHEMA_VERSION = 'release-preflight/v1';
const SAFE_COMMIT = /^[0-9a-f]{40,64}$/u;
const SAFE_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SAFE_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const TARGET_OS = new Set(['windows', 'macos', 'linux']);
const TARGET_ARCH = new Set(['x64', 'arm64']);
const MAX_ARTIFACTS = 16;
const MAX_ARTIFACT_BYTES = 5_000_000_000;

export class ReleasePreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleasePreflightError';
    this.code = code;
  }
}

export function parseReleasePreflightArgs(argv) {
  let productVersion;
  let channel;
  let sourceCommit;
  let minimumHostVersion;
  let artifactRoot;
  let output;
  let rollbackTarget = null;
  let dbSchemaMin = 0;
  let dbSchemaMax = 0;
  let createdAt = new Date().toISOString();
  let releaseNotesRef = null;
  const artifacts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--artifact') {
      artifacts.push(parseArtifactDescriptor(nextValue(argv, ++index)));
      continue;
    }
    if (argument === '--version' || argument === '--channel' || argument === '--source-commit'
      || argument === '--minimum-host-version' || argument === '--artifact-root' || argument === '--output'
      || argument === '--rollback-target' || argument === '--db-schema-min' || argument === '--db-schema-max'
      || argument === '--created-at' || argument === '--release-notes-ref') {
      const value = nextValue(argv, ++index);
      if (argument === '--version') productVersion = value;
      else if (argument === '--channel') channel = value;
      else if (argument === '--source-commit') sourceCommit = value;
      else if (argument === '--minimum-host-version') minimumHostVersion = value;
      else if (argument === '--artifact-root') artifactRoot = value;
      else if (argument === '--output') output = value;
      else if (argument === '--rollback-target') rollbackTarget = value;
      else if (argument === '--db-schema-min') dbSchemaMin = parseBoundedInteger(value);
      else if (argument === '--db-schema-max') dbSchemaMax = parseBoundedInteger(value);
      else if (argument === '--created-at') createdAt = value;
      else releaseNotesRef = value;
      continue;
    }
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARGUMENT_INVALID');
  }

  if (typeof productVersion !== 'string' || !SAFE_SEMVER.test(productVersion)) throw new ReleasePreflightError('RELEASE_PREFLIGHT_VERSION_INVALID');
  if (channel !== 'nightly' && channel !== 'preview' && channel !== 'stable') throw new ReleasePreflightError('RELEASE_PREFLIGHT_CHANNEL_INVALID');
  if (typeof sourceCommit !== 'string' || !SAFE_COMMIT.test(sourceCommit)) throw new ReleasePreflightError('RELEASE_PREFLIGHT_COMMIT_INVALID');
  if (typeof minimumHostVersion !== 'string' || !SAFE_SEMVER.test(minimumHostVersion)) throw new ReleasePreflightError('RELEASE_PREFLIGHT_HOST_VERSION_INVALID');
  if (typeof artifactRoot !== 'string' || artifactRoot.length === 0 || artifactRoot.length > 1_024) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_ROOT_INVALID');
  if (typeof output !== 'string' || output.length === 0 || output.length > 1_024) throw new ReleasePreflightError('RELEASE_PREFLIGHT_OUTPUT_INVALID');
  if (rollbackTarget !== null && !SAFE_SEMVER.test(rollbackTarget)) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ROLLBACK_INVALID');
  if (!SAFE_TIMESTAMP.test(createdAt) || Number.isNaN(Date.parse(createdAt))) throw new ReleasePreflightError('RELEASE_PREFLIGHT_TIMESTAMP_INVALID');
  if (releaseNotesRef !== null && !isSafeReference(releaseNotesRef)) throw new ReleasePreflightError('RELEASE_PREFLIGHT_REFERENCE_INVALID');
  if (artifacts.length === 0 || artifacts.length > MAX_ARTIFACTS) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_COUNT_INVALID');
  return Object.freeze({ productVersion, channel, sourceCommit: sourceCommit.toLowerCase(), minimumHostVersion, artifactRoot, output, rollbackTarget, dbSchemaMin, dbSchemaMax, createdAt, releaseNotesRef, artifacts: Object.freeze(artifacts) });
}

export async function buildReleaseManifest(options, dependencies = {}) {
  const root = await resolveArtifactRoot(options.artifactRoot, dependencies);
  const sortedArtifacts = [...options.artifacts].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
  const artifacts = [];
  for (const descriptor of sortedArtifacts) {
    const artifactPath = await resolveArtifactPath(root, descriptor.fileName, dependencies);
    const stat = await (dependencies.lstat ?? lstat)(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_INVALID');
    if (stat.size <= 0 || stat.size > MAX_ARTIFACT_BYTES) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_SIZE_INVALID');
    const digest = await hashFile(artifactPath, dependencies);
    artifacts.push({
      schemaVersion: 'ready4vibe_release_artifact_v1',
      artifactId: descriptor.artifactId,
      fileName: descriptor.fileName,
      target: { os: descriptor.os, arch: descriptor.arch },
      digest: `sha256:${digest}`,
      sizeBytes: stat.size,
      signatureRefs: [],
      attestationRefs: [],
      sbomRef: null,
    });
  }
  const manifest = {
    schemaVersion: 'ready4vibe_release_manifest_v1',
    productVersion: options.productVersion,
    tag: `v${options.productVersion}`,
    channel: options.channel,
    sourceCommit: options.sourceCommit,
    minimumHostVersion: options.minimumHostVersion,
    dbSchemaMin: options.dbSchemaMin,
    dbSchemaMax: options.dbSchemaMax,
    rollbackTarget: options.rollbackTarget,
    createdAt: options.createdAt,
    artifacts,
    releaseNotesRef: options.releaseNotesRef,
  };
  try {
    const contracts = dependencies.contracts ?? await import('../packages/contracts/dist/index.js');
    return contracts.ReleaseManifestSchema.parse(manifest);
  } catch (error) {
    if (error instanceof ReleasePreflightError) throw error;
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_SCHEMA_INVALID');
  }
}

export async function writeReleaseManifest(manifest, output, dependencies = {}) {
  try {
    const contracts = dependencies.contracts ?? await import('../packages/contracts/dist/index.js');
    const parsed = contracts.ReleaseManifestSchema.parse(manifest);
    const body = `${JSON.stringify(parsed, null, 2)}\n`;
    await (dependencies.writeFile ?? writeFile)(output, body, 'utf8');
    return Object.freeze({
      schemaVersion: PREVIEW_SCHEMA_VERSION,
      status: 'healthy',
      channel: parsed.channel,
      productVersion: parsed.productVersion,
      artifactCount: parsed.artifacts.length,
      totalBytes: parsed.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0),
      manifestDigest: `sha256:${createHash('sha256').update(body).digest('hex')}`,
    });
  } catch (error) {
    if (error instanceof ReleasePreflightError) throw error;
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_OUTPUT_WRITE_FAILED');
  }
}

export function safeReleasePreflightErrorCode(error, fallback = 'RELEASE_PREFLIGHT_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^RELEASE_PREFLIGHT_[A-Z0-9_]{1,64}$/u.test(code) ? code : fallback;
}

function nextValue(argv, index) {
  const value = argv[index];
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARGUMENT_INVALID');
  return value;
}

function parseArtifactDescriptor(value) {
  const parts = value.split(':');
  if (parts.length !== 4) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_DESCRIPTOR_INVALID');
  const [artifactId, os, arch, fileName] = parts;
  if (!SAFE_ARTIFACT_ID.test(artifactId) || !TARGET_OS.has(os) || !TARGET_ARCH.has(arch) || !SAFE_FILE_NAME.test(fileName) || fileName.includes('..')) {
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_DESCRIPTOR_INVALID');
  }
  return Object.freeze({ artifactId, os, arch, fileName });
}

function parseBoundedInteger(value) {
  if (!/^\d{1,7}$/u.test(value)) throw new ReleasePreflightError('RELEASE_PREFLIGHT_NUMBER_INVALID');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000) throw new ReleasePreflightError('RELEASE_PREFLIGHT_NUMBER_INVALID');
  return parsed;
}

function isSafeReference(value) {
  return value.length <= 512 && !/[\u0000-\u0020\u007F]/u.test(value) && !/[?#\\@]/u.test(value)
    && !/api[_-]?key|access[_-]?token|authorization|private[_-]?key|secret|password|credential|latest/iu.test(value)
    && !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value);
}

async function resolveArtifactRoot(value, dependencies) {
  try {
    return await (dependencies.realpath ?? realpath)(resolve(value));
  } catch {
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_ROOT_MISSING');
  }
}

async function resolveArtifactPath(root, fileName, dependencies) {
  const candidate = resolve(root, fileName);
  const relativePath = relative(root, candidate);
  if (!fileName || isAbsolute(fileName) || relativePath.startsWith('..') || isAbsolute(relativePath) || relativePath !== fileName) {
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_PATH_INVALID');
  }
  try {
    const stat = await (dependencies.lstat ?? lstat)(candidate);
    if (stat.isSymbolicLink()) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_SYMLINK');
    return candidate;
  } catch (error) {
    if (error instanceof ReleasePreflightError) throw error;
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_MISSING');
  }
}

async function hashFile(filePath, dependencies) {
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const stream = (dependencies.createReadStream ?? createReadStream)(filePath);
    for await (const chunk of stream) {
      bytes += chunk.length;
      if (bytes > MAX_ARTIFACT_BYTES) throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_SIZE_INVALID');
      hash.update(chunk);
    }
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof ReleasePreflightError) throw error;
    throw new ReleasePreflightError('RELEASE_PREFLIGHT_ARTIFACT_READ_FAILED');
  }
}

async function runCli(argv) {
  const options = parseReleasePreflightArgs(argv);
  if (options.help) return { schemaVersion: PREVIEW_SCHEMA_VERSION, status: 'help', usage: USAGE };
  const manifest = await buildReleaseManifest(options);
  return writeReleaseManifest(manifest, options.output);
}

if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'healthy' || result.status === 'help' ? 0 : 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: PREVIEW_SCHEMA_VERSION, status: 'failed', errorCode: safeReleasePreflightErrorCode(error) })}\n`);
    process.exitCode = 2;
  }
}

function resolvePath(value) {
  return resolve(value);
}
