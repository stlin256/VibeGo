import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY, type SchedulerRequest } from '@ready4vibe/contracts';
import { Scheduler, SchedulerCancelledError, SchedulerUnsatisfiableRequestError } from './index.js';

const request = (runId: string, workspaceId: string, workspaceAccess: SchedulerRequest['workspaceAccess'] = 'read', priority: SchedulerRequest['priority'] = 'interactive'): SchedulerRequest => ({
  runId,
  workspaceId,
  workspaceAccess,
  priority,
  resources: { modelCalls: 1, toolProcesses: 1 },
});

describe('Scheduler', () => {
  it('supports side-effect-free readiness inspection', async () => {
    const scheduler = new Scheduler({ ...DEFAULT_SCHEDULER_POLICY, maxActiveRuns: 1 });
    const firstRequest = request('run_inspect_1', 'ws_inspect');
    const secondRequest = request('run_inspect_2', 'ws_other');
    expect(scheduler.inspect(firstRequest)).toMatchObject({ status: 'ready', reasonCode: 'READY' });
    expect(scheduler.activeCount()).toBe(0);
    expect(scheduler.queuedRunIds()).toEqual([]);
    const lease = await scheduler.acquire(firstRequest);
    expect(scheduler.inspect(secondRequest)).toMatchObject({ status: 'waiting', reasonCode: 'CAPACITY_BUSY' });
    expect(scheduler.queuedRunIds()).toEqual([]);
    lease.release();
  });

  it('reports unsatisfiable requests without reserving capacity', () => {
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    expect(scheduler.inspect({ ...request('run_inspect_bad', 'ws_bad'), resources: { modelCalls: DEFAULT_SCHEDULER_POLICY.maxActiveModelCalls + 1 } })).toMatchObject({ status: 'blocked', reasonCode: 'UNSATISFIABLE' });
    expect(scheduler.activeCount()).toBe(0);
    expect(scheduler.queuedRunIds()).toEqual([]);
  });

  it('runs independent read workloads concurrently up to the limit', async () => {
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const first = await scheduler.acquire(request('run_1', 'ws_1'));
    const second = await scheduler.acquire(request('run_2', 'ws_2'));
    const thirdPromise = scheduler.acquire(request('run_3', 'ws_3'));

    expect(scheduler.activeRunIds()).toEqual(['run_1', 'run_2']);
    expect(scheduler.queuedRunIds()).toEqual(['run_3']);

    first.release();
    const third = await thirdPromise;
    expect(third.runId).toBe('run_3');
    second.release();
    third.release();
  });

  it('serializes writes on the same workspace but allows reads elsewhere', async () => {
    const scheduler = new Scheduler({ ...DEFAULT_SCHEDULER_POLICY, maxActiveRuns: 3 });
    const write = await scheduler.acquire(request('run_write', 'ws_1', 'write'));
    const readOther = await scheduler.acquire(request('run_read', 'ws_2'));
    const blocked = scheduler.acquire(request('run_blocked', 'ws_1', 'read'));

    expect(scheduler.activeRunIds()).toEqual(['run_write', 'run_read']);
    expect(scheduler.queuedRunIds()).toEqual(['run_blocked']);
    write.release();
    const released = await blocked;
    expect(released.workspaceLease.mode).toBe('read');
    readOther.release();
    released.release();
  });

  it('cancels queued work without affecting active leases', async () => {
    const scheduler = new Scheduler({ ...DEFAULT_SCHEDULER_POLICY, maxActiveRuns: 1 });
    const first = await scheduler.acquire(request('run_1', 'ws_1'));
    const pending = scheduler.acquire(request('run_2', 'ws_2'));
    expect(scheduler.cancelQueued('run_2')).toBe(true);
    await expect(pending).rejects.toBeInstanceOf(SchedulerCancelledError);
    expect(scheduler.activeRunIds()).toEqual(['run_1']);
    first.release();
  });

  it('does not release a lease twice', async () => {
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const lease = await scheduler.acquire(request('run_1', 'ws_1'));
    lease.release();
    lease.release();
    expect(scheduler.activeCount()).toBe(0);
  });

  it('rejects a request that can never fit the configured resources', async () => {
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    await expect(scheduler.acquire({
      ...request('run_too_large', 'ws_1'),
      resources: { modelCalls: DEFAULT_SCHEDULER_POLICY.maxActiveModelCalls + 1 },
    })).rejects.toBeInstanceOf(SchedulerUnsatisfiableRequestError);
  });
});
