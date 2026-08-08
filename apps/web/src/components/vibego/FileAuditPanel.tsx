import type { JSX } from 'react';
import type { StoredEvent } from '../../api.js';

export interface FileAuditCopy {
  readonly title?: string | undefined;
  readonly close?: string | undefined;
  readonly empty?: string | undefined;
  readonly contentLabel?: string | undefined;
}

export interface FileAuditPanelProps {
  readonly path: string | undefined;
  readonly events: readonly StoredEvent[];
  readonly copy: FileAuditCopy;
  readonly onClose: () => void;
}

export interface FileAuditEntry {
  readonly seq: number;
  readonly type: string;
  readonly at: string;
  readonly toolId: string;
  readonly content?: string | undefined;
}

const AUDIT_EVENT_TYPES = new Set(['tool.requested', 'tool.started', 'tool.output', 'tool.completed', 'tool.failed', 'approval.requested', 'approval.decided']);
const MAX_AUDIT_ENTRIES = 32;
const MAX_AUDIT_CONTENT_CHARS = 32 * 1024;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

function pathVariants(path: string): readonly string[] {
  const forward = path.replace(/\\/gu, '/');
  const backward = path.replace(/\//gu, '\\');
  return forward === backward ? [path] : [path, forward, backward];
}

/** Metadata + content of every tool/approval event that mentions the path.
 * Read-only projection: it never re-fetches file bytes from the workspace. */
export function collectFileAudit(events: readonly StoredEvent[], path: string): readonly FileAuditEntry[] {
  const variants = pathVariants(path);
  const toolIds = new Map<string, string>();
  const matchedCallIds = new Set<string>();
  const entries: FileAuditEntry[] = [];
  for (const event of events) {
    const payload = asRecord(event.payload);
    if (!payload) continue;
    const callId = typeof payload.callId === 'string' ? payload.callId : undefined;
    const toolId = typeof payload.toolId === 'string' ? payload.toolId : undefined;
    if (callId && toolId) toolIds.set(callId, toolId);
    if (!AUDIT_EVENT_TYPES.has(event.type)) continue;
    let serialized: string;
    try {
      serialized = JSON.stringify(payload);
    } catch {
      continue;
    }
    // Outputs rarely repeat the path; tie them to the call that referenced it.
    const mentionsPath = variants.some((variant) => serialized.includes(variant));
    if (mentionsPath && callId) matchedCallIds.add(callId);
    if (!mentionsPath && !(callId !== undefined && matchedCallIds.has(callId))) continue;
    const content = typeof payload.content === 'string' ? payload.content : undefined;
    entries.push({
      seq: event.seq,
      type: event.type,
      at: event.at,
      toolId: (callId ? toolIds.get(callId) : undefined) ?? toolId ?? 'tool',
      ...(content !== undefined ? { content: content.length > MAX_AUDIT_CONTENT_CHARS ? `${content.slice(0, MAX_AUDIT_CONTENT_CHARS)}…` : content } : {}),
    });
  }
  return entries.slice(-MAX_AUDIT_ENTRIES);
}

/** Slide-over audit view for a file reference clicked in the conversation. */
export function FileAuditPanel({ path, events, copy, onClose }: FileAuditPanelProps): JSX.Element | null {
  if (path === undefined) return null;
  const entries = collectFileAudit(events, path);
  return (
    <>
      <div className="file-audit-backdrop" data-open="true" onClick={onClose} aria-hidden="true" />
      <aside className="file-audit-panel" data-open="true" aria-label={copy.title ?? 'File reference'}>
        <header className="file-audit-header">
          <div className="file-audit-heading">
            <span className="eyebrow">{copy.title ?? 'FILE REFERENCE'}</span>
            <strong className="file-audit-path" title={path}>{path}</strong>
          </div>
          <button type="button" className="file-audit-close" aria-label={copy.close ?? 'Close'} onClick={onClose}>×</button>
        </header>
        {entries.length === 0
          ? <p className="muted file-audit-empty">{copy.empty ?? 'No tool activity recorded for this path in the current run.'}</p>
          : <ol className="file-audit-list">
            {entries.map((entry) => (
              <li key={`${entry.seq}-${entry.type}`} className="file-audit-entry" data-event-type={entry.type}>
                <div className="file-audit-meta">
                  <span className="file-audit-tool">{entry.toolId}</span>
                  <span className="file-audit-type">{entry.type}</span>
                  <time>{new Date(entry.at).toLocaleTimeString()}</time>
                </div>
                {entry.content !== undefined && (
                  <details className="file-audit-content">
                    <summary>{copy.contentLabel ?? 'Captured content'}</summary>
                    <pre>{entry.content}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>}
      </aside>
    </>
  );
}
