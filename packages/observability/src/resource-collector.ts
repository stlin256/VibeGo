import { randomUUID } from 'node:crypto';
import process from 'node:process';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import {
  ResourceSampleSchema,
  type ObservabilityAccuracy,
  type ResourceSample,
} from '@ready4vibe/contracts';

export type ResourceSamplingProfile = 'idle' | 'active' | 'detailed';

export const RESOURCE_SAMPLING_PROFILES: Readonly<Record<ResourceSamplingProfile, {
  readonly intervalMs: number;
  readonly queueCapacity: number;
  readonly maxBatchSize: number;
}>> = Object.freeze({
  idle: Object.freeze({ intervalMs: 60_000, queueCapacity: 16, maxBatchSize: 4 }),
  active: Object.freeze({ intervalMs: 5_000, queueCapacity: 32, maxBatchSize: 8 }),
  detailed: Object.freeze({ intervalMs: 1_000, queueCapacity: 64, maxBatchSize: 16 }),
});

export interface ResourceRuntime {
  readonly cpuUsage: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
  readonly memoryUsage: () => NodeJS.MemoryUsage;
  readonly totalmem: () => number;
  readonly freemem: () => number;
  readonly cpuCount: () => number;
  readonly monotonicMs: () => number;
  readonly now: () => Date;
}

export interface TimerScheduler {
  readonly setInterval: (callback: () => void, delayMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
}

export interface ResourceProbeContext {
  readonly sampledAt: string;
  readonly profile: ResourceSamplingProfile;
  readonly samplingIntervalMs: number;
  readonly scope: ResourceSample['scope'];
  readonly runId?: string;
  readonly turnId?: string;
}

export interface ResourceAdapterSample {
  readonly accuracy?: ObservabilityAccuracy;
  readonly cpu?: NonNullable<ResourceSample['cpu']>;
  readonly memory?: Pick<NonNullable<ResourceSample['memory']>, 'hostAvailableBytes'>;
  readonly disk?: ResourceSample['disk'];
}

export interface ResourceProbeAdapter {
  readonly source: 'os-adapter' | 'sandbox-adapter';
  readonly supports: () => boolean;
  readonly sample: (context: ResourceProbeContext) => ResourceAdapterSample | undefined | Promise<ResourceAdapterSample | undefined>;
}

export interface ResourceSampleWriter {
  readonly appendBatch: (batch: { readonly resourceSamples?: readonly ResourceSample[] }) => Promise<unknown>;
}

export interface ResourceCollectorOptions {
  readonly writer: ResourceSampleWriter;
  readonly runtime?: ResourceRuntime;
  readonly scheduler?: TimerScheduler;
  readonly adapters?: readonly ResourceProbeAdapter[];
  readonly profile?: ResourceSamplingProfile;
  readonly scope?: ResourceSample['scope'];
  readonly runId?: string;
  readonly turnId?: string;
  readonly queueCapacity?: number;
  readonly maxBatchSize?: number;
  readonly flushTimeoutMs?: number;
  readonly sampleId?: () => string;
}

export type ResourceCollectorState = 'stopped' | 'running' | 'ready' | 'degraded';
export type ResourceAdapterState = 'not-configured' | 'supported' | 'unsupported' | 'degraded';

export interface ResourceCollectorStatus {
  readonly state: ResourceCollectorState;
  readonly profile: ResourceSamplingProfile;
  readonly adapter: ResourceAdapterState;
  readonly queuedSamples: number;
  readonly droppedSampleCount: number;
  readonly lastSampleAt?: string;
  readonly lastErrorCode?: string;
}

export type ResourceSampleResultStatus = 'queued' | 'dropped' | 'degraded' | 'stopped';

export interface ResourceSampleResult {
  readonly status: ResourceSampleResultStatus;
  readonly sample?: ResourceSample;
  readonly errorCode?: string;
}

const DEFAULT_RUNTIME: ResourceRuntime = {
  cpuUsage: (previous) => process.cpuUsage(previous),
  memoryUsage: () => process.memoryUsage(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  cpuCount: () => Math.max(1, os.cpus().length),
  monotonicMs: () => performance.now(),
  now: () => new Date(),
};

const DEFAULT_SCHEDULER: TimerScheduler = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Low-overhead, explicit resource sampling. It is intentionally an adapter:
 * callers decide when to construct/start it and provide the ledger writer.
 * No shell, CLI, filesystem scan, or implicit daemon integration is performed.
 */
export class ResourceCollector {
  private readonly writer: ResourceSampleWriter;
  private readonly runtime: ResourceRuntime;
  private readonly scheduler: TimerScheduler;
  private readonly adapters: readonly ResourceProbeAdapter[];
  private readonly profile: ResourceSamplingProfile;
  private readonly scope: ResourceSample['scope'];
  private readonly runId: string | undefined;
  private readonly turnId: string | undefined;
  private readonly queueCapacity: number;
  private readonly maxBatchSize: number;
  private readonly flushTimeoutMs: number;
  private readonly queue: ResourceSample[] = [];
  private state: ResourceCollectorState = 'stopped';
  private startedOnce = false;
  private lifecycle = 0;
  private adapterState: ResourceAdapterState = 'not-configured';
  private droppedSampleCount = 0;
  private inFlightSamples = 0;
  private readonly sampleId: () => string;
  private timer: unknown;
  private drainPromise: Promise<void> | undefined;
  private previousCpuUsage: NodeJS.CpuUsage;
  private previousMonotonicMs: number;
  private lastSampleAt: string | undefined;
  private lastErrorCode: string | undefined;

  constructor(options: ResourceCollectorOptions) {
    this.writer = options.writer;
    this.runtime = options.runtime ?? DEFAULT_RUNTIME;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.adapters = Object.freeze([...(options.adapters ?? [])]);
    this.profile = options.profile ?? 'active';
    this.scope = options.scope ?? 'daemon';
    this.runId = options.runId;
    this.turnId = options.turnId;
    const defaults = RESOURCE_SAMPLING_PROFILES[this.profile];
    this.queueCapacity = boundedPositive(options.queueCapacity ?? defaults.queueCapacity, 1_024, 'queue capacity');
    this.maxBatchSize = boundedPositive(options.maxBatchSize ?? defaults.maxBatchSize, 64, 'batch size');
    this.flushTimeoutMs = boundedPositive(options.flushTimeoutMs ?? 1_000, 60_000, 'flush timeout');
    this.sampleId = options.sampleId ?? (() => `sample_${randomUUID().replaceAll('-', '')}`);
    this.previousCpuUsage = this.safeCpuUsage();
    this.previousMonotonicMs = this.safeMonotonicMs();
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.startedOnce = true;
    this.lifecycle += 1;
    this.previousCpuUsage = this.safeCpuUsage();
    this.previousMonotonicMs = this.safeMonotonicMs();
    this.state = 'running';
    this.timer = this.scheduler.setInterval(() => { void this.sampleOnce(); }, RESOURCE_SAMPLING_PROFILES[this.profile].intervalMs);
  }

  async stop(): Promise<void> {
    this.lifecycle += 1;
    if (this.timer !== undefined) {
      this.scheduler.clearInterval(this.timer);
      this.timer = undefined;
    }
    this.state = 'stopped';
    await this.flush();
  }

  async sampleOnce(): Promise<ResourceSampleResult> {
    if (this.startedOnce && this.timer === undefined) return { status: 'stopped', errorCode: 'OBSERVABILITY_RESOURCE_STOPPED' };
    const lifecycle = this.lifecycle;
    if (this.queue.length + this.inFlightSamples >= this.queueCapacity) {
      this.droppedSampleCount = boundedAdd(this.droppedSampleCount, 1);
      this.state = 'degraded';
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_QUEUE_FULL';
      return { status: 'dropped', errorCode: this.lastErrorCode };
    }

    const profile = RESOURCE_SAMPLING_PROFILES[this.profile];
    const sampledAt = this.safeNow().toISOString();
    const elapsedMs = Math.max(1, this.safeMonotonicMs() - this.previousMonotonicMs);
    const cpuDelta = this.safeCpuDelta(this.previousCpuUsage);
    this.previousMonotonicMs += elapsedMs;
    this.previousCpuUsage = this.safeCpuUsage();

    const node = this.readNodeMetrics(cpuDelta, elapsedMs);
    const adapter = await this.readAdapters({
      sampledAt,
      profile: this.profile,
      samplingIntervalMs: profile.intervalMs,
      scope: this.scope,
      ...(this.runId === undefined ? {} : { runId: this.runId }),
      ...(this.turnId === undefined ? {} : { turnId: this.turnId }),
    });
    if (adapter.state !== 'not-configured') this.adapterState = adapter.state;

    const mergedCpu = adapter.sample?.cpu ?? node.cpu;
    const mergedMemory = node.memory === undefined && adapter.sample?.memory === undefined
      ? undefined
      : { ...node.memory, ...adapter.sample?.memory };

    const sampleCandidate: ResourceSample = {
      schemaVersion: 'ready4vibe_resource_sample_v1',
      sampleId: this.sampleId(),
      sampledAt,
      scope: this.scope,
      ...(this.runId === undefined ? {} : { runId: this.runId }),
      ...(this.turnId === undefined ? {} : { turnId: this.turnId }),
      source: 'node',
      accuracy: adapter.state === 'degraded' || adapter.state === 'unsupported' ? 'unknown' : 'measured',
      ...(mergedCpu === undefined ? {} : { cpu: mergedCpu }),
      ...(mergedMemory === undefined ? {} : { memory: mergedMemory }),
      ...(adapter.sample?.disk === undefined ? {} : { disk: adapter.sample.disk }),
      samplingIntervalMs: profile.intervalMs,
      droppedSampleCount: this.droppedSampleCount,
    };

    let sample: ResourceSample;
    try {
      sample = ResourceSampleSchema.parse(sampleCandidate);
    } catch (error) {
      const code = hasPrivacyIssue(error) ? 'OBSERVABILITY_RESOURCE_PRIVACY' : 'OBSERVABILITY_RESOURCE_INVALID_SAMPLE';
      this.state = 'degraded';
      this.lastErrorCode = code;
      this.droppedSampleCount = boundedAdd(this.droppedSampleCount, 1);
      return { status: 'degraded', errorCode: code };
    }

    this.droppedSampleCount = 0;
    this.lastSampleAt = sample.sampledAt;
    if (lifecycle !== this.lifecycle || (this.startedOnce && this.timer === undefined)) {
      return { status: 'stopped', errorCode: 'OBSERVABILITY_RESOURCE_STOPPED' };
    }
    this.queue.push(sample);
    if (adapter.state === 'degraded' || adapter.state === 'unsupported') this.state = 'degraded';
    else if (this.state !== 'running') this.state = 'ready';
    void this.drain();
    return { status: adapter.state === 'degraded' || adapter.state === 'unsupported' ? 'degraded' : 'queued', sample };
  }

  async flush(): Promise<void> {
    if (this.queue.length > 0 && this.drainPromise === undefined) void this.drain();
    const current = this.drainPromise;
    if (!current) return;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([current, new Promise<void>((resolve) => { deadline = setTimeout(resolve, this.flushTimeoutMs); })]);
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
    if (this.drainPromise !== undefined && this.queue.length > 0) {
      this.droppedSampleCount = boundedAdd(this.droppedSampleCount, this.queue.length);
      this.queue.length = 0;
      this.state = 'degraded';
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_FLUSH_TIMEOUT';
    }
  }

  status(): ResourceCollectorStatus {
    return Object.freeze({
      state: this.state,
      profile: this.profile,
      adapter: this.adapterState,
      queuedSamples: this.queue.length + this.inFlightSamples,
      droppedSampleCount: this.droppedSampleCount,
      ...(this.lastSampleAt === undefined ? {} : { lastSampleAt: this.lastSampleAt }),
      ...(this.lastErrorCode === undefined ? {} : { lastErrorCode: this.lastErrorCode }),
    });
  }

  private readNodeMetrics(cpuDelta: NodeJS.CpuUsage | undefined, elapsedMs: number): {
    readonly cpu?: NonNullable<ResourceSample['cpu']>;
    readonly memory?: NonNullable<ResourceSample['memory']>;
  } {
    const cpu = cpuDelta === undefined ? undefined : {
      milliPercent: boundedNumber(Math.round(((cpuDelta.user + cpuDelta.system) / 1_000 / elapsedMs / Math.max(1, this.safeCpuCount())) * 100_000), 100_000),
      cpuTimeMs: boundedNumber(Math.round((cpuDelta.user + cpuDelta.system) / 1_000), 1_000_000_000_000),
    };
    let memory: NonNullable<ResourceSample['memory']> | undefined;
    try {
      const value = this.runtime.memoryUsage();
      const total = safeBytes(this.runtime.totalmem());
      const free = safeBytes(this.runtime.freemem());
      const available = total === undefined || free === undefined ? undefined : String(Math.min(Number(total), Number(free)));
      memory = {
        rssBytes: safeBytes(value.rss),
        heapUsedBytes: safeBytes(value.heapUsed),
        externalBytes: safeBytes(value.external),
        ...(available === undefined ? {} : { hostAvailableBytes: available }),
      };
    } catch {
      this.state = 'degraded';
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_NODE_PROBE_FAILED';
    }
    return {
      ...(cpu === undefined ? {} : { cpu }),
      ...(memory === undefined ? {} : { memory }),
    };
  }

  private async readAdapters(context: ResourceProbeContext): Promise<{
    readonly state: ResourceAdapterState;
    readonly sample?: ResourceAdapterSample;
  }> {
    if (this.adapters.length === 0) return { state: 'not-configured' };
    let supported = 0;
    let degraded = false;
    let merged: ResourceAdapterSample | undefined;
    for (const adapter of this.adapters) {
      let isSupported = false;
      try {
        isSupported = adapter.supports();
      } catch {
        degraded = true;
      }
      if (!isSupported) continue;
      supported += 1;
      try {
        const value = await adapter.sample(context);
        if (value) merged = mergeAdapterSamples(merged, value);
      } catch {
        degraded = true;
      }
    }
    if (degraded) {
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_ADAPTER_FAILED';
      return { state: 'degraded', ...(merged === undefined ? {} : { sample: merged }) };
    }
    if (supported === 0) {
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_ADAPTER_UNSUPPORTED';
      return { state: 'unsupported' };
    }
    return { state: 'supported', ...(merged === undefined ? {} : { sample: merged }) };
  }

  private async drain(): Promise<void> {
    if (this.drainPromise !== undefined) return this.drainPromise;
    this.drainPromise = (async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.maxBatchSize);
        this.inFlightSamples += batch.length;
        try {
          await this.writer.appendBatch({ resourceSamples: batch });
        } catch {
          this.droppedSampleCount = boundedAdd(this.droppedSampleCount, batch.length);
          this.state = 'degraded';
          this.lastErrorCode = 'OBSERVABILITY_RESOURCE_WRITE_FAILED';
        } finally {
          this.inFlightSamples = Math.max(0, this.inFlightSamples - batch.length);
        }
      }
    })().finally(() => {
      this.drainPromise = undefined;
    });
    return this.drainPromise;
  }

  private safeCpuUsage(): NodeJS.CpuUsage {
    try {
      const value = this.runtime.cpuUsage();
      return { user: safeNonNegative(value.user), system: safeNonNegative(value.system) };
    } catch {
      this.state = 'degraded';
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_NODE_PROBE_FAILED';
      return { user: 0, system: 0 };
    }
  }

  private safeCpuDelta(previous: NodeJS.CpuUsage): NodeJS.CpuUsage | undefined {
    try {
      const value = this.runtime.cpuUsage(previous);
      return { user: Math.max(0, safeNonNegative(value.user)), system: Math.max(0, safeNonNegative(value.system)) };
    } catch {
      this.state = 'degraded';
      this.lastErrorCode = 'OBSERVABILITY_RESOURCE_NODE_PROBE_FAILED';
      return undefined;
    }
  }

  private safeMonotonicMs(): number {
    try {
      const value = this.runtime.monotonicMs();
      return Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }

  private safeCpuCount(): number {
    try {
      return Math.max(1, Math.floor(this.runtime.cpuCount()));
    } catch {
      return 1;
    }
  }

  private safeNow(): Date {
    try {
      const value = this.runtime.now();
      return Number.isFinite(value.getTime()) ? value : new Date(0);
    } catch {
      return new Date(0);
    }
  }
}

function mergeAdapterSamples(left: ResourceAdapterSample | undefined, right: ResourceAdapterSample): ResourceAdapterSample {
  const accuracy = right.accuracy ?? left?.accuracy;
  const cpu = right.cpu ?? left?.cpu;
  const memory = left?.memory === undefined && right.memory === undefined ? undefined : { ...left?.memory, ...right.memory };
  const disk = right.disk ?? left?.disk;
  return {
    ...(accuracy === undefined ? {} : { accuracy }),
    ...(cpu === undefined ? {} : { cpu }),
    ...(memory === undefined ? {} : { memory }),
    ...(disk === undefined ? {} : { disk }),
  };
}

function safeBytes(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 9_999_999_999_999_999_999) return undefined;
  return String(value);
}

function safeNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function boundedNumber(value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < 0) return 0;
  return Math.min(value, max);
}

function boundedPositive(value: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label} is outside the bounded range`);
  return value;
}

function boundedAdd(left: number, right: number): number {
  return Math.min(1_000_000_000_000, left + right);
}

function hasPrivacyIssue(error: unknown): boolean {
  return error instanceof Error && /secret|absolute path/iu.test(error.message);
}
