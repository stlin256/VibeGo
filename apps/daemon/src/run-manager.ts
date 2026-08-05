import { v7 as uuidv7 } from 'uuid';
import {
  AgentMemoryRecallRequestSchema,
  AgentMemoryRecallResultSchema,
  AgentMemoryKnowledgeCallRequestSchema,
  AgentMemoryKnowledgeResultSchema,
  type AgentMemoryKnowledgeToolList,
  AgentMemoryWriteRequestSchema,
  CapabilityProfileRunSnapshotSchema,
  ModelProviderSnapshotSchema,
  PermissionProfileSchema,
  type PermissionProfile,
  parseRunConfig,
  type AgentMemoryRecallResult,
  type AgentMemoryWriteRequest,
  type CapabilityProfileRunSnapshot,
  type EventStore,
  type ModelProvider,
  type ModelProviderSnapshot,
  type RunConfig,
  type RunStatus,
  type SchedulerPolicy,
  type StoredEvent,
} from '@ready4vibe/contracts';
import type { ContextItem } from '@ready4vibe/context';
import type { PermissionProfileApplication } from '@ready4vibe/policy';
import { AgentLoop, InMemoryApprovalBroker, type AgentRunResult, type ApprovalBroker, type ApprovalDecision, type ApprovalDecisionResult, type ApprovalRequest, type ToolRuntime } from '@ready4vibe/agent';
import type { RunUsageObserver } from '@ready4vibe/observability';
import { Scheduler } from '@ready4vibe/scheduler';
import type { AgentMemoryRunSnapshot, AgentMemorySettingsManager } from './agent-memory-settings.js';
import type { AgentMemoryKnowledgeRunSnapshot } from '@ready4vibe/contracts';
import type { AgentMemoryKnowledgeSettingsManager } from './agent-memory-knowledge-settings.js';
import type { ModelProviderBinding } from './model-config.js';
import { knowledgeResultToContextItems } from './memory-knowledge-provider.js';
import { constrainPermissionToolRuntime } from './permission-profile-runtime.js';

export type RunEventListener = (event: StoredEvent) => void;

export interface RunSnapshot {
  version: 1;
  runId: string;
  status: RunStatus;
  config: RunConfig;
  modelSnapshot?: ModelProviderSnapshot;
  capabilitySnapshot?: CapabilityProfileRunSnapshot;
  lastEventSeq: number;
  output: string;
  approvals: readonly ApprovalRequest[];
  final?: {
    summary: string;
    exitReason: string;
  };
  scheduler: {
    queuePosition: number | null;
    activeRunCount: number;
    workspaceLease: 'read' | 'write' | null;
  };
}

export interface RunManagerOptions {
  eventStore: EventStore;
  modelProvider: ModelProvider;
  modelProviderForRun?: (config: RunConfig) => ModelProvider;
  modelBindingForRun?: (config: RunConfig) => ModelProviderBinding;
  capabilityProfileForRun?: (config: RunConfig) => CapabilityProfileRunSnapshot;
  /** Optional pre-resolved permission binding; settings persistence is 59-3. */
  permissionProfileForRun?: (config: RunConfig) => PermissionProfileApplication | undefined;
  toolRuntime?: ToolRuntime;
  toolRuntimeForRun?: (config: RunConfig, capabilitySnapshot?: CapabilityProfileRunSnapshot) => ToolRuntime | undefined;
  approvalBroker?: ApprovalBroker;
  scheduler?: Scheduler;
  schedulerPolicy?: SchedulerPolicy;
  workspaceExists?: (workspaceId: string) => boolean;
  agentMemorySettings?: AgentMemorySettingsManager;
  agentMemoryKnowledgeSettings?: AgentMemoryKnowledgeSettingsManager;
  observabilityUsageObserver?: RunUsageObserver;
}

/** Optional application-owned snapshot seam. Interactive callers keep the
 * one-argument start behavior; governed admission supplies a prevalidated id
 * and capability snapshot so settings cannot change between preflight and the
 * authoritative run-created event. */
export interface RunStartOptions {
  readonly runId?: string;
  readonly capabilitySnapshot?: CapabilityProfileRunSnapshot;
}

export class RunManagerError extends Error {
  constructor(readonly code: 'WORKSPACE_NOT_FOUND' | 'CAPABILITY_PROFILE_BLOCKED' | 'CAPABILITY_PROFILE_INVALID' | 'PERMISSION_PROFILE_BLOCKED' | 'PERMISSION_PROFILE_INVALID' | 'RUN_ID_CONFLICT', message: string) {
    super(message);
    this.name = 'RunManagerError';
  }
}

export class RunManager {
  readonly eventStore: ObservableEventStore;
  readonly scheduler: Scheduler;
  readonly approvalBroker: ApprovalBroker;
  private readonly agentLoop: AgentLoop;
  private readonly modelProviderForRun: (config: RunConfig) => ModelProvider;
  private readonly modelBindingForRun: ((config: RunConfig) => ModelProviderBinding) | undefined;
  private readonly capabilityProfileForRun: ((config: RunConfig) => CapabilityProfileRunSnapshot) | undefined;
  private readonly permissionProfileForRun: ((config: RunConfig) => PermissionProfileApplication | undefined) | undefined;
  private readonly toolRuntimeForRun: (config: RunConfig, capabilitySnapshot?: CapabilityProfileRunSnapshot) => ToolRuntime | undefined;
  private readonly workspaceExists: (workspaceId: string) => boolean;
  private readonly agentMemorySettings: AgentMemorySettingsManager | undefined;
  private readonly agentMemoryKnowledgeSettings: AgentMemoryKnowledgeSettingsManager | undefined;
  private readonly observabilityUsageObserver: RunUsageObserver | undefined;
  private readonly controllers = new Map<string, AbortController>();
  private readonly completions = new Map<string, AgentRunResult>();

  constructor(options: RunManagerOptions) {
    this.eventStore = new ObservableEventStore(options.eventStore);
    this.modelProviderForRun = options.modelProviderForRun ?? (() => options.modelProvider);
    this.modelBindingForRun = options.modelBindingForRun;
    this.capabilityProfileForRun = options.capabilityProfileForRun;
    this.permissionProfileForRun = options.permissionProfileForRun;
    this.toolRuntimeForRun = options.toolRuntimeForRun ?? (() => options.toolRuntime);
    this.workspaceExists = options.workspaceExists ?? (() => true);
    this.agentMemorySettings = options.agentMemorySettings;
    this.agentMemoryKnowledgeSettings = options.agentMemoryKnowledgeSettings;
    this.observabilityUsageObserver = options.observabilityUsageObserver;
    this.scheduler = options.scheduler ?? new Scheduler(options.schedulerPolicy ?? {
      maxActiveRuns: 2,
      maxActiveModelCalls: 2,
      maxActiveToolProcesses: 4,
      maxExternalSandboxes: 1,
      workspaceWriteMode: 'exclusive',
    });
    this.approvalBroker = options.approvalBroker ?? new InMemoryApprovalBroker();
    this.agentLoop = new AgentLoop({
      eventStore: this.eventStore,
      scheduler: this.scheduler,
      modelProvider: options.modelProvider,
      ...(options.toolRuntime ? { toolRuntime: options.toolRuntime } : {}),
      approvalBroker: this.approvalBroker,
    });
  }

  async start(input: unknown, options: RunStartOptions = {}): Promise<{ runId: string; status: 'queued' }> {
    const config = parseRunConfig(input);
    if (!this.workspaceExists(config.workspaceId)) throw new RunManagerError('WORKSPACE_NOT_FOUND', 'Workspace was not found.');
    const runId = options.runId ?? `run_${uuidv7()}`;
    if (!/^run_[A-Za-z0-9_-]{8,128}$/u.test(runId)) throw new RunManagerError('RUN_ID_CONFLICT', 'The run id is invalid.');
    if (this.eventStore.lastSeq(runId) > 0 || this.controllers.has(runId)) throw new RunManagerError('RUN_ID_CONFLICT', 'The run id is already in use.');
    let capabilitySnapshot: CapabilityProfileRunSnapshot | undefined;
    if (options.capabilitySnapshot) {
      try {
        capabilitySnapshot = CapabilityProfileRunSnapshotSchema.parse(options.capabilitySnapshot);
      } catch {
        throw new RunManagerError('CAPABILITY_PROFILE_INVALID', 'The capability profile snapshot is invalid.');
      }
    } else if (this.capabilityProfileForRun) {
      try {
        capabilitySnapshot = CapabilityProfileRunSnapshotSchema.parse(this.capabilityProfileForRun(config));
      } catch {
        throw new RunManagerError('CAPABILITY_PROFILE_INVALID', 'The capability profile snapshot is invalid.');
      }
      if (capabilitySnapshot.status === 'blocked') {
        throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', `The capability profile is blocked: ${capabilitySnapshot.reasonCode}.`);
      }
    }
    if (capabilitySnapshot) assertRunConfigWithinCapabilityProfile(config, capabilitySnapshot);
    let permissionProfile: PermissionProfile | undefined;
    if (this.permissionProfileForRun) {
      try {
        const application = this.permissionProfileForRun(config);
        if (application !== undefined) {
          if ((application.status !== 'ready' && application.status !== 'degraded') || application.effectiveProfile === null) {
            throw new RunManagerError('PERMISSION_PROFILE_BLOCKED', `The permission profile is blocked: ${application.reasonCode}.`);
          }
          permissionProfile = PermissionProfileSchema.parse(application.effectiveProfile);
        }
      } catch (error) {
        if (error instanceof RunManagerError) throw error;
        throw new RunManagerError('PERMISSION_PROFILE_INVALID', 'The permission profile is invalid.');
      }
    }
    const capturedModelBinding: { provider: ModelProvider; snapshot?: ModelProviderSnapshot } = this.modelBindingForRun
      ? this.modelBindingForRun(config)
      : { provider: this.modelProviderForRun(config) };
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const capturedToolRuntime = constrainPermissionToolRuntime(this.toolRuntimeForRun(config, capabilitySnapshot), permissionProfile);
    const capturedMemory = this.agentMemorySettings?.createRunSnapshot(config.createdBySessionId);
    const capturedKnowledge = this.agentMemoryKnowledgeSettings?.createRunSnapshot();
    const memoryContext = capturedMemory
      ? await this.recallMemory(capturedMemory, config, runId, controller.signal)
      : [];
    const knowledgeContext = capturedKnowledge
      ? await this.recallKnowledge(capturedKnowledge, config, runId, controller.signal)
      : [];
    const promise = this.agentLoop.run({
      runId,
      config,
      signal: controller.signal,
      modelProvider: capturedMemory?.modelProvider ?? capturedModelBinding.provider,
      ...(!capturedMemory?.modelProvider && capturedModelBinding.snapshot ? { modelSnapshot: capturedModelBinding.snapshot } : {}),
      ...(capabilitySnapshot ? { capabilitySnapshot } : {}),
      ...(capturedToolRuntime ? { toolRuntime: capturedToolRuntime } : {}),
      ...([...memoryContext, ...knowledgeContext].length > 0 ? { contextItems: [...memoryContext, ...knowledgeContext] } : {}),
    });
    void promise.then((result) => {
      this.completions.set(runId, result);
      this.controllers.delete(runId);
      void this.observeTerminalUsage(runId).catch(() => undefined);
      if (capturedMemory) {
        void this.writeMemory(capturedMemory, config, result)
          .finally(async () => {
            await capturedMemory.dispose();
            await capturedKnowledge?.dispose();
          })
          .catch(() => undefined);
      } else if (capturedKnowledge) {
        void capturedKnowledge.dispose().catch(() => undefined);
      }
    }).catch(() => {
      this.controllers.delete(runId);
      if (capturedMemory) void capturedMemory.dispose().catch(() => undefined);
      if (capturedKnowledge) void capturedKnowledge.dispose().catch(() => undefined);
    }).finally(() => {
      const dispose = (capturedToolRuntime as (ToolRuntime & { dispose?: () => Promise<void> | void }) | undefined)?.dispose;
      if (!dispose) return;
      return Promise.resolve().then(() => dispose()).catch(() => undefined);
    });
    // AgentLoop writes run.created synchronously before its first await, so a
    // follow-up GET can observe a real snapshot as soon as 202 is returned.
    await Promise.resolve();
    return { runId, status: 'queued' };
  }

  private async observeTerminalUsage(runId: string): Promise<void> {
    const observer = this.observabilityUsageObserver;
    if (!observer) return;
    const events = await this.eventStore.read(runId);
    await observer.recordTerminal(runId, events);
  }

  async retryRecovered(runId: string): Promise<{ runId: string; status: 'queued'; retryOf: string } | 'not-found' | 'not-recoverable'> {
    const snapshot = await this.snapshot(runId);
    if (!snapshot) return 'not-found';
    if (snapshot.status !== 'needs-recovery') return 'not-recoverable';
    const started = await this.start({
      ...snapshot.config,
      clientRequestId: `recovery_${uuidv7()}`,
    });
    return { ...started, retryOf: runId };
  }

  async snapshot(runId: string): Promise<RunSnapshot | undefined> {
    const events = await this.eventStore.read(runId);
    if (events.length === 0) return undefined;
    const created = events.find((event) => event.type === 'run.created');
    const config = isRunConfigPayload(created?.payload) ? created.payload.config : undefined;
    if (!config) return undefined;
    const modelSnapshot = readModelSnapshot(created?.payload);
    const capabilitySnapshot = readCapabilitySnapshot(created?.payload);
    let status: RunStatus = 'created';
    let output = '';
    let final: RunSnapshot['final'];
    for (const event of events) {
      if (event.type === 'run.status' && isStatusPayload(event.payload)) status = event.payload.to;
      if (event.type === 'run.needs_recovery') status = 'needs-recovery';
      if (event.type === 'model.delta' && isTextDeltaPayload(event.payload)) output += event.payload.text;
      if (event.type === 'run.completed' && isCompletedPayload(event.payload)) {
        final = { summary: event.payload.summary, exitReason: event.payload.exitReason };
      }
      if (event.type === 'run.failed' && isFailedPayload(event.payload)) {
        final = { summary: event.payload.safeMessage, exitReason: event.payload.code };
      }
      if (event.type === 'run.cancelled' && isCancelledPayload(event.payload)) {
        final = { summary: 'Run cancelled by user.', exitReason: event.payload.reason };
      }
      if (event.type === 'run.needs_recovery' && isRecoveryPayload(event.payload)) {
        final = { summary: 'Run requires recovery after daemon restart.', exitReason: event.payload.reason };
      }
    }
    const queued = this.scheduler.queuedRunIds();
    const workspaceLease = status === 'planning' || status === 'executing'
      ? config.sandbox.mode === 'read-only' ? 'read' : 'write'
      : null;
    return {
      version: 1,
      runId,
      status,
      config,
      ...(modelSnapshot ? { modelSnapshot } : {}),
      ...(capabilitySnapshot ? { capabilitySnapshot } : {}),
      lastEventSeq: events.at(-1)?.seq ?? 0,
      output,
      approvals: this.approvalBroker.pending(runId),
      ...(final ? { final } : {}),
      scheduler: {
        queuePosition: queued.indexOf(runId) >= 0 ? queued.indexOf(runId) + 1 : null,
        activeRunCount: this.scheduler.activeCount(),
        workspaceLease,
      },
    };
  }

  /**
   * Mark interrupted runs before the daemon starts accepting requests. This is
   * deliberately metadata-only: no approval, tool input, or execution state is
   * restored and no unknown write is retried automatically.
   */
  async recoverAfterRestart(): Promise<{ marked: number; skipped: number }> {
    let marked = 0;
    let skipped = 0;
    for (const runId of this.eventStore.listRunIds()) {
      const events = await this.eventStore.read(runId);
      const status = latestRunStatus(events);
      if (isTerminal(status) || status === 'needs-recovery') {
        skipped += 1;
        continue;
      }
      const correlationId = `corr_${uuidv7()}`;
      await this.eventStore.append({
        runId,
        type: 'run.status',
        source: 'system',
        correlationId,
        payload: { from: status, to: 'needs-recovery', reason: 'daemon-restarted' },
      });
      await this.eventStore.append({
        runId,
        type: 'run.needs_recovery',
        source: 'system',
        correlationId,
        payload: { previousStatus: status, reason: 'daemon-restarted' },
      });
      marked += 1;
    }
    return { marked, skipped };
  }

  async cancel(runId: string): Promise<'accepted' | 'already-terminal' | 'not-found'> {
    const snapshot = await this.snapshot(runId);
    if (!snapshot) return 'not-found';
    if (isTerminal(snapshot.status)) return 'already-terminal';
    const controller = this.controllers.get(runId);
    if (!controller) return 'already-terminal';
    controller.abort();
    return 'accepted';
  }

  approve(runId: string, approvalId: string, decision: ApprovalDecision): ApprovalDecisionResult | 'run-not-found' {
    if (!this.eventStore.lastSeq(runId)) return 'run-not-found';
    const result = this.approvalBroker.decide(approvalId, decision, runId);
    return result === 'not-found' ? 'run-not-found' : result;
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    return this.eventStore.subscribe(runId, listener);
  }

  readEvents(runId: string, afterSeq = 0): Promise<StoredEvent[]> {
    return this.eventStore.read(runId, afterSeq);
  }

  completion(runId: string): AgentRunResult | undefined {
    return this.completions.get(runId);
  }

  private async recallMemory(
    snapshot: AgentMemoryRunSnapshot,
    config: RunConfig,
    runId: string,
    parentSignal: AbortSignal,
  ): Promise<readonly ContextItem[]> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    parentSignal.addEventListener('abort', onAbort, { once: true });
    let resolveTimeout!: (value: AgentMemoryRecallResult) => void;
    const timeoutResult = new Promise<AgentMemoryRecallResult>((resolve) => { resolveTimeout = resolve; });
    const timer = setTimeout(() => {
      controller.abort();
      resolveTimeout({ items: [], sourceRevision: snapshot.revision, elapsedMs: MEMORY_RECALL_TIMEOUT_MS, degraded: true });
    }, MEMORY_RECALL_TIMEOUT_MS);
    try {
      const request = {
        identity: snapshot.identity,
        runId,
        ...(safeWorkspaceId(config.workspaceId) ? { workspaceId: safeWorkspaceId(config.workspaceId) } : {}),
        query: truncateUtf8(config.userMessage, MEMORY_QUERY_MAX_BYTES),
        maxItems: MEMORY_RECALL_MAX_ITEMS,
        maxBytes: Math.min(MEMORY_RECALL_MAX_BYTES, Math.max(1, Math.floor(config.limits.maxContextBytes / 4))),
        signal: controller.signal,
      };
      const parsedRequest = AgentMemoryRecallRequestSchema.parse(request);
      const result = AgentMemoryRecallResultSchema.parse(await Promise.race([snapshot.provider.recall(parsedRequest), timeoutResult]));
      if (result.degraded) return [];
      return toMemoryContextItems(result, runId);
    } catch {
      // Memory is an enhancement. A malformed query, timeout, or unavailable
      // provider must never turn an otherwise valid run into a Web error.
      return [];
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onAbort);
    }
  }

  private async writeMemory(snapshot: AgentMemoryRunSnapshot, config: RunConfig, result: AgentRunResult): Promise<void> {
    const request: AgentMemoryWriteRequest = {
      identity: snapshot.identity,
      runId: result.runId,
      ...(safeWorkspaceId(config.workspaceId) ? { workspaceId: safeWorkspaceId(config.workspaceId) } : {}),
      summary: truncateUtf8(result.output || `Run finished with status: ${result.status}.`, MEMORY_WRITE_SUMMARY_MAX_BYTES),
      evidenceRefs: [`run:${result.runId}`],
      outcome: result.status,
      ...(snapshot.revision ? { sourceRevision: snapshot.revision } : {}),
    };
    try {
      await snapshot.provider.enqueueWrite(AgentMemoryWriteRequestSchema.parse(request));
    } catch {
      // Provider validation and transport failures remain bounded degraded
      // state; run_events already contains the authoritative terminal result.
    }
  }

  private async recallKnowledge(
    snapshot: AgentMemoryKnowledgeRunSnapshot,
    config: RunConfig,
    runId: string,
    parentSignal: AbortSignal,
  ): Promise<readonly ContextItem[]> {
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    parentSignal.addEventListener('abort', onAbort, { once: true });
    let resolveTimeout!: () => void;
    const timeout = new Promise<void>((resolve) => { resolveTimeout = resolve; });
    const timer = setTimeout(() => {
      controller.abort();
      resolveTimeout();
    }, snapshot.timeoutMs);
    try {
      const listed = await Promise.race([
        snapshot.provider.listTools({ knowledgeId: snapshot.knowledgeId, signal: controller.signal }),
        timeout.then(() => undefined),
      ]) as AgentMemoryKnowledgeToolList | undefined;
      if (!listed || listed.degraded || !listed.tools.some((tool) => tool.name === 'search')) return [];
      const request = AgentMemoryKnowledgeCallRequestSchema.parse({
        knowledgeId: snapshot.knowledgeId,
        toolName: 'search',
        params: { query: truncateUtf8(config.userMessage, KNOWLEDGE_QUERY_MAX_BYTES) },
        maxItems: snapshot.maxItems,
        maxBytes: Math.min(snapshot.maxBytes, Math.max(256, Math.floor(config.limits.maxContextBytes / 2))),
        signal: controller.signal,
      });
      const result = await Promise.race([
        snapshot.provider.call(request),
        timeout.then(() => undefined),
      ]);
      if (!result) return [];
      const parsed = AgentMemoryKnowledgeResultSchema.parse(result);
      if (parsed.degraded) return [];
      return knowledgeResultToContextItems(parsed, runId);
    } catch {
      // Knowledge is an optional retrieval enhancement. Timeouts, protocol
      // errors, privacy failures, and sidecar outages never fail the run.
      return [];
    } finally {
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onAbort);
    }
  }
}

export class ObservableEventStore implements EventStore {
  private readonly listeners = new Map<string, Set<RunEventListener>>();

  constructor(private readonly delegate: EventStore) {}

  async append<TPayload>(event: Parameters<EventStore['append']>[0] & { payload: TPayload }): Promise<StoredEvent<TPayload>> {
    const stored = await this.delegate.append(event);
    this.publish(stored);
    return stored;
  }

  async appendBatch<TPayload>(events: readonly Parameters<EventStore['appendBatch']>[0][number][]): Promise<StoredEvent<TPayload>[]> {
    const stored = await this.delegate.appendBatch(events);
    for (const event of stored) this.publish(event);
    return stored as StoredEvent<TPayload>[];
  }

  read<TPayload = unknown>(runId: string, afterSeq = 0): Promise<StoredEvent<TPayload>[]> {
    return this.delegate.read(runId, afterSeq);
  }

  listRunIds(): readonly string[] {
    return this.delegate.listRunIds();
  }

  lastSeq(runId: string): number {
    return this.delegate.lastSeq(runId);
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    const listeners = this.listeners.get(runId) ?? new Set<RunEventListener>();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  private publish(event: StoredEvent): void {
    for (const listener of this.listeners.get(event.runId) ?? []) listener(event);
  }
}

function isTerminal(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'timed-out' || status === 'needs-recovery';
}

function assertRunConfigWithinCapabilityProfile(config: RunConfig, snapshot: CapabilityProfileRunSnapshot): void {
  const profile = snapshot.effectiveProfile;
  if (!profile) throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', `The capability profile is blocked: ${snapshot.reasonCode}.`);
  if (profile.modelMode === 'off') throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', 'The capability profile does not enable a model.');
  if (profile.networkMode === 'off' && sandboxNetwork(config) === 'enabled') {
    throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', 'The capability profile does not enable networked tools.');
  }
  if (profile.filesystemMode === 'off' && config.sandbox.mode === 'workspace-write') {
    throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', 'The capability profile does not enable workspace writes.');
  }
  if (profile.filesystemMode === 'workspace-read' && config.sandbox.mode === 'workspace-write') {
    throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', 'The capability profile is read-only for the workspace.');
  }
  if (profile.shellMode === 'off' && (config.sandbox.mode === 'external-sandbox' || config.sandbox.mode === 'danger-full-access')) {
    throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', 'The capability profile does not enable shell execution.');
  }
  if (profile.shellMode === 'external-sandbox' && config.sandbox.mode === 'danger-full-access') {
    throw new RunManagerError('CAPABILITY_PROFILE_BLOCKED', 'The capability profile does not enable host execution.');
  }
}

function sandboxNetwork(config: RunConfig): 'restricted' | 'enabled' {
  return 'network' in config.sandbox ? config.sandbox.network : 'restricted';
}

function isRunConfigPayload(value: unknown): value is { config: RunConfig } {
  return typeof value === 'object' && value !== null && 'config' in value;
}

function readModelSnapshot(value: unknown): ModelProviderSnapshot | undefined {
  if (typeof value !== 'object' || value === null || !('modelSnapshot' in value)) return undefined;
  const parsed = ModelProviderSnapshotSchema.safeParse(value.modelSnapshot);
  return parsed.success ? parsed.data : undefined;
}

function readCapabilitySnapshot(value: unknown): CapabilityProfileRunSnapshot | undefined {
  if (typeof value !== 'object' || value === null || !('capabilitySnapshot' in value)) return undefined;
  const parsed = CapabilityProfileRunSnapshotSchema.safeParse(value.capabilitySnapshot);
  return parsed.success ? parsed.data : undefined;
}

function isStatusPayload(value: unknown): value is { to: RunStatus } {
  return typeof value === 'object' && value !== null && 'to' in value && typeof value.to === 'string';
}

function isTextDeltaPayload(value: unknown): value is { kind: 'text'; text: string } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'text' && 'text' in value && typeof value.text === 'string';
}

function isCompletedPayload(value: unknown): value is { summary: string; exitReason: string } {
  return typeof value === 'object' && value !== null && 'summary' in value && typeof value.summary === 'string' && 'exitReason' in value && typeof value.exitReason === 'string';
}

function isFailedPayload(value: unknown): value is { safeMessage: string; code: string } {
  return typeof value === 'object' && value !== null && 'safeMessage' in value && typeof value.safeMessage === 'string' && 'code' in value && typeof value.code === 'string';
}

function isCancelledPayload(value: unknown): value is { reason: string } {
  return typeof value === 'object' && value !== null && 'reason' in value && typeof value.reason === 'string';
}

function isRecoveryPayload(value: unknown): value is { reason: 'daemon-restarted' } {
  return typeof value === 'object' && value !== null && 'reason' in value && value.reason === 'daemon-restarted';
}

function latestRunStatus(events: readonly StoredEvent[]): RunStatus {
  let status: RunStatus = 'created';
  for (const event of events) {
    if (event.type === 'run.status' && isStatusPayload(event.payload)) status = event.payload.to;
    if (event.type === 'run.needs_recovery') status = 'needs-recovery';
  }
  return status;
}

const MEMORY_RECALL_MAX_ITEMS = 8;
const MEMORY_RECALL_MAX_BYTES = 8 * 1024;
const MEMORY_QUERY_MAX_BYTES = 8 * 1024;
const MEMORY_WRITE_SUMMARY_MAX_BYTES = 8 * 1024;
const MEMORY_RECALL_TIMEOUT_MS = 750;
const KNOWLEDGE_QUERY_MAX_BYTES = 8 * 1024;
const SAFE_WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

function toMemoryContextItems(result: AgentMemoryRecallResult, runId: string): ContextItem[] {
  const ids = new Set<string>();
  const items: ContextItem[] = [];
  for (const item of result.items) {
    const baseId = `memory:${item.id}`;
    let id = baseId;
    let suffix = 1;
    while (ids.has(id)) id = `${baseId}:${suffix++}`;
    ids.add(id);
    items.push({
      id: `${runId}:${id}`,
      source: 'retrieval',
      trust: item.trust,
      // Retrieval is intentionally droppable context; system/developer/user
      // protection remains owned by ContextManager.
      role: 'assistant',
      content: `[MEMORY kind=${item.kind} source=${item.source}]\n${item.content}`,
    });
  }
  return items;
}

function safeWorkspaceId(value: string): string | undefined {
  return SAFE_WORKSPACE_ID.test(value) ? value : undefined;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(encoded.slice(0, maxBytes));
}
