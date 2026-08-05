import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import {
  createEvidencePlan,
  hashRedactedOutput,
  normalizeRepositoryMetadata,
  parseVerificationEvidenceArgs,
  redactEvidenceText,
  runEvidencePlan,
  validateOutputRoot,
  writeEvidenceBundle,
} from './verification-evidence.mjs';

test('accepts only the bounded focused/full evidence plans', () => {
  assert.deepEqual(parseVerificationEvidenceArgs(['--scope', 'full']), { scope: 'full' });
  assert.deepEqual(parseVerificationEvidenceArgs([], { VIBEGO_VERIFY_EVIDENCE_SCOPE: 'focused' }), { scope: 'focused' });
  assert.equal(createEvidencePlan('focused').length, 5);
  assert.equal(createEvidencePlan('full').length, 1);
  assert.throws(() => parseVerificationEvidenceArgs(['--scope', 'shell']), /focused or full/u);
  assert.throws(() => parseVerificationEvidenceArgs(['--output', '..\\outside']), /under/u);
  assert.throws(() => validateOutputRoot('C:\\temp\\evidence'), /under/u);
});

test('redacts secrets, secret references and absolute paths before hashing', () => {
  const raw = 'C:\\Users\\yjzlx\\workspace sk-test123 Bearer abc token=secret-value API_KEY=hidden';
  const redacted = redactEvidenceText(raw, 'C:\\Users\\yjzlx\\Documents\\projects\\ready4vibe');
  assert.doesNotMatch(redacted, /C:\\Users|sk-test|Bearer abc|secret-value|API_KEY=hidden/iu);
  assert.match(redacted, /\[path\]|\[secret\]|\[redacted\]|\[secret-ref\]/u);
  assert.equal(hashRedactedOutput(raw), hashRedactedOutput(redacted));
});

test('records passed steps and keeps child output out of the JSON report', () => {
  const calls = [];
  const result = runEvidencePlan({ scope: 'focused' }, {
    metadata: { commit: 'abcdef1234567', branch: 'main', node: 'v24.14.0', pnpm: '11.9.0' },
    run: (command, args) => {
      calls.push([command, args]);
      return { status: 0, stdout: 'C:\\private\\sk-live-value', stderr: '' };
    },
  });
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.steps.length, 5);
  assert.equal(calls.length, 5);
  assert.doesNotMatch(JSON.stringify(result.report), /sk-live|C:\\private/iu);
  assert.doesNotMatch(result.outputs[0].text, /sk-live|C:\\private/iu);
});

test('preserves failed, blocked and not-run semantics without fallback', () => {
  let callCount = 0;
  const failed = runEvidencePlan({ scope: 'focused' }, {
    metadata: { commit: 'abcdef1', branch: 'main' },
    run: () => ({ status: callCount++ === 0 ? 7 : 0, stderr: 'failed' }),
  });
  assert.equal(failed.report.status, 'failed');
  assert.equal(failed.report.steps[0].status, 'failed');
  assert.equal(failed.report.steps[1].status, 'not-run');

  const blocked = runEvidencePlan({ scope: 'full' }, {
    metadata: { commit: 'abcdef1', branch: 'main' },
    run: () => ({ status: 'blocked', errorCode: 'VERIFY_PROVIDER_BLOCKED' }),
  });
  assert.equal(blocked.report.status, 'blocked');
  assert.equal(blocked.report.steps[0].status, 'blocked');
  assert.equal(blocked.report.steps[0].errorCode, 'VERIFY_PROVIDER_BLOCKED');
});

test('writes a bounded bundle with stable files and no raw output', async () => {
  const parent = join(process.cwd(), '.ready4vibe', 'evidence');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'test-'));
  try {
    const result = runEvidencePlan({ scope: 'focused' }, {
      metadata: { commit: 'abcdef1234567', branch: 'main', node: 'v24.14.0', pnpm: '11.9.0' },
      run: () => ({ status: 0, stdout: 'token=sk-never-write C:\\secret\\path', stderr: '' }),
    });
    const bundle = await writeEvidenceBundle(result, root);
    const files = await Promise.all(['manifest.json', 'focused-results.json', 'prerequisite-matrix.md', 'security-privacy-report.md', 'known-gaps.md'].map((name) => readFile(join(bundle, name), 'utf8')));
    const combined = files.join('\n');
    assert.doesNotMatch(combined, /sk-never-write|C:\\secret/iu);
    assert.match(files[0], /verification-evidence\/v1/u);
    assert.match(files[1], /outputDigest/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('normalizes untrusted metadata to bounded safe projections', () => {
  assert.deepEqual(normalizeRepositoryMetadata({ commit: 'C:\\secret', branch: 'branch with spaces', node: 'bad', pnpm: 'git version 2' }), {
    commit: 'unknown',
    branch: 'unknown',
    node: process.version,
    pnpm: 'unknown',
  });
});
