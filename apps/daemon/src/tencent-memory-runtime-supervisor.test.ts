import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMemorySettings, AgentMemoryStatus } from '@ready4vibe/contracts';
import {
  SupervisorError,
  LocalPortAllocator,
  NodeMemorySidecarLauncher,
  TencentMemoryCandidateBuilder,
  TencentMemoryRuntimeSupervisor,
  type MemoryCandidate,
  type MemoryCandidateBuilder,
  type MemorySidecar,
  type MemorySidecarHealth,
  type PortAllocator,
  type SupervisorHealthClient,
  type SupervisorProcessLauncher,
} from './tencent-memory-runtime-supervisor.js';

const roots: string[] = [];

const settings: AgentMemorySettings = {
  schemaVersion: 'ready4vibe_agent_memory_settings_v1',
  enabled: true,
  mode: 'memory-core',
  teamId: 'team_demo',
  agentId: 'agent_demo',
  userId: 'user_demo',
  upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory',
  upstreamRef: 'feat/server_team',
  autoUpdate: true,
  updateIntervalMinutes: 60,
  fallbackToDirectProvider: true,
};

function candidate(revision: string, rootDir: string): MemoryCandidate {
  return {
    revision,
    rootDir,
    packageDir: rootDir,
    healthPath: '/health',
    executable: process.execPath,
    args: ['--version'],
  };
}

class FakeBuilder implements MemoryCandidateBuilder {
  readonly revisions = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40), 'd'.repeat(40)];
  currentIndex = 0;
  buildCalls = 0;
  activeBuilds = 0;
  maxActiveBuilds = 0;
  failBuild = false;
  readonly loadCalls: string[] = [];

  async resolveRevision(): Promise<string> {
    const revision = this.revisions[Math.min(this.currentIndex, this.revisions.length - 1)]!;
    this.currentIndex += 1;
    return revision;
  }

  async buildCandidate(input: { repository: string; ref: string; revision: string; candidateDir: string; signal?: AbortSignal | undefined }): Promise<MemoryCandidate> {
    this.buildCalls += 1;
    this.activeBuilds += 1;
    this.maxActiveBuilds = Math.max(this.maxActiveBuilds, this.activeBuilds);
    await mkdir(input.candidateDir, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.activeBuilds -= 1;
    if (this.failBuild) throw new SupervisorError('BUILD_FAILED', 'candidate build failed');
    return candidate(input.revision, input.candidateDir);
  }

  async loadRevision(input: { revision: string; revisionDir: string }): Promise<MemoryCandidate> {
    this.loadCalls.push(input.revision);
    return candidate(input.revision, input.revisionDir);
  }

  async discard(candidateDir: string): Promise<void> {
    await rm(candidateDir, { recursive: true, force: true });
  }
}

class FakeLauncher implements SupervisorProcessLauncher {
  readonly launched: MemorySidecar[] = [];
  nextId = 0;
  async launch(input: { candidate: MemoryCandidate; port: number; environment: NodeJS.ProcessEnv }): Promise<MemorySidecar> {
    const sidecar: MemorySidecar = {
      revision: input.candidate.revision,
      port: input.port,
      endpoint: `http://127.0.0.1:${input.port}`,
      pid: ++this.nextId,
      stop: vi.fn(async () => undefined),
    };
    this.launched.push(sidecar);
    return sidecar;
  }
}

class FakeHealth implements SupervisorHealthClient {
  failHealth = false;
  failSmoke = false;
  calls: Array<'health' | 'smoke'> = [];
  async health(_input: { sidecar: MemorySidecar; candidate: MemoryCandidate; signal?: AbortSignal }): Promise<MemorySidecarHealth> {
    this.calls.push('health');
    if (this.failHealth) throw new SupervisorError('HEALTH_FAILED', 'health failed');
    return { ok: true };
  }
  async smoke(_input: { sidecar: MemorySidecar; identity: AgentMemorySettings; signal?: AbortSignal }): Promise<void> {
    this.calls.push('smoke');
    if (this.failSmoke) throw new SupervisorError('SMOKE_FAILED', 'smoke failed');
  }
}

class FakePorts implements PortAllocator {
  next = 18_700;
  async allocate(): Promise<number> {
    return this.next++;
  }
}

function makeSupervisor(rootDir: string, builder: FakeBuilder, launcher: FakeLauncher, health: FakeHealth, ports: FakePorts): TencentMemoryRuntimeSupervisor {
  return new TencentMemoryRuntimeSupervisor({
    runtimeRoot: rootDir,
    settings: () => settings,
    candidateBuilder: builder,
    processLauncher: launcher,
    healthClient: health,
    portAllocator: ports,
    now: () => '2026-08-04T00:00:00.000Z',
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TencentMemoryRuntimeSupervisor', () => {
  it('keeps current when candidate build fails', async () => {
    const root = join(process.cwd(), `.tmp-memory-supervisor-${randomUUID()}`);
    roots.push(root);
    const builder = new FakeBuilder();
    const launcher = new FakeLauncher();
    const health = new FakeHealth();
    const ports = new FakePorts();
    const supervisor = makeSupervisor(root, builder, launcher, health, ports);
    expect((await supervisor.update()).revision).toBe('a'.repeat(40));
    builder.failBuild = true;
    const failed = await supervisor.update();
    expect(failed).toMatchObject({ revision: 'a'.repeat(40), previousRevision: null, degraded: true, lastErrorCode: 'build' });
    expect(launcher.launched).toHaveLength(1);
    await supervisor.close();
  });

  it('switches only after health and smoke, records previous, and serializes updates', async () => {
    const root = join(process.cwd(), `.tmp-memory-supervisor-${randomUUID()}`);
    roots.push(root);
    const builder = new FakeBuilder();
    const launcher = new FakeLauncher();
    const health = new FakeHealth();
    const ports = new FakePorts();
    const supervisor = makeSupervisor(root, builder, launcher, health, ports);
    await supervisor.update();
    const first = supervisor.update();
    const second = supervisor.update();
    const [next, nextAgain] = await Promise.all([first, second]);
    expect(next.revision).toBe('b'.repeat(40));
    expect(nextAgain.revision).toBe('c'.repeat(40));
    expect(nextAgain.previousRevision).toBe('b'.repeat(40));
    expect(builder.maxActiveBuilds).toBe(1);
    expect(health.calls.filter((call) => call === 'health').length).toBeGreaterThanOrEqual(3);
    const currentPointer = JSON.parse(await readFile(join(root, 'state', 'current.json'), 'utf8')) as Record<string, unknown>;
    const previousPointer = JSON.parse(await readFile(join(root, 'state', 'previous.json'), 'utf8')) as Record<string, unknown>;
    expect(currentPointer).toMatchObject({ revision: 'c'.repeat(40), port: 18_702 });
    expect(previousPointer).toMatchObject({ revision: 'b'.repeat(40) });
    await supervisor.close();
  });

  it('keeps current when candidate health or smoke fails', async () => {
    const root = join(process.cwd(), `.tmp-memory-supervisor-${randomUUID()}`);
    roots.push(root);
    const builder = new FakeBuilder();
    const launcher = new FakeLauncher();
    const health = new FakeHealth();
    const ports = new FakePorts();
    const supervisor = makeSupervisor(root, builder, launcher, health, ports);
    await supervisor.update();
    health.failHealth = true;
    expect(await supervisor.update()).toMatchObject({ revision: 'a'.repeat(40), degraded: true, lastErrorCode: 'health' });
    health.failHealth = false;
    health.failSmoke = true;
    expect(await supervisor.update()).toMatchObject({ revision: 'a'.repeat(40), degraded: true, lastErrorCode: 'health' });
    expect(launcher.launched).toHaveLength(3);
    await supervisor.close();
  });

  it('rolls back to previous and restores current after a daemon restart', async () => {
    const root = join(process.cwd(), `.tmp-memory-supervisor-${randomUUID()}`);
    roots.push(root);
    const builder = new FakeBuilder();
    const launcher = new FakeLauncher();
    const health = new FakeHealth();
    const ports = new FakePorts();
    const supervisor = makeSupervisor(root, builder, launcher, health, ports);
    await supervisor.update();
    await supervisor.update();
    const rolledBack = await supervisor.rollback();
    expect(rolledBack).toMatchObject({ revision: 'a'.repeat(40), previousRevision: 'b'.repeat(40), degraded: false });
    await supervisor.close();
    const restartedLauncher = new FakeLauncher();
    const restarted = makeSupervisor(root, builder, restartedLauncher, health, ports);
    expect(await restarted.start()).toMatchObject({ revision: 'a'.repeat(40), previousRevision: 'b'.repeat(40), available: true });
    expect(builder.loadCalls).toContain('a'.repeat(40));
    expect(restartedLauncher.launched[0]?.port).toBe(18_703);
    await restarted.close();
  });

  it('reports unsupported modes without starting a process', async () => {
    const root = join(process.cwd(), `.tmp-memory-supervisor-${randomUUID()}`);
    roots.push(root);
    const launcher = new FakeLauncher();
    const supervisor = new TencentMemoryRuntimeSupervisor({
      runtimeRoot: root,
      settings: () => ({ ...settings, mode: 'proxy' }),
      candidateBuilder: new FakeBuilder(),
      processLauncher: launcher,
      healthClient: new FakeHealth(),
      portAllocator: new FakePorts(),
    });
    expect(await supervisor.update()).toMatchObject({ mode: 'proxy', available: false, degraded: true, lastErrorCode: 'unavailable' });
    expect(launcher.launched).toHaveLength(0);
    await supervisor.close();
  });

  it('stops the current sidecar when settings are switched off', async () => {
    const root = join(process.cwd(), `.tmp-memory-supervisor-${randomUUID()}`);
    roots.push(root);
    const builder = new FakeBuilder();
    const launcher = new FakeLauncher();
    const health = new FakeHealth();
    const ports = new FakePorts();
    let currentSettings = settings;
    const supervisor = new TencentMemoryRuntimeSupervisor({
      runtimeRoot: root,
      settings: () => currentSettings,
      candidateBuilder: builder,
      processLauncher: launcher,
      healthClient: health,
      portAllocator: ports,
    });
    await supervisor.update();
    currentSettings = { ...settings, mode: 'proxy' };
    expect(await supervisor.start()).toMatchObject({ enabled: true, mode: 'proxy', available: false, lastErrorCode: 'unavailable' });
    expect(launcher.launched[0]?.stop).toHaveBeenCalledTimes(1);
    currentSettings = { ...settings, enabled: false };
    expect(await supervisor.start()).toMatchObject({ enabled: false, mode: 'off', updateState: 'disabled' });
    expect(launcher.launched[0]?.stop).toHaveBeenCalledTimes(1);
    await supervisor.close();
  });

  it('fails closed when an upstream candidate has no lockfile for frozen install', async () => {
    const root = join(process.cwd(), `.tmp-memory-builder-${randomUUID()}`);
    roots.push(root);
    const candidateDir = join(root, 'candidates', 'a'.repeat(40));
    await mkdir(join(candidateDir, 'MemoryCore'), { recursive: true });
    await writeFile(join(candidateDir, 'LICENSE'), 'MIT License\n', 'utf8');
    await writeFile(join(candidateDir, 'README.md'), '# MemoryCore\nnode --import tsx src/gateway/server.ts\n', 'utf8');
    await writeFile(join(candidateDir, 'MemoryCore', 'README.md'), '# MemoryCore\nnode --import tsx src/gateway/server.ts\n', 'utf8');
    await writeFile(join(candidateDir, 'MemoryCore', 'package.json'), JSON.stringify({ name: '@tencentdb-agent-memory/memory-tencentdb-v2', engines: { node: '>=22.16.0' }, scripts: { build: 'tsdown' } }), 'utf8');
    const run = vi.fn(async (input: { readonly executable: string; readonly args: readonly string[]; readonly cwd: string; readonly environment?: NodeJS.ProcessEnv; readonly timeoutMs?: number }) => ({ exitCode: 0, stdout: input.args.includes('rev-parse') ? `${'a'.repeat(40)}\n` : '' }));
    const builder = new TencentMemoryCandidateBuilder({ runtimeRoot: root, environment: { PATH: 'safe', READY4VIBE_MEMORY_CORE_API_KEY: 'do-not-pass' }, commandRunner: { run } });
    await expect(builder.buildCandidate({ repository: settings.upstreamRepo, ref: settings.upstreamRef, revision: 'a'.repeat(40), candidateDir })).rejects.toMatchObject({ code: 'NO_LOCKFILE' });
    expect(run).toHaveBeenCalledTimes(3);
    for (const call of run.mock.calls) expect(call[0]?.environment).not.toHaveProperty('READY4VIBE_MEMORY_CORE_API_KEY');
  });

  it('releases an allocated port and terminates a Windows-safe child process tree', async () => {
    const port = await new LocalPortAllocator().allocate();
    const probe = await new Promise<boolean>((resolveProbe, rejectProbe) => {
      const server = createServer();
      server.once('error', rejectProbe);
      server.listen({ host: '127.0.0.1', port }, () => server.close(() => resolveProbe(true)));
    });
    expect(probe).toBe(true);
    const launcher = new NodeMemorySidecarLauncher({ drainTimeoutMs: 100 });
    const sidecar = await launcher.launch({
      candidate: { revision: 'a'.repeat(40), rootDir: process.cwd(), packageDir: process.cwd(), healthPath: '/health', executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
      port: 19_099,
      environment: { PATH: process.env.PATH ?? '' },
    });
    expect(sidecar.pid).toBeTypeOf('number');
    await sidecar.stop(100);
    await sidecar.stop(100);
  });
});
