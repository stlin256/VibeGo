import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFocusedSteps,
  normalizeSelectors,
  runFocusedValidation,
} from './check-module.mjs';

test('normalizes, deduplicates, and strips the dependency suffix', () => {
  assert.deepEqual(
    normalizeSelectors([
      '--',
      '@ready4vibe/contracts...',
      '@ready4vibe/model-openai',
      '@ready4vibe/contracts',
    ]),
    ['@ready4vibe/contracts', '@ready4vibe/model-openai'],
  );
});

test('rejects an empty or unsafe selector', () => {
  assert.throws(() => normalizeSelectors([]), /usage/u);
  assert.throws(() => normalizeSelectors(['@ready4vibe/contracts; pnpm test']), /invalid/u);
});

test('builds dependencies but scopes typecheck and test to selected packages', () => {
  const steps = createFocusedSteps(['@ready4vibe/agent', '@ready4vibe/context']);
  assert.deepEqual(steps[0].args, [
    '--filter', '@ready4vibe/agent...',
    '--filter', '@ready4vibe/context...',
    'build',
  ]);
  assert.deepEqual(steps[1].args, [
    '--filter', '@ready4vibe/agent',
    '--filter', '@ready4vibe/context',
    'typecheck',
  ]);
  assert.deepEqual(steps[2].args, [
    '--filter', '@ready4vibe/agent',
    '--filter', '@ready4vibe/context',
    'test',
  ]);
});

test('stops at the first failed focused step', () => {
  const calls = [];
  const status = runFocusedValidation(['@ready4vibe/contracts'], (command, args) => {
    calls.push([command, args]);
    return { status: calls.length === 2 ? 7 : 0 };
  });

  assert.equal(status, 7);
  assert.equal(calls.length, 2);
});
