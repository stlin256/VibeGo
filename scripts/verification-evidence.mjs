import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = resolve(repoRoot, '.ready4vibe', 'evidence');
const USAGE = 'usage: pnpm verify:evidence -- [--scope <focused|full>] [--output <.ready4vibe/evidence>]';
const DEFAULT_SCOPE = 'focused';
const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_STEP_COUNT = 8;
const EVIDENCE_SCHEMA = 'verification-evidence/v1';
const SAFE_ID = /^[a-z][a-z0-9-]{1,63}$/u;
const SAFE_COMMIT = /^[0-9a-f]{7,64}$/iu;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,160}$/u;

const FOCUSED_PLAN = Object.freeze([
  Object.freeze({
    id: 'contracts-goal-storage',
    label: 'contracts, Goal Control and storage focused gate',
    evidenceLevel: 'C',
    command: 'pnpm',
    args: ['check:module', '--', '@ready4vibe/contracts', '@ready4vibe/goal-control', '@ready4vibe/storage'],
  }),
  Object.freeze({
    id: 'policy-sandbox-execution',
    label: 'policy, sandbox and execution focused gate',
    evidenceLevel: 'F',
    command: 'pnpm',
    args: ['check:module', '--', '@ready4vibe/policy', '@ready4vibe/sandbox', '@ready4vibe/execution'],
  }),
  Object.freeze({
    id: 'agent-daemon',
    label: 'AgentLoop and daemon focused gate',
    evidenceLevel: 'D',
    command: 'pnpm',
    args: ['check:module', '--', '@ready4vibe/agent', '@ready4vibe/daemon'],
  }),
  Object.freeze({
    id: 'web',
    label: 'Web focused gate and asset budget',
    evidenceLevel: 'E',
    command: 'pnpm',
    args: ['check:web'],
  }),
  Object.freeze({
    id: 'workflow-fixtures',
    label: 'workflow fixture and redaction tests',
    evidenceLevel: 'D',
    command: 'pnpm',
    args: ['test:workflow'],
  }),
]);

const FULL_PLAN = Object.freeze([
  Object.freeze({
    id: 'full-verify',
    label: 'full repository verification gate',
    evidenceLevel: 'D',
    command: 'pnpm',
    args: ['verify'],
  }),
]);

export function parseVerificationEvidenceArgs(argv, environment = process.env) {
  let scope = environment.VIBEGO_VERIFY_EVIDENCE_SCOPE ?? DEFAULT_SCOPE;
  let outputRoot;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return Object.freeze({ help: true });
    if (argument === '--scope' || argument === '--output') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--scope') scope = value;
      else outputRoot = validateOutputRoot(value);
      continue;
    }
    throw new Error(USAGE);
  }
  if (scope !== 'focused' && scope !== 'full') throw new Error('scope must be focused or full');
  return Object.freeze({ scope, ...(outputRoot ? { outputRoot } : {}) });
}

export function validateOutputRoot(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 260 || value.includes('\0')) {
    throw new Error('output root is invalid');
  }
  const candidate = resolve(repoRoot, value);
  if (!isWithin(evidenceRoot, candidate)) throw new Error('output root must stay under .ready4vibe/evidence');
  return candidate;
}

export function createEvidencePlan(scope) {
  if (scope === 'focused') return FOCUSED_PLAN;
  if (scope === 'full') return FULL_PLAN;
  throw new Error('scope must be focused or full');
}

export function redactEvidenceText(value, root = repoRoot) {
  let text = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const normalizedRoot = root.replaceAll('\\', '/');
  if (normalizedRoot.length > 2) text = text.replaceAll(normalizedRoot, '[repo]');
  text = text.replace(/[A-Za-z]:\\[^\r\n\t ]+/gu, '[path]');
  text = text.replace(/(?<!https?:)\/(?:[A-Za-z0-9._-]+\/){2,}[A-Za-z0-9._-]*/gu, '[path]');
  text = text.replace(/Bearer\s+[^\s]+/giu, 'Bearer [redacted]');
  text = text.replace(/\b(?:sk|rk|ghp|github_pat)-[A-Za-z0-9_-]+\b/gu, '[secret]');
  text = text.replace(/\b(?:api[_-]?key|token|secret|password|private[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]');
  text = text.replace(/\b[A-Z][A-Z0-9_]{2,}(?:KEY|TOKEN|SECRET|PASSWORD)\b/gu, '[secret-ref]');
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_OUTPUT_BYTES) return text;
  return `${Buffer.from(text, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8')}\n[output-truncated]`;
}

export function safeEvidenceErrorCode(error, fallback = 'VERIFY_EVIDENCE_FAILED') {
  const code = error && typeof error === 'object' ? error.code : undefined;
  return typeof code === 'string' && /^VERIFY_[A-Z0-9_]{1,63}$/u.test(code) ? code : fallback;
}

export function hashRedactedOutput(value) {
  return createHash('sha256').update(redactEvidenceText(value)).digest('hex');
}

export function normalizeRepositoryMetadata(metadata = {}) {
  const commit = typeof metadata.commit === 'string' && SAFE_COMMIT.test(metadata.commit) ? metadata.commit.toLowerCase() : 'unknown';
  const branch = typeof metadata.branch === 'string' && SAFE_BRANCH.test(metadata.branch) ? metadata.branch : 'unknown';
  const node = typeof metadata.node === 'string' && /^v\d+\.\d+\.\d+/.test(metadata.node) ? metadata.node.slice(0, 32) : process.version;
  const pnpm = typeof metadata.pnpm === 'string' && /^\d+\.\d+\.\d+/.test(metadata.pnpm) ? metadata.pnpm.slice(0, 32) : 'unknown';
  return Object.freeze({ commit, branch, node, pnpm });
}

/**
 * Runs one fixed verification plan. The runner is injectable so unit tests do
 * not spawn pnpm, write files or inspect the user's workspace.
 */
export function runEvidencePlan(options, dependencies = {}) {
  const plan = createEvidencePlan(options.scope);
  if (plan.length > MAX_STEP_COUNT) throw new Error('VERIFY_PLAN_TOO_LARGE');
  const run = dependencies.run ?? runCommand;
  const metadata = normalizeRepositoryMetadata(dependencies.metadata ?? getRepositoryMetadata());
  const outputs = [];
  const steps = [];
  let stoppedBy;

  for (const step of plan) {
    if (stoppedBy) {
      steps.push(Object.freeze({
        id: step.id,
        label: step.label,
        evidenceLevel: step.evidenceLevel,
        status: 'not-run',
        blockedBy: stoppedBy,
      }));
      continue;
    }
    const startedAt = Date.now();
    let result;
    try {
      result = run(step.command, [...step.args], { timeoutMs: DEFAULT_STEP_TIMEOUT_MS });
    } catch (error) {
      result = { status: 1, stderr: safeEvidenceErrorCode(error, 'VERIFY_RUNNER_ERROR') };
    }
    const rawOutput = [result?.stdout, result?.stderr].filter((value) => value !== undefined && value !== '').join('\n');
    const redactedOutput = redactEvidenceText(rawOutput);
    outputs.push(Object.freeze({ id: step.id, text: redactedOutput }));
    const status = normalizeStepStatus(result);
    const stepResult = {
      id: step.id,
      label: step.label,
      evidenceLevel: step.evidenceLevel,
      command: Object.freeze([step.command, ...step.args]),
      status,
      elapsedMs: boundedElapsed(result?.elapsedMs ?? Date.now() - startedAt),
      outputBytes: Math.min(MAX_OUTPUT_BYTES, Buffer.byteLength(redactedOutput, 'utf8')),
      outputDigest: hashRedactedOutput(redactedOutput),
      ...(Number.isInteger(result?.status) ? { exitCode: result.status } : {}),
      ...(safeCode(result?.errorCode) ? { errorCode: safeCode(result.errorCode) } : {}),
    };
    steps.push(Object.freeze(stepResult));
    if (status !== 'passed') stoppedBy = step.id;
  }

  const status = overallStatus(steps);
  const report = Object.freeze({
    schemaVersion: EVIDENCE_SCHEMA,
    scope: options.scope,
    status,
    claim: 'verification-gate-only',
    evidenceLevel: options.scope === 'full' ? 'D' : 'E',
    generatedAt: new Date().toISOString(),
    ...metadata,
    steps: Object.freeze(steps),
    ...(stoppedBy ? { stoppedBy } : {}),
    liveRuntime: 'not-run-by-this-command',
  });
  return Object.freeze({ report, outputs: Object.freeze(outputs) });
}

export async function writeEvidenceBundle(result, outputRoot = evidenceRoot) {
  if (!result || !result.report || !Array.isArray(result.outputs)) throw new Error('VERIFY_REPORT_INVALID');
  const report = result.report;
  const root = resolve(outputRoot);
  if (!isWithin(evidenceRoot, root)) throw new Error('output root must stay under .ready4vibe/evidence');
  const date = /^\d{4}-\d{2}-\d{2}/u.exec(report.generatedAt)?.[0] ?? 'unknown-date';
  const commit = SAFE_COMMIT.test(report.commit) ? report.commit : 'unknown-commit';
  const bundleDir = resolve(root, date, commit);
  if (!isWithin(root, bundleDir)) throw new Error('VERIFY_BUNDLE_PATH_INVALID');
  await mkdir(bundleDir, { recursive: true });
  const manifest = JSON.stringify(report, null, 2);
  await writeFile(join(bundleDir, 'manifest.json'), `${manifest}\n`, 'utf8');
  const resultsName = report.scope === 'full' ? 'full-verify.txt' : 'focused-results.json';
  if (report.scope === 'full') {
    await writeFile(join(bundleDir, resultsName), formatOutput(result.outputs), 'utf8');
  } else {
    await writeFile(join(bundleDir, resultsName), `${JSON.stringify({ schemaVersion: EVIDENCE_SCHEMA, steps: report.steps }, null, 2)}\n`, 'utf8');
  }
  await writeFile(join(bundleDir, 'prerequisite-matrix.md'), [
    '# Prerequisite matrix',
    '',
    'See `docs/reports/60-0-prerequisite-audit-2026-08-05.md` for the authoritative audit.',
    '',
    `This bundle records the explicit ${report.scope} verification plan at commit \`${commit}\`.`,
    'It is not release evidence and does not claim live provider, remote, full-host or signed artifact support.',
    '',
  ].join('\n'), 'utf8');
  await writeFile(join(bundleDir, 'security-privacy-report.md'), [
    '# Security and privacy note',
    '',
    'Child output was bounded and passed through the verification redactor before persistence.',
    'Secrets, secret-shaped references, bearer values, raw command payloads and absolute paths are not retained by this bundle.',
    'This note is a verification harness property, not a complete security audit.',
    '',
  ].join('\n'), 'utf8');
  await writeFile(join(bundleDir, 'known-gaps.md'), formatKnownGaps(report), 'utf8');
  return bundleDir;
}

function normalizeStepStatus(result) {
  if (result?.status === 'blocked' || result?.status === 'timeout' || result?.status === 'not-run' || result?.status === 'failed') return result.status;
  if (result?.status === 0) return 'passed';
  if (result?.status === null || result?.timedOut === true) return 'timeout';
  return 'failed';
}

function overallStatus(steps) {
  if (steps.some((step) => step.status === 'failed')) return 'failed';
  if (steps.some((step) => step.status === 'timeout')) return 'timeout';
  if (steps.some((step) => step.status === 'blocked')) return 'blocked';
  if (steps.some((step) => step.status === 'not-run')) return 'not-run';
  return steps.length > 0 && steps.every((step) => step.status === 'passed') ? 'passed' : 'failed';
}

function safeCode(value) {
  return typeof value === 'string' && /^VERIFY_[A-Z0-9_]{1,63}$/u.test(value) ? value : undefined;
}

function boundedElapsed(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(DEFAULT_STEP_TIMEOUT_MS, Math.trunc(value))) : 0;
}

function formatOutput(outputs) {
  return outputs.map((item) => `== ${item.id} ==\n${item.text || '[no output]'}`).join('\n\n').slice(0, MAX_OUTPUT_BYTES + (outputs.length * 128)) + '\n';
}

function formatKnownGaps(report) {
  const lines = [
    '# Known gaps',
    '',
    '- Live LLM, remote transport, Tailscale/SSH, ACME, full-host production execution and signed release operations are not run by this command.',
    '- Fixture-only and focused results remain verification evidence, not a release-candidate claim.',
  ];
  if (report.status !== 'passed') lines.push(`- Verification plan status is \`${report.status}\`; inspect the bounded step status and rerun after addressing the reported gate.`);
  return `${lines.join('\n')}\n`;
}

function isWithin(parent, child) {
  const normalizedParent = resolve(parent);
  const normalizedChild = resolve(child);
  const suffix = relative(normalizedParent, normalizedChild);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${requireSeparator()}`) && !isAbsolute(suffix));
}

function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

function getRepositoryMetadata() {
  const run = (args) => spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  const commitResult = run(['rev-parse', 'HEAD']);
  const branchResult = run(['symbolic-ref', '--short', 'HEAD']);
  const pnpmResult = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd --version'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
    : spawnSync('pnpm', ['--version'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  return normalizeRepositoryMetadata({
    commit: commitResult.status === 0 ? commitResult.stdout.trim() : undefined,
    branch: branchResult.status === 0 ? branchResult.stdout.trim() : undefined,
    node: process.version,
    pnpm: pnpmResult.status === 0 ? pnpmResult.stdout.trim() : undefined,
  });
}

function runCommand(command, args, options = {}) {
  const environment = { ...process.env, CI: process.env.CI ?? 'true' };
  const windowsPnpm = process.platform === 'win32' && command === 'pnpm';
  const executable = windowsPnpm ? (environment.ComSpec ?? 'cmd.exe') : process.platform === 'win32' && command === 'git' ? 'git.exe' : command;
  const executableArgs = windowsPnpm
    ? ['/d', '/s', '/c', ['pnpm.cmd', ...args].map(quoteWindowsArg).join(' ')]
    : args;
  const startedAt = Date.now();
  const child = spawnSync(executable, executableArgs, {
    cwd: repoRoot,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: options.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: MAX_OUTPUT_BYTES,
  });
  return {
    status: child.error?.code === 'ETIMEDOUT' ? null : child.status ?? 1,
    timedOut: child.error?.code === 'ETIMEDOUT',
    ...(child.error?.code === 'ETIMEDOUT' ? { errorCode: 'VERIFY_TIMEOUT' } : child.error ? { errorCode: 'VERIFY_CHILD_ERROR' } : {}),
    stdout: child.stdout ?? '',
    stderr: child.stderr ?? (child.error ? child.error.message : ''),
    elapsedMs: Date.now() - startedAt,
  };
}

function quoteWindowsArg(value) {
  return /[\s"&|<>^*]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function formatCliReport(report, bundleDir) {
  return JSON.stringify({
    schemaVersion: report.schemaVersion,
    scope: report.scope,
    status: report.status,
    commit: report.commit,
    branch: report.branch,
    bundle: bundleDir,
    steps: report.steps.map((step) => ({ id: step.id, status: step.status, elapsedMs: step.elapsedMs, ...(step.errorCode ? { errorCode: step.errorCode } : {}) })),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseVerificationEvidenceArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      const result = runEvidencePlan(options);
      const bundleDir = await writeEvidenceBundle(result, options.outputRoot ?? evidenceRoot);
      process.stdout.write(`${formatCliReport(result.report, bundleDir)}\n`);
      process.exitCode = result.report.status === 'passed' ? 0 : result.report.status === 'blocked' ? 2 : result.report.status === 'timeout' ? 3 : 1;
    }
  } catch (error) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 4;
  }
}
