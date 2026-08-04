import type { FormEvent, JSX, RefObject } from 'react';
import type { RunProfile, RunSnapshot, StoredEvent } from '../../api.js';
import { Button, Textarea } from '../ui/index.js';
import { ApprovalCard } from './ApprovalCard.js';
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
    <section className="conversation-column" aria-label="Conversation and run timeline">
      <section className="panel conversation-stream" aria-label="Conversation stream">
        <div className="conversation-stream-header"><div><div className="eyebrow">CONVERSATION</div><h1>{copy.title}</h1></div><span className="muted conversation-hint">{copy.hint}</span></div>
        {run ? <RunConsole run={run} events={events} onCancel={onCancel} onApprove={onApprove} onRetry={onRetry} /> : <div className="empty-state"><span className="empty-icon">⌁</span><h2>{copy.readyTitle}</h2><p className="muted">{copy.readyDescription}</p></div>}
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

function RunConsole({ run, events, onCancel, onApprove, onRetry }: { readonly run: RunSnapshot; readonly events: readonly StoredEvent[]; readonly onCancel?: (() => void) | undefined; readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined; readonly onRetry?: (() => void) | undefined }): JSX.Element {
  return <section className="panel run-panel"><div className="run-header"><div><div className="eyebrow">RUN CONSOLE</div><h2>{run.runId}</h2></div><div className="status-chip" data-status={run.status}>{run.status}</div></div><div className="run-metrics"><div><span>queue</span><strong>{run.scheduler.queuePosition ?? '—'}</strong></div><div><span>active</span><strong>{run.scheduler.activeRunCount}</strong></div><div><span>lease</span><strong>{run.scheduler.workspaceLease ?? '—'}</strong></div><div><span>events</span><strong>{run.lastEventSeq}</strong></div></div>{run.status === 'needs-recovery' && <RecoveryCard onRetry={onRetry} />}{run.status !== 'needs-recovery' && (run.approvals ?? []).map((approval) => <ApprovalCard key={approval.approvalId} approval={approval} sandboxMode={run.config.sandbox?.mode ?? 'unknown'} onApprove={onApprove} />)}<ToolOutputInspector events={events} /><pre className="output-view">{run.output || '等待模型输出…'}</pre><div className="event-list">{events.map((event) => <div className="event-row" key={`${event.runId}-${event.seq}`}><span>{event.seq}</span><span>{event.type}</span><time>{new Date(event.at).toLocaleTimeString()}</time></div>)}</div>{!['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(run.status) && <Button variant="destructive" className="cancel-button" onClick={onCancel}>请求取消</Button>}</section>;
}
