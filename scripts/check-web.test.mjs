import assert from 'node:assert/strict';
import test from 'node:test';

import { assertWebBudgets, runWebValidation, summarizeWebAssets } from './check-web.mjs';

test('summarizes JavaScript and CSS gzip sizes without retaining asset contents', () => {
  const report = summarizeWebAssets([
    { name: 'index.js', content: 'const ready = true;'.repeat(20) },
    { name: 'index.css', content: '.app { color: cyan; }'.repeat(20) },
  ]);
  assert.equal(report.assets.length, 2);
  assert.equal(report.assets[0].name, 'index.js');
  assert.equal(report.assets[0].content, undefined);
  assert.ok(report.jsGzipBytes > 0);
  assert.ok(report.cssGzipBytes > 0);
});

test('rejects missing asset types and enforces bounded budgets', () => {
  assert.throws(() => summarizeWebAssets([{ name: 'index.js', content: 'x' }]), /WEB_ASSET_TYPE_MISSING/u);
  const report = { jsGzipKiB: 10, cssGzipKiB: 2 };
  assert.equal(assertWebBudgets(report, { jsGzipKiB: 10, cssGzipKiB: 2 }), report);
  assert.throws(() => assertWebBudgets({ ...report, jsGzipKiB: 11 }, { jsGzipKiB: 10, cssGzipKiB: 2 }), /WEB_JS_GZIP_BUDGET_EXCEEDED/u);
  assert.throws(() => assertWebBudgets({ ...report, cssGzipKiB: 3 }, { jsGzipKiB: 10, cssGzipKiB: 2 }), /WEB_CSS_GZIP_BUDGET_EXCEEDED/u);
});

test('runs only the focused Web gate, then assets and diff checks in order', () => {
  const calls = [];
  const output = [];
  const status = runWebValidation({
    runFocused: (selectors) => { calls.push(['focused', selectors]); return 0; },
    inspectAssets: () => { calls.push(['assets']); return { jsGzipKiB: 4, cssGzipKiB: 2 }; },
    runDiff: () => { calls.push(['diff']); return 0; },
    output: (message) => output.push(message),
  });
  assert.equal(status, 0);
  assert.deepEqual(calls, [['focused', ['@ready4vibe/web']], ['assets'], ['diff']]);
  assert.ok(output.at(-1)?.includes('complete'));
});

test('stops before asset or diff checks when focused Web validation fails', () => {
  const calls = [];
  const status = runWebValidation({
    runFocused: () => { calls.push('focused'); return 7; },
    inspectAssets: () => { calls.push('assets'); return { jsGzipKiB: 1, cssGzipKiB: 1 }; },
    runDiff: () => { calls.push('diff'); return 0; },
    output: () => undefined,
  });
  assert.equal(status, 7);
  assert.deepEqual(calls, ['focused']);
});

test('redacts filesystem inspection errors to a stable code', () => {
  const output = [];
  const status = runWebValidation({
    runFocused: () => 0,
    inspectAssets: () => { throw new Error("ENOENT: scandir 'C:\\private\\workspace'"); },
    runDiff: () => 0,
    output: (message) => output.push(message),
  });
  assert.equal(status, 2);
  assert.equal(output[0], 'check:web failed: WEB_ASSET_INSPECTION_FAILED');
  assert.ok(!output.join('\n').includes('C:\\private'));
});
