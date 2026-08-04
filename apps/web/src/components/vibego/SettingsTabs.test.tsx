import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsTabPanel, SettingsTabs } from './SettingsTabs.js';

const tabs = [{ id: 'run', label: 'Run' }, { id: 'tools', label: 'Tools' }, { id: 'access', label: 'Access' }] as const;

describe('SettingsTabs', () => {
  it('renders an accessible tablist and selected panel relationship', () => {
    const html = renderToStaticMarkup(<SettingsTabs ariaLabel="Settings sections" tabs={tabs} activeTab="tools" onTabChange={() => undefined}>
      <SettingsTabPanel tabId="run" activeTab="tools">Run controls</SettingsTabPanel>
      <SettingsTabPanel tabId="tools" activeTab="tools">Tool controls</SettingsTabPanel>
      <SettingsTabPanel tabId="access" activeTab="tools">Access controls</SettingsTabPanel>
    </SettingsTabs>);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('id="settings-tab-tools"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls="settings-panel-tools"');
    expect(html).toContain('id="settings-panel-tools"');
    expect(html).toContain('aria-labelledby="settings-tab-tools"');
    expect(html).toContain('Tool controls');
    expect(html).toMatch(/id="settings-panel-run"[^>]+aria-hidden="true"[^>]+hidden/iu);
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\/|private[_-]?key/iu);
  });

  it('keeps all panel copy deterministic while only the active panel is exposed', () => {
    const html = renderToStaticMarkup(<SettingsTabs ariaLabel="Settings" tabs={tabs} activeTab="run" onTabChange={() => undefined}>
      <SettingsTabPanel tabId="run" activeTab="run"><p>Run</p></SettingsTabPanel>
      <SettingsTabPanel tabId="tools" activeTab="run"><p>Tools</p></SettingsTabPanel>
      <SettingsTabPanel tabId="access" activeTab="run"><p>Access</p></SettingsTabPanel>
    </SettingsTabs>);
    expect(html).toContain('data-active-tab="run"');
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('hidden');
    expect(html).toContain('Run');
    expect(html).toContain('Tools');
    expect(html).toContain('Access');
  });
});
