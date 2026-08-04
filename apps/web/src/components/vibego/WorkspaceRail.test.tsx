import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceRail } from './WorkspaceRail.js';

describe('WorkspaceRail', () => {
  it('keeps navigation labels, current session and explicit callbacks in a presentational rail', () => {
    const html = renderToStaticMarkup(<WorkspaceRail workspaceLabel="Project A" settingsOpen={false} copy={{ navigationLabel: 'Workspace navigation', eyebrow: 'WORKSPACE', localSession: 'Local session', newTask: 'New task', recent: 'RECENT', currentTask: 'Current task', noOtherRuns: 'No other runs', settings: 'Settings' }} onNewTask={() => undefined} onOpenSettings={() => undefined} />);
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).toContain('Project A');
    expect(html).toContain('Current task');
    expect(html).toContain('No other runs');
    expect(html).toContain('rail-new-button');
    expect(html).toContain('aria-controls="settings-drawer"');
    expect(html).not.toMatch(/C:\\Users|api[_-]?key|Authorization/iu);
  });
});
