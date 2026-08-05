import type { JSX } from 'react';
import type { AuditEventsResponse, GoalMutationResponse, GoalPreflightResult, GoalProjectionListResponse, HealthResponse, UsageSummary } from '../../api.js';
import { GoalProjectionPanel } from '../../GoalProjectionPanel.js';
import { ObservabilityPanel } from '../../ObservabilityPanel.js';
import { Card } from '../ui/index.js';

export interface ContextRailCopy {
  readonly ariaLabel: string;
  readonly connectionEyebrow: string;
  readonly connectionTitle: string;
  readonly description: string;
  readonly transport: string;
  readonly tls: string;
  readonly sandbox: string;
  readonly safetyTitle: string;
  readonly guardrails: readonly string[];
}

export interface ContextRailProps {
  readonly goalProjection?: GoalProjectionListResponse | undefined;
  readonly goalProjectionLoading: boolean;
  readonly goalProjectionUnavailable: boolean;
  readonly goalProjectionRefreshing: boolean;
  readonly onRefreshGoalProjection?: (() => Promise<void> | void) | undefined;
  readonly onCreateGoal?: (input: { title: string; objective: string; workspaceId?: string }) => Promise<GoalMutationResponse> | void;
  readonly onAddTodo?: (goalId: string, input: { expectedRevision: number; title: string }) => Promise<GoalMutationResponse> | void;
  readonly onOpenGate?: (goalId: string, input: { expectedRevision: number; question: string }) => Promise<GoalMutationResponse> | void;
  readonly onResolveGate?: (goalId: string, gateId: string, input: { expectedRevision: number; status: 'approved' | 'rejected' | 'deferred' | 'expired' }) => Promise<GoalMutationResponse> | void;
  readonly onAttachEvidence?: (goalId: string, input: { expectedRevision: number; summary: string }) => Promise<GoalMutationResponse> | void;
  readonly onPreflight?: (goalId: string, todoId: string, expectedRevision: number) => Promise<GoalPreflightResult>;
  readonly usageSummary?: UsageSummary | undefined;
  readonly auditEvents?: AuditEventsResponse | undefined;
  readonly observabilityLoading: boolean;
  readonly observabilityUnavailable: boolean;
  readonly observabilityRefreshing: boolean;
  readonly onRefreshObservability?: (() => Promise<void> | void) | undefined;
  readonly health?: HealthResponse | undefined;
  readonly copy: ContextRailCopy;
  readonly open: boolean;
}

/** Read-only context rail; all data fetching stays in RuntimeApp/ApiClient. */
export function ContextRail({ goalProjection, goalProjectionLoading, goalProjectionUnavailable, goalProjectionRefreshing, onRefreshGoalProjection, onCreateGoal, onAddTodo, onOpenGate, onResolveGate, onAttachEvidence, onPreflight, usageSummary, auditEvents, observabilityLoading, observabilityUnavailable, observabilityRefreshing, onRefreshObservability, health, copy, open }: ContextRailProps): JSX.Element {
  return (
    <aside className="context-rail" data-open={open} aria-label={copy.ariaLabel}>
      <GoalProjectionPanel {...(goalProjection ? { projection: goalProjection } : {})} loading={goalProjectionLoading} unavailable={goalProjectionUnavailable} refreshing={goalProjectionRefreshing} {...(onRefreshGoalProjection ? { onRefresh: onRefreshGoalProjection } : {})} {...(onCreateGoal ? { onCreateGoal } : {})} {...(onAddTodo ? { onAddTodo } : {})} {...(onOpenGate ? { onOpenGate } : {})} {...(onResolveGate ? { onResolveGate } : {})} {...(onAttachEvidence ? { onAttachEvidence } : {})} {...(onPreflight ? { onPreflight } : {})} />
      <ObservabilityPanel {...(usageSummary ? { summary: usageSummary } : {})} {...(auditEvents ? { audit: auditEvents } : {})} loading={observabilityLoading} unavailable={observabilityUnavailable} refreshing={observabilityRefreshing} {...(onRefreshObservability ? { onRefresh: onRefreshObservability } : {})} />
      <Card className="panel connection-panel">
        <div className="eyebrow">{copy.connectionEyebrow}</div>
        <h2>{copy.connectionTitle}</h2>
        <p className="muted">{copy.description}</p>
        {health ? <dl className="summary-list"><div><dt>{copy.transport}</dt><dd>{health.transport.kind}</dd></div><div><dt>{copy.tls}</dt><dd>{health.transport.tlsRequired ? 'required' : 'off'}</dd></div><div><dt>{copy.sandbox}</dt><dd>{health.sandbox.availableModes.join(' · ')}</dd></div></dl> : <p className="muted">正在读取 daemon 状态…</p>}
      </Card>
      <Card className="panel safety-panel"><div className="eyebrow">{copy.safetyTitle}</div><ul>{copy.guardrails.map((item) => <li key={item}>{item}</li>)}</ul></Card>
    </aside>
  );
}
