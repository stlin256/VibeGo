import {
  canonicalObservabilityJson,
} from './index.js';
import {
  ResourceCollector,
  type ResourceCollectorOptions,
  type ResourceCollectorStatus,
  type ResourceSampleResult,
  type ResourceSampleWriter,
  type ResourceSamplingProfile,
} from './resource-collector.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const SECRET_VALUE = /(?:sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|credential|bearer)\s*[:=]\s*\S+)/iu;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;
const UNC_ABSOLUTE = /^\\\\/u;
const POSIX_ABSOLUTE = /^\/(?!\/)/u;
const MAX_TERMINAL_SNAPSHOTS = 4_096;

export type ResourceSamplingLifecyclePhase = 'create' | 'retry' | 'pause' | 'cancel' | 'recover' | 'terminal';
export type ResourceSamplingLifecycleSampling = 'enabled' | 'disabled';

export interface ResourceSamplingLifecycleInput {
  readonly runId: string;
  readonly logicalAttemptId: string;
  readonly attempt: number;
  readonly phase: ResourceSamplingLifecyclePhase;
  readonly at: string;
  readonly sampling?: ResourceSamplingLifecycleSampling;
  readonly leaseAcquired?: boolean;
  readonly profile?: ResourceSamplingProfile;
  readonly scope?: 'run' | 'daemon';
  /** Policy metadata only; this adapter never deletes ledger rows. */
  readonly retentionDays?: number;
}

export interface ResourceCollectorLike {
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly sampleOnce: () => Promise<ResourceSampleResult>;
  readonly status: () => ResourceCollectorStatus;
}

export interface ResourceSamplingLifecycleAdapterOptions {
  readonly writer: ResourceSampleWriter;
  readonly collectorFactory?: (options: ResourceCollectorOptions) => ResourceCollectorLike;
  readonly collectorOptions?: Omit<ResourceCollectorOptions, 'writer' | 'runId' | 'scope' | 'profile'>;
  readonly profile?: ResourceSamplingProfile;
  readonly scope?: 'run' | 'daemon';
  readonly retentionDays?: number;
}

export type ResourceSamplingLifecycleResultStatus = 'started' | 'stopped' | 'noop' | 'ignored' | 'conflict' | 'rejected' | 'degraded';

export interface ResourceSamplingLifecycleResult {
  readonly status: ResourceSamplingLifecycleResultStatus;
  readonly logicalAttemptId: string;
  readonly collectorStatus?: ResourceCollectorStatus;
  readonly errorCode?:
    | 'OBSERVABILITY_RESOURCE_LEASE_REQUIRED'
    | 'OBSERVABILITY_RESOURCE_DISABLED'
    | 'OBSERVABILITY_RESOURCE_CONFLICT'
    | 'OBSERVABILITY_RESOURCE_PRIVACY'
    | 'OBSERVABILITY_RESOURCE_INVALID'
    | 'OBSERVABILITY_RESOURCE_STOP_FAILED';
}

interface ActiveSampling {
  readonly runId: string;
  readonly logicalAttemptId: string;
  readonly attempt: number;
  readonly signature: string;
  readonly collector: ResourceCollectorLike;
}

/**
 * Run/application boundary for the existing low-resource ResourceCollector.
 * It has no scheduler of its own: callers must provide an explicit lease fact
 * before a collector starts. All process/OS probes remain injected into the
 * collector and no shell, CLI or workspace scan is performed here.
 */
export class ResourceSamplingLifecycleAdapter {
  private readonly writer: ResourceSampleWriter;
  private readonly collectorFactory: (options: ResourceCollectorOptions) => ResourceCollectorLike;
  private readonly collectorOptions: Omit<ResourceCollectorOptions, 'writer' | 'runId' | 'scope' | 'profile'>;
  private readonly defaultProfile: ResourceSamplingProfile;
  private readonly defaultScope: 'run' | 'daemon';
  private readonly defaultRetentionDays: number;
  private readonly active = new Map<string, ActiveSampling>();
  private readonly terminal = new Map<string, string>();

  constructor(options: ResourceSamplingLifecycleAdapterOptions) {
    this.writer = options.writer;
    this.collectorFactory = options.collectorFactory ?? ((collectorOptions) => new ResourceCollector(collectorOptions));
    this.collectorOptions = { ...(options.collectorOptions ?? {}) };
    this.defaultProfile = options.profile ?? 'active';
    this.defaultScope = options.scope ?? 'run';
    this.defaultRetentionDays = boundedRetention(options.retentionDays ?? 30);
  }

  async transition(input: ResourceSamplingLifecycleInput): Promise<ResourceSamplingLifecycleResult> {
    const validation = validateInput({
      ...input,
      ...(input.profile === undefined ? { profile: this.defaultProfile } : {}),
      ...(input.scope === undefined ? { scope: this.defaultScope } : {}),
      ...(input.retentionDays === undefined ? { retentionDays: this.defaultRetentionDays } : {}),
    });
    if (!validation.ok) return validation.result;
    const normalized = validation.input;
    const active = this.active.get(normalized.logicalAttemptId);
    if (isStartPhase(normalized.phase)) {
      if (normalized.sampling === 'disabled') {
        return { status: 'ignored', logicalAttemptId: normalized.logicalAttemptId, errorCode: 'OBSERVABILITY_RESOURCE_DISABLED' };
      }
      if (normalized.leaseAcquired !== true) {
        return { status: 'ignored', logicalAttemptId: normalized.logicalAttemptId, errorCode: 'OBSERVABILITY_RESOURCE_LEASE_REQUIRED' };
      }
      if (this.terminal.has(normalized.logicalAttemptId)) return conflictResult(normalized.logicalAttemptId);
      const signature = signatureFor(normalized);
      if (active) {
        if (active.signature !== signature) return conflictResult(normalized.logicalAttemptId);
        return { status: 'noop', logicalAttemptId: normalized.logicalAttemptId, collectorStatus: active.collector.status() };
      }
      try {
        const collector = this.collectorFactory({
          ...this.collectorOptions,
          writer: this.writer,
          runId: normalized.runId,
          scope: normalized.scope,
          profile: normalized.profile,
        });
        collector.start();
        this.active.set(normalized.logicalAttemptId, {
          runId: normalized.runId,
          logicalAttemptId: normalized.logicalAttemptId,
          attempt: normalized.attempt,
          signature,
          collector,
        });
        return { status: 'started', logicalAttemptId: normalized.logicalAttemptId, collectorStatus: collector.status() };
      } catch {
        return { status: 'degraded', logicalAttemptId: normalized.logicalAttemptId, errorCode: 'OBSERVABILITY_RESOURCE_INVALID' };
      }
    }

    if (!active) {
      if (normalized.phase === 'terminal') {
        const signature = signatureFor(normalized);
        const previous = this.terminal.get(normalized.logicalAttemptId);
        if (previous !== undefined && previous !== signature) return conflictResult(normalized.logicalAttemptId);
        if (previous !== undefined) return { status: 'noop', logicalAttemptId: normalized.logicalAttemptId };
        this.terminal.set(normalized.logicalAttemptId, signature);
      }
      return { status: 'ignored', logicalAttemptId: normalized.logicalAttemptId };
    }

    if (active.runId !== normalized.runId || active.attempt !== normalized.attempt) return conflictResult(normalized.logicalAttemptId);

    const stopped = await this.stopActive(normalized.logicalAttemptId, active);
    this.active.delete(normalized.logicalAttemptId);
    if (normalized.phase === 'terminal') this.rememberTerminal(normalized.logicalAttemptId, signatureFor(normalized));
    return stopped;
  }

  async sampleOnce(logicalAttemptId: string): Promise<ResourceSampleResult> {
    const active = this.active.get(logicalAttemptId);
    if (!active) return { status: 'stopped', errorCode: 'OBSERVABILITY_RESOURCE_STOPPED' };
    return active.collector.sampleOnce();
  }

  status(logicalAttemptId: string): ResourceCollectorStatus | undefined {
    return this.active.get(logicalAttemptId)?.collector.status();
  }

  /** Exposes the bounded policy snapshot without exposing collector internals. */
  policy(): { readonly profile: ResourceSamplingProfile; readonly scope: 'run' | 'daemon'; readonly retentionDays: number } {
    return Object.freeze({ profile: this.defaultProfile, scope: this.defaultScope, retentionDays: this.defaultRetentionDays });
  }

  private async stopActive(logicalAttemptId: string, active: ActiveSampling): Promise<ResourceSamplingLifecycleResult> {
    try {
      await active.collector.stop();
      const collectorStatus = active.collector.status();
      return {
        status: collectorStatus.state === 'degraded' ? 'degraded' : 'stopped',
        logicalAttemptId,
        collectorStatus,
        ...(collectorStatus.state === 'degraded' ? { errorCode: 'OBSERVABILITY_RESOURCE_STOP_FAILED' as const } : {}),
      };
    } catch {
      return { status: 'degraded', logicalAttemptId, errorCode: 'OBSERVABILITY_RESOURCE_STOP_FAILED' };
    }
  }

  private rememberTerminal(logicalAttemptId: string, signature: string): void {
    this.terminal.set(logicalAttemptId, signature);
    while (this.terminal.size > MAX_TERMINAL_SNAPSHOTS) {
      const oldest = this.terminal.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.terminal.delete(oldest);
    }
  }
}

function validateInput(input: ResourceSamplingLifecycleInput):
  | { readonly ok: true; readonly input: Required<Pick<ResourceSamplingLifecycleInput, 'runId' | 'logicalAttemptId' | 'attempt' | 'phase' | 'at' | 'sampling' | 'profile' | 'scope' | 'retentionDays'>> & Pick<ResourceSamplingLifecycleInput, 'leaseAcquired'> }
  | { readonly ok: false; readonly result: ResourceSamplingLifecycleResult } {
  const logicalAttemptId = input && typeof input.logicalAttemptId === 'string' ? input.logicalAttemptId : 'invalid';
  try {
    if (!isSafeId(input.runId) || !isSafeId(input.logicalAttemptId)) throw new Error('id');
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > 128) throw new Error('attempt');
    if (!isSafeTimestamp(input.at)) throw new Error('timestamp');
    if (!['create', 'retry', 'pause', 'cancel', 'recover', 'terminal'].includes(input.phase)) throw new Error('phase');
    if (input.sampling !== undefined && input.sampling !== 'enabled' && input.sampling !== 'disabled') throw new Error('sampling');
    if (input.profile !== undefined && !['idle', 'active', 'detailed'].includes(input.profile)) throw new Error('profile');
    if (input.scope !== undefined && input.scope !== 'run' && input.scope !== 'daemon') throw new Error('scope');
    const retentionDays = boundedRetention(input.retentionDays ?? 30);
    const normalized = {
      runId: input.runId,
      logicalAttemptId: input.logicalAttemptId,
      attempt: input.attempt,
      phase: input.phase,
      at: input.at,
      sampling: input.sampling ?? 'enabled',
      ...(input.leaseAcquired === undefined ? {} : { leaseAcquired: input.leaseAcquired }),
      profile: input.profile ?? 'active',
      scope: input.scope ?? 'run',
      retentionDays,
    } as const;
    return { ok: true, input: normalized };
  } catch {
    const privacy = containsPrivacy(input);
    return {
      ok: false,
      result: {
        status: 'rejected',
        logicalAttemptId,
        errorCode: privacy ? 'OBSERVABILITY_RESOURCE_PRIVACY' : 'OBSERVABILITY_RESOURCE_INVALID',
      },
    };
  }
}

function isStartPhase(phase: ResourceSamplingLifecyclePhase): boolean {
  return phase === 'create' || phase === 'retry' || phase === 'recover';
}

function signatureFor(input: Required<Pick<ResourceSamplingLifecycleInput, 'runId' | 'logicalAttemptId' | 'attempt' | 'phase' | 'at' | 'sampling' | 'profile' | 'scope' | 'retentionDays'>>): string {
  return canonicalObservabilityJson({
    runId: input.runId,
    logicalAttemptId: input.logicalAttemptId,
    attempt: input.attempt,
    at: input.at,
    sampling: input.sampling,
    profile: input.profile,
    scope: input.scope,
    retentionDays: input.retentionDays,
  });
}

function conflictResult(logicalAttemptId: string): ResourceSamplingLifecycleResult {
  return { status: 'conflict', logicalAttemptId, errorCode: 'OBSERVABILITY_RESOURCE_CONFLICT' };
}

function boundedRetention(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_650) throw new Error('retention');
  return value;
}

function isSafeTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value) && !SECRET_VALUE.test(value) && !isAbsolutePath(value);
}

function isAbsolutePath(value: string): boolean {
  return WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value) || POSIX_ABSOLUTE.test(value);
}

function containsPrivacy(value: unknown): boolean {
  if (typeof value === 'string') return SECRET_VALUE.test(value) || isAbsolutePath(value);
  if (Array.isArray(value)) return value.some((entry) => containsPrivacy(entry));
  if (typeof value !== 'object' || value === null) return false;
  try {
    return Object.entries(value).some(([key, child]) => SECRET_VALUE.test(key) || containsPrivacy(child));
  } catch {
    return true;
  }
}
