import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commandName = process.platform === 'win32'
  ? (name) => name === 'pnpm' ? 'pnpm.cmd' : `${name}.exe`
  : (name) => name;

export const VERIFY_STEPS = Object.freeze([
  Object.freeze({ label: 'typecheck', command: 'pnpm', args: ['typecheck'] }),
  Object.freeze({ label: 'test', command: 'pnpm', args: ['test'] }),
  Object.freeze({ label: 'diff:check', command: 'pnpm', args: ['diff:check'] }),
  Object.freeze({ label: 'git diff --check', command: 'git', args: ['diff', '--check'] }),
]);

export function runVerification(steps = VERIFY_STEPS, run = runCommand) {
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    process.stdout.write(`\n==> verify ${index + 1}/${steps.length}: ${step.label}\n`);
    const result = run(step.command, step.args);
    if (result.status !== 0) {
      const status = typeof result.status === 'number' ? result.status : 1;
      process.stderr.write(`Verification stopped at ${step.label} (exit ${status}).\n`);
      return status;
    }
  }
  process.stdout.write('\nVerification complete.\n');
  return 0;
}

function runCommand(command, args) {
  const environment = { ...process.env };
  if (environment.CI === undefined) environment.CI = 'true';
  const windowsPnpm = process.platform === 'win32' && command === 'pnpm';
  const executable = windowsPnpm ? (environment.ComSpec ?? 'cmd.exe') : commandName(command);
  const executableArgs = windowsPnpm ? ['/d', '/s', '/c', [commandName(command), ...args].map(quoteWindowsArg).join(' ')] : args;
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
  process.exitCode = runVerification();
}
