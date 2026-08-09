import { describe, expect, it, vi } from 'vitest';
import { probeHostShell, type HostShellProbeSpawn } from './host-shell.js';

const spawnWith = (available: readonly string[]): HostShellProbeSpawn =>
  vi.fn((command: string) => (available.includes(command) ? { status: 0 } : { status: null, error: new Error('not found') }));

describe('probeHostShell', () => {
  it('resolves pwsh with the PowerShell invocation prefix on Windows', () => {
    const spawn = spawnWith(['pwsh']);
    const probe = probeHostShell({ platform: 'win32', spawn });
    expect(probe).toMatchObject({ status: 'ok', shell: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command'], platform: 'win32' });
    expect(spawn).toHaveBeenCalledWith('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], expect.objectContaining({ shell: false }));
  });

  it('falls back to Windows PowerShell when pwsh is not installed', () => {
    const probe = probeHostShell({ platform: 'win32', spawn: spawnWith(['powershell']) });
    expect(probe).toMatchObject({ status: 'ok', shell: 'powershell', args: ['-NoProfile', '-NonInteractive', '-Command'] });
  });

  it('resolves bash with -c on POSIX and falls back to sh', () => {
    expect(probeHostShell({ platform: 'linux', spawn: spawnWith(['bash']) })).toMatchObject({ status: 'ok', shell: 'bash', args: ['-c'] });
    expect(probeHostShell({ platform: 'darwin', spawn: spawnWith(['sh']) })).toMatchObject({ status: 'ok', shell: 'sh', args: ['-c'] });
  });

  it('reports missing when no candidate shell responds', () => {
    const probe = probeHostShell({ platform: 'linux', spawn: spawnWith([]) });
    expect(probe.status).toBe('missing');
    expect(probe.shell).toBeUndefined();
    expect(probe.args).toEqual([]);
  });

  it('treats a non-zero probe exit as unavailable', () => {
    const probe = probeHostShell({ platform: 'win32', spawn: () => ({ status: 1 }) });
    expect(probe.status).toBe('missing');
  });
});
