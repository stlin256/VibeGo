import {
  DEFAULT_SCHEDULER_POLICY,
  SchedulerPolicySchema,
  type ResourceKind,
  type ResourceVector,
  type SchedulerLease,
  type SchedulerPolicy,
  type SchedulerRequest,
  type WorkspaceLease,
} from '@ready4vibe/contracts';
type SchedulerPolicyValue = SchedulerPolicy;
type QueueEntry = {
  request: SchedulerRequest;
  order: number;
  resolve: (lease: SchedulerLease) => void;
  reject: (error: Error) => void;
};
type ActiveEntry = { request: SchedulerRequest; lease: SchedulerLease };

export type SchedulerInspectionStatus = 'ready' | 'waiting' | 'blocked';
export type SchedulerInspectionReason = 'READY' | 'CAPACITY_BUSY' | 'UNSATISFIABLE' | 'WORKSPACE_CONFLICT';

export interface SchedulerInspection {
  readonly status: SchedulerInspectionStatus;
  readonly reasonCode: SchedulerInspectionReason;
  /** Stable, bounded reference safe to carry in an application decision. */
  readonly decisionRef: string;
}

export class SchedulerCancelledError extends Error {
  constructor(runId: string) {
    super(`scheduler request cancelled: ${runId}`);
    this.name = 'SchedulerCancelledError';
  }
}

export class SchedulerDuplicateRunError extends Error {
  constructor(runId: string) {
    super(`run is already scheduled: ${runId}`);
    this.name = 'SchedulerDuplicateRunError';
  }
}

export class SchedulerUnsatisfiableRequestError extends Error {
  constructor(runId: string) {
    super(`scheduler request exceeds configured capacity: ${runId}`);
    this.name = 'SchedulerUnsatisfiableRequestError';
  }
}

export class Scheduler {
  private readonly active = new Map<string, ActiveEntry>();
  private readonly queue: QueueEntry[] = [];
  private order = 0;

  private readonly policy: SchedulerPolicyValue;

  constructor(policy: SchedulerPolicyValue) {
    this.policy = SchedulerPolicySchema.parse(policy);
  }

  acquire(request: SchedulerRequest): Promise<SchedulerLease> {
    if (this.active.has(request.runId) || this.queue.some((item) => item.request.runId === request.runId)) {
      return Promise.reject(new SchedulerDuplicateRunError(request.runId));
    }
    if (!this.canEverGrant(request)) {
      return Promise.reject(new SchedulerUnsatisfiableRequestError(request.runId));
    }

    return new Promise<SchedulerLease>((resolve, reject) => {
      this.queue.push({ request, order: this.order++, resolve, reject });
      this.pump();
    });
  }

  /**
   * Read-only preflight used by application services. It never enqueues a
   * request, creates a lease, changes active state, or adds a second queue.
   */
  inspect(request: SchedulerRequest): SchedulerInspection {
    if (!this.canEverGrant(request)) {
      return { status: 'blocked', reasonCode: 'UNSATISFIABLE', decisionRef: 'scheduler_unsatisfiable' };
    }
    if (this.active.has(request.runId) || this.queue.some((item) => item.request.runId === request.runId)) {
      return { status: 'blocked', reasonCode: 'UNSATISFIABLE', decisionRef: 'scheduler_duplicate_run' };
    }
    if (this.canGrant(request)) {
      return { status: 'ready', reasonCode: 'READY', decisionRef: 'scheduler_ready' };
    }
    const workspaceConflict = [...this.active.values()].some(({ request: activeRequest }) => this.workspaceConflicts(activeRequest, request));
    return {
      status: 'waiting',
      reasonCode: workspaceConflict ? 'WORKSPACE_CONFLICT' : 'CAPACITY_BUSY',
      decisionRef: workspaceConflict ? 'scheduler_workspace_conflict' : 'scheduler_capacity_busy',
    };
  }

  cancelQueued(runId: string): boolean {
    const index = this.queue.findIndex((entry) => entry.request.runId === runId);
    if (index < 0) return false;
    const [entry] = this.queue.splice(index, 1);
    entry?.reject(new SchedulerCancelledError(runId));
    return true;
  }

  activeCount(): number {
    return this.active.size;
  }

  queuedRunIds(): string[] {
    return this.queue.map((entry) => entry.request.runId);
  }

  activeRunIds(): string[] {
    return [...this.active.keys()];
  }

  private pump(): void {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const candidateIndex = this.pickCandidateIndex();
      if (candidateIndex < 0) return;
      const [entry] = this.queue.splice(candidateIndex, 1);
      if (!entry) return;
      const lease = this.createLease(entry.request);
      this.active.set(entry.request.runId, { request: entry.request, lease });
      entry.resolve(lease);
      progressed = true;
    }
  }

  private pickCandidateIndex(): number {
    const ordered = this.queue
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const priority = (value: SchedulerRequest['priority']) => (value === 'interactive' ? 1 : 0);
        return priority(b.entry.request.priority) - priority(a.entry.request.priority) || a.entry.order - b.entry.order;
      });
    return ordered.find(({ entry }) => this.canGrant(entry.request))?.index ?? -1;
  }

  private canGrant(request: SchedulerRequest): boolean {
    if (this.active.size >= this.policy.maxActiveRuns) return false;
    if (this.activeResourceUsage('modelCalls') + (request.resources.modelCalls ?? 0) > this.policy.maxActiveModelCalls) return false;
    if (this.activeResourceUsage('toolProcesses') + (request.resources.toolProcesses ?? 0) > this.policy.maxActiveToolProcesses) return false;
    if (this.activeResourceUsage('externalSandboxes') + (request.resources.externalSandboxes ?? 0) > this.policy.maxExternalSandboxes) return false;
    return ![...this.active.values()].some(({ request: activeRequest }) => this.workspaceConflicts(activeRequest, request));
  }

  private canEverGrant(request: SchedulerRequest): boolean {
    const resources = {
      modelCalls: request.resources.modelCalls ?? 0,
      toolProcesses: request.resources.toolProcesses ?? 0,
      externalSandboxes: request.resources.externalSandboxes ?? 0,
    };
    return (
      Object.values(resources).every((value) => Number.isInteger(value) && value >= 0) &&
      resources.modelCalls <= this.policy.maxActiveModelCalls &&
      resources.toolProcesses <= this.policy.maxActiveToolProcesses &&
      resources.externalSandboxes <= this.policy.maxExternalSandboxes
    );
  }

  private workspaceConflicts(active: SchedulerRequest, next: SchedulerRequest): boolean {
    if (active.workspaceId !== next.workspaceId) return false;
    return active.workspaceAccess === 'write' || next.workspaceAccess === 'write';
  }

  private activeResourceUsage(kind: ResourceKind): number {
    return [...this.active.values()].reduce((sum, entry) => sum + (entry.request.resources[kind] ?? 0), 0);
  }

  private createLease(request: SchedulerRequest): SchedulerLease {
    const resources: ResourceVector = {
      modelCalls: request.resources.modelCalls ?? 0,
      toolProcesses: request.resources.toolProcesses ?? 0,
      externalSandboxes: request.resources.externalSandboxes ?? 0,
    };
    const workspaceLease: WorkspaceLease = {
      workspaceId: request.workspaceId,
      mode: request.workspaceAccess,
      holderRunId: request.runId,
      acquiredAt: new Date().toISOString(),
    };
    let released = false;
    return {
      runId: request.runId,
      workspaceLease,
      resources,
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(request.runId);
        this.pump();
      },
    };
  }
}

export { DEFAULT_SCHEDULER_POLICY };
