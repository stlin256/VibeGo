import { describe, expect, it, vi } from 'vitest';
import type { ResourceSample } from '@ready4vibe/contracts';
import { ResourceCollector, type ResourceProbeAdapter, type ResourceRuntime, type ResourceSampleWriter, type TimerScheduler } from './resource-collector.js';

function runtimeFixture(): { runtime: ResourceRuntime; advance: (milliseconds: number) => void } {
  let monotonic = 0;
  const cpuValues = [
    { user: 0, system: 0 },
    { user: 10_000, system: 5_000 },
    { user: 20_000, system: 10_000 },
    { user: 30_000, system: 15_000 },
  ];
  let cpuIndex = 0;
  const runtime: ResourceRuntime = {
    cpuUsage: () => cpuValues[Math.min(cpuIndex++, cpuValues.length - 1)]!,
    memoryUsage: () => ({ rss: 1024, heapTotal: 2048, heapUsed: 512, external: 128, arrayBuffers: 0 }),
    totalmem: () => 16_000,
    freemem: () => 8_000,
    cpuCount: () => 2,
    monotonicMs: () => monotonic,
    now: () => new Date('2026-08-04T00:00:00.000Z'),
  };
  return { runtime, advance: (milliseconds) => { monotonic += milliseconds; } };
}

function writerFixture(): { writer: ResourceSampleWriter; samples: ResourceSample[]; reject?: (error: Error) => void; block?: () => void; release?: () => void } {
  const samples: ResourceSample[] = [];
  let reject: ((error: Error) => void) | undefined;
  let blocked = false;
  let resolveBlocked: (() => void) | undefined;
  const writer: ResourceSampleWriter = {
    appendBatch: vi.fn(async (batch) => {
      if (reject) throw new Error('writer unavailable');
      if (blocked) await new Promise<void>((resolve) => { resolveBlocked = resolve; });
      samples.push(...(batch.resourceSamples ?? []));
      return undefined;
    }),
  };
  return {
    writer,
    samples,
    reject: (error) => { reject = () => { throw error; }; },
    block: () => { blocked = true; },
    release: () => { blocked = false; resolveBlocked?.(); resolveBlocked = undefined; },
  };
}

function timerFixture(): { scheduler: TimerScheduler; fire: () => void; active: () => number } {
  const callbacks = new Set<() => void>();
  const scheduler: TimerScheduler = {
    setInterval: (callback) => { callbacks.add(callback); return callback; },
    clearInterval: (handle) => { callbacks.delete(handle as () => void); },
  };
  return { scheduler, fire: () => { for (const callback of callbacks) callback(); }, active: () => callbacks.size };
}

describe('ResourceCollector', () => {
  it('collects bounded Node metrics and uses the selected profile interval', async () => {
    const { runtime, advance } = runtimeFixture();
    const { writer, samples } = writerFixture();
    const collector = new ResourceCollector({ runtime, writer, profile: 'active' });

    advance(1_000);
    const result = await collector.sampleOnce();
    await collector.flush();

    expect(result.status).toBe('queued');
    expect(samples[0]).toMatchObject({
      scope: 'daemon',
      source: 'node',
      accuracy: 'measured',
      samplingIntervalMs: 5_000,
      cpu: { milliPercent: 750, cpuTimeMs: 15 },
      memory: { rssBytes: '1024', heapUsedBytes: '512', externalBytes: '128', hostAvailableBytes: '8000' },
      droppedSampleCount: 0,
    });
    expect(collector.status().profile).toBe('active');
  });

  it('drops samples when the bounded queue is full and reports the count on recovery', async () => {
    const { runtime, advance } = runtimeFixture();
    const { writer, samples, block, release } = writerFixture();
    const collector = new ResourceCollector({ runtime, writer, profile: 'idle', queueCapacity: 1 });

    block?.();
    advance(1_000);
    await collector.sampleOnce();
    advance(1_000);
    const dropped = await collector.sampleOnce();
    expect(dropped.status).toBe('dropped');
    expect(collector.status().droppedSampleCount).toBe(1);

    release?.();
    await collector.flush();
    advance(1_000);
    await collector.sampleOnce();
    await collector.flush();

    expect(samples.at(-1)?.droppedSampleCount).toBe(1);
  });

  it('marks unsupported adapters degraded without throwing or blocking the writer', async () => {
    const { runtime, advance } = runtimeFixture();
    const { writer, samples } = writerFixture();
    const adapter: ResourceProbeAdapter = {
      source: 'os-adapter',
      supports: () => false,
      sample: () => undefined,
    };
    const collector = new ResourceCollector({ runtime, writer, adapters: [adapter] });

    advance(1_000);
    const result = await collector.sampleOnce();
    await collector.flush();

    expect(result.status).toBe('degraded');
    expect(collector.status().adapter).toBe('unsupported');
    expect(samples).toHaveLength(1);
  });

  it('stops and restarts scheduling without leaking timers', async () => {
    const { runtime } = runtimeFixture();
    const { writer } = writerFixture();
    const { scheduler, active, fire } = timerFixture();
    const collector = new ResourceCollector({ runtime, writer, scheduler });

    collector.start();
    expect(active()).toBe(1);
    fire();
    await collector.stop();
    expect(active()).toBe(0);
    expect((await collector.sampleOnce()).status).toBe('stopped');
    collector.start();
    expect(active()).toBe(1);
    await collector.stop();
    expect(active()).toBe(0);
  });

  it('does not enqueue a sample that finishes after stop', async () => {
    const { runtime, advance } = runtimeFixture();
    const { writer, samples } = writerFixture();
    let resolveProbe: (() => void) | undefined;
    const adapter: ResourceProbeAdapter = {
      source: 'os-adapter',
      supports: () => true,
      sample: () => new Promise<undefined>((resolve) => { resolveProbe = () => resolve(undefined); }),
    };
    const collector = new ResourceCollector({ runtime, writer, adapters: [adapter] });
    collector.start();
    advance(1_000);
    const pending = collector.sampleOnce();
    await Promise.resolve();
    const stopped = collector.stop();
    resolveProbe?.();
    await pending;
    await stopped;

    expect(samples).toHaveLength(0);
  });

  it('fails soft when the writer rejects and carries lost samples forward', async () => {
    const { runtime, advance } = runtimeFixture();
    const { writer, reject } = writerFixture();
    reject?.(new Error('disk full'));
    const collector = new ResourceCollector({ runtime, writer });

    advance(1_000);
    await collector.sampleOnce();
    await collector.flush();

    expect(collector.status().state).toBe('degraded');
    expect(collector.status().lastErrorCode).toBe('OBSERVABILITY_RESOURCE_WRITE_FAILED');
    expect(collector.status().droppedSampleCount).toBe(1);
  });

  it('rejects adapter privacy violations before writing a sample', async () => {
    const { runtime, advance } = runtimeFixture();
    const { writer, samples } = writerFixture();
    const adapter: ResourceProbeAdapter = {
      source: 'sandbox-adapter',
      supports: () => true,
      sample: () => ({ disk: { volumeClass: 'sandbox-volume', volumeId: 'C:\\private\\sandbox', freeBytes: '10' } }) as never,
    };
    const collector = new ResourceCollector({ runtime, writer, adapters: [adapter] });

    advance(1_000);
    const result = await collector.sampleOnce();
    await collector.flush();

    expect(result.status).toBe('degraded');
    expect(collector.status().lastErrorCode).toBe('OBSERVABILITY_RESOURCE_PRIVACY');
    expect(samples).toHaveLength(0);
  });
});
