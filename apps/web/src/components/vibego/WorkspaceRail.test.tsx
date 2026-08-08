import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceRail } from './WorkspaceRail.js';

describe('WorkspaceRail', () => {
  it('keeps navigation labels, current session and explicit callbacks in a presentational rail', () => {
    const html = renderToStaticMarkup(<WorkspaceRail workspaceLabel="Project A" settingsOpen={false} copy={{ navigationLabel: 'Workspace navigation', newTask: 'New task', recent: 'RECENT', currentTask: 'Current task', settings: 'Settings' }} onNewTask={() => undefined} onOpenSettings={() => undefined} />);
    expect(html).toContain('aria-label="Workspace navigation"');
    expect(html).toContain('Project A');
    expect(html).toContain('Current task');
    expect(html).toContain('rail-new-button');
    expect(html).toContain('aria-controls="settings-drawer"');
    expect(html).not.toMatch(/C:\\Users|api[_-]?key|Authorization/iu);
  });

  it('renders the run history with titles, active highlight and terminal dots', () => {
    const history = [
      { runId: 'run-2', status: 'executing', title: 'Fix the login flow', createdAt: '2026-08-07T10:00:00.000Z' },
      { runId: 'run-1', status: 'completed', title: 'Say hello', createdAt: '2026-08-07T09:00:00.000Z' },
    ] as const;
    const html = renderToStaticMarkup(<WorkspaceRail workspaceLabel="Project A" settingsOpen={false} copy={{ navigationLabel: 'Workspace navigation', newTask: 'New task', recent: 'RECENT', currentTask: 'Current task', settings: 'Settings' }} onNewTask={() => undefined} onOpenSettings={() => undefined} history={history} activeKey="run-2" onOpenConversation={() => undefined} />);
    expect(html).toContain('Fix the login flow');
    expect(html).toContain('Say hello');
    expect(html).toContain('rail-session active');
    expect(html).toContain('session-dot muted-dot');
    expect(html).not.toContain('Current task');
  });

  it('collapses runs of one conversation into a single entry titled by the first message', () => {
    const history = [
      { runId: 'run-3', status: 'completed', title: 'follow-up answer', createdAt: '2026-08-07T11:00:00.000Z', conversationId: 'conv-1' },
      { runId: 'run-2', status: 'executing', title: 'Fix the login flow', createdAt: '2026-08-07T10:00:00.000Z' },
      { runId: 'run-1', status: 'completed', title: 'original question', createdAt: '2026-08-07T09:00:00.000Z', conversationId: 'conv-1' },
    ] as const;
    const html = renderToStaticMarkup(<WorkspaceRail workspaceLabel="Project A" settingsOpen={false} copy={{ navigationLabel: 'Workspace navigation', newTask: 'New task', recent: 'RECENT', currentTask: 'Current task', settings: 'Settings' }} onNewTask={() => undefined} onOpenSettings={() => undefined} history={history} activeKey="conv-1" onOpenConversation={() => undefined} />);
    expect(html).toContain('original question');
    expect(html).toContain('Fix the login flow');
    expect(html).not.toContain('follow-up answer');
    expect(html.match(/<button[^>]*class="rail-session/gu)?.length ?? 0).toBe(2);
    expect(html).toContain('rail-session active');
  });
});
