import type { JSX, ReactNode, RefObject } from 'react';
import { Button } from '../ui/index.js';

export interface SettingsSheetCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly close: string;
}

export interface SettingsSheetProps {
  readonly open: boolean;
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly copy: SettingsSheetCopy;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** Presentational settings dialog shell; App owns focus and persistence state. */
export function SettingsSheet({ open, panelRef, copy, onClose, children }: SettingsSheetProps): JSX.Element {
  return (
    <>
      <div className="settings-backdrop" data-open={open} aria-hidden="true" onClick={open ? onClose : undefined} />
      <section id="settings-drawer" ref={panelRef} className="panel settings-panel" data-open={open} role="dialog" aria-modal="true" aria-labelledby="settings-drawer-title" aria-hidden={!open}>
        <div className="settings-drawer-header"><div><div className="eyebrow">{copy.eyebrow}</div><h2 id="settings-drawer-title">{copy.title}</h2></div><Button variant="ghost" className="drawer-close" aria-label={copy.close} onClick={onClose}>{copy.close}</Button></div>
        <p className="muted">{copy.description}</p>
        {children}
      </section>
    </>
  );
}
