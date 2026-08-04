import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import type {
  AgentMemoryErrorCode,
  AgentMemoryIdentity,
  AgentMemoryMode,
  AgentMemorySettings,
  AgentMemoryStatus,
} from '@ready4vibe/contracts';
import {
  AgentMemoryErrorCodeSchema,
  AgentMemoryIdentitySchema,
  AgentMemoryOperationsSchema,
  AgentMemoryStatusSchema,
  AgentMemoryUpdateRecordSchema,
  AgentMemoryUpdateStateSchema,
  type AgentMemoryOperations,
  type AgentMemoryUpdateRecord,
} from '@ready4vibe/contracts';

const RUNTIME_SCHEMA_VERSION = 'ready4vibe_agent_memory_runtime_v1' as const;
const REVISION = /^[0-9a-f]{40}$/u;
const PACKAGE_NAME = '@tencentdb-agent-memory/memory-tencentdb-v2';
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_README_BYTES = 256 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 8_000;
const DEFAULT_DRAIN_TIMEOUT_MS = 8_000;

export type SupervisorErrorCode =
  | 'INVALID_SETTINGS'
  | 'UPSTREAM_UNAVAILABLE'
  | 'REVISION_INVALID'
  | 'MATERIALIZE_FAILED'
  | 'MANIFEST_INVALID'
  | 'NO_LOCKFILE'
  | 'INSTALL_FAILED'
  | 'BUILD_FAILED'
  | 'TYPECHECK_FAILED'
  | 'HEALTH_FAILED'
  | 'SMOKE_FAILED'
  | 'SWITCH_FAILED'
  | 'ROLLBACK_FAILED'
  | 'RUNTIME_UNAVAILABLE';

export class SupervisorError extends Error {
  constructor(readonly code: SupervisorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SupervisorError';
  }
}

export interface MemoryCandidate {
  readonly revision: string;
  readonly rootDir: string;
  readonly packageDir: string;
  readonly healthPath: string;
  readonly executable: string;
  readonly args: readonly string[];
}

export interface MemoryCandidateBuilder {
  resolveRevision(input: { repository: string; ref: string; signal?: AbortSignal | undefined }): Promise<string>;
  buildCandidate(input: { repository: string; ref: string; revision: string; candidateDir: string; signal?: AbortSignal | undefined }): Promise<MemoryCandidate>;
  loadRevision(input: { revision: string; revisionDir: string; signal?: AbortSignal | undefined }): Promise<MemoryCandidate>;
  discard(candidateDir: string): Promise<void>;
}

export interface MemorySidecar {
  readonly revision: string;
  readonly port: number;
  readonly endpoint: string;
  readonly pid?: number | undefined;
  stop(timeoutMs?: number): Promise<void>;
}

export interface SupervisorProcessLauncher {
  launch(input: { candidate: MemoryCandidate; port: number; environment: NodeJS.ProcessEnv }): Promise<MemorySidecar>;
}

export interface MemorySidecarHealth {
  readonly ok: true;
}

export interface SupervisorHealthClient {
  health(input: { sidecar: MemorySidecar; candidate: MemoryCandidate; signal?: AbortSignal | undefined }): Promise<MemorySidecarHealth>;
  smoke(input: { sidecar: MemorySidecar; identity: AgentMemoryIdentity; signal?: AbortSignal | undefined }): Promise<void>;
}

export interface PortAllocator {
  allocate(): Promise<number>;
}

export interface TencentMemoryRuntimeSupervisorOptions {
  readonly runtimeRoot: string;
  readonly settings: () => AgentMemorySettings;
  readonly candidateBuilder?: MemoryCandidateBuilder;
  readonly processLauncher?: SupervisorProcessLauncher;
  readonly healthClient?: SupervisorHealthClient;
  readonly portAllocator?: PortAllocator;
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => string;
  readonly commandTimeoutMs?: number;
  readonly healthTimeoutMs?: number;
  readonly drainTimeoutMs?: number;
  readonly maxRetainedRevisions?: number;
}

interface CurrentPointer {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  revision: string;
  mode: AgentMemoryMode;
  port: number;
  endpoint: string;
  startedAt: string;
}

interface PreviousPointer {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  revision: string;
  mode: AgentMemoryMode;
  recordedAt: string;
}

interface RuntimeState {
  current: CurrentPointer | null;
  previous: PreviousPointer | null;
  lastHealthAt: string | null;
  lastUpdateAt: string | null;
  healthLatencyMs: number | null;
  updateState: AgentMemoryStatus['updateState'];
  lastErrorCode: AgentMemoryErrorCode | null;
  updates: AgentMemoryUpdateRecord[];
}

interface PointerDocument {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  current: CurrentPointer | null;
  previous: PreviousPointer | null;
}

interface UpdateStateDocument {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  lastHealthAt: string | null;
  lastUpdateAt: string | null;
  healthLatencyMs: number | null;
  updateState: AgentMemoryStatus['updateState'];
  lastErrorCode: AgentMemoryErrorCode | null;
}

interface OperationsDocument {
  schemaVersion: typeof RUNTIME_SCHEMA_VERSION;
  healthLatencyMs: number | null;
  updates: AgentMemoryUpdateRecord[];
}

interface CommandInput {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
}

interface CommandRunner {
  run(input: CommandInput): Promise<CommandResult>;
}

/**
 * The supervisor owns only sidecar lifecycle and revision state. It does not
 * execute agent tools, write run/goal events, or alter RunManager admission.
 */
export class TencentMemoryRuntimeSupervisor {
  private readonly runtimeRoot: string;
  private readonly candidatesRoot: string;
  private readonly revisionsRoot: string;
  private readonly stateRoot: string;
  private readonly settings: () => AgentMemorySettings;
  private readonly candidateBuilder: MemoryCandidateBuilder;
  private readonly processLauncher: SupervisorProcessLauncher;
  private readonly healthClient: SupervisorHealthClient;
  private readonly portAllocator: PortAllocator;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => string;
  private readonly drainTimeoutMs: number;
  private readonly maxRetainedRevisions: number;
  private state: RuntimeState = emptyState();
  private sidecar: MemorySidecar | undefined;
  private queue: Promise<AgentMemoryStatus> = Promise.resolve({} as AgentMemoryStatus);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private stateLoaded = false;

  constructor(options: TencentMemoryRuntimeSupervisorOptions) {
    this.runtimeRoot = resolve(options.runtimeRoot);
    this.candidatesRoot = join(this.runtimeRoot, 'candidates');
    this.revisionsRoot = join(this.runtimeRoot, 'revisions');
    this.stateRoot = join(this.runtimeRoot, 'state');
    this.settings = options.settings;
    this.candidateBuilder = options.candidateBuilder ?? new TencentMemoryCandidateBuilder({
      runtimeRoot: this.runtimeRoot,
      environment: options.environment,
      commandTimeoutMs: options.commandTimeoutMs,
    });
    this.processLauncher = options.processLauncher ?? new NodeMemorySidecarLauncher({
      environment: options.environment,
      drainTimeoutMs: options.drainTimeoutMs,
    });
    this.healthClient = options.healthClient ?? new MemoryCoreHealthClient({
      environment: options.environment,
      timeoutMs: options.healthTimeoutMs,
    });
    this.portAllocator = options.portAllocator ?? new LocalPortAllocator();
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? (() => new Date().toISOString());
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.maxRetainedRevisions = Math.max(2, Math.min(10, options.maxRetainedRevisions ?? 3));
  }

  async start(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    if (this.closed) return this.failureStatus('unavailable');
    const settings = this.settings();
    if (!settings.enabled || settings.mode === 'off') {
      if (this.stateLoaded) await this.stopSidecar();
      this.state = { ...this.state, updateState: 'disabled', lastErrorCode: null };
      this.schedule(settings);
      if (this.stateLoaded) await this.persistState();
      return this.statusValue();
    }
    await this.ensureLoaded();
    const operationStartedAt = Date.now();
    const fromRevision = this.state.current?.revision ?? null;
    let operationOutcome: 'succeeded' | 'failed' | 'skipped' = 'failed';
    let operationError: AgentMemoryErrorCode | null = null;
    if (!isSupportedMode(settings.mode)) {
      await this.stopSidecar();
      this.state = { ...this.state, updateState: 'degraded', lastErrorCode: 'unavailable' };
      this.schedule(settings);
      await this.persistState();
      return this.statusValue();
    }
    if (this.state.current) {
      try {
        const candidate = await this.candidateBuilder.loadRevision({ revision: this.state.current.revision, revisionDir: this.revisionDir(this.state.current.revision), signal });
        this.sidecar = await this.launch(candidate, signal);
        await this.checkHealthy(this.sidecar, candidate, signal);
        await this.checkSmoke(this.sidecar, settings, signal);
        this.state = {
          ...this.state,
          current: { ...this.state.current, port: this.sidecar.port, endpoint: this.sidecar.endpoint, startedAt: this.now() },
          updateState: 'ready',
          lastErrorCode: null,
          lastHealthAt: this.now(),
        };
        operationOutcome = 'succeeded';
      } catch {
        await this.stopSidecar();
        this.state = { ...this.state, updateState: 'degraded', lastErrorCode: 'unavailable' };
        operationError = 'unavailable';
      }
    } else {
      this.state = { ...this.state, updateState: 'degraded', lastErrorCode: 'unavailable' };
      operationError = 'unavailable';
    }
    this.recordUpdate('start', operationOutcome, fromRevision, this.state.current?.revision ?? null, operationError, operationStartedAt);
    this.schedule(settings);
    await this.persistState();
    return this.statusValue();
  }

  endpoint(): string | undefined {
    return this.sidecar?.endpoint;
  }

  operations(): AgentMemoryOperations {
    return AgentMemoryOperationsSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_operations_v1',
      currentRevision: this.state.current?.revision ?? null,
      previousRevision: this.state.previous?.revision ?? null,
      healthLatencyMs: this.state.healthLatencyMs,
      recall: { hits: 0, misses: 0, lastAt: null },
      writeQueue: { pending: 0, inFlight: false, accepted: 0, failed: 0, lastAttemptAt: null, lastErrorCode: null },
      updates: this.state.updates,
    });
  }

  async probe(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      const operationStartedAt = Date.now();
      const fromRevision = this.state.current?.revision ?? null;
      if (this.closed) return this.failureStatus('unavailable');
      const settings = this.settings();
      if (!settings.enabled || settings.mode === 'off') return this.disabledStatus();
      if (!isSupportedMode(settings.mode)) return this.failureStatus('unavailable');
      if (!this.sidecar || !this.state.current) {
        this.recordUpdate('probe', 'failed', this.state.current?.revision ?? null, this.state.current?.revision ?? null, 'unavailable', operationStartedAt);
        await this.persistState();
        return this.failureStatus('unavailable');
      }
      try {
        const candidate = await this.candidateBuilder.loadRevision({ revision: this.state.current.revision, revisionDir: this.revisionDir(this.state.current.revision), signal });
        await this.checkHealthy(this.sidecar, candidate, signal);
        this.state = { ...this.state, updateState: 'ready', lastErrorCode: null, lastHealthAt: this.now() };
      } catch {
        this.state = { ...this.state, updateState: 'degraded', lastErrorCode: 'health' };
      }
      this.recordUpdate('probe', this.state.lastErrorCode ? 'failed' : 'succeeded', fromRevision, this.state.current?.revision ?? null, this.state.lastErrorCode, operationStartedAt);
      await this.persistState();
      return this.statusValue();
    });
  }

  async update(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.updateInternal(signal);
    });
  }

  /** Webhook/timer notifications intentionally share the exact update queue. */
  async enqueueUpdate(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    return this.update(signal);
  }

  async rollback(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    return this.enqueue(async () => {
      await this.ensureLoaded();
      return this.rollbackInternal(signal);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.stopSidecar();
    if (this.stateLoaded) await this.persistState().catch(() => undefined);
  }

  private async updateInternal(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    if (this.closed) return this.failureStatus('unavailable');
    const settings = this.settings();
    if (!settings.enabled || settings.mode === 'off') return this.disabledStatus();
    if (!isSupportedMode(settings.mode)) return this.failureStatus('unavailable');
    let candidateDir: string | undefined;
    let candidateSidecar: MemorySidecar | undefined;
    const operationStartedAt = Date.now();
    const fromRevision = this.state.current?.revision ?? null;
    try {
      this.state = { ...this.state, updateState: 'updating', lastErrorCode: null };
      await this.persistState();
      if (settings.upstreamRefLocked === true && !REVISION.test(settings.upstreamRef)) {
        throw new SupervisorError('INVALID_SETTINGS', 'locked upstream ref must be an immutable commit');
      }
      const revision = validateRevision(await this.candidateBuilder.resolveRevision({ repository: settings.upstreamRepo, ref: settings.upstreamRef, signal }));
      if (this.state.current?.revision === revision && this.sidecar) {
        await this.probeCurrent(signal);
        this.recordUpdate('update', 'skipped', fromRevision, this.state.current?.revision ?? null, null, operationStartedAt);
        await this.persistState();
        return this.statusValue();
      }
      candidateDir = this.candidateDir(revision);
      await this.removeCandidateIfPresent(candidateDir);
      await this.candidateBuilder.buildCandidate({ repository: settings.upstreamRepo, ref: settings.upstreamRef, revision, candidateDir, signal });
      const revisionDir = this.revisionDir(revision);
      if (!(await exists(revisionDir))) {
        await rename(candidateDir, revisionDir);
        candidateDir = undefined;
      } else {
        await this.candidateBuilder.discard(candidateDir);
        candidateDir = undefined;
      }
      const candidate = await this.candidateBuilder.loadRevision({ revision, revisionDir, signal });
      candidateSidecar = await this.launch(candidate, signal);
      await this.checkHealthy(candidateSidecar, candidate, signal);
      await this.checkSmoke(candidateSidecar, settings, signal);
      await this.switchTo(candidate, candidateSidecar, signal);
      candidateSidecar = undefined;
      this.state = { ...this.state, updateState: 'ready', lastErrorCode: null, lastHealthAt: this.now(), lastUpdateAt: this.now() };
      this.recordUpdate('update', 'succeeded', fromRevision, this.state.current?.revision ?? null, null, operationStartedAt);
      await this.persistState();
      await this.pruneRevisions();
      this.schedule(settings);
      return this.statusValue();
    } catch (error) {
      await candidateSidecar?.stop(this.drainTimeoutMs).catch(() => undefined);
      if (candidateDir) await this.candidateBuilder.discard(candidateDir).catch(() => undefined);
      const code = mapSupervisorError(error, 'build');
      this.state = { ...this.state, updateState: 'degraded', lastErrorCode: code };
      this.recordUpdate('update', 'failed', fromRevision, this.state.current?.revision ?? null, code, operationStartedAt);
      await this.persistState();
      return this.statusValue();
    }
  }

  private async rollbackInternal(signal?: AbortSignal): Promise<AgentMemoryStatus> {
    if (this.closed) return this.failureStatus('unavailable');
    const settings = this.settings();
    if (!settings.enabled || settings.mode === 'off') return this.disabledStatus();
    if (!isSupportedMode(settings.mode) || !this.state.previous) return this.failureStatus('rollback');
    let rollbackSidecar: MemorySidecar | undefined;
    const operationStartedAt = Date.now();
    const fromRevision = this.state.current?.revision ?? null;
    try {
      this.state = { ...this.state, updateState: 'rollback', lastErrorCode: null };
      await this.persistState();
      const previous = this.state.previous;
      if (!previous) throw new SupervisorError('ROLLBACK_FAILED', 'previous revision is unavailable');
      const candidate = await this.candidateBuilder.loadRevision({ revision: previous.revision, revisionDir: this.revisionDir(previous.revision), signal });
      rollbackSidecar = await this.launch(candidate, signal);
      await this.checkHealthy(rollbackSidecar, candidate, signal);
      await this.checkSmoke(rollbackSidecar, settings, signal);
      await this.switchTo(candidate, rollbackSidecar, signal);
      rollbackSidecar = undefined;
      this.state = { ...this.state, updateState: 'ready', lastErrorCode: null, lastHealthAt: this.now(), lastUpdateAt: this.now() };
      this.recordUpdate('rollback', 'succeeded', fromRevision, this.state.current?.revision ?? null, null, operationStartedAt);
      await this.persistState();
      return this.statusValue();
    } catch {
      await rollbackSidecar?.stop(this.drainTimeoutMs).catch(() => undefined);
      this.state = { ...this.state, updateState: 'degraded', lastErrorCode: 'rollback' };
      this.recordUpdate('rollback', 'failed', fromRevision, this.state.current?.revision ?? null, 'rollback', operationStartedAt);
      await this.persistState();
      return this.statusValue();
    }
  }

  private async switchTo(candidate: MemoryCandidate, nextSidecar: MemorySidecar, signal?: AbortSignal): Promise<void> {
    const settings = this.settings();
    const oldPointer = this.state.current;
    const oldSidecar = this.sidecar;
    const nextPointer: CurrentPointer = {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      revision: candidate.revision,
      mode: settings.mode,
      port: nextSidecar.port,
      endpoint: nextSidecar.endpoint,
      startedAt: this.now(),
    };
    const nextPrevious = oldPointer
      ? { schemaVersion: RUNTIME_SCHEMA_VERSION, revision: oldPointer.revision, mode: oldPointer.mode, recordedAt: this.now() } satisfies PreviousPointer
      : null;
    try {
      await this.persistPointers(nextPointer, nextPrevious);
      await this.checkHealthy(nextSidecar, candidate, signal);
    } catch (error) {
      await this.persistPointers(oldPointer, this.state.previous).catch(() => undefined);
      throw new SupervisorError('SWITCH_FAILED', 'candidate switch health check failed', { cause: error });
    }
    this.state = { ...this.state, current: nextPointer, previous: nextPrevious };
    this.sidecar = nextSidecar;
    if (oldSidecar && oldSidecar !== nextSidecar) await oldSidecar.stop(this.drainTimeoutMs).catch(() => undefined);
  }

  private async probeCurrent(signal?: AbortSignal): Promise<void> {
    if (!this.sidecar || !this.state.current) throw new SupervisorError('RUNTIME_UNAVAILABLE', 'current sidecar is unavailable');
    const candidate = await this.candidateBuilder.loadRevision({ revision: this.state.current.revision, revisionDir: this.revisionDir(this.state.current.revision), signal });
    await this.checkHealthy(this.sidecar, candidate, signal);
    this.state = { ...this.state, updateState: 'ready', lastErrorCode: null, lastHealthAt: this.now() };
    await this.persistState();
  }

  private async launch(candidate: MemoryCandidate, signal?: AbortSignal): Promise<MemorySidecar> {
    if (signal?.aborted) throw new SupervisorError('RUNTIME_UNAVAILABLE', 'operation cancelled');
    const port = await this.portAllocator.allocate();
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new SupervisorError('RUNTIME_UNAVAILABLE', 'sidecar port is invalid');
    const sidecar = await this.processLauncher.launch({ candidate, port, environment: sidecarEnvironment(this.environment, port) });
    try {
      validateLoopbackEndpoint(sidecar.endpoint);
      if (sidecar.port !== port) throw new Error('sidecar port does not match allocated port');
      return sidecar;
    } catch (error) {
      await sidecar.stop(this.drainTimeoutMs).catch(() => undefined);
      throw new SupervisorError('RUNTIME_UNAVAILABLE', 'sidecar endpoint is not a safe loopback endpoint', { cause: error });
    }
  }

  private async checkHealthy(sidecar: MemorySidecar, candidate: MemoryCandidate, signal?: AbortSignal): Promise<number> {
    const startedAt = Date.now();
    try {
      await this.healthClient.health({ sidecar, candidate, signal });
      const latency = boundedLatency(Date.now() - startedAt);
      this.state = { ...this.state, healthLatencyMs: latency };
      return latency;
    } catch (error) {
      this.state = { ...this.state, healthLatencyMs: boundedLatency(Date.now() - startedAt) };
      throw error instanceof SupervisorError ? error : new SupervisorError('HEALTH_FAILED', 'sidecar health check failed', { cause: error });
    }
  }

  private async checkSmoke(sidecar: MemorySidecar, settings: AgentMemorySettings, signal?: AbortSignal): Promise<void> {
    try {
      await this.healthClient.smoke({ sidecar, identity: AgentMemoryIdentitySchema.parse({ teamId: settings.teamId, agentId: settings.agentId, userId: settings.userId }), signal });
    } catch (error) {
      throw error instanceof SupervisorError ? error : new SupervisorError('SMOKE_FAILED', 'MemoryCore smoke check failed', { cause: error });
    }
  }

  private enqueue(operation: () => Promise<AgentMemoryStatus>): Promise<AgentMemoryStatus> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => this.statusValue());
    return next;
  }

  private recordUpdate(
    operation: AgentMemoryUpdateRecord['operation'],
    outcome: AgentMemoryUpdateRecord['outcome'],
    fromRevision: string | null,
    toRevision: string | null,
    errorCode: AgentMemoryErrorCode | null,
    startedAt: number,
  ): void {
    const record = AgentMemoryUpdateRecordSchema.parse({
      at: this.now(),
      operation,
      outcome,
      fromRevision,
      toRevision,
      elapsedMs: boundedLatency(Date.now() - startedAt),
      errorCode,
    });
    this.state = { ...this.state, updates: [...this.state.updates, record].slice(-32) };
  }

  private schedule(settings: AgentMemorySettings): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed || !settings.enabled || !settings.autoUpdate || settings.mode === 'off') return;
    const delay = Math.max(5, settings.updateIntervalMinutes) * 60_000;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.update().finally(() => this.schedule(this.settings()));
    }, delay);
    this.timer.unref?.();
  }

  private async loadState(): Promise<void> {
    await mkdir(this.stateRoot, { recursive: true });
    await mkdir(this.candidatesRoot, { recursive: true });
    await mkdir(this.revisionsRoot, { recursive: true });
    const aggregate = await readPointerDocument(join(this.stateRoot, 'pointers.json'));
    const update = await readUpdateState(join(this.stateRoot, 'update.json'));
    const operations = await readOperationsDocument(join(this.stateRoot, 'operations.json'));
    this.state = {
      ...emptyState(),
      current: aggregate?.current ?? await readPointer<CurrentPointer>(join(this.stateRoot, 'current.json'), 'current'),
      previous: aggregate?.previous ?? await readPointer<PreviousPointer>(join(this.stateRoot, 'previous.json'), 'previous'),
      ...(update ?? {}),
      healthLatencyMs: operations?.healthLatencyMs ?? update?.healthLatencyMs ?? null,
      updates: operations?.updates ?? [],
    };
    this.stateLoaded = true;
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.stateLoaded) await this.loadState();
  }

  private async persistState(): Promise<void> {
    await mkdir(this.stateRoot, { recursive: true });
    await this.persistPointers(this.state.current, this.state.previous);
    await writeAtomicJson(join(this.stateRoot, 'update.json'), {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      lastHealthAt: this.state.lastHealthAt,
      lastUpdateAt: this.state.lastUpdateAt,
      healthLatencyMs: this.state.healthLatencyMs,
      updateState: this.state.updateState,
      lastErrorCode: this.state.lastErrorCode,
    } satisfies UpdateStateDocument);
    await writeAtomicJson(join(this.stateRoot, 'operations.json'), {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      healthLatencyMs: this.state.healthLatencyMs,
      updates: this.state.updates,
    } satisfies OperationsDocument);
  }

  private async persistPointers(current: CurrentPointer | null, previous: PreviousPointer | null): Promise<void> {
    const document: PointerDocument = { schemaVersion: RUNTIME_SCHEMA_VERSION, current, previous };
    await writeAtomicJson(join(this.stateRoot, 'pointers.json'), document);
    if (current) await writeAtomicJson(join(this.stateRoot, 'current.json'), current);
    else await rm(join(this.stateRoot, 'current.json'), { force: true });
    if (previous) await writeAtomicJson(join(this.stateRoot, 'previous.json'), previous);
    else await rm(join(this.stateRoot, 'previous.json'), { force: true });
  }

  private async stopSidecar(): Promise<void> {
    const sidecar = this.sidecar;
    this.sidecar = undefined;
    await sidecar?.stop(this.drainTimeoutMs).catch(() => undefined);
  }

  private async removeCandidateIfPresent(candidateDir: string): Promise<void> {
    if (!isWithin(this.candidatesRoot, candidateDir)) throw new SupervisorError('MATERIALIZE_FAILED', 'candidate path escaped runtime root');
    await rm(candidateDir, { recursive: true, force: true });
  }

  private async pruneRevisions(): Promise<void> {
    const entries = await readdir(this.revisionsRoot, { withFileTypes: true }).catch(() => []);
    const protectedRevisions = new Set([this.state.current?.revision, this.state.previous?.revision].filter((value): value is string => Boolean(value)));
    const candidates = entries.filter((entry) => entry.isDirectory() && REVISION.test(entry.name) && !protectedRevisions.has(entry.name)).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of candidates.slice(0, Math.max(0, candidates.length - (this.maxRetainedRevisions - protectedRevisions.size)))) {
      await rm(join(this.revisionsRoot, entry.name), { recursive: true, force: true });
    }
  }

  private candidateDir(revision: string): string { return join(this.candidatesRoot, revision); }
  private revisionDir(revision: string): string { return join(this.revisionsRoot, revision); }

  private statusValue(): AgentMemoryStatus {
    const settings = this.settings();
    if (!settings.enabled || settings.mode === 'off') return this.disabledStatus();
    const current = this.state.current;
    const available = Boolean(this.sidecar && current);
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0',
      enabled: true,
      mode: settings.mode,
      available,
      degraded: !available || this.state.updateState === 'degraded' || this.state.updateState === 'rollback',
      revision: current?.revision ?? null,
      previousRevision: this.state.previous?.revision ?? null,
      lastHealthAt: this.state.lastHealthAt,
      lastUpdateAt: this.state.lastUpdateAt,
      updateState: this.state.updateState,
      lastErrorCode: this.state.lastErrorCode,
      capabilities: settings.mode === 'memory-core' ? ['recall', 'write-back'] : [],
    });
  }

  private disabledStatus(): AgentMemoryStatus {
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false,
      degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null,
      updateState: 'disabled', lastErrorCode: null, capabilities: [],
    });
  }

  private failureStatus(code: AgentMemoryErrorCode): AgentMemoryStatus {
    const settings = this.settings();
    return AgentMemoryStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: settings.enabled, mode: settings.mode,
      available: false, degraded: true, revision: this.state.current?.revision ?? null,
      previousRevision: this.state.previous?.revision ?? null, lastHealthAt: this.state.lastHealthAt,
      lastUpdateAt: this.state.lastUpdateAt, updateState: code === 'rollback' ? 'rollback' : 'degraded',
      lastErrorCode: code, capabilities: settings.mode === 'memory-core' ? ['recall', 'write-back'] : [],
    });
  }
}

export class TencentMemoryCandidateBuilder implements MemoryCandidateBuilder {
  private readonly runtimeRoot: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly commandRunner: CommandRunner;
  private readonly commandTimeoutMs: number;

  constructor(options: { runtimeRoot: string; environment?: NodeJS.ProcessEnv | undefined; commandRunner?: CommandRunner; commandTimeoutMs?: number | undefined }) {
    this.runtimeRoot = resolve(options.runtimeRoot);
    this.environment = options.environment ?? process.env;
    this.commandRunner = options.commandRunner ?? new SpawnCommandRunner();
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  }

  async resolveRevision(input: { repository: string; ref: string; signal?: AbortSignal }): Promise<string> {
    if (REVISION.test(input.ref)) return input.ref;
    const result = await this.commandRunner.run({ executable: gitExecutable(), args: ['ls-remote', '--refs', input.repository, input.ref], cwd: this.runtimeRoot, environment: safeCommandEnvironment(this.environment), timeoutMs: this.commandTimeoutMs });
    if (result.exitCode !== 0) throw new SupervisorError('UPSTREAM_UNAVAILABLE', 'upstream ref check failed');
    const line = result.stdout.split(/\r?\n/u).map((value) => value.trim()).find((value) => value.length > 0);
    const revision = line?.split(/\s+/u)[0];
    if (!revision || !REVISION.test(revision)) throw new SupervisorError('REVISION_INVALID', 'upstream did not return a commit revision');
    return revision;
  }

  async buildCandidate(input: { repository: string; ref: string; revision: string; candidateDir: string; signal?: AbortSignal }): Promise<MemoryCandidate> {
    const revision = validateRevision(input.revision);
    if (!isWithin(this.runtimeRoot, input.candidateDir)) throw new SupervisorError('MATERIALIZE_FAILED', 'candidate path escaped runtime root');
    await mkdir(dirname(input.candidateDir), { recursive: true });
    const cloneArgs = ['clone', '--no-checkout', '--filter=blob:none', '--depth=1'];
    if (!REVISION.test(input.ref)) cloneArgs.push('--branch', input.ref);
    cloneArgs.push(input.repository, input.candidateDir);
    const clone = await this.runGit(cloneArgs, this.runtimeRoot);
    if (clone.exitCode !== 0) throw new SupervisorError('MATERIALIZE_FAILED', 'candidate checkout failed');
    const checkout = await this.runGit(['-C', input.candidateDir, 'checkout', '--detach', revision], this.runtimeRoot);
    if (checkout.exitCode !== 0) throw new SupervisorError('MATERIALIZE_FAILED', 'candidate revision checkout failed');
    const verified = await this.runGit(['-C', input.candidateDir, 'rev-parse', 'HEAD'], this.runtimeRoot);
    if (verified.exitCode !== 0 || verified.stdout.trim().split(/\r?\n/u)[0] !== revision) throw new SupervisorError('MATERIALIZE_FAILED', 'candidate revision verification failed');
    return this.buildAndInspect({ revision, rootDir: input.candidateDir });
  }

  async loadRevision(input: { revision: string; revisionDir: string; signal?: AbortSignal }): Promise<MemoryCandidate> {
    const revision = validateRevision(input.revision);
    if (!isWithin(join(this.runtimeRoot, 'revisions'), input.revisionDir)) throw new SupervisorError('MANIFEST_INVALID', 'revision path escaped runtime root');
    return this.buildAndInspect({ revision, rootDir: input.revisionDir, loadOnly: true });
  }

  async discard(candidateDir: string): Promise<void> {
    if (!isWithin(join(this.runtimeRoot, 'candidates'), candidateDir)) throw new SupervisorError('MATERIALIZE_FAILED', 'candidate path escaped runtime root');
    await rm(candidateDir, { recursive: true, force: true });
  }

  private async buildAndInspect(input: { revision: string; rootDir: string; loadOnly?: boolean }): Promise<MemoryCandidate> {
    const packageDir = await findMemoryCorePackage(input.rootDir);
    const packageJson = await readJsonBounded(join(packageDir, 'package.json'), MAX_MANIFEST_BYTES);
    const packageName = typeof packageJson.name === 'string' ? packageJson.name : '';
    if (packageName !== PACKAGE_NAME) throw new SupervisorError('MANIFEST_INVALID', 'candidate MemoryCore package identity is unsupported');
    const scripts = asRecord(packageJson.scripts);
    if (typeof scripts?.build !== 'string') throw new SupervisorError('MANIFEST_INVALID', 'candidate has no build script');
    const readmePath = await findFirstExisting([join(packageDir, 'README.md'), join(input.rootDir, 'README.md')]);
    if (!readmePath) throw new SupervisorError('MANIFEST_INVALID', 'candidate README is missing');
    const readme = await readBounded(readmePath, MAX_README_BYTES);
    if (typeof scripts.start !== 'string' && !/node\s+--import\s+tsx\s+src\/gateway\/server\.ts/iu.test(readme)) {
      throw new SupervisorError('MANIFEST_INVALID', 'candidate startup command is not declared by manifest or README');
    }
    const engines = asRecord(packageJson.engines);
    if (typeof engines?.node !== 'string' || !supportsCurrentNode(engines.node)) {
      throw new SupervisorError('MANIFEST_INVALID', 'candidate requires an unsupported Node.js version');
    }
    const licensePath = await findFirstExisting([join(input.rootDir, 'LICENSE'), join(input.rootDir, 'LICENSE.md')]);
    if (!licensePath || !/MIT/iu.test(await readBounded(licensePath, MAX_README_BYTES))) {
      throw new SupervisorError('MANIFEST_INVALID', 'candidate license is missing or unsupported');
    }
    const lock = await findLockfile(packageDir, input.rootDir);
    if (!lock) throw new SupervisorError('NO_LOCKFILE', 'candidate has no supported lockfile for frozen install');
    const manager = packageManager(lock.path);
    if (!input.loadOnly) {
      const install = await this.runPackage(manager, lock.cwd, installArgs(manager));
      if (install.exitCode !== 0) throw new SupervisorError('INSTALL_FAILED', 'candidate frozen install failed');
      const build = await this.runPackage(manager, packageDir, ['run', 'build']);
      if (build.exitCode !== 0) throw new SupervisorError('BUILD_FAILED', 'candidate build failed');
      const typecheck = typeof scripts.typecheck === 'string'
        ? await this.runPackage(manager, packageDir, ['run', 'typecheck'])
        : await this.runCommand(npxExecutable(), ['--no-install', 'tsc', '--noEmit'], packageDir);
      if (typecheck.exitCode !== 0) throw new SupervisorError('TYPECHECK_FAILED', 'candidate typecheck failed');
    }
    return {
      revision: input.revision,
      rootDir: input.rootDir,
      packageDir,
      healthPath: '/health',
      executable: typeof scripts.start === 'string' ? managerExecutable(manager) : process.execPath,
      args: typeof scripts.start === 'string' ? ['run', 'start'] : ['--import', 'tsx', 'src/gateway/server.ts'],
    };
  }

  private async runGit(args: readonly string[], cwd: string): Promise<CommandResult> {
    return this.runCommand(gitExecutable(), args, cwd);
  }

  private async runPackage(manager: PackageManager, cwd: string, args: readonly string[]): Promise<CommandResult> {
    return this.runCommand(managerExecutable(manager), args, cwd);
  }

  private async runCommand(executable: string, args: readonly string[], cwd: string): Promise<CommandResult> {
    try {
      return await this.commandRunner.run({ executable, args, cwd, environment: safeCommandEnvironment(this.environment), timeoutMs: this.commandTimeoutMs });
    } catch (error) {
      throw new SupervisorError('BUILD_FAILED', 'candidate command failed', { cause: error });
    }
  }
}

type PackageManager = 'npm' | 'pnpm' | 'yarn';
interface Lockfile {
  readonly path: string;
  readonly cwd: string;
}

class SpawnCommandRunner implements CommandRunner {
  async run(input: CommandInput): Promise<CommandResult> {
    const child = spawn(input.executable, [...input.args], {
      cwd: input.cwd,
      env: input.environment ? { ...input.environment } : undefined,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let bytes = 0;
    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (bytes >= MAX_COMMAND_OUTPUT_BYTES) return;
      const text = String(chunk);
      bytes += Buffer.byteLength(text, 'utf8');
      stdout += text.slice(0, MAX_COMMAND_OUTPUT_BYTES - stdout.length);
    });
    const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        child.kill();
        reject(new SupervisorError('BUILD_FAILED', 'candidate command timed out'));
      }, timeoutMs);
    });
    const completion = new Promise<CommandResult>((resolveResult, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveResult({ exitCode: code ?? 1, stdout }));
    });
    try { return await Promise.race([completion, timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }
}

export class NodeMemorySidecarLauncher implements SupervisorProcessLauncher {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly drainTimeoutMs: number;

  constructor(options: { environment?: NodeJS.ProcessEnv | undefined; drainTimeoutMs?: number | undefined }) {
    this.environment = options.environment ?? process.env;
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  }

  async launch(input: { candidate: MemoryCandidate; port: number; environment: NodeJS.ProcessEnv }): Promise<MemorySidecar> {
    const child = spawn(input.candidate.executable, [...input.candidate.args], {
      cwd: input.candidate.packageDir,
      env: { ...safeCommandEnvironment(this.environment), ...input.environment },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForSpawn(child);
    return new ChildMemorySidecar({ child, revision: input.candidate.revision, port: input.port, endpoint: `http://127.0.0.1:${input.port}`, drainTimeoutMs: this.drainTimeoutMs });
  }
}

class ChildMemorySidecar implements MemorySidecar {
  readonly revision: string;
  readonly port: number;
  readonly endpoint: string;
  readonly pid: number | undefined;
  private readonly child: ChildProcess;
  private readonly drainTimeoutMs: number;
  private stopped = false;

  constructor(options: { child: ChildProcess; revision: string; port: number; endpoint: string; drainTimeoutMs: number }) {
    this.child = options.child;
    this.revision = options.revision;
    this.port = options.port;
    this.endpoint = options.endpoint;
    this.pid = options.child.pid;
    this.drainTimeoutMs = options.drainTimeoutMs;
  }

  async stop(timeoutMs = this.drainTimeoutMs): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill('SIGTERM');
    const exited = new Promise<void>((resolveExit) => this.child.once('exit', () => resolveExit()));
    const timeout = new Promise<void>((resolveExit) => setTimeout(resolveExit, timeoutMs));
    await Promise.race([exited, timeout]);
    if (this.child.exitCode === null && this.child.signalCode === null && this.pid) {
      const taskkill = process.platform === 'win32' ? 'taskkill.exe' : 'kill';
      const args = process.platform === 'win32' ? ['/PID', String(this.pid), '/T', '/F'] : ['-KILL', String(this.pid)];
      const killer = spawn(taskkill, args, { windowsHide: true, shell: false, stdio: 'ignore' });
      await new Promise<void>((resolveExit) => killer.once('exit', () => resolveExit()));
    }
  }
}

export class LocalPortAllocator implements PortAllocator {
  async allocate(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0 }, () => resolveListen());
    });
    const address = server.address();
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    if (!address || typeof address === 'string' || !address.port) throw new SupervisorError('RUNTIME_UNAVAILABLE', 'sidecar port allocation failed');
    return address.port;
  }
}

class MemoryCoreHealthClient implements SupervisorHealthClient {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(options: { environment?: NodeJS.ProcessEnv | undefined; timeoutMs?: number | undefined }) {
    this.environment = options.environment ?? process.env;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  }

  async health(input: { sidecar: MemorySidecar; candidate: MemoryCandidate; signal?: AbortSignal }): Promise<MemorySidecarHealth> {
    await fetchJson(`${input.sidecar.endpoint}${input.candidate.healthPath}`, { method: 'GET' }, this.timeoutMs, input.signal);
    return { ok: true };
  }

  async smoke(input: { sidecar: MemorySidecar; identity: AgentMemoryIdentity; signal?: AbortSignal }): Promise<void> {
    const apiKey = this.environment.READY4VIBE_MEMORY_CORE_API_KEY;
    if (!apiKey) throw new SupervisorError('SMOKE_FAILED', 'MemoryCore smoke requires a daemon-provided credential');
    const response = await fetchJson(`${input.sidecar.endpoint}/v3/atomic/search`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-tdai-service-id': this.environment.READY4VIBE_MEMORY_CORE_SERVICE_ID ?? 'vibego',
      },
      body: JSON.stringify({ team_id: input.identity.teamId, agent_id: input.identity.agentId, user_id: input.identity.userId, query: 'ready4vibe smoke', limit: 1 }),
    }, this.timeoutMs, input.signal);
    const record = asRecord(response);
    if (record?.code !== 0 || !('data' in record)) throw new SupervisorError('SMOKE_FAILED', 'MemoryCore smoke response is incompatible');
  }
}

async function fetchJson(input: string, init: RequestInit, timeoutMs: number, parentSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = (): void => controller.abort();
  parentSignal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMAND_OUTPUT_BYTES) throw new SupervisorError('HEALTH_FAILED', 'sidecar response exceeds the bounded health limit');
    const text = await response.text();
    if (!response.ok || Buffer.byteLength(text, 'utf8') > MAX_COMMAND_OUTPUT_BYTES) throw new SupervisorError('HEALTH_FAILED', 'sidecar returned an unhealthy response');
    try { return JSON.parse(text) as unknown; } catch { throw new SupervisorError('HEALTH_FAILED', 'sidecar returned malformed health JSON'); }
  } catch (error) {
    if (error instanceof SupervisorError) throw error;
    throw new SupervisorError('HEALTH_FAILED', 'sidecar request failed', { cause: error });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

function sidecarEnvironment(environment: NodeJS.ProcessEnv, port: number): NodeJS.ProcessEnv {
  const next = safeCommandEnvironment(environment);
  next.NODE_ENV = 'production';
  next.TDAI_GATEWAY_HOST = '127.0.0.1';
  next.TDAI_GATEWAY_PORT = String(port);
  next.TDAI_DATA_DIR = join(resolve(environment.READY4VIBE_DATA_DIR ?? '.ready4vibe'), 'agent-memory-data');
  if (environment.READY4VIBE_MEMORY_CORE_API_KEY) next.TDAI_GATEWAY_API_KEY = environment.READY4VIBE_MEMORY_CORE_API_KEY;
  if (environment.READY4VIBE_MEMORY_CORE_LLM_API_KEY) next.TDAI_LLM_API_KEY = environment.READY4VIBE_MEMORY_CORE_LLM_API_KEY;
  if (environment.READY4VIBE_MEMORY_CORE_LLM_BASE_URL) next.TDAI_LLM_BASE_URL = environment.READY4VIBE_MEMORY_CORE_LLM_BASE_URL;
  if (environment.READY4VIBE_MEMORY_CORE_LLM_MODEL) next.TDAI_LLM_MODEL = environment.READY4VIBE_MEMORY_CORE_LLM_MODEL;
  return next;
}

function safeCommandEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'];
  const result: NodeJS.ProcessEnv = {};
  for (const key of allowed) {
    const value = environment[key];
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function gitExecutable(): string { return process.platform === 'win32' ? 'git.exe' : 'git'; }
function managerExecutable(manager: PackageManager): string { return process.platform === 'win32' ? `${manager}.cmd` : manager; }
function npxExecutable(): string { return process.platform === 'win32' ? 'npx.cmd' : 'npx'; }
function installArgs(manager: PackageManager): readonly string[] {
  if (manager === 'npm') return ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (manager === 'pnpm') return ['install', '--frozen-lockfile', '--ignore-scripts'];
  return ['install', '--immutable', '--mode=skip-builds'];
}

function packageManager(lockfile: string): PackageManager {
  if (lockfile.endsWith('package-lock.json')) return 'npm';
  if (lockfile.endsWith('pnpm-lock.yaml')) return 'pnpm';
  return 'yarn';
}

async function findMemoryCorePackage(rootDir: string): Promise<string> {
  const nested = join(rootDir, 'MemoryCore');
  if (await exists(join(nested, 'package.json'))) return nested;
  if (await exists(join(rootDir, 'package.json'))) return rootDir;
  throw new SupervisorError('MANIFEST_INVALID', 'MemoryCore package.json is missing');
}

async function findLockfile(packageDir: string, rootDir: string): Promise<Lockfile | undefined> {
  const nested = await findFirstExisting([
    join(packageDir, 'package-lock.json'),
    join(packageDir, 'pnpm-lock.yaml'),
    join(packageDir, 'yarn.lock'),
  ]);
  if (nested) return { path: nested, cwd: packageDir };
  const root = await findFirstExisting([
    join(rootDir, 'package-lock.json'),
    join(rootDir, 'pnpm-lock.yaml'),
    join(rootDir, 'yarn.lock'),
  ]);
  return root ? { path: root, cwd: rootDir } : undefined;
}

async function findFirstExisting(paths: readonly string[]): Promise<string | undefined> {
  for (const path of paths) if (await exists(path)) return path;
  return undefined;
}

async function readJsonBounded(path: string, maxBytes: number): Promise<Record<string, unknown>> {
  const raw = await readBounded(path, maxBytes);
  try {
    const value = JSON.parse(raw) as unknown;
    const record = asRecord(value);
    if (!record) throw new Error('not an object');
    return record;
  } catch (error) {
    throw new SupervisorError('MANIFEST_INVALID', 'candidate manifest is malformed', { cause: error });
  }
}

async function readBounded(path: string, maxBytes: number): Promise<string> {
  const metadata = await stat(path);
  if (metadata.size > maxBytes) throw new SupervisorError('MANIFEST_INVALID', 'candidate metadata exceeds bounded size');
  const value = await readFile(path);
  if (value.byteLength > maxBytes) throw new SupervisorError('MANIFEST_INVALID', 'candidate metadata exceeds bounded size');
  return value.toString('utf8');
}

async function waitForSpawn(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolveSpawn, rejectSpawn) => {
    const onError = (error: Error): void => { child.removeListener('spawn', onSpawn); rejectSpawn(error); };
    const onSpawn = (): void => { child.removeListener('error', onError); resolveSpawn(); };
    child.once('error', onError);
    child.once('spawn', onSpawn);
  });
}

async function readPointer<T extends CurrentPointer | PreviousPointer>(path: string, kind: 'current' | 'previous'): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return validatePointerRecord(JSON.parse(raw) as unknown, kind) as T | null;
  } catch { return null; }
}

async function readPointerDocument(path: string): Promise<PointerDocument | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const record = asRecord(JSON.parse(raw) as unknown);
    if (!record || record.schemaVersion !== RUNTIME_SCHEMA_VERSION) return null;
    const current = record.current === null ? null : validatePointerRecord(record.current, 'current');
    const previous = record.previous === null ? null : validatePointerRecord(record.previous, 'previous');
    if (record.current !== null && !current) return null;
    if (record.previous !== null && !previous) return null;
    return { schemaVersion: RUNTIME_SCHEMA_VERSION, current, previous };
  } catch { return null; }
}

async function readUpdateState(path: string): Promise<UpdateStateDocument | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const record = asRecord(JSON.parse(raw) as unknown);
    if (!record || record.schemaVersion !== RUNTIME_SCHEMA_VERSION) return null;
    if (!isNullableIsoTimestamp(record.lastHealthAt) || !isNullableIsoTimestamp(record.lastUpdateAt)) return null;
    if (!isNullableLatency(record.healthLatencyMs)) return null;
    if (!AgentMemoryUpdateStateSchema.safeParse(record.updateState).success) return null;
    if (record.lastErrorCode !== null && !AgentMemoryErrorCodeSchema.safeParse(record.lastErrorCode).success) return null;
    return {
      schemaVersion: RUNTIME_SCHEMA_VERSION,
      lastHealthAt: record.lastHealthAt,
      lastUpdateAt: record.lastUpdateAt,
      healthLatencyMs: record.healthLatencyMs,
      updateState: record.updateState,
      lastErrorCode: record.lastErrorCode,
    } as UpdateStateDocument;
  } catch { return null; }
}

async function readOperationsDocument(path: string): Promise<OperationsDocument | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const record = asRecord(JSON.parse(raw) as unknown);
    if (!record || record.schemaVersion !== RUNTIME_SCHEMA_VERSION || !isNullableLatency(record.healthLatencyMs) || !Array.isArray(record.updates) || record.updates.length > 32) return null;
    const updates = record.updates.map((value) => AgentMemoryUpdateRecordSchema.parse(value));
    return { schemaVersion: RUNTIME_SCHEMA_VERSION, healthLatencyMs: record.healthLatencyMs, updates };
  } catch { return null; }
}

function validatePointerRecord(value: unknown, kind: 'current'): CurrentPointer | null;
function validatePointerRecord(value: unknown, kind: 'previous'): PreviousPointer | null;
function validatePointerRecord(value: unknown, kind: 'current' | 'previous'): CurrentPointer | PreviousPointer | null;
function validatePointerRecord(value: unknown, kind: 'current' | 'previous'): CurrentPointer | PreviousPointer | null {
  const record = asRecord(value);
  if (!record || record.schemaVersion !== RUNTIME_SCHEMA_VERSION || typeof record.revision !== 'string' || !REVISION.test(record.revision)) return null;
  if (kind === 'current' && (!Number.isInteger(record.port) || typeof record.endpoint !== 'string' || typeof record.startedAt !== 'string')) return null;
  if (kind === 'current') {
    try { validateLoopbackEndpoint(record.endpoint as string); } catch { return null; }
  }
  if (typeof record.mode !== 'string' || !['off', 'memory-core', 'proxy', 'full-stack'].includes(record.mode)) return null;
  return record as unknown as CurrentPointer | PreviousPointer;
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(path, { force: true });
    await rename(temporary, path).catch(() => { throw error; });
  }
}

function emptyState(): RuntimeState {
  return { current: null, previous: null, lastHealthAt: null, lastUpdateAt: null, healthLatencyMs: null, updateState: 'degraded', lastErrorCode: null, updates: [] };
}

function validateRevision(value: string): string {
  if (!REVISION.test(value)) throw new SupervisorError('REVISION_INVALID', 'revision must be a 40-character commit SHA');
  return value;
}

function isSupportedMode(mode: AgentMemoryMode): mode is 'memory-core' { return mode === 'memory-core'; }

function mapSupervisorError(error: unknown, fallback: AgentMemoryErrorCode): AgentMemoryErrorCode {
  if (!(error instanceof SupervisorError)) return fallback;
  if (error.code === 'HEALTH_FAILED' || error.code === 'SMOKE_FAILED' || error.code === 'SWITCH_FAILED') return 'health';
  if (error.code === 'ROLLBACK_FAILED') return 'rollback';
  if (error.code === 'UPSTREAM_UNAVAILABLE' || error.code === 'RUNTIME_UNAVAILABLE') return 'unavailable';
  if (error.code === 'REVISION_INVALID' || error.code === 'MANIFEST_INVALID' || error.code === 'NO_LOCKFILE' || error.code === 'MATERIALIZE_FAILED') return 'build';
  if (error.code === 'INSTALL_FAILED' || error.code === 'BUILD_FAILED' || error.code === 'TYPECHECK_FAILED') return 'build';
  return fallback;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

function isWithin(parent: string, target: string): boolean {
  const parentResolved = resolve(parent);
  const targetResolved = resolve(target);
  const rel = relative(parentResolved, targetResolved);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

function validateLoopbackEndpoint(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost' && parsed.hostname !== '[::1]' && parsed.hostname !== '::1')) {
    throw new Error('sidecar endpoint must be loopback HTTP');
  }
  if (parsed.pathname !== '/' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('sidecar endpoint must not contain credentials, path, or query parameters');
}

function supportsCurrentNode(range: string): boolean {
  const minimum = />=\s*(\d+)\.(\d+)(?:\.(\d+))?/u.exec(range);
  if (!minimum) return true;
  const major = Number(minimum[1]);
  const minor = Number(minimum[2]);
  const current = process.versions.node.split('.').map(Number);
  const currentMajor = current[0] ?? 0;
  const currentMinor = current[1] ?? 0;
  return currentMajor > major || (currentMajor === major && currentMinor >= minor);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && !Number.isNaN(Date.parse(value)));
}

function isNullableLatency(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60_000);
}

function boundedLatency(value: number): number {
  return Math.min(60_000, Math.max(0, Math.trunc(value)));
}
