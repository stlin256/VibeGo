import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { Button } from '../ui/index.js';

export interface SettingsTabDefinition {
  readonly id: string;
  readonly label: string;
}

export interface SettingsTabsProps {
  readonly ariaLabel: string;
  readonly tabs: readonly SettingsTabDefinition[];
  readonly activeTab: string;
  readonly onTabChange: (tabId: string) => void;
  readonly children: ReactNode;
}

export interface SettingsTabPanelProps {
  readonly tabId: string;
  readonly activeTab: string;
  readonly children: ReactNode;
}

function settingsTabId(tabId: string): string {
  return `settings-tab-${tabId.replace(/[^a-z0-9_-]/giu, '-')}`;
}

function settingsPanelId(tabId: string): string {
  return `settings-panel-${tabId.replace(/[^a-z0-9_-]/giu, '-')}`;
}

/** Resolve the next bounded tab without depending on a browser or React state. */
export function resolveSettingsTab(tabs: readonly SettingsTabDefinition[], activeTab: string, key: string): string | null {
  if (tabs.length === 0) return null;
  const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));
  if (key === 'Home') return tabs[0]?.id ?? null;
  if (key === 'End') return tabs[tabs.length - 1]?.id ?? null;
  if (key !== 'ArrowLeft' && key !== 'ArrowUp' && key !== 'ArrowRight' && key !== 'ArrowDown') return null;
  const direction = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  return tabs[(currentIndex + direction + tabs.length) % tabs.length]?.id ?? null;
}

function focusSettingsTab(tabId: string): void {
  if (typeof document === 'undefined') return;
  document.getElementById(settingsTabId(tabId))?.focus();
}

export function SettingsTabs({ ariaLabel, tabs, activeTab, onTabChange, children }: SettingsTabsProps): JSX.Element {
  return (
    <div className="settings-tabs" data-active-tab={activeTab}>
      <div className="settings-tab-list" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const selected = tab.id === activeTab;
          const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
            const nextTab = resolveSettingsTab(tabs, tab.id, event.key);
            if (!nextTab) return;
            event.preventDefault();
            onTabChange(nextTab);
            focusSettingsTab(nextTab);
          };
          return <Button key={tab.id} variant={selected ? 'secondary' : 'ghost'} className="settings-tab" role="tab" id={settingsTabId(tab.id)} aria-selected={selected} aria-controls={settingsPanelId(tab.id)} tabIndex={selected ? 0 : -1} onClick={() => onTabChange(tab.id)} onKeyDown={handleKeyDown}>{tab.label}</Button>;
        })}
      </div>
      <div className="settings-tab-panels">{children}</div>
    </div>
  );
}

export function SettingsTabPanel({ tabId, activeTab, children }: SettingsTabPanelProps): JSX.Element {
  const active = tabId === activeTab;
  return <section id={settingsPanelId(tabId)} className="settings-tab-panel" role="tabpanel" aria-labelledby={settingsTabId(tabId)} aria-hidden={!active} hidden={!active} tabIndex={0}>{children}</section>;
}
