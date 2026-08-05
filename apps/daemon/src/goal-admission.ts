import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CapabilityProfileRunSnapshotSchema,
  GoalAdmissionDecisionV1Schema,
  GoalControlProjectionV1Schema,
  GoalQuotaReservationV1Schema,
  GoalRunBindingV1Schema,
  RunConfigSchema,
  type CapabilityProfileRunSnapshot,
  type GoalAdmissionDecisionV1,
  type GoalAdmissionReasonCodeV1,
  type GoalControlProjectionV1,
  type GoalQuotaReservationV1,
  type GoalRunBindingV1,
  type TodoTaskClass,
  type PermissionProfileRunSnapshot,
  type GoalRevisionToken,
  type RunConfig,
  type SchedulerRequest,
} from '@ready4vibe/contracts';
import {
  GoalControlProjectionBuilder,
  GoalControlV1WriteService,
  type GoalControlEventStoreV1,
  shouldRun,
} from '@ready4vibe/goal-control';
import type { Scheduler, SchedulerInspection } from '@ready4vibe/scheduler';
import type { RunManager } from './run-manager.js';

export const GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION = 'ready4vibe_goal_admission_application_v1' as const;
export const GOAL_PREFLIGHT_SCHEMA_VERSION = 'ready4vibe_goal_preflight_v1' as const;

const GOAL_ID = /^goal_[A-Za-z0-9_-]{8,128}$/u;
const TODO_ID = /^todo_[A-Za-z0-9_-]{8,128}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const TURN_KEY = /^turn_[A-Za-z0-9_.:-]{1,160}$/u;
const RUN_ID = /^run_[A-Za-z0-9_-]{8,128}$/u;
const ISO_DATE = z.string().datetime({ offset: true });

const GovernedMetadataSchema = z.object({
  runMode: z.literal('governed'),
  goalId: z.string().regex(GOAL_ID),
  todoId: z.string().regex(TODO_ID).optional(),
  expectedControlRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  agentId: z.string().regex(SAFE_ID),
  turnKey: z.string().regex(TURN_KEY),
  attempt: z.number().int().positive().max(10_000).default(1),
  requestId: z.string().regex(SAFE_ID),
  remainingDeliveryQuota: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  expiresAt: ISO_DATE.optional(),
}).strict();

export type GovernedRunRequest = z.infer<typeof GovernedMetadataSchema> & { readonly config: RunConfig };

export interface GoalAdmissionReadiness {
  readonly ready: boolean;
  readonly revision: GoalRevisionToken;
  readonly reason?: string;
}

export interface GoalAdmissionReadinessInput {
  readonly runId: string;
  readonly config: RunConfig;
  readonly capabilitySnapshot: CapabilityProfileRunSnapshot;
}

export interface GoalAdmissionOptions {
  readonly goalStore: GoalControlEventStoreV1;
  readonly runManager: RunManager;
  readonly capabilitySnapshotForRun: (config: RunConfig) => CapabilityProfileRunSnapshot;
  readonly workspace: {
    exists(workspaceId: string): boolean;
  };
  readonly scheduler: Pick<Scheduler, 'inspect'>;
  readonly schedulerRequestForRun?: (runId: string, config: RunConfig, capabilitySnapshot: CapabilityProfileRunSnapshot) => SchedulerRequest;
  readonly approval?: (input: GoalAdmissionReadinessInput) => GoalAdmissionReadiness | Promise<GoalAdmissionReadiness>;
  readonly sandbox?: (input: GoalAdmissionReadinessInput) => GoalAdmissionReadiness | Promise<GoalAdmissionReadiness>;
  readonly capabilitiesForSnapshot?: (snapshot: CapabilityProfileRunSnapshot, config: RunConfig) => readonly string[];
  readonly writeScopesForSnapshot?: (snapshot: CapabilityProfileRunSnapshot, config: RunConfig) => readonly string[];
  readonly goalControl?: GoalControlV1WriteService;
  /** Registers the binding before the first run event can be emitted. */
  readonly registerBinding?: (binding: GoalRunBindingV1, taskClass?: TodoTaskClass) => void;
  /** Delivery quota is opt-in so existing interactive/admission fixtures and
   * deployments can migrate without changing their durable event stream. */
  readonly quotaPolicy?: GoalAdmissionQuotaPolicy;
  readonly clock?: () => Date;
  readonly producer?: string;
}

export interface GoalAdmissionQuotaPolicy {
  readonly enabled: boolean;
  readonly units?: number;
  readonly reservationTtlMs?: number;
}

export interface GoalAdmissionResult {
  readonly schemaVersion: typeof GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION;
  readonly runId: string;
  readonly status: 'queued';
  readonly goalId: string;
  readonly todoId: string;
  readonly attempt: number;
  readonly admission: GoalAdmissionDecisionV1;
  readonly binding: GoalRunBindingV1;
  readonly reservation?: GoalQuotaReservationV1;
  readonly schedulerDecisionRef: string;
}

export interface GoalAdmissionRunOptions {
  /** Optional permission snapshot captured by the authenticated daemon
   * application boundary. Goal admission remains the first authority. */
  readonly permissionSnapshot?: PermissionProfileRunSnapshot;
}

export type GoalPreflightCheckKey = 'goal' | 'gate' | 'todo' | 'claim' | 'quota' | 'capability' | 'workspace' | 'scheduler' | 'approval' | 'sandbox';
export type GoalPreflightCheckStatus = 'ready' | 'blocked' | 'waiting' | 'degraded' | 'not_evaluated';

export interface GoalPreflightCheck {
  readonly key: GoalPreflightCheckKey;
  readonly status: GoalPreflightCheckStatus;
  readonly reason: string;
  readonly revision?: GoalRevisionToken;
  readonly reference?: string;
}

export interface GoalPreflightResult {
  readonly schemaVersion: typeof GOAL_PREFLIGHT_SCHEMA_VERSION;
  readonly runId: string;
  readonly goalId: string;
  readonly todoId?: string;
  readonly requestId: string;
  readonly controlRevision: number;
  readonly projectionChecksum: string;
  readonly decision: GoalAdmissionDecisionV1;
  readonly checks: readonly GoalPreflightCheck[];
}

export type GoalAdmissionErrorCode =
  | 'INVALID_REQUEST'
  | 'GOAL_NOT_FOUND'
  | 'PROJECTION_UNAVAILABLE'
  | 'STALE_REVISION'
  | 'GOAL_PAUSED'
  | 'GOAL_BLOCKED'
  | 'GATE_OPEN'
  | 'TODO_NOT_ELIGIBLE'
  | 'TODO_ALREADY_CLAIMED'
  | 'TODO_CLAIM_REQUIRED'
  | 'TODO_CLAIM_EXPIRED'
  | 'QUOTA_EXHAUSTED'
  | 'QUOTA_RESERVED'
  | 'CAPABILITY_MISMATCH'
  | 'WORKSPACE_UNAVAILABLE'
  | 'SCHEDULER_UNAVAILABLE'
  | 'APPROVAL_REQUIRED'
  | 'SANDBOX_UNAVAILABLE'
  | 'BINDING_CONFLICT'
  | 'QUOTA_RESERVATION_FAILED'
  | 'RUN_ID_CONFLICT'
  | 'RUN_START_FAILED';

export class GoalAdmissionError extends Error {
  constructor(
    readonly code: GoalAdmissionErrorCode,
    message: string,
    readonly decision?: GoalAdmissionDecisionV1,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GoalAdmissionError';
  }
}

/**
 * The sole application boundary for an explicitly governed run. It reads
 * Goal state and asks existing runtime authorities for readiness; it never
 * owns a scheduler queue, approval grant, sandbox process, or model call.
 */
export class GoalAdmissionService {
  private readonly builder: GoalControlProjectionBuilder;
  private readonly goalControl: GoalControlV1WriteService;
  private readonly clock: () => Date;
  private readonly producer: string;

  constructor(private readonly options: GoalAdmissionOptions) {
    this.builder = new GoalControlProjectionBuilder();
    this.clock = options.clock ?? (() => new Date());
    this.producer = options.producer ?? 'daemon-goal-admission';
    this.goalControl = options.goalControl ?? new GoalControlV1WriteService(options.goalStore, {
      producer: this.producer,
      clock: () => this.now(),
    });
  }

  async admit(input: unknown, runOptions: GoalAdmissionRunOptions = {}): Promise<GoalAdmissionResult> {
    const request = parseGovernedRunRequest(input);
    const now = this.now();
    const runId = stableId('run', request.goalId, request.requestId, request.turnKey);
    const events = await this.options.goalStore.read(request.goalId);
    if (events.length === 0) throw new GoalAdmissionError('GOAL_NOT_FOUND', 'The requested Goal was not found.');

    let projection: GoalControlProjectionV1;
    try {
      projection = GoalControlProjectionV1Schema.parse(this.builder.build(events));
    } catch (error) {
      throw new GoalAdmissionError('PROJECTION_UNAVAILABLE', 'The Goal projection could not be replayed.', undefined, { cause: error });
    }
    if (!projection.goal) throw new GoalAdmissionError('GOAL_NOT_FOUND', 'The requested Goal was not found.');
    const existingBinding = projection.bindings.find((candidate) => candidate.requestId === request.requestId);
    if (existingBinding) {
      const existingAdmission = projection.admissions.find((candidate) => candidate.admissionId === existingBinding.admissionId);
      if (existingBinding.runId !== runId || existingBinding.goalId !== request.goalId || existingBinding.todoId === undefined || (request.todoId !== undefined && existingBinding.todoId !== request.todoId) || !existingAdmission) {
        throw new GoalAdmissionError('BINDING_CONFLICT', 'The governed request id is already bound to different Goal data.');
      }
      const existingRun = await this.options.runManager.snapshot(existingBinding.runId);
      if (existingRun) {
        const existingReservation = projection.quota.reservations.find((candidate) => candidate.bindingId === existingBinding.bindingId);
        return {
          schemaVersion: GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION,
          runId: existingBinding.runId,
          status: 'queued',
          goalId: request.goalId,
          todoId: existingBinding.todoId,
          attempt: existingBinding.attempt,
          admission: existingAdmission,
          binding: existingBinding,
          ...(existingReservation ? { reservation: existingReservation } : {}),
          schedulerDecisionRef: existingAdmission.schedulerDecisionRef ?? 'scheduler_replayed',
        };
      }
      const capabilitySnapshot = this.readCapabilitySnapshot(request);
      const reservation = await this.ensureReservation(request, existingBinding, projection);
      if (reservation && reservation.status !== 'reserved') {
        throw new GoalAdmissionError('QUOTA_RESERVATION_FAILED', 'The previous governed binding no longer has a spendable quota reservation.');
      }
      try {
        this.options.registerBinding?.(existingBinding, projection.todos.find((candidate) => candidate.todoId === existingBinding.todoId)?.taskClass);
        await this.options.runManager.start(request.config, { runId: existingBinding.runId, capabilitySnapshot, ...(runOptions.permissionSnapshot ? { permissionSnapshot: runOptions.permissionSnapshot } : {}) });
      } catch (error) {
        if (isRunIdConflict(error) && await this.options.runManager.snapshot(existingBinding.runId)) {
          return {
            schemaVersion: GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION,
            runId: existingBinding.runId,
            status: 'queued',
            goalId: request.goalId,
            todoId: existingBinding.todoId,
            attempt: existingBinding.attempt,
            admission: existingAdmission,
            binding: existingBinding,
            ...(reservation ? { reservation } : {}),
            schedulerDecisionRef: existingAdmission.schedulerDecisionRef ?? 'scheduler_replayed',
          };
        }
        await this.releaseAfterStartFailure(request.goalId, reservation).catch(() => undefined);
        const code = isRunIdConflict(error) ? 'RUN_ID_CONFLICT' : 'RUN_START_FAILED';
        throw new GoalAdmissionError(code, 'The previous governed binding could not be recovered.', undefined, { cause: error });
      }
      return {
        schemaVersion: GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION,
        runId: existingBinding.runId,
        status: 'queued',
        goalId: request.goalId,
        todoId: existingBinding.todoId,
        attempt: existingBinding.attempt,
        admission: existingAdmission,
        binding: existingBinding,
        ...(reservation ? { reservation } : {}),
        schedulerDecisionRef: existingAdmission.schedulerDecisionRef ?? 'scheduler_replayed',
      };
    }
    if (projection.controlRevision !== request.expectedControlRevision) {
      throw this.fail(projection, request, 'STALE_REVISION', 'The Goal control revision is stale.', 'retry', 'blocked');
    }
    this.assertGoalState(projection, request);
    const todo = this.selectTodo(projection, request, now);
    this.assertClaim(todo, request.agentId, now, projection, request);

    let capabilitySnapshot: CapabilityProfileRunSnapshot;
    try {
      capabilitySnapshot = CapabilityProfileRunSnapshotSchema.parse(this.options.capabilitySnapshotForRun(request.config));
    } catch (error) {
      throw this.fail(projection, request, 'CAPABILITY_MISMATCH', 'The capability snapshot is invalid.', 'retry', 'blocked', undefined, error);
    }
    const effective = capabilitySnapshot.effectiveProfile;
    if (capabilitySnapshot.status === 'blocked' || !effective || effective.modelMode === 'off') {
      throw this.fail(projection, request, 'CAPABILITY_MISMATCH', 'The capability profile cannot run this Goal.', 'retry', 'blocked');
    }
    if (effective.workspaceId && effective.workspaceId !== request.config.workspaceId) {
      throw this.fail(projection, request, 'CAPABILITY_MISMATCH', 'The capability profile is bound to another workspace.', 'retry', 'blocked');
    }
    const capabilities = this.options.capabilitiesForSnapshot?.(capabilitySnapshot, request.config)
      ?? defaultCapabilities(capabilitySnapshot);
    const writeScopes = this.options.writeScopesForSnapshot?.(capabilitySnapshot, request.config)
      ?? defaultWriteScopes(capabilitySnapshot, request.config);
    const decision = shouldRun({
      projection: toLegacyProjection(projection),
      now,
      agentId: request.agentId,
      capabilities,
      writeScopes,
      ...(request.remainingDeliveryQuota === undefined ? {} : { remainingDeliveryQuota: request.remainingDeliveryQuota }),
      turnKey: request.turnKey,
    });
    if (decision.status !== 'eligible' || decision.todoId !== todo.todoId) {
      throw this.fail(projection, request, 'CAPABILITY_MISMATCH', decision.reason, 'retry', 'blocked');
    }

    const schedulerRequest = this.options.schedulerRequestForRun?.(runId, request.config, capabilitySnapshot)
      ?? defaultSchedulerRequest(runId, request.config, capabilitySnapshot);
    const schedulerDecision = this.options.scheduler.inspect(schedulerRequest);
    if (schedulerDecision.status !== 'ready') {
      const status = schedulerDecision.status === 'waiting' ? 'waiting' : 'blocked';
      throw this.fail(projection, request, 'SCHEDULER_UNAVAILABLE', schedulerReason(schedulerDecision), status === 'waiting' ? 'wait_scheduler' : 'retry', status, schedulerDecision.decisionRef);
    }
    if (!this.options.workspace.exists(request.config.workspaceId)) {
      throw this.fail(projection, request, 'WORKSPACE_UNAVAILABLE', 'The selected workspace is unavailable.', 'retry', 'blocked');
    }
    const readinessInput = { runId, config: request.config, capabilitySnapshot } satisfies GoalAdmissionReadinessInput;
    const approval = await (this.options.approval?.(readinessInput) ?? defaultApprovalReadiness(readinessInput));
    if (!approval.ready) {
      throw this.fail(projection, request, 'APPROVAL_REQUIRED', approval.reason ?? 'Approval readiness is unavailable.', 'retry', 'blocked');
    }
    const sandbox = await (this.options.sandbox?.(readinessInput) ?? defaultSandboxReadiness(readinessInput));
    if (!sandbox.ready) {
      throw this.fail(projection, request, 'SANDBOX_UNAVAILABLE', sandbox.reason ?? 'Sandbox readiness is unavailable.', 'retry', 'blocked');
    }

    const admissionId = stableId('admission', request.goalId, request.requestId, request.turnKey);
    const admissionEventId = stableEventId(request.goalId, request.requestId, 'admission');
    const admission = GoalAdmissionDecisionV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_admission_v1',
      admissionId,
      goalId: request.goalId,
      todoId: todo.todoId,
      status: 'eligible',
      reasonCode: 'ELIGIBLE',
      reason: `Todo ${todo.todoId} passed governed preflight.`,
      projectionChecksum: projection.sourceChecksum,
      controlRevision: projection.controlRevision,
      schedulerDecisionRef: schedulerDecision.decisionRef,
      nextStep: 'create_run',
      createdAt: now,
      requestId: request.requestId,
    });
    let admissionResult;
    try {
      const { schemaVersion: _admissionSchemaVersion, ...admissionDraft } = admission;
      admissionResult = await this.goalControl.recordAdmission(request.goalId, {
        eventId: admissionEventId,
        expectedRevision: projection.controlRevision,
        decision: admissionDraft,
      });
    } catch (error) {
      throw new GoalAdmissionError('STALE_REVISION', 'The Goal changed during governed preflight.', undefined, { cause: error });
    }
    const createdAt = now;
    const expiresAt = request.expiresAt ?? new Date(Date.parse(now) + Math.min(request.config.limits.maxWallTimeMs, 30 * 60 * 1_000)).toISOString();
    const binding = GoalRunBindingV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_binding_v1',
      bindingId: stableId('binding', request.goalId, request.requestId, request.turnKey),
      runId,
      goalId: request.goalId,
      todoId: todo.todoId,
      mode: 'governed',
      goalControlRevision: admissionResult.controlRevision,
      policyRevision: capabilitySnapshot.policyRevision,
      capabilityProfileRevision: capabilitySnapshot.profileRevision,
      approvalPolicyRevision: approval.revision,
      sandboxSnapshotRevision: sandbox.revision,
      workspaceId: request.config.workspaceId,
      admissionId,
      createdAt,
      expiresAt,
      attempt: request.attempt,
      requestId: request.requestId,
    });
    const bindingEventId = stableEventId(request.goalId, request.requestId, 'binding');
    let bindingResult;
    try {
      const { schemaVersion: _bindingSchemaVersion, ...bindingDraft } = binding;
      bindingResult = await this.goalControl.createBinding(request.goalId, {
        eventId: bindingEventId,
        expectedRevision: admissionResult.controlRevision,
        binding: bindingDraft,
      });
    } catch (error) {
      throw new GoalAdmissionError('BINDING_CONFLICT', 'The Goal binding could not be persisted.', undefined, { cause: error });
    }

    const persistedBinding = bindingResult.projection.bindings.find((candidate) => candidate.bindingId === binding.bindingId) ?? binding;
    const reservation = await this.ensureReservation(request, persistedBinding, bindingResult.projection);

    try {
      this.options.registerBinding?.(persistedBinding, todo.taskClass);
      await this.options.runManager.start(request.config, { runId, capabilitySnapshot, ...(runOptions.permissionSnapshot ? { permissionSnapshot: runOptions.permissionSnapshot } : {}) });
    } catch (error) {
      if (isRunIdConflict(error) && await this.options.runManager.snapshot(runId)) {
        return {
          schemaVersion: GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION,
          runId,
          status: 'queued',
          goalId: request.goalId,
          todoId: todo.todoId,
          attempt: request.attempt,
          admission,
          binding: persistedBinding,
          ...(reservation ? { reservation } : {}),
          schedulerDecisionRef: schedulerDecision.decisionRef,
        };
      }
      await this.releaseAfterStartFailure(request.goalId, reservation).catch(() => undefined);
      const code = isRunIdConflict(error) ? 'RUN_ID_CONFLICT' : 'RUN_START_FAILED';
      throw new GoalAdmissionError(code, 'The governed run could not be started after its binding was persisted.', undefined, { cause: error });
    }
    return {
      schemaVersion: GOAL_ADMISSION_APPLICATION_SCHEMA_VERSION,
      runId,
      status: 'queued',
      goalId: request.goalId,
      todoId: todo.todoId,
      attempt: request.attempt,
      admission,
      binding: persistedBinding,
      ...(reservation ? { reservation } : {}),
      schedulerDecisionRef: schedulerDecision.decisionRef,
    };
  }

  /**
   * Evaluate the same server-owned readiness authorities as governed admission
   * without writing Goal Control state or starting a run. A later call to
   * admit() must repeat the checks; this result is informational and can go
   * stale immediately after it is returned.
   */
  async preview(input: unknown): Promise<GoalPreflightResult> {
    const request = parseGovernedRunRequest(input);
    const now = this.now();
    const runId = stableId('run', request.goalId, request.requestId, request.turnKey);
    const events = await this.options.goalStore.read(request.goalId);
    if (events.length === 0) throw new GoalAdmissionError('GOAL_NOT_FOUND', 'The requested Goal was not found.');

    let projection: GoalControlProjectionV1;
    try {
      projection = GoalControlProjectionV1Schema.parse(this.builder.build(events));
    } catch (error) {
      throw new GoalAdmissionError('PROJECTION_UNAVAILABLE', 'The Goal projection could not be replayed.', undefined, { cause: error });
    }
    if (!projection.goal) throw new GoalAdmissionError('GOAL_NOT_FOUND', 'The requested Goal was not found.');

    const checks: GoalPreflightCheck[] = [];
    const finish = (decision: GoalAdmissionDecisionV1): GoalPreflightResult => preflightResult({
      runId,
      goalId: request.goalId,
      ...(decision.todoId ? { todoId: decision.todoId } : {}),
      requestId: request.requestId,
      controlRevision: projection.controlRevision,
      projectionChecksum: projection.sourceChecksum,
      decision,
      checks,
    });
    const fail = (key: GoalPreflightCheckKey, error: GoalAdmissionError): GoalPreflightResult => {
      checks.push({ key, status: preflightStatus(error.decision?.status ?? 'blocked'), reason: boundedReason(error.message) });
      return finish(error.decision ?? this.fail(projection, request, 'PROJECTION_UNAVAILABLE', error.message, 'retry', 'blocked').decision!);
    };

    const goal = projection.goal;
    if (goal.status === 'paused') return fail('goal', this.fail(projection, request, 'GOAL_PAUSED', 'The Goal is paused.', 'none', 'blocked'));
    if (goal.status === 'blocked') return fail('goal', this.fail(projection, request, 'GOAL_BLOCKED', 'The Goal is blocked.', 'none', 'blocked'));
    if (goal.status === 'completed' || goal.status === 'archived') return fail('goal', this.fail(projection, request, 'TODO_NOT_ELIGIBLE', 'The Goal is not active.', 'none', 'waiting'));
    checks.push({ key: 'goal', status: 'ready', reason: 'The Goal is active.', revision: projection.controlRevision });

    const blockingGate = projection.gates.find((gate) => gate.blocking && gate.status === 'open');
    if (blockingGate) return fail('gate', this.fail(projection, request, 'GATE_OPEN', 'A blocking Goal gate is open.', 'resolve_gate', 'blocked'));
    checks.push({ key: 'gate', status: 'ready', reason: 'No blocking Gate is open.' });

    if (request.remainingDeliveryQuota !== undefined && request.remainingDeliveryQuota <= 0) {
      return fail('quota', this.fail(projection, request, 'QUOTA_EXHAUSTED', 'Delivery quota is exhausted.', 'retry', 'throttled'));
    }
    if (projection.quota.spentTurnKeys.includes(request.turnKey)) {
      return fail('quota', this.fail(projection, request, 'QUOTA_EXHAUSTED', 'This turn key has already been spent.', 'retry', 'throttled'));
    }
    if (projection.quota.reservations.some((reservation) => reservation.turnKey === request.turnKey && reservation.status === 'reserved')) {
      return fail('quota', this.fail(projection, request, 'QUOTA_RESERVED', 'This turn key already has an active quota reservation.', 'retry', 'waiting'));
    }
    checks.push({ key: 'quota', status: 'ready', reason: this.options.quotaPolicy?.enabled ? 'Quota is available for a new governed admission.' : 'No governed delivery quota policy is enabled.' });

    let todo: GoalControlProjectionV1['todos'][number];
    try {
      todo = this.selectTodo(projection, request, now);
    } catch (error) {
      if (error instanceof GoalAdmissionError) return fail('todo', error);
      throw error;
    }
    checks.push({ key: 'todo', status: 'ready', reason: `Todo ${todo.todoId} is due and eligible.`, reference: todo.todoId });
    try {
      this.assertClaim(todo, request.agentId, now, projection, request);
    } catch (error) {
      if (error instanceof GoalAdmissionError) return fail('claim', error);
      throw error;
    }
    checks.push({ key: 'claim', status: 'ready', reason: 'The Todo has an active claim for this agent.', reference: todo.todoId });

    let capabilitySnapshot: CapabilityProfileRunSnapshot;
    try {
      capabilitySnapshot = CapabilityProfileRunSnapshotSchema.parse(this.options.capabilitySnapshotForRun(request.config));
    } catch (error) {
      return fail('capability', this.fail(projection, request, 'CAPABILITY_MISMATCH', 'The capability snapshot is invalid.', 'retry', 'blocked', undefined, error));
    }
    const effective = capabilitySnapshot.effectiveProfile;
    if (capabilitySnapshot.status === 'blocked' || !effective || effective.modelMode === 'off') {
      return fail('capability', this.fail(projection, request, 'CAPABILITY_MISMATCH', 'The capability profile cannot run this Goal.', 'retry', 'blocked'));
    }
    if (effective.workspaceId && effective.workspaceId !== request.config.workspaceId) {
      return fail('capability', this.fail(projection, request, 'CAPABILITY_MISMATCH', 'The capability profile is bound to another workspace.', 'retry', 'blocked'));
    }
    const capabilities = this.options.capabilitiesForSnapshot?.(capabilitySnapshot, request.config) ?? defaultCapabilities(capabilitySnapshot);
    const writeScopes = this.options.writeScopesForSnapshot?.(capabilitySnapshot, request.config) ?? defaultWriteScopes(capabilitySnapshot, request.config);
    const decision = shouldRun({
      projection: toLegacyProjection(projection),
      now,
      agentId: request.agentId,
      capabilities,
      writeScopes,
      ...(request.remainingDeliveryQuota === undefined ? {} : { remainingDeliveryQuota: request.remainingDeliveryQuota }),
      turnKey: request.turnKey,
    });
    if (decision.status !== 'eligible' || decision.todoId !== todo.todoId) {
      return fail('capability', this.fail(projection, request, 'CAPABILITY_MISMATCH', decision.reason, 'retry', 'blocked'));
    }
    checks.push({ key: 'capability', status: 'ready', reason: 'Capability requirements are satisfied.', revision: capabilitySnapshot.profileRevision });

    const schedulerRequest = this.options.schedulerRequestForRun?.(runId, request.config, capabilitySnapshot)
      ?? defaultSchedulerRequest(runId, request.config, capabilitySnapshot);
    const schedulerDecision = this.options.scheduler.inspect(schedulerRequest);
    if (schedulerDecision.status !== 'ready') {
      const status = schedulerDecision.status === 'waiting' ? 'waiting' : 'blocked';
      return fail('scheduler', this.fail(projection, request, 'SCHEDULER_UNAVAILABLE', schedulerReason(schedulerDecision), status === 'waiting' ? 'wait_scheduler' : 'retry', status, schedulerDecision.decisionRef));
    }
    checks.push({ key: 'scheduler', status: 'ready', reason: 'The Scheduler can accept the requested resources.', reference: schedulerDecision.decisionRef });

    if (!this.options.workspace.exists(request.config.workspaceId)) {
      return fail('workspace', this.fail(projection, request, 'WORKSPACE_UNAVAILABLE', 'The selected workspace is unavailable.', 'retry', 'blocked'));
    }
    checks.push({ key: 'workspace', status: 'ready', reason: 'The selected workspace is available.', reference: request.config.workspaceId });

    const readinessInput = { runId, config: request.config, capabilitySnapshot } satisfies GoalAdmissionReadinessInput;
    const approval = await (this.options.approval?.(readinessInput) ?? defaultApprovalReadiness(readinessInput));
    if (!approval.ready) {
      return fail('approval', this.fail(projection, request, 'APPROVAL_REQUIRED', approval.reason ?? 'Approval readiness is unavailable.', 'retry', 'blocked'));
    }
    checks.push({ key: 'approval', status: 'ready', reason: 'Approval policy is ready for this run.', revision: approval.revision });

    const sandbox = await (this.options.sandbox?.(readinessInput) ?? defaultSandboxReadiness(readinessInput));
    if (!sandbox.ready) {
      return fail('sandbox', this.fail(projection, request, 'SANDBOX_UNAVAILABLE', sandbox.reason ?? 'Sandbox readiness is unavailable.', 'retry', 'blocked'));
    }
    checks.push({ key: 'sandbox', status: 'ready', reason: 'Sandbox readiness is satisfied.', revision: sandbox.revision });

    return finish(GoalAdmissionDecisionV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_admission_v1',
      admissionId: stableId('admission', request.goalId, request.requestId, request.turnKey),
      goalId: request.goalId,
      todoId: todo.todoId,
      status: 'eligible',
      reasonCode: 'ELIGIBLE',
      reason: `Todo ${todo.todoId} passed governed preflight.`,
      projectionChecksum: projection.sourceChecksum,
      controlRevision: projection.controlRevision,
      schedulerDecisionRef: schedulerDecision.decisionRef,
      nextStep: 'create_run',
      createdAt: now,
      requestId: request.requestId,
    }));
  }

  private readCapabilitySnapshot(request: GovernedRunRequest): CapabilityProfileRunSnapshot {
    try {
      return CapabilityProfileRunSnapshotSchema.parse(this.options.capabilitySnapshotForRun(request.config));
    } catch (error) {
      throw new GoalAdmissionError('CAPABILITY_MISMATCH', 'The capability snapshot is invalid during governed recovery.', undefined, { cause: error });
    }
  }

  private async ensureReservation(
    request: GovernedRunRequest,
    binding: GoalRunBindingV1,
    projection: GoalControlProjectionV1,
  ): Promise<GoalQuotaReservationV1 | undefined> {
    const policy = this.options.quotaPolicy;
    if (!policy?.enabled) return undefined;
    const existing = projection.quota.reservations.find((candidate) => candidate.bindingId === binding.bindingId && candidate.attempt === binding.attempt);
    if (existing) return existing;
    const now = this.now();
    const reservation = GoalQuotaReservationV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_quota_reservation_v1',
      reservationId: stableId('reservation', request.goalId, request.requestId, request.turnKey),
      bindingId: binding.bindingId,
      goalId: request.goalId,
      ...(binding.todoId ? { todoId: binding.todoId } : {}),
      attempt: binding.attempt,
      turnKey: request.turnKey,
      units: policy.units ?? 1,
      status: 'reserved',
      createdAt: now,
      expiresAt: request.expiresAt ?? new Date(Date.parse(now) + Math.min(policy.reservationTtlMs ?? 30 * 60 * 1_000, 30 * 60 * 1_000)).toISOString(),
      updatedAt: now,
    });
    try {
      const { schemaVersion: _schemaVersion, status: _status, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = reservation;
      const result = await this.goalControl.reserveQuota(request.goalId, {
        eventId: stableEventId(request.goalId, request.requestId, 'quota.reserve'),
        expectedRevision: projection.controlRevision,
        requestId: request.requestId,
        reservation: draft,
      });
      return result.projection.quota.reservations.find((candidate) => candidate.reservationId === reservation.reservationId) ?? reservation;
    } catch (error) {
      throw new GoalAdmissionError('QUOTA_RESERVATION_FAILED', 'The governed quota reservation could not be persisted.', undefined, { cause: error });
    }
  }

  private async releaseAfterStartFailure(goalId: string, reservation: GoalQuotaReservationV1 | undefined): Promise<void> {
    if (!reservation || reservation.status !== 'reserved') return;
    const events = await this.options.goalStore.read(goalId);
    const projection = GoalControlProjectionV1Schema.parse(this.builder.build(events));
    const current = projection.quota.reservations.find((candidate) => candidate.reservationId === reservation.reservationId);
    if (!current || current.status !== 'reserved') return;
    await this.goalControl.releaseQuota(goalId, current.reservationId, {
      eventId: stableEventId(goalId, current.reservationId, 'quota.release'),
      expectedRevision: projection.controlRevision,
      reason: 'run-start-failed',
    });
  }

  private assertGoalState(projection: GoalControlProjectionV1, request: GovernedRunRequest): void {
    const goal = projection.goal;
    if (!goal) throw new GoalAdmissionError('GOAL_NOT_FOUND', 'The requested Goal was not found.');
    if (goal.status === 'paused') throw this.fail(projection, request, 'GOAL_PAUSED', 'The Goal is paused.', 'none', 'blocked');
    if (goal.status === 'blocked') throw this.fail(projection, request, 'GOAL_BLOCKED', 'The Goal is blocked.', 'none', 'blocked');
    if (goal.status === 'completed' || goal.status === 'archived') throw this.fail(projection, request, 'TODO_NOT_ELIGIBLE', 'The Goal is not active.', 'none', 'waiting');
    if (projection.gates.some((gate) => gate.blocking && gate.status === 'open')) {
      throw this.fail(projection, request, 'GATE_OPEN', 'A blocking Goal gate is open.', 'resolve_gate', 'blocked');
    }
    if (request.remainingDeliveryQuota !== undefined && request.remainingDeliveryQuota <= 0) {
      throw this.fail(projection, request, 'QUOTA_EXHAUSTED', 'Delivery quota is exhausted.', 'retry', 'throttled');
    }
    if (projection.quota.spentTurnKeys.includes(request.turnKey)) {
      throw this.fail(projection, request, 'QUOTA_EXHAUSTED', 'This turn key has already been spent.', 'retry', 'throttled');
    }
    if (projection.quota.reservations.some((reservation) => reservation.turnKey === request.turnKey && reservation.status === 'reserved')) {
      throw this.fail(projection, request, 'QUOTA_RESERVED', 'This turn key already has an active quota reservation.', 'retry', 'waiting');
    }
  }

  private selectTodo(projection: GoalControlProjectionV1, request: GovernedRunRequest, now: string) {
    const candidates = projection.todos
      .filter((todo) => request.todoId === undefined || todo.todoId === request.todoId)
      .filter((todo) => (todo.status === 'open' || todo.status === 'deferred') && (todo.nextDueAt === undefined || Date.parse(todo.nextDueAt) <= Date.parse(now)))
      .filter((todo) => todo.taskClass !== 'user_action' && todo.taskClass !== 'user_gate')
      .sort((left, right) => left.priority - right.priority || left.todoId.localeCompare(right.todoId));
    const selected = candidates[0];
    if (!selected) throw this.fail(projection, request, 'TODO_NOT_ELIGIBLE', 'No eligible Todo is due for this governed run.', 'claim_todo', 'waiting');
    return selected;
  }

  private assertClaim(todo: GoalControlProjectionV1['todos'][number], agentId: string, now: string, projection: GoalControlProjectionV1, request: GovernedRunRequest): void {
    if (todo.claimedBy === undefined || todo.claimTokenHash === undefined || todo.claimExpiresAt === undefined) {
      throw this.fail(projection, request, 'TODO_CLAIM_REQUIRED', 'The Todo must have an active server-side claim before governed admission.', 'claim_todo', 'blocked');
    }
    if (todo.claimedBy !== agentId || (todo.boundAgentId !== undefined && todo.boundAgentId !== agentId)) {
      throw this.fail(projection, request, 'TODO_ALREADY_CLAIMED', 'The Todo is claimed by another agent.', 'claim_todo', 'blocked');
    }
    if (Date.parse(todo.claimExpiresAt) <= Date.parse(now)) {
      throw this.fail(projection, request, 'TODO_CLAIM_EXPIRED', 'The Todo claim has expired.', 'claim_todo', 'blocked');
    }
  }

  private fail(
    projection: GoalControlProjectionV1,
    request: GovernedRunRequest,
    reasonCode: GoalAdmissionReasonCodeV1,
    reason: string,
    nextStep: GoalAdmissionDecisionV1['nextStep'],
    status: GoalAdmissionDecisionV1['status'],
    schedulerDecisionRef?: string,
    cause?: unknown,
  ): GoalAdmissionError {
    const decision = GoalAdmissionDecisionV1Schema.parse({
      schemaVersion: 'ready4vibe_goal_admission_v1',
      admissionId: stableId('admission', request.goalId, request.requestId, request.turnKey),
      goalId: request.goalId,
      ...(request.todoId ? { todoId: request.todoId } : {}),
      status,
      reasonCode,
      reason: boundedReason(reason),
      projectionChecksum: projection.sourceChecksum,
      controlRevision: projection.controlRevision,
      ...(schedulerDecisionRef ? { schedulerDecisionRef } : {}),
      nextStep,
      createdAt: this.now(),
      requestId: request.requestId,
    });
    return new GoalAdmissionError(errorCodeForReason(reasonCode), reason, decision, cause === undefined ? undefined : { cause });
  }

  private now(): string {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Goal admission clock must return a valid Date.');
    return value.toISOString();
  }
}

export function parseGovernedRunRequest(input: unknown): GovernedRunRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new GoalAdmissionError('INVALID_REQUEST', 'A governed run request object is required.');
  const raw = input as Record<string, unknown>;
  rejectSecretShapedKeys(raw);
  if (raw.runMode !== 'governed') throw new GoalAdmissionError('INVALID_REQUEST', 'Only an explicit runMode=governed request may enter Goal admission.');
  const metadata = GovernedMetadataSchema.parse({
    runMode: raw.runMode,
    goalId: raw.goalId,
    todoId: raw.todoId,
    expectedControlRevision: raw.expectedControlRevision,
    agentId: raw.agentId,
    turnKey: raw.turnKey,
    attempt: raw.attempt,
    requestId: raw.requestId,
    remainingDeliveryQuota: raw.remainingDeliveryQuota,
    expiresAt: raw.expiresAt,
  });
  const { runMode: _runMode, goalId: _goalId, todoId: _todoId, expectedControlRevision: _revision, agentId: _agentId, turnKey: _turnKey, attempt: _attempt, requestId: _requestId, remainingDeliveryQuota: _quota, expiresAt: _expiresAt, ...configInput } = raw;
  const config = RunConfigSchema.parse(configInput);
  return { ...metadata, config };
}

function rejectSecretShapedKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) rejectSecretShapedKeys(child);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (/api[_-]?key|access[_-]?token|refresh[_-]?token|csrf|private[_-]?key|password|credential|secret|environment|env(?:ironment)?[_-]?vars?/iu.test(key)) {
      throw new GoalAdmissionError('INVALID_REQUEST', 'Governed requests cannot contain secret-shaped fields.');
    }
    rejectSecretShapedKeys(child);
  }
}

function toLegacyProjection(projection: GoalControlProjectionV1) {
  return {
    projectionVersion: 'goal_control_projection_v0' as const,
    goal: projection.goal,
    todos: projection.todos,
    gates: projection.gates,
    evidence: projection.evidence,
    handoffs: projection.handoffs,
    quota: { spentTurnKeys: projection.quota.spentTurnKeys, totalSpent: projection.quota.totalSpent },
    lastEventId: projection.lastEventId,
    lastAppendSequence: projection.lastAppendSequence,
    sourceEventCount: projection.sourceEventCount,
    sourceChecksum: projection.sourceChecksum,
    controlRevision: projection.controlRevision,
  };
}

function defaultSchedulerRequest(runId: string, config: RunConfig, snapshot: CapabilityProfileRunSnapshot): SchedulerRequest {
  const profile = snapshot.effectiveProfile;
  const toolProcesses = profile && (profile.filesystemMode !== 'off' || profile.shellMode !== 'off' || profile.mcpSkillMode !== 'off') ? 1 : 0;
  return {
    runId,
    workspaceId: config.workspaceId,
    workspaceAccess: config.sandbox.mode === 'read-only' ? 'read' : 'write',
    priority: 'background',
    resources: {
      modelCalls: 1,
      ...(toolProcesses > 0 ? { toolProcesses } : {}),
      ...(config.sandbox.mode === 'external-sandbox' ? { externalSandboxes: 1 } : {}),
    },
  };
}

function defaultCapabilities(snapshot: CapabilityProfileRunSnapshot): readonly string[] {
  const profile = snapshot.effectiveProfile;
  if (!profile) return [];
  return [
    ...(profile.modelMode === 'configured' ? ['model'] : []),
    ...(profile.filesystemMode === 'workspace-read' ? ['workspace-read'] : []),
    ...(profile.filesystemMode === 'workspace-write' ? ['workspace-read', 'workspace-write'] : []),
    ...(profile.shellMode === 'external-sandbox' ? ['external-sandbox'] : []),
    ...(profile.shellMode === 'host-restricted' ? ['host-restricted'] : []),
    ...(profile.mcpSkillMode === 'configured' ? ['mcp-skill'] : []),
  ];
}

function defaultWriteScopes(snapshot: CapabilityProfileRunSnapshot, config: RunConfig): readonly string[] {
  return snapshot.effectiveProfile?.filesystemMode === 'workspace-write' ? [`workspace:${config.workspaceId}`] : [];
}

function defaultApprovalReadiness(input: GoalAdmissionReadinessInput): GoalAdmissionReadiness {
  if (input.config.taskTrust === 'untrusted-content' && input.config.approval === 'never') {
    return { ready: false, revision: 'approval-1', reason: 'Untrusted content cannot use approval=never.' };
  }
  return { ready: true, revision: 'approval-1' };
}

function defaultSandboxReadiness(input: GoalAdmissionReadinessInput): GoalAdmissionReadiness {
  if (input.config.taskTrust === 'untrusted-content' && input.config.sandbox.mode !== 'external-sandbox') {
    return { ready: false, revision: 'sandbox-1', reason: 'Untrusted content requires an external sandbox.' };
  }
  if (input.config.sandbox.mode === 'danger-full-access') {
    return { ready: false, revision: 'sandbox-1', reason: 'Full-host execution is not enabled by this governed profile.' };
  }
  if (input.config.sandbox.mode === 'external-sandbox') {
    return { ready: false, revision: 'sandbox-1', reason: 'An external sandbox readiness port is required.' };
  }
  return { ready: true, revision: 'sandbox-1' };
}

function schedulerReason(inspection: SchedulerInspection): string {
  if (inspection.reasonCode === 'WORKSPACE_CONFLICT') return 'The Scheduler is serializing conflicting workspace access.';
  if (inspection.reasonCode === 'CAPACITY_BUSY') return 'The Scheduler is at capacity.';
  if (inspection.reasonCode === 'UNSATISFIABLE') return 'The Scheduler cannot satisfy this run resource request.';
  return 'The Scheduler accepted the preflight request.';
}

function stableId(prefix: 'run' | 'admission' | 'binding' | 'reservation', ...parts: readonly string[]): string {
  return `${prefix}_${createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex').slice(0, 32)}`;
}

function stableEventId(goalId: string, requestId: string, kind: 'admission' | 'binding' | 'quota.reserve' | 'quota.release'): string {
  return `gevt_${createHash('sha256').update(`${goalId}\u0000${requestId}\u0000${kind}`, 'utf8').digest('hex').slice(0, 32)}`;
}

function boundedReason(value: string): string {
  const normalized = value.replace(/[\r\n\u0000-\u001F\u007F]/gu, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497)}...` : normalized || 'Governed admission was blocked.';
}

function isRunIdConflict(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'RUN_ID_CONFLICT';
}

function errorCodeForReason(reason: GoalAdmissionReasonCodeV1): GoalAdmissionErrorCode {
  switch (reason) {
    case 'GATE_OPEN': return 'GATE_OPEN';
    case 'GOAL_PAUSED': return 'GOAL_PAUSED';
    case 'GOAL_BLOCKED': return 'GOAL_BLOCKED';
    case 'STALE_REVISION': return 'STALE_REVISION';
    case 'TODO_ALREADY_CLAIMED': return 'TODO_ALREADY_CLAIMED';
    case 'TODO_CLAIM_REQUIRED': return 'TODO_CLAIM_REQUIRED';
    case 'TODO_CLAIM_EXPIRED': return 'TODO_CLAIM_EXPIRED';
    case 'QUOTA_EXHAUSTED': return 'QUOTA_EXHAUSTED';
    case 'QUOTA_RESERVED': return 'QUOTA_RESERVED';
    case 'SCHEDULER_UNAVAILABLE': return 'SCHEDULER_UNAVAILABLE';
    case 'CAPABILITY_MISMATCH': return 'CAPABILITY_MISMATCH';
    case 'APPROVAL_REQUIRED': return 'APPROVAL_REQUIRED';
    case 'SANDBOX_UNAVAILABLE': return 'SANDBOX_UNAVAILABLE';
    case 'WORKSPACE_UNAVAILABLE': return 'WORKSPACE_UNAVAILABLE';
    case 'PROJECTION_UNAVAILABLE': return 'PROJECTION_UNAVAILABLE';
    default: return 'TODO_NOT_ELIGIBLE';
  }
}

const PREFLIGHT_CHECK_ORDER: readonly GoalPreflightCheckKey[] = [
  'goal', 'gate', 'todo', 'claim', 'quota', 'capability', 'workspace', 'scheduler', 'approval', 'sandbox',
];

function preflightResult(input: Omit<GoalPreflightResult, 'schemaVersion' | 'checks'> & { checks: readonly GoalPreflightCheck[] }): GoalPreflightResult {
  const known = new Map(input.checks.map((check) => [check.key, check]));
  const checks = PREFLIGHT_CHECK_ORDER.map((key) => known.get(key) ?? {
    key,
    status: 'not_evaluated' as const,
    reason: 'Not evaluated because an earlier preflight check blocked the request.',
  });
  return {
    schemaVersion: GOAL_PREFLIGHT_SCHEMA_VERSION,
    runId: input.runId,
    goalId: input.goalId,
    ...(input.todoId ? { todoId: input.todoId } : {}),
    requestId: input.requestId,
    controlRevision: input.controlRevision,
    projectionChecksum: input.projectionChecksum,
    decision: input.decision,
    checks,
  };
}

function preflightStatus(status: GoalAdmissionDecisionV1['status']): GoalPreflightCheckStatus {
  if (status === 'eligible') return 'ready';
  if (status === 'waiting' || status === 'throttled') return 'waiting';
  return status === 'degraded' ? 'degraded' : 'blocked';
}
