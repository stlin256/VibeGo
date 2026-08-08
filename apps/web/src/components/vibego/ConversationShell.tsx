import { useEffect, useState, type FormEvent, type JSX, type KeyboardEvent, type RefObject } from 'react';
import type { CapabilityProfile, ConversationMessage, PermissionProfileRunSnapshot, RunProfile, RunSnapshot, StoredEvent } from '../../api.js';
import { Button, Textarea } from '../ui/index.js';
import { ApprovalCard, type ApprovalReviewPresentation } from './ApprovalCard.js';
import { RecoveryCard } from './RecoveryCard.js';
import { Markdown } from './markdown.js';
import { FileAuditPanel } from './FileAuditPanel.js';

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
  readonly runDetails: string;
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
  readonly quickApproval: string;
  readonly quickSandbox: string;
  readonly quickModel: string;
  readonly approvalOnRequest: string;
  readonly approvalUntrusted: string;
  readonly approvalNever: string;
  readonly sandboxReadOnly: string;
  readonly sandboxWorkspaceWrite: string;
  readonly sandboxExternal: string;
  readonly fileAuditTitle?: string | undefined;
  readonly fileAuditClose?: string | undefined;
  readonly fileAuditEmpty?: string | undefined;
  readonly fileAuditContentLabel?: string | undefined;
}

export interface ConversationShellProps {
  readonly run?: RunSnapshot | undefined;
  readonly events: readonly StoredEvent[];
  /** Past exchanges of the active conversation, rendered above the live run. */
  readonly thread?: readonly ConversationMessage[] | undefined;
  readonly message: string;
  readonly profile: RunProfile;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly copy: ConversationCopy;
  readonly onMessageChange: (value: string) => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  readonly onProfileChange?: ((patch: Partial<RunProfile>) => void) | undefined;
  readonly onCancel?: (() => void) | undefined;
  readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined;
  readonly onRetry?: (() => void) | undefined;
  /** Daemon-resolved effective capability profile; when provided, composer
   * shortcuts that exceed it are disabled so a run cannot be blocked by the
   * capability gate. `undefined` keeps every option enabled (settings not
   * loaded yet); `null` means the resolution is blocked. */
  readonly capabilityProfile?: CapabilityProfile | null | undefined;
}

const QUICK_MODEL_PRESETS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'] as const;

/** Enter submits the composer; Shift+Enter and IME composition insert a newline. */
export function isComposerSubmitShortcut(event: { readonly key: string; readonly shiftKey: boolean; readonly isComposing?: boolean }): boolean {
  return event.key === 'Enter' && !event.shiftKey && event.isComposing !== true;
}

function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (!isComposerSubmitShortcut({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

/** Conversation-first surface; all authority remains in the App callbacks. */
export function ConversationShell({ run, events, thread = [], message, profile, composerRef, copy, onMessageChange, onSubmit, onProfileChange, onCancel, onApprove, onRetry, capabilityProfile }: ConversationShellProps): JSX.Element {
  const [auditPath, setAuditPath] = useState<string | undefined>(undefined);
  const runId = run?.runId;
  useEffect(() => { setAuditPath(undefined); }, [runId]);
  const approval = typeof profile.approval === 'string' ? profile.approval : 'on-request';
  const sandboxMode = profile.sandbox.mode;
  const workspaceWriteEnabled = capabilityProfile === undefined || capabilityProfile?.filesystemMode === 'workspace-write';
  const externalSandboxEnabled = capabilityProfile === undefined || (capabilityProfile !== null && capabilityProfile.shellMode !== 'off');
  const modelOptions = QUICK_MODEL_PRESETS.includes(profile.model.name as (typeof QUICK_MODEL_PRESETS)[number]) ? QUICK_MODEL_PRESETS : [...QUICK_MODEL_PRESETS, profile.model.name];
  const updateSandboxMode = (mode: RunProfile['sandbox']['mode']): void => {
    if (!onProfileChange) return;
    const network = 'network' in profile.sandbox && profile.sandbox.network ? profile.sandbox.network : 'restricted';
    if (mode === 'read-only') onProfileChange({ sandbox: { mode, network } });
    else if (mode === 'workspace-write') onProfileChange({ sandbox: { mode, network, writableRoots: 'writableRoots' in profile.sandbox && profile.sandbox.writableRoots.length > 0 ? profile.sandbox.writableRoots : ['.'] } });
    else onProfileChange({ sandbox: { mode, network, provider: 'provider' in profile.sandbox ? profile.sandbox.provider : 'docker', ...('writableRoots' in profile.sandbox && profile.sandbox.writableRoots ? { writableRoots: profile.sandbox.writableRoots } : {}) } });
  };
  return (
    <section className="conversation-column" aria-label={copy.conversationTimeline}>
      <section className="conversation-stream" aria-label={copy.conversationStream}>
        {thread.map((exchange) => <ThreadExchange key={exchange.runId} exchange={exchange} />)}
        {run ? <RunConsole run={run} events={events} copy={copy} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} onFileRef={setAuditPath} /> : thread.length === 0 ? <div className="empty-state"><h1>{copy.title}</h1><p className="muted">{copy.readyDescription}</p></div> : null}
        <FileAuditPanel path={auditPath} events={events} onClose={() => setAuditPath(undefined)} copy={{ title: copy.fileAuditTitle, close: copy.fileAuditClose, empty: copy.fileAuditEmpty, contentLabel: copy.fileAuditContentLabel }} />
      </section>
      <section className="panel composer-panel">
        <form onSubmit={onSubmit}>
          <Textarea ref={composerRef} aria-label={copy.inputLabel} value={message} onChange={(event) => onMessageChange(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={copy.inputPlaceholder} rows={2} />
          <div className="composer-footer">
            {onProfileChange && <div className="composer-tools">
              <label className="composer-chip"><span>{copy.quickApproval}</span><select aria-label={copy.quickApproval} value={approval} onChange={(event) => onProfileChange({ approval: event.target.value as RunProfile['approval'] })}><option value="on-request">{copy.approvalOnRequest}</option><option value="untrusted">{copy.approvalUntrusted}</option><option value="never">{copy.approvalNever}</option></select></label>
              <label className="composer-chip"><span>{copy.quickSandbox}</span><select aria-label={copy.quickSandbox} value={sandboxMode} onChange={(event) => updateSandboxMode(event.target.value as RunProfile['sandbox']['mode'])}><option value="read-only">{copy.sandboxReadOnly}</option><option value="workspace-write" disabled={!workspaceWriteEnabled}>{copy.sandboxWorkspaceWrite}</option><option value="external-sandbox" disabled={!externalSandboxEnabled}>{copy.sandboxExternal}</option></select></label>
              <label className="composer-chip"><span>{copy.quickModel}</span><select aria-label={copy.quickModel} value={profile.model.name} onChange={(event) => onProfileChange({ model: { ...profile.model, name: event.target.value } })}>{modelOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
            </div>}
            <Button type="submit">{copy.startRun}</Button>
          </div>
        </form>
      </section>
    </section>
  );
}

const MAX_TOOL_OUTPUT_CARDS = 24;
const MAX_TOOL_OUTPUT_DISPLAY_BYTES = 128 * 1024;

/** A completed past exchange of the active conversation, rendered as plain bubbles. */
function ThreadExchange({ exchange }: { readonly exchange: ConversationMessage }): JSX.Element {
  return (
    <div className="chat-thread chat-thread-history" data-status={exchange.status}>
      {exchange.user.length > 0 && <div className="chat-message chat-message-user"><div className="chat-bubble">{exchange.user}</div></div>}
      {exchange.assistant.length > 0 && <div className="chat-message chat-message-assistant"><div className="chat-bubble"><Markdown text={exchange.assistant} /></div></div>}
    </div>
  );
}

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

function RunConsole({ run, events, copy, onCancel, onApprove, onRetry, onFileRef }: { readonly run: RunSnapshot; readonly events: readonly StoredEvent[]; readonly copy: ConversationCopy; readonly onCancel?: (() => void) | undefined; readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; readonly onRetry?: (() => void) | undefined; readonly onFileRef?: ((path: string) => void) | undefined }): JSX.Element {
  return <RunConsoleContent run={run} events={events} copy={copy} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} onFileRef={onFileRef} />;
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

function RunConsoleContent({ run, events, copy, onCancel, onApprove, onRetry, onFileRef }: { readonly run: RunSnapshot; readonly events: readonly StoredEvent[]; readonly copy: ConversationCopy; readonly onCancel?: (() => void) | undefined; readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; readonly onRetry?: (() => void) | undefined; readonly onFileRef?: ((path: string) => void) | undefined }): JSX.Element {
  const streaming = !['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(run.status);
  const snapshotBlocked = run.permissionSnapshot !== undefined && run.permissionSnapshot.status !== 'ready';
  return (
    <section className="panel run-panel">
      <div className="run-header">
        <span className="status-chip" data-status={run.status}>{run.status}</span>
        <span className="run-id muted" title={run.runId}>{run.runId}</span>
        {streaming && <Button variant="destructive" className="cancel-button" onClick={onCancel}>{copy.cancelRun}</Button>}
      </div>
      {snapshotBlocked && run.permissionSnapshot && <PermissionSnapshotSummary snapshot={run.permissionSnapshot} copy={copy} />}
      {run.status === 'needs-recovery' && <RecoveryCard copy={{ eyebrow: copy.recoveryEyebrow, title: copy.recoveryTitle, description: copy.recoveryDescription, action: copy.recoveryAction }} onRetry={onRetry} />}
      {run.status !== 'needs-recovery' && (run.approvals ?? []).map((approval) => <ApprovalCard key={approval.approvalId} approval={approval} sandboxMode={run.config.sandbox?.mode ?? 'unknown'} onApprove={onApprove} reviewStatus={reviewStatusForApproval(approval, events)} copy={{ eyebrow: copy.approvalEyebrow, meta: copy.approvalMeta, sandboxLabel: copy.approvalSandboxLabel, networkLabel: copy.approvalNetworkLabel, imageLabel: copy.approvalImageLabel, allowOnce: copy.approvalAllowOnce, allowAriaLabel: copy.approvalAllowAriaLabel, deny: copy.approvalDeny, sessionNote: copy.approvalSessionNote, reviewReviewedLabel: copy.reviewReviewedLabel, reviewAskedLabel: copy.reviewAskedLabel, reviewDeniedLabel: copy.reviewDeniedLabel, reviewUnavailableLabel: copy.reviewUnavailableLabel, reviewReviewedDescription: copy.reviewReviewedDescription, reviewAskedDescription: copy.reviewAskedDescription, reviewDeniedDescription: copy.reviewDeniedDescription, reviewUnavailableDescription: copy.reviewUnavailableDescription }} />)}
      <div className="chat-thread" aria-busy={streaming}>
        {typeof run.config.userMessage === 'string' && run.config.userMessage.length > 0 && <div className="chat-message chat-message-user"><div className="chat-bubble">{run.config.userMessage}</div></div>}
        <div className="chat-message chat-message-assistant">
          <div className="chat-bubble">
            {run.output.length > 0
              ? <><Markdown text={run.output} onFileRef={onFileRef} />{streaming && <span className="stream-cursor" aria-hidden="true" />}</>
              : <span className="chat-thinking">{copy.waitingOutput}{streaming && <span className="thinking-dots" aria-hidden="true"><span /><span /><span /></span>}</span>}
          </div>
        </div>
      </div>
      <details className="run-details">
        <summary>{copy.runDetails}</summary>
        <div className="run-details-body">
          {!snapshotBlocked && run.permissionSnapshot && <PermissionSnapshotSummary snapshot={run.permissionSnapshot} copy={copy} />}
          {run.approvalReviewerSnapshot && <ReviewerRunSummary snapshot={run.approvalReviewerSnapshot} copy={copy} />}
          <div className="run-metrics"><div><span>{copy.metricQueue}</span><strong>{run.scheduler.queuePosition ?? '—'}</strong></div><div><span>{copy.metricActive}</span><strong>{run.scheduler.activeRunCount}</strong></div><div><span>{copy.metricLease}</span><strong>{run.scheduler.workspaceLease ?? '—'}</strong></div><div><span>{copy.metricEvents}</span><strong>{run.lastEventSeq}</strong></div></div>
          <ToolOutputInspector events={events} />
          <div className="event-list" aria-label={copy.timeline}>{events.map((event) => <div className="event-row" data-event-type={event.type} key={`${event.runId}-${event.seq}`}><span>{event.seq}</span><span>{timelineEventLabel(event)}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div>)}</div>
        </div>
      </details>
    </section>
  );
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
