export type ApprovalDecision = 'allow' | 'deny';
export type ApprovalResolution = ApprovalDecision | 'expired';
export type ApprovalDecisionResult = 'accepted' | 'not-found' | 'already-decided' | 'expired';

export interface ApprovalRequest {
  readonly approvalId: string;
  readonly runId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly risk: 'read' | 'write' | 'destructive' | 'network';
  readonly argumentBytes: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ApprovalBroker {
  readonly timeoutMs: number;
  waitForDecision(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResolution>;
  decide(approvalId: string, decision: ApprovalDecision, runId?: string): ApprovalDecisionResult;
  pending(runId?: string): readonly ApprovalRequest[];
}

export type ApprovalBrokerErrorCode = 'CANCELLED' | 'CAPACITY';

export class ApprovalBrokerError extends Error {
  constructor(readonly code: ApprovalBrokerErrorCode, message = 'Approval broker could not continue the request.') {
    super(message);
    this.name = 'ApprovalBrokerError';
  }
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (decision: ApprovalResolution) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

type HistoryState = 'allow' | 'deny' | 'expired' | 'cancelled';
interface HistoryEntry { runId: string; state: HistoryState }

export interface InMemoryApprovalBrokerOptions {
  timeoutMs?: number;
  maxPending?: number;
  maxHistory?: number;
}

export class InMemoryApprovalBroker implements ApprovalBroker {
  readonly timeoutMs: number;
  private readonly maxPending: number;
  private readonly maxHistory: number;
  private readonly pendingEntries = new Map<string, PendingEntry>();
  private readonly history = new Map<string, HistoryEntry>();

  constructor(options: InMemoryApprovalBrokerOptions = {}) {
    this.timeoutMs = positiveLimit(options.timeoutMs ?? 120_000);
    this.maxPending = positiveLimit(options.maxPending ?? 256);
    this.maxHistory = positiveLimit(options.maxHistory ?? 512);
  }

  waitForDecision(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalResolution> {
    const safeRequest = Object.freeze({ ...request });
    if (this.pendingEntries.size >= this.maxPending) return Promise.reject(new ApprovalBrokerError('CAPACITY'));
    if (this.pendingEntries.has(safeRequest.approvalId) || this.history.has(safeRequest.approvalId)) {
      return Promise.reject(new ApprovalBrokerError('CAPACITY', 'Approval id is already in use.'));
    }
    if (!Number.isSafeInteger(safeRequest.expiresAt) || safeRequest.expiresAt <= Date.now()) {
      this.remember(safeRequest.approvalId, safeRequest.runId, 'expired');
      return Promise.resolve('expired');
    }
    if (signal?.aborted) {
      this.remember(safeRequest.approvalId, safeRequest.runId, 'cancelled');
      return Promise.reject(new ApprovalBrokerError('CANCELLED', 'Approval wait was cancelled.'));
    }

    return new Promise<ApprovalResolution>((resolve, reject) => {
      const timer = setTimeout(() => this.expire(safeRequest.approvalId), Math.max(1, safeRequest.expiresAt - Date.now()));
      const entry: PendingEntry = { request: safeRequest, resolve, reject, timer, ...(signal ? { signal } : {}) };
      this.pendingEntries.set(safeRequest.approvalId, entry);
      const onAbort = (): void => {
        const current = this.pendingEntries.get(safeRequest.approvalId);
        if (!current) return;
        clearTimeout(current.timer);
        this.pendingEntries.delete(safeRequest.approvalId);
        this.remember(safeRequest.approvalId, safeRequest.runId, 'cancelled');
        reject(new ApprovalBrokerError('CANCELLED', 'Approval wait was cancelled.'));
      };
      entry.onAbort = onAbort;
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  decide(approvalId: string, decision: ApprovalDecision, runId?: string): ApprovalDecisionResult {
    const entry = this.pendingEntries.get(approvalId);
    if (!entry) {
      const previous = this.history.get(approvalId);
      if (previous === undefined || (runId !== undefined && previous.runId !== runId)) return 'not-found';
      if (previous.state === 'expired') return 'expired';
      return 'already-decided';
    }
    if (runId !== undefined && entry.request.runId !== runId) return 'not-found';
    if (entry.request.expiresAt <= Date.now()) {
      this.expire(approvalId);
      return 'expired';
    }
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort!);
    this.pendingEntries.delete(approvalId);
    this.remember(approvalId, entry.request.runId, decision);
    entry.resolve(decision);
    return 'accepted';
  }

  pending(runId?: string): readonly ApprovalRequest[] {
    return Object.freeze([...this.pendingEntries.values()]
      .map((entry) => entry.request)
      .filter((request) => runId === undefined || request.runId === runId)
      .sort((a, b) => a.createdAt - b.createdAt));
  }

  private expire(approvalId: string): void {
    const entry = this.pendingEntries.get(approvalId);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.onAbort!);
    this.pendingEntries.delete(approvalId);
    this.remember(approvalId, entry.request.runId, 'expired');
    entry.resolve('expired');
  }

  private remember(approvalId: string, runId: string, state: HistoryState): void {
    if (this.history.size >= this.maxHistory) {
      const oldest = this.history.keys().next().value;
      if (typeof oldest === 'string') this.history.delete(oldest);
    }
    this.history.set(approvalId, { runId, state });
  }
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('approval broker limit must be a positive safe integer');
  return value;
}
