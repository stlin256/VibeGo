import { describe, expect, it, vi } from 'vitest';
import type { ResourceSample } from '@ready4vibe/contracts';
import {
  ResourceSamplingLifecycleAdapter,
  type ResourceCollectorLike,
  type ResourceSamplingLifecycleInput,
  type ResourceSamplingLifecycleAdapterOptions,
} from './resource-sampling-lifecycle.js';
import type { ResourceCollectorOptions, ResourceCollectorStatus, ResourceProbeAdapter, ResourceRuntime, ResourceSampleWriter, TimerScheduler } from './resource-collector.js';

const at = '2026-08-05T00:00:00.000Z';
const runId = 'run_sampling_lifecycle_01';

function input(overrides: Partial<ResourceSamplingLifecycleInput> = {}): ResourceSamplingLifecycleInput {
  return {
    runId,
    logicalAttemptId: 'attempt_sampling_01',
    attempt: 1,
    phase: 'create',
    at,
    sampling: 'enabled',
    leaseAcquired: true,
    ...overrides,
  };
}

function writerFixture(): { writer: ResourceSampleWriter; samples: ResourceSample[] } {
  const samples: ResourceSample[] = [];
  return {
    samples,
    writer: {
      appendBatch: vi.fn(async (batch) => { samples.push(...(batch.resourceSamples ?? [])); }),
    },
  };
}

function fakeCollectorFactory(): { factory: (options: ResourceCollectorOptions) => ResourceCollectorLike; instances: Array<{ options: ResourceCollectorOptions; starts: number; stops: number; state: ResourceCollectorStatus['state'] }> } {
  const instances: Array<{ options: ResourceCollectorOptions; starts: number; stops: number; state: ResourceCollectorStatus['state'] }> = [];
  const factory = (options: ResourceCollectorOptions): ResourceCollectorLike => {
    const record = { options, starts: 0, stops: 0, state: 'stopped' as ResourceCollectorStatus['state'] };
    instances.push(record);
    return {
      start: () => { record.starts += 1; record.state = 'running'; },
      stop: async () => { record.stops += 1; record.state = 'ready'; },
      sampleOnce: async () => ({ status: 'queued' as const }),
      status: () => ({
        state: record.state,
        profile: options.profile ?? 'active',
        adapter: 'not-configured' as const,
        queuedSamples: 0,
        droppedSampleCount: 0,
      }),
    };
  };
  return { factory, instances };
}

function runtimeFixture(): { runtime: ResourceRuntime; scheduler: TimerScheduler } {
  const runtime: ResourceRuntime = {
    cpuUsage: () => ({ user: 0, system: 0 }),
    memoryUsage: () => ({ rss: 1024, heapTotal: 2048, heapUsed: 512, external: 128, arrayBuffers: 0 }),
    totalmem: () => 16_000,
    freemem: () => 8_000,
    cpuCount: () => 2,
    monotonicMs: () => 1_000,
    now: () => new Date(at),
  };
  const scheduler: TimerScheduler = {
    setInterval: (callback) => callback,
    clearInterval: () => undefined,
  };
  return { runtime, scheduler };
}

describe('ResourceSamplingLifecycleAdapter', () => {
  it('does not create a collector without a Scheduler lease or when sampling is disabled', async () => {
    const fixture = fakeCollectorFactory();
    const { writer } = writerFixture();
    const adapter = new ResourceSamplingLifecycleAdapter({ writer, collectorFactory: fixture.factory });

    expect((await adapter.transition(input({ leaseAcquired: false }))).errorCode).toBe('OBSERVABILITY_RESOURCE_LEASE_REQUIRED');
    expect((await adapter.transition(input({ logicalAttemptId: 'attempt_disabled', sampling: 'disabled' }))).errorCode).toBe('OBSERVABILITY_RESOURCE_DISABLED');
    expect(fixture.instances).toHaveLength(0);
  });

  it('starts after lease, captures a snapshot and stops/flushed on terminal', async () => {
    const fixture = fakeCollectorFactory();
    const { writer } = writerFixture();
    const adapter = new ResourceSamplingLifecycleAdapter({ writer, collectorFactory: fixture.factory, profile: 'idle', retentionDays: 14 });

    expect((await adapter.transition(input({ profile: 'idle' }))).status).toBe('started');
    expect((await adapter.transition(input({ profile: 'idle' }))).status).toBe('noop');
    expect((await adapter.sampleOnce('attempt_sampling_01')).status).toBe('queued');
    expect((await adapter.transition(input({ phase: 'terminal', profile: 'idle' }))).status).toBe('stopped');
    expect(fixture.instances[0]).toMatchObject({ starts: 1, stops: 1, options: { runId, profile: 'idle', scope: 'run' } });
    expect(adapter.policy()).toEqual({ profile: 'idle', scope: 'run', retentionDays: 14 });
  });

  it('pauses, recovers into a fresh snapshot, then cancels without leaking a collector', async () => {
    const fixture = fakeCollectorFactory();
    const { writer } = writerFixture();
    const adapter = new ResourceSamplingLifecycleAdapter({ writer, collectorFactory: fixture.factory });

    expect((await adapter.transition(input())).status).toBe('started');
    expect((await adapter.transition(input({ phase: 'pause' }))).status).toBe('stopped');
    expect((await adapter.transition(input({ phase: 'recover' }))).status).toBe('started');
    expect((await adapter.transition(input({ phase: 'cancel' }))).status).toBe('stopped');
    expect(fixture.instances).toHaveLength(2);
    expect(fixture.instances.map((item) => item.starts)).toEqual([1, 1]);
    expect(fixture.instances.map((item) => item.stops)).toEqual([1, 1]);
    expect(adapter.status('attempt_sampling_01')).toBeUndefined();
  });

  it('fails closed on snapshot conflicts and identity changes', async () => {
    const fixture = fakeCollectorFactory();
    const { writer } = writerFixture();
    const adapter = new ResourceSamplingLifecycleAdapter({ writer, collectorFactory: fixture.factory });

    expect((await adapter.transition(input())).status).toBe('started');
    expect((await adapter.transition(input({ profile: 'detailed' }))).status).toBe('conflict');
    expect((await adapter.transition(input({ runId: 'run_other' }))).status).toBe('conflict');
    expect((await adapter.transition(input({ phase: 'terminal' }))).status).toBe('stopped');
    expect((await adapter.transition(input({ phase: 'terminal' }))).status).toBe('noop');
  });

  it('returns degraded when collector stop reports a writer failure', async () => {
    const instances: ResourceCollectorLike[] = [];
    const { writer } = writerFixture();
    const adapter = new ResourceSamplingLifecycleAdapter({
      writer,
      collectorFactory: () => {
        let state: ResourceCollectorStatus['state'] = 'stopped';
        const collector: ResourceCollectorLike = {
          start: () => { state = 'running'; },
          stop: async () => { state = 'degraded'; },
          sampleOnce: async () => ({ status: 'queued' as const }),
          status: () => ({ state, profile: 'active', adapter: 'not-configured', queuedSamples: 0, droppedSampleCount: 1, lastErrorCode: 'OBSERVABILITY_RESOURCE_WRITE_FAILED' }),
        };
        instances.push(collector);
        return collector;
      },
    });

    expect((await adapter.transition(input())).status).toBe('started');
    const result = await adapter.transition(input({ phase: 'terminal' }));
    expect(result.status).toBe('degraded');
    expect(result.errorCode).toBe('OBSERVABILITY_RESOURCE_STOP_FAILED');
    expect(instances).toHaveLength(1);
  });

  it('uses injected Windows/macOS/Linux probe fixtures without shell or CLI calls', async () => {
    const platforms = ['win32', 'darwin', 'linux'] as const;
    for (const [index, platform] of platforms.entries()) {
      const { writer, samples } = writerFixture();
      const { runtime, scheduler } = runtimeFixture();
      const adapterFixture: ResourceProbeAdapter = {
        source: 'os-adapter',
        supports: () => platform !== 'darwin',
        sample: () => ({ disk: { volumeClass: 'workspace-volume', volumeId: `volume_${platform}`, freeBytes: '10' } }),
      };
      const options: ResourceSamplingLifecycleAdapterOptions = {
        writer,
        collectorOptions: {
          runtime,
          scheduler,
          adapters: [adapterFixture],
          sampleId: () => `sample_${index}`,
        },
      };
      const adapter = new ResourceSamplingLifecycleAdapter(options);
      const logicalAttemptId = `attempt_${platform}`;
      expect((await adapter.transition(input({ logicalAttemptId }))).status).toBe('started');
      const sampled = await adapter.sampleOnce(logicalAttemptId);
      expect(['queued', 'degraded']).toContain(sampled.status);
      await adapter.transition(input({ logicalAttemptId, phase: 'terminal' }));
      if (platform === 'darwin') expect(samples[0]?.accuracy).toBe('unknown');
      else expect(samples[0]?.disk?.volumeId).toBe(`volume_${platform}`);
    }
  });

  it('rejects secret-shaped and absolute-path lifecycle facts before constructing a collector', async () => {
    const fixture = fakeCollectorFactory();
    const { writer } = writerFixture();
    const adapter = new ResourceSamplingLifecycleAdapter({ writer, collectorFactory: fixture.factory });

    const secret = await adapter.transition(input({ logicalAttemptId: 'authorization: Bearer secret' }));
    const path = await adapter.transition(input({ runId: 'C:\\private\\run' }));
    expect(secret).toMatchObject({ status: 'rejected', errorCode: 'OBSERVABILITY_RESOURCE_PRIVACY' });
    expect(path).toMatchObject({ status: 'rejected', errorCode: 'OBSERVABILITY_RESOURCE_PRIVACY' });
    expect(fixture.instances).toHaveLength(0);
  });
});
