import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';

import { exitCodeForSmokeStatus, parseSmokeArgs } from './smoke-container.mjs';

test('parses explicit smoke runtime/image and resolves workspace', () => {
  assert.deepEqual(parseSmokeArgs([
    '--runtime', 'podman',
    '--image', `ghcr.io/ready4vibe/runner@sha256:${'a'.repeat(64)}`,
    '--workspace', 'fixtures',
  ], {}, 'C:/repo'), {
    runtime: 'podman',
    image: `ghcr.io/ready4vibe/runner@sha256:${'a'.repeat(64)}`,
    workspaceRoot: resolve('C:/repo/fixtures'),
  });
});

test('supports non-secret environment defaults and rejects arbitrary arguments', () => {
  assert.equal(parseSmokeArgs([], {
    VIBEGO_CONTAINER_RUNTIME: 'docker',
    VIBEGO_CONTAINER_IMAGE: `ghcr.io/ready4vibe/runner@sha256:${'b'.repeat(64)}`,
    VIBEGO_CONTAINER_WORKSPACE: 'C:/workspace',
  }).runtime, 'docker');
  assert.equal(parseSmokeArgs(['--', '--help']).help, true);
  assert.throws(() => parseSmokeArgs(['--command', 'whoami'], {}, 'C:/repo'), /usage/u);
  assert.throws(() => parseSmokeArgs(['--runtime', 'docker'], {}, 'C:/repo'), /image is required/u);
});

test('maps redacted smoke status to stable process exit codes', () => {
  assert.equal(exitCodeForSmokeStatus('healthy'), 0);
  assert.equal(exitCodeForSmokeStatus('failed'), 1);
  assert.equal(exitCodeForSmokeStatus('unavailable'), 2);
  assert.equal(exitCodeForSmokeStatus('cancelled'), 3);
});
