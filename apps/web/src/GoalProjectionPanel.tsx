import type { JSX } from 'react';
import type { GoalProjectionListResponse, SafeGoalProjection, SafeGoalTodo } from './api.js';

const MAX_VISIBLE_TODOS = 12;
const MAX_VISIBLE_GATES = 8;
const MAX_VISIBLE_EVIDENCE = 8;

export interface GoalProjectionPanelProps {
  projection?: GoalProjectionListResponse;
  loading?: boolean;
  unavailable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
}

/**
 * Presentation-only Goal Control surface. It intentionally has no mutation
 * callbacks: Goal creation, claiming and Gate resolution belong to a later
 * authenticated application-service slice.
 */
export function GoalProjectionPanel({ projection, loading = false, unavailable = false, refreshing = false, onRefresh }: GoalProjectionPanelProps): JSX.Element {
  if (loading && projection === undefined) {
    return <section className="panel goal-panel" data-state="loading" aria-label="Goal control"><GoalPanelHeader refreshing={false} onRefresh={onRefresh} /><div className="goal-loading" aria-live="polite"><span className="goal-skeleton" aria-hidden="true" /><p>Loading goal projection…</p></div></section>;
  }

  if (unavailable || projection === undefined) {
    return <section className="panel goal-panel" data-state="unavailable" aria-label="Goal control"><GoalPanelHeader refreshing={refreshing} onRefresh={onRefresh} /><div className="goal-state" role="status"><span className="empty-icon" aria-hidden="true">?</span><h3>Goal projection unavailable</h3><p className="muted">The daemon did not provide a safe read-only projection. Interactive runs remain available.</p><RefreshButton refreshing={refreshing} onRefresh={onRefresh} /></div></section>;
  }

  if (projection.goals.length === 0) {
    return <section className="panel goal-panel" data-state="empty" aria-label="Goal control"><GoalPanelHeader refreshing={refreshing} onRefresh={onRefresh} /><div className="goal-state" role="status"><span className="empty-icon" aria-hidden="true">◎</span><h3>No long-term goals yet</h3><p className="muted">This read-only view will show goals after a protected Goal API creates one.</p><RefreshButton refreshing={refreshing} onRefresh={onRefresh} /></div></section>;
  }

  return <section className="panel goal-panel" data-state="ready" aria-label="Goal control"><GoalPanelHeader refreshing={refreshing} onRefresh={onRefresh} /><div className="goal-list">{projection.goals.map((goal) => <GoalCard key={goal.goal?.goalId ?? goal.sourceChecksum} projection={goal} />)}</div></section>;
}

function GoalPanelHeader({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: (() => void | Promise<void>) | undefined }): JSX.Element {
  return <div className="goal-panel-header"><div><div className="eyebrow">GOAL CONTROL · READ ONLY</div><h2>Long-term goals</h2><p className="muted">A compact projection of Todo, Gate, evidence and quota state.</p></div><RefreshButton refreshing={refreshing} onRefresh={onRefresh} /></div>;
}

function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: (() => void | Promise<void>) | undefined }): JSX.Element {
  return <button className="goal-refresh" type="button" disabled={refreshing || onRefresh === undefined} onClick={() => { void onRefresh?.(); }}>{refreshing ? 'Refreshing…' : 'Refresh goals'}</button>;
}

function GoalCard({ projection }: { projection: SafeGoalProjection }): JSX.Element {
  const goal = projection.goal;
  const todos = projection.todos.slice(0, MAX_VISIBLE_TODOS);
  const gates = projection.gates.slice(0, MAX_VISIBLE_GATES);
  const evidence = projection.evidence.slice(0, MAX_VISIBLE_EVIDENCE);
  const completedTodos = projection.todos.filter((todo) => todo.status === 'done').length;
  const blockingGates = projection.gates.filter((gate) => gate.blocking && gate.status === 'open').length;
  return <article className="goal-card"><header className="goal-card-header"><div><div className="goal-id-row"><span className="status-chip" data-status={goal?.status ?? 'unknown'}>{goal?.status ?? 'unknown'}</span>{goal?.goalId && <code>{safeText(goal.goalId, 128)}</code>}</div><h3>{safeText(goal?.title ?? 'Untitled goal', 200)}</h3></div></header>{goal?.objective && <p className="goal-objective">{safeText(goal.objective, 600)}</p>}{goal?.workspaceId && <p className="muted goal-workspace">Workspace: {safeText(goal.workspaceId, 64)}</p>}<div className="goal-metrics"><div><span>Todo</span><strong>{completedTodos}/{projection.todos.length}</strong></div><div><span>Blocking gates</span><strong>{blockingGates}</strong></div><div><span>Evidence</span><strong>{projection.evidence.length}</strong></div><div><span>Quota spend</span><strong>{projection.quota.totalSpent}</strong></div></div><GoalTodoList todos={todos} hiddenCount={projection.todos.length - todos.length} /><GoalGateList gates={gates} hiddenCount={projection.gates.length - gates.length} /><GoalEvidenceList evidence={evidence} hiddenCount={projection.evidence.length - evidence.length} /><footer className="goal-meta"><span>revision {projection.controlRevision}</span><span>events {projection.sourceEventCount}</span><span>checksum <code>{safeText(projection.sourceChecksum.slice(0, 12), 12)}…</code></span></footer></article>;
}

function GoalTodoList({ todos, hiddenCount }: { todos: readonly SafeGoalTodo[]; hiddenCount: number }): JSX.Element | null {
  if (todos.length === 0) return null;
  return <section className="goal-subsection"><h4>Todo</h4><ul className="goal-item-list">{todos.map((todo) => <li key={todo.todoId}><span className="goal-item-main"><strong>{safeText(todo.title, 400)}</strong><span className="muted">{todo.status} · {todo.taskClass}</span></span>{todo.claimedBy && <span className="goal-item-owner">{safeText(todo.claimedBy, 128)}</span>}</li>)}</ul>{hiddenCount > 0 && <p className="muted goal-more">+{hiddenCount} more Todo items</p>}</section>;
}

function GoalGateList({ gates, hiddenCount }: { gates: SafeGoalProjection['gates']; hiddenCount: number }): JSX.Element | null {
  if (gates.length === 0) return null;
  return <section className="goal-subsection"><h4>Gates</h4><ul className="goal-item-list">{gates.map((gate) => <li key={gate.gateId}><span className="goal-item-main"><strong>{safeText(gate.question, 1_000)}</strong><span className="muted">{gate.status}{gate.blocking ? ' · blocking' : ''}</span></span></li>)}</ul>{hiddenCount > 0 && <p className="muted goal-more">+{hiddenCount} more gates</p>}</section>;
}

function GoalEvidenceList({ evidence, hiddenCount }: { evidence: SafeGoalProjection['evidence']; hiddenCount: number }): JSX.Element | null {
  if (evidence.length === 0) return null;
  return <section className="goal-subsection"><h4>Recent evidence</h4><ul className="goal-item-list">{evidence.map((item) => <li key={item.evidenceId}><span className="goal-item-main"><strong>{safeText(item.summary, 2_000)}</strong><span className="muted">{item.status} · {item.kind} · {formatDate(item.recordedAt)}</span></span></li>)}</ul>{hiddenCount > 0 && <p className="muted goal-more">+{hiddenCount} more evidence items</p>}</section>;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'date unavailable' : parsed.toLocaleDateString();
}

/** Keep the renderer defensive even if a future API accidentally widens text. */
function safeText(value: string, max: number): string {
  const bounded = value.slice(0, max);
  return bounded
    .replace(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token)\s*[:=]\s*[^\s,;]+/giu, '[redacted secret]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[redacted secret]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"']+/gu, '[redacted path]')
    .replace(/(?:^|\s)\/(?:Users|home|private|tmp|var|workspace)(?:[^\s<>"']*)/giu, ' [redacted path]');
}
