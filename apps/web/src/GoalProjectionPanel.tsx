import { useState, type JSX } from 'react';
import type { GoalMutationResponse, GoalPreflightResult, GoalProjectionListResponse, SafeGoalProjection, SafeGoalTodo } from './api.js';

const MAX_VISIBLE_TODOS = 12;
const MAX_VISIBLE_GATES = 8;
const MAX_VISIBLE_EVIDENCE = 8;

type GoalMutation = (input: { expectedRevision: number; title?: string; objective?: string; question?: string; summary?: string; status?: 'approved' | 'rejected' | 'deferred' | 'expired' }) => Promise<GoalMutationResponse> | void;

export interface GoalProjectionPanelProps {
  projection?: GoalProjectionListResponse;
  loading?: boolean;
  unavailable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  onCreateGoal?: (input: { title: string; objective: string; workspaceId?: string }) => Promise<GoalMutationResponse> | void;
  onAddTodo?: (goalId: string, input: { expectedRevision: number; title: string }) => Promise<GoalMutationResponse> | void;
  onOpenGate?: (goalId: string, input: { expectedRevision: number; question: string }) => Promise<GoalMutationResponse> | void;
  onResolveGate?: (goalId: string, gateId: string, input: { expectedRevision: number; status: 'approved' | 'rejected' | 'deferred' | 'expired' }) => Promise<GoalMutationResponse> | void;
  onAttachEvidence?: (goalId: string, input: { expectedRevision: number; summary: string }) => Promise<GoalMutationResponse> | void;
  onPreflight?: (goalId: string, todoId: string, expectedRevision: number) => Promise<GoalPreflightResult>;
}

/**
 * Goal Control surface. Reads remain bounded projections; mutations are
 * optional callbacks supplied by the authenticated RuntimeApp boundary.
 */
export function GoalProjectionPanel({ projection, loading = false, unavailable = false, refreshing = false, onRefresh, onCreateGoal, onAddTodo, onOpenGate, onResolveGate, onAttachEvidence, onPreflight }: GoalProjectionPanelProps): JSX.Element {
  const [createError, setCreateError] = useState<string>();
  const [createBusy, setCreateBusy] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalObjective, setGoalObjective] = useState('');

  if (loading && projection === undefined) {
    return <section className="panel goal-panel" data-state="loading" aria-label="Goal control"><GoalPanelHeader refreshing={false} onRefresh={onRefresh} editable={Boolean(onCreateGoal || onAddTodo || onOpenGate)} /><div className="goal-loading" aria-live="polite"><span className="goal-skeleton" aria-hidden="true" /><p>Loading goal projection…</p></div></section>;
  }

  if (unavailable || projection === undefined) {
    return <section className="panel goal-panel" data-state="unavailable" aria-label="Goal control"><GoalPanelHeader refreshing={refreshing} onRefresh={onRefresh} editable={Boolean(onCreateGoal || onAddTodo || onOpenGate)} /><div className="goal-state" role="status"><span className="empty-icon" aria-hidden="true">?</span><h3>Goal projection unavailable</h3><p className="muted">The daemon did not provide a safe projection. Interactive runs remain available.</p><RefreshButton refreshing={refreshing} onRefresh={onRefresh} /></div></section>;
  }

  if (projection.goals.length === 0) {
    return <section className="panel goal-panel" data-state="empty" aria-label="Goal control"><GoalPanelHeader refreshing={refreshing} onRefresh={onRefresh} editable={Boolean(onCreateGoal || onAddTodo || onOpenGate)} /><div className="goal-state" role="status"><span className="empty-icon" aria-hidden="true">◎</span><h3>No long-term goals yet</h3><p className="muted">Create a Goal to keep remote work observable and resumable.</p><RefreshButton refreshing={refreshing} onRefresh={onRefresh} />{onCreateGoal && <form className="goal-editor goal-create-form" onSubmit={(event) => { event.preventDefault(); if (!goalTitle.trim() || !goalObjective.trim()) return; setCreateBusy(true); setCreateError(undefined); Promise.resolve(onCreateGoal({ title: goalTitle.trim(), objective: goalObjective.trim() })).then(async () => { setGoalTitle(''); setGoalObjective(''); await onRefresh?.(); }).catch((error: unknown) => setCreateError(safeError(error))).finally(() => setCreateBusy(false)); }}><label>Goal title<input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} maxLength={200} required /></label><label>Objective<textarea value={goalObjective} onChange={(event) => setGoalObjective(event.target.value)} maxLength={4_000} required /></label><button type="submit" disabled={createBusy || !goalTitle.trim() || !goalObjective.trim()}>{createBusy ? 'Creating…' : 'Create goal'}</button>{createError && <p className="goal-error" role="alert">{createError}</p>}</form>}</div></section>;
  }

  return <section className="panel goal-panel" data-state="ready" aria-label="Goal control"><GoalPanelHeader refreshing={refreshing} onRefresh={onRefresh} editable={Boolean(onCreateGoal || onAddTodo || onOpenGate)} /><div className="goal-list">{projection.goals.map((goal) => <GoalCard key={goal.goal?.goalId ?? goal.sourceChecksum} projection={goal} onAddTodo={onAddTodo} onOpenGate={onOpenGate} onResolveGate={onResolveGate} onAttachEvidence={onAttachEvidence} onPreflight={onPreflight} onRefresh={onRefresh} />)}</div></section>;
}

function GoalPanelHeader({ refreshing, onRefresh, editable }: { refreshing: boolean; onRefresh: (() => void | Promise<void>) | undefined; editable: boolean }): JSX.Element {
  return <div className="goal-panel-header"><div><div className="eyebrow">GOAL CONTROL {editable ? '· MANAGE' : '· READ ONLY'}</div><h2>Long-term goals</h2><p className="muted">A compact projection of Todo, Gate, evidence and quota state.</p></div><RefreshButton refreshing={refreshing} onRefresh={onRefresh} /></div>;
}

function RefreshButton({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: (() => void | Promise<void>) | undefined }): JSX.Element {
  return <button className="goal-refresh" type="button" disabled={refreshing || onRefresh === undefined} onClick={() => { void onRefresh?.(); }}>{refreshing ? 'Refreshing…' : 'Refresh goals'}</button>;
}

function GoalCard({ projection, onAddTodo, onOpenGate, onResolveGate, onAttachEvidence, onPreflight, onRefresh }: { projection: SafeGoalProjection; onAddTodo?: GoalProjectionPanelProps['onAddTodo']; onOpenGate?: GoalProjectionPanelProps['onOpenGate']; onResolveGate?: GoalProjectionPanelProps['onResolveGate']; onAttachEvidence?: GoalProjectionPanelProps['onAttachEvidence']; onPreflight?: GoalProjectionPanelProps['onPreflight']; onRefresh?: GoalProjectionPanelProps['onRefresh'] }): JSX.Element {
  const goal = projection.goal;
  const todos = projection.todos.slice(0, MAX_VISIBLE_TODOS);
  const gates = projection.gates.slice(0, MAX_VISIBLE_GATES);
  const evidence = projection.evidence.slice(0, MAX_VISIBLE_EVIDENCE);
  const completedTodos = projection.todos.filter((todo) => todo.status === 'done').length;
  const todoTotal = projection.todos.length;
  const todoPct = todoTotal === 0 ? 0 : Math.round((completedTodos / todoTotal) * 100);
  const blockingGates = projection.gates.filter((gate) => gate.blocking && gate.status === 'open').length;
  const [todoTitle, setTodoTitle] = useState('');
  const [gateQuestion, setGateQuestion] = useState('');
  const [evidenceSummary, setEvidenceSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [preflight, setPreflight] = useState<GoalPreflightResult>();
  const goalId = goal?.goalId;
  const revision = projection.controlRevision;
  const resolveGateHandler = goalId && onResolveGate
    ? (gateId: string, status: 'approved' | 'rejected' | 'deferred' | 'expired') => invoke(() => onResolveGate(goalId, gateId, { expectedRevision: revision, status }))
    : undefined;

  const invoke = async (action: (() => Promise<unknown> | void), after?: () => void): Promise<void> => {
    setBusy(true); setError(undefined);
    try { await action(); after?.(); await onRefresh?.(); }
    catch (reason) { setError(safeError(reason)); }
    finally { setBusy(false); }
  };

  return <article className="goal-card"><header className="goal-card-header"><div><div className="goal-id-row"><span className="status-chip" data-status={goal?.status ?? 'unknown'}>{goal?.status ?? 'unknown'}</span>{goal?.goalId && <code>{safeText(goal.goalId, 128)}</code>}</div><h3>{safeText(goal?.title ?? 'Untitled goal', 200)}</h3></div></header>{goal?.objective && <p className="goal-objective">{safeText(goal.objective, 600)}</p>}{goal?.workspaceId && <p className="muted goal-workspace">Workspace: {safeText(goal.workspaceId, 64)}</p>}<div className="goal-metrics"><div><span>Todo</span><strong>{completedTodos}/{projection.todos.length}</strong></div><div><span>Blocking gates</span><strong>{blockingGates}</strong></div><div><span>Evidence</span><strong>{projection.evidence.length}</strong></div><div><span>Quota spend</span><strong>{projection.quota.totalSpent}</strong></div></div>{todoTotal > 0 && <div className="goal-progress" role="progressbar" aria-valuenow={todoPct} aria-valuemin={0} aria-valuemax={100} aria-label="Todo completion"><span style={{ width: `${todoPct}%` }} /></div>}<GoalTodoList todos={todos} hiddenCount={projection.todos.length - todos.length} /><GoalGateList gates={gates} hiddenCount={projection.gates.length - gates.length} {...(resolveGateHandler ? { onResolveGate: resolveGateHandler } : {})} /><GoalEvidenceList evidence={evidence} hiddenCount={projection.evidence.length - evidence.length} /><div className="goal-action-row">{onPreflight && goalId && <button type="button" disabled={busy || !projection.todos.some((todo) => (todo.status === 'open' || todo.status === 'deferred') && todo.taskClass !== 'user_action' && todo.taskClass !== 'user_gate')} onClick={() => { const todo = projection.todos.find((candidate) => (candidate.status === 'open' || candidate.status === 'deferred') && candidate.taskClass !== 'user_action' && candidate.taskClass !== 'user_gate'); if (!todo) return; setBusy(true); setError(undefined); void onPreflight(goalId, todo.todoId, revision).then(setPreflight).catch((reason: unknown) => setError(safeError(reason))).finally(() => setBusy(false)); }}>Preview governed run</button>}</div>{preflight && <PreflightCard result={preflight} />}{(onAddTodo || onOpenGate || onAttachEvidence) && goalId && <details className="goal-editor-details"><summary>Manage Goal</summary><div className="goal-editor-grid">{onAddTodo && <form className="goal-editor" onSubmit={(event) => { event.preventDefault(); if (!todoTitle.trim()) return; void invoke(() => onAddTodo(goalId, { expectedRevision: revision, title: todoTitle.trim() }), () => setTodoTitle('')); }}><label>Add Todo<input value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} maxLength={400} required /></label><button type="submit" disabled={busy || !todoTitle.trim()}>Add Todo</button></form>}{onOpenGate && <form className="goal-editor" onSubmit={(event) => { event.preventDefault(); if (!gateQuestion.trim()) return; void invoke(() => onOpenGate(goalId, { expectedRevision: revision, question: gateQuestion.trim() }), () => setGateQuestion('')); }}><label>Open blocking Gate<input value={gateQuestion} onChange={(event) => setGateQuestion(event.target.value)} maxLength={1_000} required /></label><button type="submit" disabled={busy || !gateQuestion.trim()}>Open Gate</button></form>}{onAttachEvidence && <form className="goal-editor" onSubmit={(event) => { event.preventDefault(); if (!evidenceSummary.trim()) return; void invoke(() => onAttachEvidence(goalId, { expectedRevision: revision, summary: evidenceSummary.trim() }), () => setEvidenceSummary('')); }}><label>Attach evidence<input value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} maxLength={2_000} required /></label><button type="submit" disabled={busy || !evidenceSummary.trim()}>Attach evidence</button></form>}</div></details>}{error && <p className="goal-error" role="alert">{error}</p>}<footer className="goal-meta"><span>revision {revision}</span><span>events {projection.sourceEventCount}</span><span>checksum <code>{safeText(projection.sourceChecksum.slice(0, 12), 12)}…</code></span></footer></article>;
}

function GoalTodoList({ todos, hiddenCount }: { todos: readonly SafeGoalTodo[]; hiddenCount: number }): JSX.Element | null {
  if (todos.length === 0) return null;
  return <section className="goal-subsection"><h4>Todo</h4><ul className="goal-item-list">{todos.map((todo) => <li key={todo.todoId} data-status={todo.status}><span className="goal-item-main"><strong>{safeText(todo.title, 400)}</strong><span className="muted">{todo.status} · {todo.taskClass}</span></span>{todo.claimedBy && <span className="goal-item-owner">{safeText(todo.claimedBy, 128)}</span>}</li>)}</ul>{hiddenCount > 0 && <p className="muted goal-more">+{hiddenCount} more Todo items</p>}</section>;
}

function GoalGateList({ gates, hiddenCount, onResolveGate }: { gates: SafeGoalProjection['gates']; hiddenCount: number; onResolveGate?: (gateId: string, status: 'approved' | 'rejected' | 'deferred' | 'expired') => void }): JSX.Element | null {
  if (gates.length === 0) return null;
  return <section className="goal-subsection"><h4>Gates</h4><ul className="goal-item-list">{gates.map((gate) => <li key={gate.gateId}><span className="goal-item-main"><strong>{safeText(gate.question, 1_000)}</strong><span className="muted">{gate.status}{gate.blocking ? ' · blocking' : ''}</span></span>{gate.status === 'open' && onResolveGate && <span className="goal-inline-buttons"><button type="button" onClick={() => onResolveGate(gate.gateId, 'approved')}>Approve</button><button type="button" onClick={() => onResolveGate(gate.gateId, 'rejected')}>Reject</button></span>}</li>)}</ul>{hiddenCount > 0 && <p className="muted goal-more">+{hiddenCount} more gates</p>}</section>;
}

function GoalEvidenceList({ evidence, hiddenCount }: { evidence: SafeGoalProjection['evidence']; hiddenCount: number }): JSX.Element | null {
  if (evidence.length === 0) return null;
  return <section className="goal-subsection"><h4>Recent evidence</h4><ul className="goal-item-list">{evidence.map((item) => <li key={item.evidenceId}><span className="goal-item-main"><strong>{safeText(item.summary, 2_000)}</strong><span className="muted">{item.status} · {item.kind} · {formatDate(item.recordedAt)}</span></span></li>)}</ul>{hiddenCount > 0 && <p className="muted goal-more">+{hiddenCount} more evidence items</p>}</section>;
}

function PreflightCard({ result }: { result: GoalPreflightResult }): JSX.Element {
  return <section className="goal-preflight" aria-label="Governed preflight"><div className="goal-preflight-header"><div><div className="eyebrow">GOVERNED PREFLIGHT</div><strong data-status={result.decision.status}>{result.decision.status}</strong></div><span className="muted">revision {result.controlRevision}</span></div><p className="muted">{safeText(result.decision.reason, 500)}</p><ul className="goal-check-list">{result.checks.map((check) => <li key={check.key}><span className="status-chip" data-status={check.status}>{check.key}</span><span>{safeText(check.reason, 500)}</span></li>)}</ul>{result.decision.status !== 'eligible' && <p className="goal-error">Next step: {safeText(result.decision.nextStep, 64)}</p>}</section>;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'date unavailable' : parsed.toLocaleDateString();
}

function safeText(value: string, max: number): string {
  const bounded = value.slice(0, max);
  return bounded
    .replace(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|password|authorization|cookie|credential|secret|token)\s*[:=]\s*[^\s,;]+/giu, '[redacted secret]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[redacted secret]')
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s<>"']+/gu, '[redacted path]')
    .replace(/(?:^|\s)\/(?:Users|home|private|tmp|var|workspace)(?:[^\s<>"']*)/giu, ' [redacted path]');
}

function safeError(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') return `Request failed · ${reason.code}`;
  return 'Request failed; check the daemon connection.';
}
