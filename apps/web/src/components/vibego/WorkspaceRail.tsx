import type { JSX } from 'react';
import { Button } from '../ui/index.js';

export interface WorkspaceRailCopy {
  readonly navigationLabel: string;
  readonly eyebrow: string;
  readonly localSession: string;
  readonly newTask: string;
  readonly recent: string;
  readonly currentTask: string;
  readonly noOtherRuns: string;
  readonly settings: string;
}

export interface WorkspaceRailProps {
  readonly workspaceLabel: string;
  readonly settingsOpen: boolean;
  readonly copy: WorkspaceRailCopy;
  readonly onNewTask: () => void;
  readonly onOpenSettings: (target: HTMLElement) => void;
}

/** The navigation rail owns no workspace registry or persistence authority. */
export function WorkspaceRail({ workspaceLabel, settingsOpen, copy, onNewTask, onOpenSettings }: WorkspaceRailProps): JSX.Element {
  return (
    <nav className="workspace-rail" aria-label={copy.navigationLabel}>
      <div className="eyebrow">{copy.eyebrow}</div>
      <strong className="workspace-rail-name">{workspaceLabel}</strong>
      <p className="muted">{copy.localSession}</p>
      <Button className="rail-new-button" onClick={onNewTask}>{copy.newTask}</Button>
      <div className="rail-section-label">{copy.recent}</div>
      <div className="rail-session active"><span className="session-dot" />{copy.currentTask}</div>
      <div className="rail-session"><span className="session-dot muted-dot" />{copy.noOtherRuns}</div>
      <Button variant="ghost" className="rail-settings-button" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="settings-drawer" onClick={(event) => onOpenSettings(event.currentTarget)}>{copy.settings}</Button>
    </nav>
  );
}
