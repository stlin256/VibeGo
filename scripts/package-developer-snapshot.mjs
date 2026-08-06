import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { execFile as nodeExecFile } from 'node:child_process';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_PATH = fileURLToPath(import.meta.url);
const PREVIEW_SCHEMA_VERSION = 'developer-snapshot/v1';
const SAFE_VERSION = /^\d+\.\d+\.\d+-nightly(?:\.[0-9A-Za-z.-]+)?$/u;
const SAFE_COMMIT = /^[0-9a-f]{40,64}$/u;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const SECRET_VALUE = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*(?:['"][A-Za-z0-9._-]{16,}['"]|(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{32,})/iu;
const ABSOLUTE_USER_PATH = /(?:[A-Za-z]:\\Users\\|\/Users\/|\/home\/|C:\\private\\)/iu;
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.svg', '.txt', '.md', '.yaml', '.yml', '.ts', '.tsx', '.d.ts']);
const SKIP_FILE = /(?:\.map$|\.test\.(?:js|mjs|cjs|d\.ts)$|\.spec\.(?:js|mjs|cjs|d\.ts)$)/u;
const BANNED_SEGMENT = /^(?:\.env(?:\..*)?|\.ready4vibe|\.research|credentials?|.*private.*key.*|.*secret.*|.*\.sqlite(?:3)?|.*\.db)$/iu;

const USAGE = 'usage: pnpm package:developer-snapshot -- --version <0.1.0-nightly...> --source-commit <40..64-hex> --daemon-deploy <dir> --web-dist <dir> --launcher <file> --repo-root <dir> --stage-dir <dir> --output <archive.tar.gz>';

export class DeveloperSnapshotError extends Error {
  constructor(code) {
    super(code);
    this.name = 'DeveloperSnapshotError';
    this.code = code;
  }
}

export function parseDeveloperSnapshotArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    const allowed = new Set(['--version', '--source-commit', '--daemon-deploy', '--web-dist', '--launcher', '--repo-root', '--stage-dir', '--output']);
    if (!allowed.has(argument)) throw new DeveloperSnapshotError('SNAPSHOT_ARGUMENT_INVALID');
    const value = argv[++index];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) throw new DeveloperSnapshotError('SNAPSHOT_ARGUMENT_INVALID');
    values.set(argument, value);
  }
  const version = values.get('--version');
  const sourceCommit = values.get('--source-commit');
  if (typeof version !== 'string' || !SAFE_VERSION.test(version)) throw new DeveloperSnapshotError('SNAPSHOT_VERSION_INVALID');
  if (typeof sourceCommit !== 'string' || !SAFE_COMMIT.test(sourceCommit)) throw new DeveloperSnapshotError('SNAPSHOT_COMMIT_INVALID');
  const paths = Object.fromEntries(['--daemon-deploy', '--web-dist', '--launcher', '--repo-root', '--stage-dir', '--output'].map((key) => [key.slice(2).replaceAll('-', ''), values.get(key)]));
  if (Object.values(paths).some((value) => typeof value !== 'string' || value.length === 0 || value.length > 1_024)) throw new DeveloperSnapshotError('SNAPSHOT_PATH_INVALID');
  return Object.freeze({ version, sourceCommit: sourceCommit.toLowerCase(), daemonDeploy: paths.daemondeploy, webDist: paths.webdist, launcher: paths.launcher, repoRoot: paths.reporoot, stageDir: paths.stagedir, output: paths.output });
}

export async function buildDeveloperSnapshot(options, dependencies = {}) {
  const fsApi = dependencies.fsApi ?? { lstat, mkdir, readFile, readdir, realpath, stat, writeFile };
  const stageRoot = resolve(options.stageDir);
  const snapshotRoot = join(stageRoot, 'vibego-developer-snapshot');
  await ensureEmptyStage(stageRoot, fsApi);
  await mkdir(snapshotRoot, { recursive: true });
  await copyTree(resolve(options.daemonDeploy), join(snapshotRoot, 'daemon'), fsApi, { runtimeOnly: true });
  // Match the daemon's production fallback (`apps/web/dist`) so an extracted
  // snapshot starts through the Host launcher without a source checkout or
  // an environment override.
  await copyTree(resolve(options.webDist), join(snapshotRoot, 'apps', 'web', 'dist'), fsApi);
  await copyFileChecked(resolve(options.launcher), join(snapshotRoot, 'launcher', 'host-launcher.mjs'), fsApi);
  for (const name of ['package.json', 'pnpm-lock.yaml', 'README.md', 'README-zh.md']) {
    await copyFileChecked(join(resolve(options.repoRoot), name), join(snapshotRoot, 'meta', name), fsApi);
  }
  const metadata = {
    schemaVersion: 'vibego_developer_snapshot_v1',
    product: 'VibeGo',
    version: options.version,
    channel: 'nightly',
    sourceCommit: options.sourceCommit,
    target: { os: 'windows', arch: 'x64' },
    signed: false,
    sbom: 'not-generated',
    attestation: 'not-generated',
  };
  await writeFile(join(snapshotRoot, 'snapshot.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  const files = await scanSnapshot(snapshotRoot, fsApi);
  const artifactName = `vibego-${options.version}-windows-x64-developer.tar.gz`;
  const output = resolve(options.output);
  if (basename(output) !== artifactName) throw new DeveloperSnapshotError('SNAPSHOT_OUTPUT_NAME_INVALID');
  await mkdir(dirname(output), { recursive: true });
  await (dependencies.createArchive ?? createArchive)(stageRoot, 'vibego-developer-snapshot', output);
  const archiveStat = await stat(output);
  if (!archiveStat.isFile() || archiveStat.size <= 0) throw new DeveloperSnapshotError('SNAPSHOT_ARCHIVE_INVALID');
  const digest = await hashFile(output, fsApi);
  await writeFile(join(stageRoot, 'SHA256SUMS'), `sha256:${digest}  ${artifactName}\n`, 'utf8');
  await writeFile(join(stageRoot, 'release-notes.md'), buildReleaseNotes(metadata, files), 'utf8');
  return Object.freeze({ schemaVersion: PREVIEW_SCHEMA_VERSION, status: 'healthy', artifactName, sizeBytes: archiveStat.size, digest: `sha256:${digest}`, fileCount: files.length, target: metadata.target, signed: false, stageName: basename(stageRoot) });
}

export function safeDeveloperSnapshotErrorCode(error, fallback = 'SNAPSHOT_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^SNAPSHOT_[A-Z0-9_]{1,64}$/u.test(code) ? code : fallback;
}

async function ensureEmptyStage(stageRoot, fsApi) {
  try {
    const info = await fsApi.lstat(stageRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new DeveloperSnapshotError('SNAPSHOT_STAGE_INVALID');
    const entries = await fsApi.readdir(stageRoot);
    if (entries.length > 0) throw new DeveloperSnapshotError('SNAPSHOT_STAGE_NOT_EMPTY');
  } catch (error) {
    if (error instanceof DeveloperSnapshotError) throw error;
    await fsApi.mkdir(stageRoot, { recursive: true });
  }
}

async function copyTree(source, destination, fsApi, options = {}, sourceRoot = source, seen = new Set()) {
  const info = await fsApi.lstat(source).catch(() => { throw new DeveloperSnapshotError('SNAPSHOT_INPUT_MISSING'); });
  if (options.runtimeOnly && shouldExcludeRuntimePath(source, sourceRoot)) return;
  if (info.isSymbolicLink()) {
    const target = await fsApi.realpath(source).catch(() => { throw new DeveloperSnapshotError('SNAPSHOT_SYMLINK_INVALID'); });
    const escaped = relative(sourceRoot, target).startsWith('..');
    // pnpm deploy leaves one self-reference for the daemon package. It is not
    // needed at runtime and is omitted rather than copying a workspace path.
    if (escaped && isKnownDaemonSelfLink(source)) return;
    if (escaped) throw new DeveloperSnapshotError('SNAPSHOT_SYMLINK_ESCAPE');
    // A pnpm deploy has several aliases to the same workspace package. Those
    // aliases must each be materialized at their destination after extraction;
    // use the set only as a recursion-path guard so dependency cycles terminate.
    if (seen.has(target)) return;
    seen.add(target);
    try {
      return await copyTree(target, destination, fsApi, options, sourceRoot, seen);
    } finally {
      seen.delete(target);
    }
  }
  if (info.isDirectory()) {
    await fsApi.mkdir(destination, { recursive: true });
    for (const entry of await fsApi.readdir(source, { withFileTypes: true })) {
      if (BANNED_SEGMENT.test(entry.name)) throw new DeveloperSnapshotError('SNAPSHOT_FORBIDDEN_CONTENT');
      await copyTree(join(source, entry.name), join(destination, entry.name), fsApi, options, sourceRoot, seen);
    }
    return;
  }
  if (!info.isFile()) throw new DeveloperSnapshotError('SNAPSHOT_INPUT_INVALID');
  if (options.runtimeOnly && shouldExcludeRuntimePath(source, sourceRoot)) return;
  if (SKIP_FILE.test(basename(source))) return;
  await copyFileChecked(source, destination, fsApi);
}

/**
 * A pnpm deploy contains package sources in addition to compiled output. The
 * snapshot is a runnable artifact, so source-only material is deliberately
 * excluded before the privacy scan. This also keeps test fixtures and source
 * maps out of a public developer download.
 */
function shouldExcludeRuntimePath(source, sourceRoot) {
  const rel = relative(sourceRoot, source).replaceAll('\\', '/');
  if (!rel) return false;
  if (rel === 'src' || rel.startsWith('src/')) return true;
  const name = basename(source);
  return name.toLowerCase() === 'tsconfig.json' || /(?:\.d\.ts|\.tsx?)$/iu.test(name);
}

function isKnownDaemonSelfLink(source) {
  return /node_modules[\\/](?:\.pnpm[\\/].*)?node_modules[\\/]@ready4vibe[\\/]daemon$/iu.test(source);
}

async function copyFileChecked(source, destination, fsApi) {
  if (BANNED_SEGMENT.test(basename(source))) throw new DeveloperSnapshotError('SNAPSHOT_FORBIDDEN_CONTENT');
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { force: true, errorOnExist: false, dereference: true });
}

async function scanSnapshot(root, fsApi, relativeRoot = root) {
  const files = [];
  for (const entry of await fsApi.readdir(root, { withFileTypes: true })) {
    const source = join(root, entry.name);
    const rel = relative(relativeRoot, source).replaceAll('\\', '/');
    if (BANNED_SEGMENT.test(entry.name) || rel.includes('..')) throw new DeveloperSnapshotError('SNAPSHOT_FORBIDDEN_CONTENT');
    if (entry.isDirectory()) {
      files.push(...await scanSnapshot(source, fsApi, relativeRoot));
      continue;
    }
    if (!entry.isFile() || SKIP_FILE.test(entry.name)) continue;
    const info = await fsApi.lstat(source);
    if (info.isSymbolicLink()) throw new DeveloperSnapshotError('SNAPSHOT_SYMLINK_INVALID');
    const extension = extname(entry.name).toLowerCase();
    if (TEXT_EXTENSIONS.has(extension) && info.size <= 4 * 1024 * 1024) {
      const text = await fsApi.readFile(source, 'utf8');
      if (SECRET_VALUE.test(text)) throw new DeveloperSnapshotError('SNAPSHOT_SECRET_CONTENT');
      if (ABSOLUTE_USER_PATH.test(text)) throw new DeveloperSnapshotError('SNAPSHOT_ABSOLUTE_PATH_CONTENT');
    }
    files.push(rel);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function hashFile(path, fsApi) {
  const hash = createHash('sha256');
  const content = await fsApi.readFile(path);
  hash.update(content);
  return hash.digest('hex');
}

function buildReleaseNotes(metadata, files) {
  return `# VibeGo ${metadata.version}\n\nDeveloper nightly snapshot for Windows x64.\n\n- Source commit: \`${metadata.sourceCommit}\`\n- Signed: no (developer snapshot)\n- SBOM/attestation: not generated in this slice\n- Files: ${files.length} bounded files\n\nRun \`node launcher/host-launcher.mjs --help\` for the Host launcher boundary.\n`;
}

function createArchive(stageRoot, directoryName, output) {
  return new Promise((resolvePromise, reject) => {
    // GNU tar (MSYS/Git Bash) treats a drive-letter colon in the -f archive
    // name as a remote host ("Cannot connect to C:"). Spawn from the output
    // directory and pass only the basename so both GNU tar and Windows bsdtar
    // accept the path.
    nodeExecFile('tar', ['-czf', basename(output), '-C', stageRoot, directoryName], { cwd: dirname(output), windowsHide: true }, (error, _stdout, _stderr) => {
      if (error) reject(new DeveloperSnapshotError('SNAPSHOT_ARCHIVE_CREATE_FAILED'));
      else resolvePromise();
    });
  });
}

async function runCli(argv) {
  const options = parseDeveloperSnapshotArgs(argv);
  if (options.help) return { schemaVersion: PREVIEW_SCHEMA_VERSION, status: 'help', usage: USAGE };
  return buildDeveloperSnapshot(options);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(MODULE_PATH)) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'healthy' || result.status === 'help' ? 0 : 2;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: PREVIEW_SCHEMA_VERSION, status: 'failed', errorCode: safeDeveloperSnapshotErrorCode(error) })}\n`);
    process.exitCode = 2;
  }
}
