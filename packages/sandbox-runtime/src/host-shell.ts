import { spawnSync as defaultSpawnSync, type SpawnSyncOptions } from 'node:child_process';

export type HostShellProbeStatus = 'ok' | 'missing';

export interface HostShellProbe {
  readonly status: HostShellProbeStatus;
  /** Resolved shell executable (for example `pwsh` or `bash`) when status is `ok`. */
  readonly shell?: string;
  /** Invocation prefix placed before the raw command string (`-Command` style or `-c`). */
  readonly args: readonly string[];
  readonly platform: NodeJS.Platform;
}

export interface HostShellProbeSpawnResult {
  readonly status: number | null;
  readonly error?: Error;
}

export type HostShellProbeSpawn = (command: string, args: readonly string[], options: SpawnSyncOptions) => HostShellProbeSpawnResult;

export interface HostShellProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawn?: HostShellProbeSpawn;
}

const POWERSHELL_ARGS: readonly string[] = ['-NoProfile', '-NonInteractive', '-Command'];
const POSIX_ARGS: readonly string[] = ['-c'];
const PROBE_TIMEOUT_MS = 2_000;

/**
 * Resolve the host command-line shell for this platform. Windows prefers
 * `pwsh` (PowerShell 7) and falls back to Windows PowerShell; POSIX prefers
 * `bash` and falls back to `sh`. Each candidate is probed with a bounded
 * no-op invocation spawned with `shell:false`; nothing is executed beyond
 * the candidate itself. Callers probe once (for example at daemon startup)
 * and reuse the returned value.
 */
export function probeHostShell(options: HostShellProbeOptions = {}): HostShellProbe {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? ((command, args, spawnOptions) => defaultSpawnSync(command, [...args], spawnOptions));
  const windows = platform === 'win32';
  const candidates = windows ? ['pwsh', 'powershell'] : ['bash', 'sh'];
  const prefix = windows ? POWERSHELL_ARGS : POSIX_ARGS;
  for (const candidate of candidates) {
    try {
      const result = spawn(candidate, [...prefix, 'exit 0'], {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
        timeout: PROBE_TIMEOUT_MS,
      });
      if (!result.error && result.status === 0) {
        return { status: 'ok', shell: candidate, args: Object.freeze([...prefix]), platform };
      }
    } catch {
      // Try the next candidate.
    }
  }
  return { status: 'missing', args: Object.freeze([]), platform };
}
