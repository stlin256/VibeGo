import {
  GoalControlProjectionBuilder,
  shouldRun,
  type GoalControlEventStoreV1,
} from '@ready4vibe/goal-control';
import type { GoalControlProjectionV1, GoalShouldRunDecision } from '@ready4vibe/contracts';
import type { GoalRunWritebackReconciliationResult, GoalRunWritebackService } from './goal-writeback.js';

export type GoalRecoveryMonitorStatus = 'healthy' | 'degraded';

export interface GoalRecoveryMonitorOptions {
  readonly goalStore: Pick<GoalControlEventStoreV1, 'listGoalIds' | 'read'>;
  readonly writeback: Pick<GoalRunWritebackService, 'reconcile'>;
  readonly clock?: () => Date;
  readonly intervalMs?: number;
  readonly capabilitiesForGoal?: (projection: GoalControlProjectionV1) => readonly string[];
  readonly writeScopesForGoal?: (projection: GoalControlProjectionV1) => readonly string[];
  readonly remainingDeliveryQuota?: (projection: GoalControlProjectionV1) => number | undefined;
  /** Optional launcher. It must delegate to GoalAdmissionService. */
  readonly onEligible?: (decision: GoalShouldRunDecision, projection: GoalControlProjectionV1) => void | Promise<void>;
}

export interface GoalRecoveryMonitorResult {
  readonly schemaVersion: 'ready4vibe_goal_recovery_monitor_v1';
  readonly status: GoalRecoveryMonitorStatus;
  readonly reconciliation: GoalRunWritebackReconciliationResult | null;
  readonly decisions: readonly GoalShouldRunDecision[];
  readonly projectedGoals: number;
  readonly launched: number;
  readonly skipped: number;
  readonly errorCode?: 'GOAL_MONITOR_RECONCILE_FAILED' | 'GOAL_MONITOR_PROJECTION_FAILED' | 'GOAL_MONITOR_LAUNCH_FAILED';
}

const DEFAULT_INTERVAL_MS = 15_000;
const MIN_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 5 * 60_000;

/**
 * Serialized daemon application monitor. It observes Goal Control and routes
 * optional launches back through the existing admission/runtime authorities.
 */
export class GoalRecoveryMonitor {
  private readonly builder = new GoalControlProjectionBuilder();
  private readonly clock: () => Date;
  private readonly intervalMs: number;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tickPromise: Promise<GoalRecoveryMonitorResult> | undefined;

  constructor(private readonly options: GoalRecoveryMonitorOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < MIN_INTERVAL_MS || this.intervalMs > MAX_INTERVAL_MS) {
      throw new Error(`Goal recovery monitor interval must be ${MIN_INTERVAL_MS}-${MAX_INTERVAL_MS} ms.`);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** One bounded, serialized monitor tick for tests and explicit health work. */
  runOnce(): Promise<GoalRecoveryMonitorResult> {
    if (this.tickPromise) return this.tickPromise;
    this.tickPromise = this.runTick().finally(() => {
      this.tickPromise = undefined;
    });
    return this.tickPromise;
  }

  private async runTick(): Promise<GoalRecoveryMonitorResult> {
    let reconciliation: GoalRunWritebackReconciliationResult | null = null;
    let status: GoalRecoveryMonitorStatus = 'healthy';
    let errorCode: GoalRecoveryMonitorResult['errorCode'];
    try {
      reconciliation = await this.options.writeback.reconcile();
    } catch {
      status = 'degraded';
      errorCode = 'GOAL_MONITOR_RECONCILE_FAILED';
    }
    const decisions: GoalShouldRunDecision[] = [];
    let projectedGoals = 0;
    let launched = 0;
    let skipped = 0;
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      return { schemaVersion: 'ready4vibe_goal_recovery_monitor_v1', status: 'degraded', reconciliation, decisions, projectedGoals, launched, skipped, errorCode: 'GOAL_MONITOR_PROJECTION_FAILED' };
    }
    for (const goalId of [...this.options.goalStore.listGoalIds()].sort((left, right) => left.localeCompare(right))) {
      let projection: GoalControlProjectionV1;
      try {
        projection = this.builder.build(await this.options.goalStore.read(goalId));
        projectedGoals += 1;
      } catch {
        status = 'degraded';
        errorCode ??= 'GOAL_MONITOR_PROJECTION_FAILED';
        skipped += 1;
        continue;
      }
      try {
        const remainingDeliveryQuota = this.options.remainingDeliveryQuota?.(projection);
        const decision = shouldRun({
          projection: projection as never,
          now: now.toISOString(),
          ...(this.options.capabilitiesForGoal ? { capabilities: this.options.capabilitiesForGoal(projection) } : {}),
          ...(this.options.writeScopesForGoal ? { writeScopes: this.options.writeScopesForGoal(projection) } : {}),
          ...(remainingDeliveryQuota !== undefined ? { remainingDeliveryQuota } : {}),
        });
        decisions.push(decision);
        if (decision.status === 'eligible' && this.options.onEligible) {
          try {
            await this.options.onEligible(decision, projection);
            launched += 1;
          } catch {
            status = 'degraded';
            errorCode ??= 'GOAL_MONITOR_LAUNCH_FAILED';
            skipped += 1;
          }
        }
      } catch {
        status = 'degraded';
        errorCode ??= 'GOAL_MONITOR_PROJECTION_FAILED';
        skipped += 1;
      }
    }
    return {
      schemaVersion: 'ready4vibe_goal_recovery_monitor_v1',
      status,
      reconciliation,
      decisions,
      projectedGoals,
      launched,
      skipped,
      ...(errorCode ? { errorCode } : {}),
    };
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.schedule());
    }, this.intervalMs);
  }
}
