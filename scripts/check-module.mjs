import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commandName = process.platform === 'win32'
  ? (name) => name === 'pnpm' ? 'pnpm.cmd' : `${name}.exe`
  : (name) => name;

const SELECTOR_PATTERN = /^[A-Za-z0-9@_/*?.:-]+$/u;

/**
 * Normalize package selectors passed from the command line.
 *
 * The command intentionally accepts package selectors, rather than arbitrary
 * shell fragments. Arguments are passed to pnpm as an argv array, but keeping
 * the selector grammar narrow also makes accidental broad filters visible.
 */
export function normalizeSelectors(input) {
  const selectors = [...new Set(input
    .filter((value) => value !== '--')
    .map((value) => value.trim().replace(/\.\.\.$/u, ''))
    .filter(Boolean))];

  if (selectors.length === 0) {
    throw new Error('usage: pnpm check:module -- <workspace-package> [<workspace-package> ...]');
  }

  for (const selector of selectors) {
    if (!SELECTOR_PATTERN.test(selector)) {
      throw new Error(`invalid workspace package selector: ${selector}`);
    }
  }

  return Object.freeze(selectors);
}

/**
 * Build the focused validation plan.
 *
 * Build includes each selected package's workspace dependency closure so that
 * package exports resolve to fresh dist output. Typecheck and test use exact
 * selectors to keep the feedback loop scoped to the requested packages.
 */
export function createFocusedSteps(selectors) {
  const dependencyFilters = selectors.flatMap((selector) => [
    '--filter',
    `${selector}...`,
  ]);
  const exactFilters = selectors.flatMap((selector) => [
    '--filter',
    selector,
  ]);
  const label = selectors.join(', ');

  return Object.freeze([
    Object.freeze({
      label: `build dependency closure (${label})`,
      command: 'pnpm',
      args: [...dependencyFilters, 'build'],
    }),
    Object.freeze({
      label: `typecheck selected package(s) (${label})`,
      command: 'pnpm',
      args: [...exactFilters, 'typecheck'],
    }),
    Object.freeze({
      label: `test selected package(s) (${label})`,
      command: 'pnpm',
      args: [...exactFilters, 'test'],
    }),
  ]);
}

export function runFocusedValidation(selectors, run = runCommand) {
  const steps = createFocusedSteps(selectors);
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    process.stdout.write(`\n==> check:module ${index + 1}/${steps.length}: ${step.label}\n`);
    const result = run(step.command, step.args);
    if (result.status !== 0) {
      const status = typeof result.status === 'number' ? result.status : 1;
      process.stderr.write(`Focused validation stopped at ${step.label} (exit ${status}).\n`);
      return status;
    }
  }
  process.stdout.write('\nFocused module validation complete.\n');
  return 0;
}

function runCommand(command, args) {
  const environment = { ...process.env };
  if (environment.CI === undefined) environment.CI = 'true';
  const windowsPnpm = process.platform === 'win32' && command === 'pnpm';
  const executable = windowsPnpm ? (environment.ComSpec ?? 'cmd.exe') : commandName(command);
  const executableArgs = windowsPnpm
    ? ['/d', '/s', '/c', [commandName(command), ...args].map(quoteWindowsArg).join(' ')]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: repoRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    process.stderr.write(`Unable to start ${command}.\n`);
    return { status: 1 };
  }
  return result;
}

function quoteWindowsArg(value) {
  return /[\s"&|<>^*]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runFocusedValidation(normalizeSelectors(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
