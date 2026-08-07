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
  readonly activeRunId?: string | undefined;
  readonly onOpenRun?: ((runId: string) => void) | undefined;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery']);

/** The navigation rail owns no workspace registry or persistence authority. */
export function WorkspaceRail({ workspaceLabel, settingsOpen, copy, onNewTask, onOpenSettings, history = [], activeRunId, onOpenRun }: WorkspaceRailProps): JSX.Element {
  return (
    <nav className="workspace-rail" aria-label={copy.navigationLabel}>
      <strong className="workspace-rail-name">{workspaceLabel}</strong>
      <Button className="rail-new-button" aria-keyshortcuts="Control+N Meta+N" onClick={onNewTask}>{copy.newTask}</Button>
      <div className="rail-section-label">{copy.recent}</div>
      {history.length === 0
        ? <div className="rail-session active"><span className="session-dot" /><span className="rail-session-title">{copy.currentTask}</span></div>
        : history.map((item) => (
          <button key={item.runId} type="button" className={item.runId === activeRunId ? 'rail-session active' : 'rail-session'} title={item.title} onClick={() => onOpenRun?.(item.runId)}>
            <span className={TERMINAL_STATUSES.has(item.status) ? 'session-dot muted-dot' : 'session-dot'} /><span className="rail-session-title">{item.title}</span>
          </button>
        ))}
      <Button variant="ghost" className="rail-settings-button" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="settings-drawer" onClick={(event) => onOpenSettings(event.currentTarget)}>{copy.settings}</Button>
    </nav>
  );
}
