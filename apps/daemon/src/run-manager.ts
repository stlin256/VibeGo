import { v7 as uuidv7 } from 'uuid';
import {
  AgentMemoryRecallRequestSchema,
  AgentMemoryRecallResultSchema,
  AgentMemoryWriteRequestSchema,
  parseRunConfig,
  type AgentMemoryRecallResult,
  type AgentMemoryWriteRequest,
  type EventStore,
  type ModelProvider,
  type RunConfig,
  type RunStatus,
  type SchedulerPolicy,
  type StoredEvent,
} from '@ready4vibe/contracts';
import type { ContextItem } from '@ready4vibe/context';
import { AgentLoop, InMemoryApprovalBroker, type AgentRunResult, type ApprovalBroker, type ApprovalDecision, type ApprovalDecisionResult, type ApprovalRequest, type ToolRuntime } from '@ready4vibe/agent';
import { Scheduler } from '@ready4vibe/scheduler';
import type { AgentMemoryRunSnapshot, AgentMemorySettingsManager } from './agent-memory-settings.js';

export type RunEventListener = (event: StoredEvent) => void;

export interface RunSnapshot {
  version: 1;
  runId: string;
  status: RunStatus;
  config: RunConfig;
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
  modelProviderForRun?: () => ModelProvider;
  toolRuntime?: ToolRuntime;
  toolRuntimeForRun?: (config: RunConfig) => ToolRuntime | undefined;
  approvalBroker?: ApprovalBroker;
  scheduler?: Scheduler;
  schedulerPolicy?: SchedulerPolicy;
  workspaceExists?: (workspaceId: string) => boolean;
  agentMemorySettings?: AgentMemorySettingsManager;
}

export class RunManagerError extends Error {
  constructor(readonly code: 'WORKSPACE_NOT_FOUND', message: string) {
    super(message);
    this.name = 'RunManagerError';
  }
}

export class RunManager {
  readonly eventStore: ObservableEventStore;
  readonly scheduler: Scheduler;
  readonly approvalBroker: ApprovalBroker;
  private readonly agentLoop: AgentLoop;
  private readonly modelProviderForRun: () => ModelProvider;
  private readonly toolRuntimeForRun: (config: RunConfig) => ToolRuntime | undefined;
  private readonly workspaceExists: (workspaceId: string) => boolean;
  private readonly agentMemorySettings: AgentMemorySettingsManager | undefined;
  private readonly controllers = new Map<string, AbortController>();
  private readonly completions = new Map<string, AgentRunResult>();

  constructor(options: RunManagerOptions) {
    this.eventStore = new ObservableEventStore(options.eventStore);
    this.modelProviderForRun = options.modelProviderForRun ?? (() => options.modelProvider);
    this.toolRuntimeForRun = options.toolRuntimeForRun ?? (() => options.toolRuntime);
    this.workspaceExists = options.workspaceExists ?? (() => true);
    this.agentMemorySettings = options.agentMemorySettings;
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

  async start(input: unknown): Promise<{ runId: string; status: 'queued' }> {
    const config = parseRunConfig(input);
    if (!this.workspaceExists(config.workspaceId)) throw new RunManagerError('WORKSPACE_NOT_FOUND', 'Workspace was not found.');
    const runId = `run_${uuidv7()}`;
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const capturedToolRuntime = this.toolRuntimeForRun(config);
    const capturedMemory = this.agentMemorySettings?.createRunSnapshot(config.createdBySessionId);
    const memoryContext = capturedMemory
      ? await this.recallMemory(capturedMemory, config, runId, controller.signal)
      : [];
    const promise = this.agentLoop.run({
      runId,
      config,
      signal: controller.signal,
      modelProvider: capturedMemory?.modelProvider ?? this.modelProviderForRun(),
      ...(capturedToolRuntime ? { toolRuntime: capturedToolRuntime } : {}),
      ...(memoryContext.length > 0 ? { contextItems: memoryContext } : {}),
    });
    void promise.then((result) => {
      this.completions.set(runId, result);
      this.controllers.delete(runId);
      if (capturedMemory) {
        void this.writeMemory(capturedMemory, config, result)
          .finally(() => capturedMemory.dispose())
          .catch(() => undefined);
      }
    }).catch(() => {
      this.controllers.delete(runId);
      if (capturedMemory) void capturedMemory.dispose().catch(() => undefined);
    });
    // AgentLoop writes run.created synchronously before its first await, so a
    // follow-up GET can observe a real snapshot as soon as 202 is returned.
    await Promise.resolve();
    return { runId, status: 'queued' };
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

function isRunConfigPayload(value: unknown): value is { config: RunConfig } {
  return typeof value === 'object' && value !== null && 'config' in value;
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
