import type { JSX } from 'react';
import type { Locale } from '../../locale.js';
import { Button } from '../ui/index.js';

export interface ConversationHeaderCopy {
  readonly brandName: string;
  readonly brandPrefix: string;
  readonly brandSuffix: string;
  readonly newTask: string;
  readonly hideDetails: string;
  readonly showDetails: string;
  readonly settings: string;
  readonly localeLabel: string;
  readonly localeEnglish: string;
  readonly localeChinese: string;
  readonly connected: string;
  readonly awaitingPairing: string;
}

export interface ConversationHeaderProps {
  readonly connected: boolean;
  readonly contextOpen: boolean;
  readonly settingsOpen: boolean;
  readonly locale: Locale;
  readonly copy: ConversationHeaderCopy;
  readonly onNewTask: () => void;
  readonly onToggleContext: () => void;
  readonly onOpenSettings: (target: HTMLElement) => void;
  readonly onLocaleChange?: ((locale: Locale) => void) | undefined;
}

/** Presentational topbar; App retains navigation, settings and locale state. */
export function ConversationHeader({ connected, contextOpen, settingsOpen, locale, copy, onNewTask, onToggleContext, onOpenSettings, onLocaleChange }: ConversationHeaderProps): JSX.Element {
  const contextLabel = contextOpen ? copy.hideDetails : copy.showDetails;
  return (
    <header className="topbar">
      <div className="brand-lockup"><img className="brand-mark" src="/vibego-mark.svg" alt={copy.brandName} /><span>{copy.brandPrefix}<span className="brand-go">{copy.brandSuffix}</span></span></div>
      <div className="topbar-actions">
        <Button className="topbar-button primary-task-button" aria-keyshortcuts="Control+N Meta+N" onClick={onNewTask}>{copy.newTask}</Button>
        <Button variant="outline" className="topbar-button context-toggle" aria-expanded={contextOpen} aria-label={contextLabel} onClick={onToggleContext}>{contextLabel}</Button>
        <Button variant="outline" className="topbar-button settings-toggle" aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls="settings-drawer" onClick={(event) => onOpenSettings(event.currentTarget)}>{copy.settings}</Button>
        <label className="locale-control"><span>{copy.localeLabel}</span><select aria-label={copy.localeLabel} value={locale} onChange={(event) => onLocaleChange?.(event.target.value as Locale)}><option value="en-US">{copy.localeEnglish}</option><option value="zh-CN">{copy.localeChinese}</option></select></label>
        <div className="connection-pill" data-connected={connected}>{connected ? copy.connected : copy.awaitingPairing}</div>
      </div>
    </header>
  );
}
