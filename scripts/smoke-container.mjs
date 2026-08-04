import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE = 'usage: pnpm smoke:container -- --runtime <docker|podman> --image <name@sha256:digest> [--workspace <path>]';

export function parseSmokeArgs(argv, environment = process.env, cwd = process.cwd()) {
  let runtime = environment.VIBEGO_CONTAINER_RUNTIME ?? 'docker';
  let image = environment.VIBEGO_CONTAINER_IMAGE;
  let workspace = environment.VIBEGO_CONTAINER_WORKSPACE ?? cwd;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help') return { help: true };
    if (argument === '--runtime' || argument === '--image' || argument === '--workspace') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(USAGE);
      index += 1;
      if (argument === '--runtime') runtime = value;
      else if (argument === '--image') image = value;
      else workspace = value;
      continue;
    }
    throw new Error(USAGE);
  }

  if (runtime !== 'docker' && runtime !== 'podman') throw new Error(USAGE);
  if (typeof image !== 'string' || image.length === 0) throw new Error(`${USAGE}\nimage is required via --image or VIBEGO_CONTAINER_IMAGE`);
  const workspaceRoot = resolve(cwd, workspace);
  if (!isAbsolute(workspaceRoot)) throw new Error(USAGE);
  return Object.freeze({ runtime, image, workspaceRoot });
}

export function exitCodeForSmokeStatus(status) {
  if (status === 'healthy') return 0;
  if (status === 'unavailable') return 2;
  if (status === 'cancelled') return 3;
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseSmokeArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 0;
    } else {
      const { ContainerSmokeRunner } = await import('../packages/sandbox-runtime/dist/index.js');
      const report = await new ContainerSmokeRunner().run(options);
      process.stdout.write(`${JSON.stringify(report)}\n`);
      process.exitCode = exitCodeForSmokeStatus(report.status);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : USAGE}\n`);
    process.exitCode = 2;
  }
}
