import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSheet } from './SettingsSheet.js';

const copy = { eyebrow: 'SETTINGS', title: 'Run profile', description: 'Configure this run.', close: 'Close settings' };

describe('SettingsSheet', () => {
  it('renders an open dialog shell with a bounded child slot and Button close affordance', () => {
    const html = renderToStaticMarkup(<SettingsSheet open panelRef={{ current: null }} copy={copy} onClose={() => undefined}><div className="settings-stack"><span>Safe settings slot</span></div></SettingsSheet>);
    expect(html).toContain('id="settings-drawer"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="settings-drawer-title"');
    expect(html).toContain('aria-hidden="false"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('Close settings');
    expect(html).toContain('ui-button');
    expect(html).toContain('Safe settings slot');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\/|private[_-]?key/iu);
  });

  it('keeps a closed sheet hidden while preserving the dialog relationship', () => {
    const html = renderToStaticMarkup(<SettingsSheet open={false} panelRef={{ current: null }} copy={copy} onClose={() => undefined}><p>Deferred content</p></SettingsSheet>);
    expect(html).toContain('data-open="false"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Deferred content');
    expect(html).toContain('aria-label="Close settings"');
  });
});
