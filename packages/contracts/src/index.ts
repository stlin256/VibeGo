import { z } from 'zod';

export const RunStatusSchema = z.enum([
  'created',
  'queued',
  'planning',
  'executing',
  'waiting-approval',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'timed-out',
  'needs-recovery',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const TaskTrustSchema = z.enum(['trusted-workspace', 'untrusted-content']);
export type TaskTrust = z.infer<typeof TaskTrustSchema>;

export const SandboxPolicySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('read-only'), network: z.enum(['restricted', 'enabled']) }),
  z.object({
    mode: z.literal('workspace-write'),
    writableRoots: z.array(z.string().min(1)).min(1),
    network: z.enum(['restricted', 'enabled']),
  }),
  z.object({
    mode: z.literal('external-sandbox'),
    provider: z.enum(['docker', 'podman', 'vm']),
    network: z.enum(['restricted', 'enabled']),
    writableRoots: z.array(z.string().min(1)).max(32).optional(),
  }),
  z.object({ mode: z.literal('danger-full-access'), enabledBy: z.literal('explicit-user-only') }),
]);
export type SandboxPolicy = z.infer<typeof SandboxPolicySchema>;

export const ApprovalPolicySchema = z.union([
  z.literal('untrusted'),
  z.literal('on-request'),
  z.object({
    granular: z.object({
      sandboxApproval: z.boolean(),
      ruleApproval: z.boolean(),
      skillApproval: z.boolean(),
      permissionRequest: z.boolean(),
      mcpElicitation: z.boolean(),
    }),
  }),
  z.literal('never'),
]);
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const RunLimitsSchema = z.object({
  maxTurns: z.number().int().positive().max(50),
  maxWallTimeMs: z.number().int().positive().max(30 * 60 * 1000),
  maxModelInputTokens: z.number().int().positive(),
  maxModelOutputTokens: z.number().int().positive(),
  maxToolCalls: z.number().int().positive().max(200),
  maxOutputBytes: z.number().int().positive().max(50 * 1024 * 1024),
  maxContextBytes: z.number().int().positive(),
});
export type RunLimits = z.infer<typeof RunLimitsSchema>;

export const RunConfigSchema = z.object({
  workspaceId: z.string().min(1),
  userMessage: z.string().min(1),
  model: z.object({ provider: z.string().min(1), name: z.string().min(1) }),
  taskTrust: TaskTrustSchema,
  sandbox: SandboxPolicySchema,
  approval: ApprovalPolicySchema,
  limits: RunLimitsSchema,
  createdBySessionId: z.string().min(1),
  clientRequestId: z.string().min(1),
});
export type RunConfig = z.infer<typeof RunConfigSchema>;

export const SchedulerPolicySchema = z.object({
  maxActiveRuns: z.number().int().positive().max(4),
  maxActiveModelCalls: z.number().int().positive().max(8),
  maxActiveToolProcesses: z.number().int().positive().max(32),
  maxExternalSandboxes: z.number().int().positive().max(4),
  workspaceWriteMode: z.enum(['exclusive', 'worktree-only']),
});
export type SchedulerPolicy = z.infer<typeof SchedulerPolicySchema>;

export const DEFAULT_SCHEDULER_POLICY: SchedulerPolicy = {
  maxActiveRuns: 2,
  maxActiveModelCalls: 2,
  maxActiveToolProcesses: 4,
  maxExternalSandboxes: 1,
  workspaceWriteMode: 'exclusive',
};

export type ResourceKind = 'modelCalls' | 'toolProcesses' | 'externalSandboxes';
export type ResourceVector = Record<ResourceKind, number>;

export interface SchedulerRequest {
  runId: string;
  workspaceId: string;
  workspaceAccess: 'read' | 'write';
  resources: Partial<ResourceVector>;
  priority?: 'interactive' | 'background';
}

export interface WorkspaceLease {
  workspaceId: string;
  mode: 'read' | 'write';
  holderRunId: string;
  acquiredAt: string;
}

export interface SchedulerLease {
  readonly runId: string;
  readonly workspaceLease: WorkspaceLease;
  readonly resources: ResourceVector;
  release(): void;
}

export interface NewDomainEvent<TPayload = unknown> {
  runId: string;
  type: string;
  source: 'user' | 'orchestrator' | 'model' | 'tool' | 'policy' | 'sandbox' | 'system';
  correlationId: string;
  payload: TPayload;
}

export interface StoredEvent<TPayload = unknown> extends NewDomainEvent<TPayload> {
  version: 1;
  id: string;
  seq: number;
  at: string;
}

export interface EventStore {
  append<TPayload>(event: NewDomainEvent<TPayload>): Promise<StoredEvent<TPayload>>;
  appendBatch<TPayload>(events: readonly NewDomainEvent<TPayload>[]): Promise<StoredEvent<TPayload>[]>;
  read<TPayload = unknown>(runId: string, afterSeq?: number): Promise<StoredEvent<TPayload>[]>;
  listRunIds(): readonly string[];
  lastSeq(runId: string): number;
}

export type ModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call-delta'; callId: string; name?: string; argumentsChunk: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'completed'; finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' }
  | { type: 'error'; code: string; retryable: boolean; safeMessage: string; retryAfterMs?: number };

export interface ModelRequest {
  model: string;
  messages: readonly unknown[];
  tools: readonly unknown[];
  budget: { maxInputTokens: number; maxOutputTokens: number };
  metadata: { runId: string; turnId: string; requestId: string };
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: {
    streaming: boolean;
    toolCalls: boolean;
    structuredOutput: boolean;
  };
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  created: ['queued', 'failed', 'needs-recovery'],
  queued: ['planning', 'cancelling', 'failed', 'needs-recovery'],
  planning: ['executing', 'waiting-approval', 'cancelling', 'failed', 'timed-out', 'needs-recovery'],
  executing: ['planning', 'waiting-approval', 'cancelling', 'completed', 'failed', 'timed-out', 'needs-recovery'],
  'waiting-approval': ['executing', 'cancelling', 'failed', 'timed-out', 'needs-recovery'],
  cancelling: ['cancelled', 'failed', 'needs-recovery'],
  completed: [],
  failed: [],
  cancelled: [],
  'timed-out': [],
  'needs-recovery': [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid run transition: ${from} -> ${to}`);
  }
}

export function parseRunConfig(input: unknown): RunConfig {
  return RunConfigSchema.parse(input);
}

export * from './goal.js';
export * from './agent-memory.js';
export * from './agent-memory-operations.js';
export * from './agent-memory-knowledge.js';
export * from './agent-memory-knowledge-settings.js';
export * from './observability.js';
export * from './observability-api.js';
export * from './provider-usage.js';
export * from './model-runtime.js';
