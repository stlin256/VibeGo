import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SettingsSection } from './SettingsSection.js';

describe('SettingsSection', () => {
  it('renders bounded headings, descriptions and status variants', () => {
    const html = renderToStaticMarkup(<SettingsSection id="memory" eyebrow="TOOLS" title="Agent memory" description="Optional retrieval." status="degraded" statusLabel="Degraded"><p>Retry is available.</p></SettingsSection>);
    expect(html).toContain('class="ui-card settings-section"');
    expect(html).toContain('aria-labelledby="memory-title"');
    expect(html).toContain('id="memory-title"');
    expect(html).toContain('Agent memory');
    expect(html).toContain('Optional retrieval.');
    expect(html).toContain('ui-badge--destructive');
    expect(html).toContain('Degraded');
    expect(html).toContain('Retry is available.');
  });

  it('does not echo secrets or paths in the presentational wrapper', () => {
    const html = renderToStaticMarkup(<SettingsSection id="safe" title="Safe" status="ready"><span>Bounded content</span></SettingsSection>);
    expect(html).toContain('data-status="ready"');
    expect(html).toContain('Bounded content');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\/|private[_-]?key/iu);
  });
});
