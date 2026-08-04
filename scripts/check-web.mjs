import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFocusedValidation } from './check-module.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDistDir = resolve(repoRoot, 'apps', 'web', 'dist');
export const DEFAULT_WEB_BUDGETS = Object.freeze({ jsGzipKiB: 110, cssGzipKiB: 30 });
const MAX_ASSETS = 64;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;

/**
 * Summarize generated Web assets without retaining their contents. Callers
 * pass buffers so tests and CI never need a browser, network, or user data.
 */
export function summarizeWebAssets(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ASSETS) {
    throw new Error('WEB_ASSETS_INVALID');
  }
  const assets = entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !/^[A-Za-z0-9._-]+\.(?:js|css)$/u.test(entry.name)) {
      throw new Error('WEB_ASSET_NAME_INVALID');
    }
    const content = Buffer.isBuffer(entry.content) ? entry.content : typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : null;
    if (!content || content.length > MAX_ASSET_BYTES) throw new Error('WEB_ASSET_SIZE_INVALID');
    const kind = entry.name.endsWith('.js') ? 'js' : 'css';
    const gzipBytes = gzipSync(content, { level: 9 }).length;
    return Object.freeze({ name: entry.name, kind, bytes: content.length, gzipBytes });
  });
  const jsGzipBytes = assets.filter((asset) => asset.kind === 'js').reduce((total, asset) => total + asset.gzipBytes, 0);
  const cssGzipBytes = assets.filter((asset) => asset.kind === 'css').reduce((total, asset) => total + asset.gzipBytes, 0);
  if (jsGzipBytes === 0 || cssGzipBytes === 0) throw new Error('WEB_ASSET_TYPE_MISSING');
  return Object.freeze({
    assets: Object.freeze(assets),
    jsGzipBytes,
    cssGzipBytes,
    jsGzipKiB: jsGzipBytes / 1024,
    cssGzipKiB: cssGzipBytes / 1024,
  });
}

export function inspectWebAssets(distDir = defaultDistDir) {
  const assetsDir = resolve(distDir, 'assets');
  const names = readdirSync(assetsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:js|css)$/u.test(entry.name))
    .map((entry) => entry.name);
  return summarizeWebAssets(names.map((name) => ({ name, content: readFileSync(resolve(assetsDir, name)) })));
}

export function assertWebBudgets(report, budgets = DEFAULT_WEB_BUDGETS) {
  if (!report || !Number.isFinite(report.jsGzipKiB) || !Number.isFinite(report.cssGzipKiB)) throw new Error('WEB_BUDGET_REPORT_INVALID');
  if (!budgets || !Number.isFinite(budgets.jsGzipKiB) || !Number.isFinite(budgets.cssGzipKiB)) throw new Error('WEB_BUDGETS_INVALID');
  if (report.jsGzipKiB > budgets.jsGzipKiB) throw new Error(`WEB_JS_GZIP_BUDGET_EXCEEDED:${report.jsGzipKiB.toFixed(2)}>${budgets.jsGzipKiB}`);
  if (report.cssGzipKiB > budgets.cssGzipKiB) throw new Error(`WEB_CSS_GZIP_BUDGET_EXCEEDED:${report.cssGzipKiB.toFixed(2)}>${budgets.cssGzipKiB}`);
  return report;
}

export function runGitDiffCheck() {
  const result = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['diff', '--check'], { cwd: repoRoot, stdio: 'inherit', windowsHide: true });
  return result.error ? 1 : result.status ?? 1;
}

function safeWebError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^WEB_[A-Z0-9_]+(?::[0-9.>]+)?$/u.test(message) ? message : 'WEB_ASSET_INSPECTION_FAILED';
}

export function runWebValidation(options = {}) {
  const output = options.output ?? ((message) => process.stdout.write(`${message}\n`));
  const runFocused = options.runFocused ?? runFocusedValidation;
  const inspect = options.inspectAssets ?? (() => inspectWebAssets());
  const runDiff = options.runDiff ?? runGitDiffCheck;
  const focusedStatus = runFocused(['@ready4vibe/web']);
  if (focusedStatus !== 0) return focusedStatus;
  let report;
  try {
    report = assertWebBudgets(inspect(), options.budgets ?? DEFAULT_WEB_BUDGETS);
  } catch (error) {
    output(`check:web failed: ${safeWebError(error)}`);
    return 2;
  }
  output(`check:web assets: js=${report.jsGzipKiB.toFixed(2)} KiB gzip, css=${report.cssGzipKiB.toFixed(2)} KiB gzip`);
  const diffStatus = runDiff();
  if (diffStatus !== 0) {
    output(`check:web failed: git diff --check (exit ${diffStatus})`);
    return diffStatus;
  }
  output('check:web complete');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runWebValidation();
}
