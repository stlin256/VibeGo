import type { JSX, ReactNode } from 'react';
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

export function SettingsTabs({ ariaLabel, tabs, activeTab, onTabChange, children }: SettingsTabsProps): JSX.Element {
  return (
    <div className="settings-tabs" data-active-tab={activeTab}>
      <div className="settings-tab-list" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const selected = tab.id === activeTab;
          return <Button key={tab.id} variant={selected ? 'secondary' : 'ghost'} className="settings-tab" role="tab" id={settingsTabId(tab.id)} aria-selected={selected} aria-controls={`settings-panel-${tab.id}`} tabIndex={selected ? 0 : -1} onClick={() => onTabChange(tab.id)}>{tab.label}</Button>;
        })}
      </div>
      <div className="settings-tab-panels">{children}</div>
    </div>
  );
}

export function SettingsTabPanel({ tabId, activeTab, children }: SettingsTabPanelProps): JSX.Element {
  const active = tabId === activeTab;
  return <section id={`settings-panel-${tabId}`} className="settings-tab-panel" role="tabpanel" aria-labelledby={settingsTabId(tabId)} aria-hidden={!active} hidden={!active} tabIndex={0}>{children}</section>;
}
