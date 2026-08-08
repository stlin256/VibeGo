import type { JSX } from 'react';
import type { RunSummary } from '../../api.js';
import { Button } from '../ui/index.js';

export interface WorkspaceRailCopy {
  readonly navigationLabel: string;
  readonly newTask: string;
  readonly recent: string;
  readonly currentTask: string;
  readonly settings: string;
}

export interface WorkspaceRailProps {
  readonly workspaceLabel: string;
  readonly settingsOpen: boolean;
  readonly copy: WorkspaceRailCopy;
  readonly onNewTask: () => void;
  readonly onOpenSettings: (target: HTMLElement) => void;
  readonly history?: readonly RunSummary[];
  /** Highlight key: conversation id for grouped entries, run id for legacy runs. */
  readonly activeKey?: string | undefined;
  readonly onOpenConversation?: ((key: string) => void) | undefined;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery']);

interface RailEntry {
  readonly key: string;
  readonly title: string;
  readonly status: string;
}

/** Runs sharing a conversation collapse into one rail entry; the title comes
 * from the first message of the conversation, the status from the latest run. */
export function groupHistoryByConversation(history: readonly RunSummary[]): RailEntry[] {
  const order: string[] = [];
  const byKey = new Map<string, RailEntry>();
  for (const item of history) {
    const key = item.conversationId ?? item.runId;
    const existing = byKey.get(key);
    if (!existing) {
      order.push(key);
      byKey.set(key, { key, title: item.title, status: item.status });
      continue;
    }
    // History arrives newest-first: later occurrences are older runs of the
    // same conversation, so their title (first message) wins while the status
    // stays with the latest run.
    byKey.set(key, { key, title: item.title, status: existing.status });
  }
  return order.map((key) => byKey.get(key) as RailEntry);
}

/** The navigation rail owns no workspace registry or persistence authority. */
export function WorkspaceRail({ workspaceLabel, settingsOpen, copy, onNewTask, onOpenSettings, history = [], activeKey, onOpenConversation }: WorkspaceRailProps): JSX.Element {
  const entries = groupHistoryByConversation(history);
  return (
    <nav className="workspace-rail" aria-label={copy.navigationLabel}>
      <strong className="workspace-rail-name">{workspaceLabel}</strong>
      <Button className="rail-new-button" aria-keyshortcuts="Control+N Meta+N" onClick={onNewTask}>{copy.newTask}</Button>
      <div className="rail-section-label">{copy.recent}</div>
      {entries.length === 0
        ? <div className="rail-session active"><span className="session-dot" /><span className="rail-session-title">{copy.currentTask}</span></div>
        : entries.map((item) => (
          <button key={item.key} type="button" className={item.key === activeKey ? 'rail-session active' : 'rail-session'} title={item.title} onClick={() => onOpenConversation?.(item.key)}>
            <span className={TERMINAL_STATUSES.has(item.status) ? 'session-dot muted-dot' : 'session-dot'} /><span className="rail-session-title">{item.title}</span>
          </button>
        ))}
      <Button variant="ghost" className="rail-settings-button" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="settings-drawer" onClick={(event) => onOpenSettings(event.currentTarget)}>{copy.settings}</Button>
    </nav>
  );
}
