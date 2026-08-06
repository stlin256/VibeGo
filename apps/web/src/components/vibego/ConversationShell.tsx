import type { FormEvent, JSX, RefObject } from 'react';
import type { PermissionProfileRunSnapshot, RunProfile, RunSnapshot, StoredEvent } from '../../api.js';
import { Button, Textarea } from '../ui/index.js';
import { ApprovalCard, type ApprovalReviewPresentation } from './ApprovalCard.js';
import { RecoveryCard } from './RecoveryCard.js';

export interface ConversationCopy {
  readonly title: string;
  readonly hint: string;
  readonly newMessage: string;
  readonly inputLabel: string;
  readonly inputPlaceholder: string;
  readonly startRun: string;
  readonly readyTitle: string;
  readonly readyDescription: string;
  readonly untrustedPolicy: string;
  readonly trustedPolicy: string;
  readonly conversationEyebrow: string;
  readonly conversationStream: string;
  readonly conversationTimeline: string;
  readonly runConsole: string;
  readonly waitingOutput: string;
  readonly cancelRun: string;
  readonly timeline: string;
  readonly metricQueue: string;
  readonly metricActive: string;
  readonly metricLease: string;
  readonly metricEvents: string;
  readonly recoveryEyebrow: string;
  readonly recoveryTitle: string;
  readonly recoveryDescription: string;
  readonly recoveryAction: string;
  readonly approvalEyebrow: string;
  readonly approvalMeta: string;
  readonly approvalSandboxLabel: string;
  readonly approvalNetworkLabel: string;
  readonly approvalImageLabel: string;
  readonly approvalAllowOnce: string;
  readonly approvalAllowAriaLabel: string;
  readonly approvalDeny: string;
  readonly approvalSessionNote: string;
  readonly reviewReviewedLabel: string;
  readonly reviewAskedLabel: string;
  readonly reviewDeniedLabel: string;
  readonly reviewUnavailableLabel: string;
  readonly reviewReviewedDescription: string;
  readonly reviewAskedDescription: string;
  readonly reviewDeniedDescription: string;
  readonly reviewUnavailableDescription: string;
  readonly snapshotEyebrow: string;
  readonly snapshotTitle: string;
  readonly snapshotAriaLabel: string;
  readonly snapshotRequested: string;
  readonly snapshotEffective: string;
  readonly snapshotProfileRevision: string;
  readonly snapshotPolicyRevision: string;
  readonly snapshotScopeLabel: string;
  readonly snapshotBlocked: string;
  readonly snapshotGrantExpiry: string;
  readonly snapshotActive: string;
  readonly snapshotBlockedChip: string;
  readonly reviewerEyebrow: string;
  readonly reviewerOff: string;
  readonly reviewerFrozen: string;
}

export interface ConversationShellProps {
  readonly run?: RunSnapshot | undefined;
  readonly events: readonly StoredEvent[];
  readonly message: string;
  readonly profile: RunProfile;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly copy: ConversationCopy;
  readonly onMessageChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onCancel?: (() => void) | undefined;
  readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined;
  readonly onRetry?: (() => void) | undefined;
}

/** Conversation-first surface; all authority remains in the App callbacks. */
export function ConversationShell({ run, events, message, profile, composerRef, copy, onMessageChange, onSubmit, onCancel, onApprove, onRetry }: ConversationShellProps): JSX.Element {
  return (
    <section className="conversation-column" aria-label={copy.conversationTimeline}>
      <section className="panel conversation-stream" aria-label={copy.conversationStream}>
        <div className="conversation-stream-header"><div><div className="eyebrow">{copy.conversationEyebrow}</div><h1>{copy.title}</h1></div><span className="muted conversation-hint">{copy.hint}</span></div>
        {run ? <RunConsole run={run} events={events} copy={copy} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} /> : <div className="empty-state"><span className="empty-icon">⌁</span><h2>{copy.readyTitle}</h2><p className="muted">{copy.readyDescription}</p></div>}
      </section>
      <section className="panel composer-panel">
        <div className="eyebrow">{copy.newMessage}</div>
        <form onSubmit={onSubmit}>
          <Textarea ref={composerRef} aria-label={copy.inputLabel} value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder={copy.inputPlaceholder} rows={3} />
          <div className="composer-footer"><span className="muted">{profile.taskTrust === 'untrusted-content' ? copy.untrustedPolicy : copy.trustedPolicy}</span><Button type="submit">{copy.startRun}</Button></div>
        </form>
      </section>
    </section>
  );
}

const MAX_TOOL_OUTPUT_CARDS = 24;
const MAX_TOOL_OUTPUT_DISPLAY_BYTES = 128 * 1024;

interface ToolOutputView {
  readonly seq: number;
  readonly callId: string;
  readonly toolId: string;
  readonly bytes: number;
  readonly truncated: boolean;
  readonly content: string;
}

function ToolOutputInspector({ events }: { readonly events: readonly StoredEvent[] }): JSX.Element | null {
  const outputs = collectToolOutputs(events);
  if (outputs.length === 0) return null;
  return <section className="tool-output-list" aria-label="Tool outputs"><div className="eyebrow">TOOL OUTPUTS</div>{outputs.map((output) => <details className="tool-output-card" key={`${output.seq}-${output.callId}`}><summary><span>{output.toolId}</span><span>{output.bytes} bytes{output.truncated ? ' · server truncated' : ''}{output.content.length < output.bytes ? ' · display truncated' : ''}</span></summary><pre>{output.content}</pre></details>)}</section>;
}

function collectToolOutputs(events: readonly StoredEvent[]): ToolOutputView[] {
  const toolIds = new Map<string, string>();
  const outputs: ToolOutputView[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const callId = typeof payload.callId === 'string' ? payload.callId : undefined;
    const toolId = typeof payload.toolId === 'string' ? payload.toolId : undefined;
    if ((event.type === 'tool.requested' || event.type === 'tool.started') && callId && toolId) toolIds.set(callId, toolId);
    if (event.type !== 'tool.output' || !callId || typeof payload.content !== 'string') continue;
    const rawBytes = payload.bytes;
    const bytes = typeof rawBytes === 'number' && Number.isSafeInteger(rawBytes) && rawBytes >= 0 ? rawBytes : new TextEncoder().encode(payload.content).byteLength;
    const truncated = payload.truncated === true;
    outputs.push({ seq: event.seq, callId, toolId: toolIds.get(callId) ?? toolId ?? 'Tool output', bytes, truncated, content: truncateToolOutput(formatToolOutput(payload.content)) });
  }
  return outputs.slice(-MAX_TOOL_OUTPUT_CARDS);
}

function formatToolOutput(content: string): string {
  try {
    const parsed: unknown = JSON.parse(content);
    const record = asRecord(parsed);
    if (record && (typeof record.stdout === 'string' || typeof record.stderr === 'string')) {
      const sections: string[] = [];
      if (typeof record.stdout === 'string' && record.stdout.length > 0) sections.push(record.stdout);
      if (typeof record.stderr === 'string' && record.stderr.length > 0) sections.push(`[stderr]\n${record.stderr}`);
      if (typeof record.exitCode === 'number') sections.push(`[exit code: ${record.exitCode}]`);
      return sections.join('\n');
    }
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2) ?? content;
  } catch {
    return content;
  }
}

function truncateToolOutput(value: string): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= MAX_TOOL_OUTPUT_DISPLAY_BYTES) return value;
  return `${new TextDecoder().decode(encoded.slice(0, MAX_TOOL_OUTPUT_DISPLAY_BYTES))}\n…[display truncated]`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function RunConsole({ run, events, copy, onCancel, onApprove, onRetry }: { readonly run: RunSnapshot; readonly events: readonly StoredEvent[]; readonly copy: ConversationCopy; readonly onCancel?: (() => void) | undefined; readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; readonly onRetry?: (() => void) | undefined }): JSX.Element {
  return <>
    {run.permissionSnapshot && <PermissionSnapshotSummary snapshot={run.permissionSnapshot} copy={copy} />}
    <RunConsoleContent run={run} events={events} copy={copy} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} />
  </>;
}

function PermissionSnapshotSummary({ snapshot, copy }: { readonly snapshot: PermissionProfileRunSnapshot; readonly copy: ConversationCopy }): JSX.Element {
  const effective = snapshot.effectiveProfile;
  const scope = snapshot.effectiveScope;
  const statusLabel = snapshot.status === 'ready' ? copy.snapshotActive : snapshot.status;
  return <section className="permission-snapshot-summary" data-status={snapshot.status} aria-label={copy.snapshotAriaLabel}>
    <div className="permission-snapshot-heading"><div><div className="eyebrow">{copy.snapshotEyebrow}</div><strong>{copy.snapshotTitle}</strong></div><span className="status-chip" data-status={snapshot.status}>{statusLabel}</span></div>
    <div className="permission-snapshot-grid"><div><span>{copy.snapshotRequested}</span><strong>{snapshot.requestedProfile.profileId}</strong></div><div><span>{copy.snapshotEffective}</span><strong>{effective?.profileId ?? copy.snapshotBlockedChip}</strong></div><div><span>{copy.snapshotProfileRevision}</span><strong>{snapshot.profileRevision}</strong></div><div><span>{copy.snapshotPolicyRevision}</span><strong>{snapshot.policyRevision}</strong></div></div>
    {effective && <p className="muted">{copy.snapshotScopeLabel}: {effective.filesystemScope} · process {effective.processScope} · network {effective.networkMode} · posture {scope?.approvalPosture ?? effective.approvalPosture}</p>}
    {!effective && <p className="permission-snapshot-blocked">{copy.snapshotBlocked.replace('{reason}', snapshot.reasonCode)}</p>}
    {snapshot.grantExpiresAt && <p className="muted">{copy.snapshotGrantExpiry}: {formatSnapshotTimestamp(snapshot.grantExpiresAt)}</p>}
  </section>;
}

function formatSnapshotTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'not set';
}

function RunConsoleContent({ run, events, copy, onCancel, onApprove, onRetry }: { readonly run: RunSnapshot; readonly events: readonly StoredEvent[]; readonly copy: ConversationCopy; readonly onCancel?: (() => void) | undefined; readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; readonly onRetry?: (() => void) | undefined }): JSX.Element {
  const streaming = !['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(run.status);
  return <section className="panel run-panel"><div className="run-header"><div><div className="eyebrow">{copy.runConsole}</div><h2>{run.runId}</h2></div><div className="status-chip" data-status={run.status}>{run.status}</div></div>{run.approvalReviewerSnapshot && <ReviewerRunSummary snapshot={run.approvalReviewerSnapshot} copy={copy} />}<div className="run-metrics"><div><span>{copy.metricQueue}</span><strong>{run.scheduler.queuePosition ?? '—'}</strong></div><div><span>{copy.metricActive}</span><strong>{run.scheduler.activeRunCount}</strong></div><div><span>{copy.metricLease}</span><strong>{run.scheduler.workspaceLease ?? '—'}</strong></div><div><span>{copy.metricEvents}</span><strong>{run.lastEventSeq}</strong></div></div>{run.status === 'needs-recovery' && <RecoveryCard copy={{ eyebrow: copy.recoveryEyebrow, title: copy.recoveryTitle, description: copy.recoveryDescription, action: copy.recoveryAction }} onRetry={onRetry} />}{run.status !== 'needs-recovery' && (run.approvals ?? []).map((approval) => <ApprovalCard key={approval.approvalId} approval={approval} sandboxMode={run.config.sandbox?.mode ?? 'unknown'} onApprove={onApprove} reviewStatus={reviewStatusForApproval(approval, events)} copy={{ eyebrow: copy.approvalEyebrow, meta: copy.approvalMeta, sandboxLabel: copy.approvalSandboxLabel, networkLabel: copy.approvalNetworkLabel, imageLabel: copy.approvalImageLabel, allowOnce: copy.approvalAllowOnce, allowAriaLabel: copy.approvalAllowAriaLabel, deny: copy.approvalDeny, sessionNote: copy.approvalSessionNote, reviewReviewedLabel: copy.reviewReviewedLabel, reviewAskedLabel: copy.reviewAskedLabel, reviewDeniedLabel: copy.reviewDeniedLabel, reviewUnavailableLabel: copy.reviewUnavailableLabel, reviewReviewedDescription: copy.reviewReviewedDescription, reviewAskedDescription: copy.reviewAskedDescription, reviewDeniedDescription: copy.reviewDeniedDescription, reviewUnavailableDescription: copy.reviewUnavailableDescription }} />)}<ToolOutputInspector events={events} /><pre className="output-view" aria-busy={streaming}>{run.output || copy.waitingOutput}{streaming && <span className="stream-cursor" aria-hidden="true" />}</pre><div className="event-list" aria-label={copy.timeline}>{events.map((event) => <div className="event-row" data-event-type={event.type} key={`${event.runId}-${event.seq}`}><span>{event.seq}</span><span>{timelineEventLabel(event)}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div>)}</div>{streaming && <Button variant="destructive" className="cancel-button" onClick={onCancel}>{copy.cancelRun}</Button>}</section>;
}

function ReviewerRunSummary({ snapshot, copy }: { readonly snapshot: NonNullable<RunSnapshot['approvalReviewerSnapshot']>; readonly copy: ConversationCopy }): JSX.Element {
  const state = snapshot.status === 'disabled' || snapshot.posture === 'off' ? 'disabled' : snapshot.status;
  return <div className="reviewer-run-summary" data-status={state} role="status"><span className="eyebrow">{copy.reviewerEyebrow}</span><strong>{state === 'disabled' ? copy.reviewerOff : `${snapshot.reviewerSource} · ${snapshot.posture}`}</strong><span className="muted">{copy.reviewerFrozen.replace('{rev}', String(snapshot.reviewerRevision)).replace('{policy}', String(snapshot.policyRevision))}</span></div>;
}

function reviewStatusForApproval(approval: { readonly approvalId: string; readonly callId: string }, events: readonly StoredEvent[]): ApprovalReviewPresentation | undefined {
  const matching = events.filter((event) => {
    if (!event.type.startsWith('review.')) return false;
    const payload = asRecord(event.payload);
    if (!payload) return false;
    return payload.approvalId === approval.approvalId || payload.correlationId === approval.callId || payload.callId === approval.callId;
  });
  const latest = matching.at(-1);
  if (!latest) return undefined;
  const payload = asRecord(latest.payload);
  const reasonCode = safeReviewReasonCode(payload?.reasonCode);
  const latencyMs = payload && typeof payload.latencyMs === 'number' && Number.isSafeInteger(payload.latencyMs) && payload.latencyMs >= 0 && payload.latencyMs <= 120_000 ? payload.latencyMs : undefined;
  if (latest.type === 'review.unavailable') return { state: 'review-unavailable', ...(reasonCode ? { reasonCode } : {}), ...(latencyMs === undefined ? {} : { latencyMs }) };
  if (latest.type === 'review.completed') {
    const decision = payload?.decision;
    if (decision === 'allow') return { state: 'reviewed', ...(reasonCode ? { reasonCode } : {}), ...(latencyMs === undefined ? {} : { latencyMs }) };
    if (decision === 'deny') return { state: 'denied', ...(reasonCode ? { reasonCode } : {}), ...(latencyMs === undefined ? {} : { latencyMs }) };
    return { state: 'asked', ...(reasonCode ? { reasonCode } : {}), ...(latencyMs === undefined ? {} : { latencyMs }) };
  }
  return { state: 'asked', ...(reasonCode ? { reasonCode } : {}), ...(latencyMs === undefined ? {} : { latencyMs }) };
}

const SAFE_REVIEW_REASON_CODES = new Set([
  'eligible', 'reviewer-disabled', 'ineligible-risk', 'ineligible-trust',
  'ineligible-sandbox', 'policy-denied', 'policy-ask', 'provider-unavailable',
  'dedicated-profile-missing', 'timeout', 'cancelled', 'request-too-large',
  'response-too-large', 'malformed-response', 'schema-mismatch',
  'fingerprint-mismatch', 'revision-stale', 'budget-exhausted',
  'review-revoked', 'invalid-request',
]);

function safeReviewReasonCode(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_REVIEW_REASON_CODES.has(value) ? value : undefined;
}

function timelineEventLabel(event: StoredEvent): string {
  if (event.type === 'review.completed') {
    const decision = asRecord(event.payload)?.decision;
    if (decision === 'allow') return 'reviewed';
    if (decision === 'deny') return 'denied';
    return 'asked';
  }
  if (event.type === 'review.unavailable') return 'review-unavailable';
  if (event.type === 'review.requested') return 'asked';
  if (event.type === 'review.revoked') return 'review-unavailable';
  return event.type;
}
