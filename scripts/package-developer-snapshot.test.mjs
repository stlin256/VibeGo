import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDeveloperSnapshot,
  parseDeveloperSnapshotArgs,
  safeDeveloperSnapshotErrorCode,
} from './package-developer-snapshot.mjs';

test('parses nightly metadata and rejects non-nightly or unknown arguments', () => {
  const parsed = parseDeveloperSnapshotArgs(['--version', '0.1.0-nightly.20260806.1', '--source-commit', 'a'.repeat(40), '--daemon-deploy', 'daemon', '--web-dist', 'web', '--launcher', 'launcher.mjs', '--repo-root', 'repo', '--stage-dir', 'stage', '--output', 'out.tar.gz']);
  assert.equal(parsed.sourceCommit, 'a'.repeat(40));
  assert.throws(() => parseDeveloperSnapshotArgs(['--version', '0.1.0', '--source-commit', 'a'.repeat(40)]), /VERSION_INVALID/u);
  assert.throws(() => parseDeveloperSnapshotArgs(['--unknown']), /ARGUMENT_INVALID/u);
});

test('packages a bounded runnable-shaped snapshot and emits no absolute paths', async () => {
  const root = await mkdtemp(join(process.cwd(), '.ready4vibe', 'snapshot-test-'));
  try {
    const daemon = join(root, 'daemon');
    const web = join(root, 'web');
    const repo = join(root, 'repo');
    const stage = join(root, 'stage');
    await mkdir(join(daemon, 'dist'), { recursive: true });
    await mkdir(join(daemon, 'src'), { recursive: true });
    await mkdir(web, { recursive: true });
    await mkdir(repo, { recursive: true });
    await writeFile(join(daemon, 'dist', 'main.js'), 'console.log("daemon");\n', 'utf8');
    await writeFile(join(daemon, 'dist', 'fixture.test.js'), 'api_key=sk-never-include-1234567890\n', 'utf8');
    await writeFile(join(daemon, 'src', 'credentials.ts'), "const apiKey = 'sk-source-fixture-never-pack';\n", 'utf8');
    await writeFile(join(daemon, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true}}\n', 'utf8');
    await writeFile(join(web, 'index.html'), '<main>VibeGo</main>\n', 'utf8');
    await writeFile(join(repo, 'package.json'), '{"name":"ready4vibe"}\n', 'utf8');
    await writeFile(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
    await writeFile(join(repo, 'README.md'), '# VibeGo\n', 'utf8');
    await writeFile(join(repo, 'README-zh.md'), '# VibeGo\n', 'utf8');
    const launcher = join(root, 'host-launcher.mjs');
    await writeFile(launcher, 'console.log("launcher");\n', 'utf8');
    const output = join(root, 'out', 'vibego-0.1.0-nightly.20260806.1-windows-x64-developer.tar.gz');
    const result = await buildDeveloperSnapshot({ version: '0.1.0-nightly.20260806.1', sourceCommit: 'a'.repeat(40), daemonDeploy: daemon, webDist: web, launcher, repoRoot: repo, stageDir: stage, output });
    assert.equal(result.status, 'healthy');
    assert.match(result.digest, /^sha256:[0-9a-f]{64}$/u);
    assert.ok(result.sizeBytes > 0);
    assert.doesNotMatch(JSON.stringify(result), /C:\\|token|secret|sk-/iu);
    await assert.rejects(() => readFile(join(stage, 'vibego-developer-snapshot', 'daemon', 'src', 'credentials.ts')));
    await assert.rejects(() => readFile(join(stage, 'vibego-developer-snapshot', 'daemon', 'tsconfig.json')));
    assert.equal(await readFile(join(stage, 'vibego-developer-snapshot', 'daemon', 'dist', 'main.js'), 'utf8'), 'console.log("daemon");\n');
    assert.match(await readFile(join(stage, 'SHA256SUMS'), 'utf8'), /^sha256:[0-9a-f]{64}  vibego-/u);
    assert.match(await readFile(join(stage, 'release-notes.md'), 'utf8'), /developer nightly snapshot/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed on secret-shaped staged content', async () => {
  const root = await mkdtemp(join(process.cwd(), '.ready4vibe', 'snapshot-test-'));
  try {
    const daemon = join(root, 'daemon');
    const web = join(root, 'web');
    const repo = join(root, 'repo');
    await mkdir(join(daemon, 'dist'), { recursive: true });
    await mkdir(web, { recursive: true });
    await mkdir(repo, { recursive: true });
    await writeFile(join(daemon, 'dist', 'main.js'), 'const apiKey="sk-never-include-1234567890";\n', 'utf8');
    await writeFile(join(web, 'index.html'), 'ok\n', 'utf8');
    for (const name of ['package.json', 'pnpm-lock.yaml', 'README.md', 'README-zh.md']) await writeFile(join(repo, name), 'safe\n', 'utf8');
    const launcher = join(root, 'host-launcher.mjs');
    await writeFile(launcher, 'safe\n', 'utf8');
    await assert.rejects(() => buildDeveloperSnapshot({ version: '0.1.0-nightly.20260806.1', sourceCommit: 'a'.repeat(40), daemonDeploy: daemon, webDist: web, launcher, repoRoot: repo, stageDir: join(root, 'stage'), output: join(root, 'out.tar.gz') }), (error) => safeDeveloperSnapshotErrorCode(error) === 'SNAPSHOT_SECRET_CONTENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
