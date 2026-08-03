import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { RunManager, RunManagerError } from './run-manager.js';

const config = {
  workspaceId: 'workspace-recovery',
  userMessage: 'inspect the workspace',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: {
    maxTurns: 1,
    maxWallTimeMs: 60_000,
    maxModelInputTokens: 100,
    maxModelOutputTokens: 100,
    maxToolCalls: 10,
    maxOutputBytes: 100,
    maxContextBytes: 100_000,
  },
  createdBySessionId: 'session-recovery',
  clientRequestId: 'client-recovery',
};

function event(runId: string, type: string, payload: unknown) {
  return { runId, type, source: 'system' as const, correlationId: `corr_${runId}`, payload };
}

function manager(eventStore: InMemoryEventStore): RunManager {
  return new RunManager({
    eventStore,
    scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
    modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
  });
}

describe('RunManager restart recovery', () => {
  it('marks non-terminal runs once without restoring approval state', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append(event('run_recovery', 'run.created', { config }));
    await eventStore.append(event('run_recovery', 'run.status', { from: 'created', to: 'waiting-approval' }));
    const runManager = manager(eventStore);

    await expect(runManager.recoverAfterRestart()).resolves.toEqual({ marked: 1, skipped: 0 });
    await expect(runManager.snapshot('run_recovery')).resolves.toMatchObject({
      status: 'needs-recovery',
      approvals: [],
      final: { summary: 'Run requires recovery after daemon restart.', exitReason: 'daemon-restarted' },
    });
    const events = await eventStore.read('run_recovery');
    const marker = events.find((item) => item.type === 'run.needs_recovery');
    expect(marker?.payload).toEqual({ previousStatus: 'waiting-approval', reason: 'daemon-restarted' });
    expect(JSON.stringify(marker?.payload)).not.toMatch(/secret|token|argument|path/iu);

    await expect(runManager.recoverAfterRestart()).resolves.toEqual({ marked: 0, skipped: 1 });
    expect((await eventStore.read('run_recovery')).filter((item) => item.type === 'run.needs_recovery')).toHaveLength(1);
  });

  it('skips terminal runs', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append(event('run_done', 'run.created', { config }));
    await eventStore.append(event('run_done', 'run.status', { from: 'created', to: 'queued' }));
    await eventStore.append(event('run_done', 'run.status', { from: 'queued', to: 'planning' }));
    await eventStore.append(event('run_done', 'run.status', { from: 'planning', to: 'executing' }));
    await eventStore.append(event('run_done', 'run.status', { from: 'executing', to: 'completed' }));
    const runManager = manager(eventStore);

    await expect(runManager.recoverAfterRestart()).resolves.toEqual({ marked: 0, skipped: 1 });
    expect((await eventStore.read('run_done')).some((item) => item.type === 'run.needs_recovery')).toBe(false);
  });

  it('rejects an unknown workspace before queueing a run', async () => {
    const eventStore = new InMemoryEventStore();
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
      workspaceExists: (workspaceId) => workspaceId === 'workspace-ok',
    });
    await expect(runManager.start(config)).rejects.toBeInstanceOf(RunManagerError);
    expect(eventStore.listRunIds()).toEqual([]);
  });
});
