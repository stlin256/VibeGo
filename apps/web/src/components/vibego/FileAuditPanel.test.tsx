import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '../../api.js';
import { collectFileAudit, FileAuditPanel } from './FileAuditPanel.js';

function event(seq: number, type: string, payload: unknown): StoredEvent {
  return { version: 1, id: `evt_${seq}`, seq, runId: 'run_1', type, source: 'tool', correlationId: 'corr', at: '2026-08-08T12:00:00.000Z', payload };
}

const events = [
  event(1, 'tool.started', { callId: 'c1', toolId: 'filesystem.read', input: { path: 'src/main.ts' } }),
  event(2, 'tool.output', { callId: 'c1', content: 'file-bytes-here', bytes: 15 }),
  event(3, 'tool.output', { callId: 'c2', content: 'unrelated output', bytes: 16 }),
];

describe('collectFileAudit', () => {
  it('keeps only events mentioning the referenced path', () => {
    const entries = collectFileAudit(events, 'src/main.ts');
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2]);
    expect(entries[0]?.toolId).toBe('filesystem.read');
    expect(entries[1]?.content).toBe('file-bytes-here');
  });

  it('matches separator variants of the same path', () => {
    expect(collectFileAudit(events, 'src\\main.ts').map((entry) => entry.seq)).toEqual([1, 2]);
  });
});

describe('FileAuditPanel', () => {
  it('renders nothing when closed and lists audit entries when open', () => {
    expect(renderToStaticMarkup(<FileAuditPanel path={undefined} events={events} onClose={() => undefined} copy={{}} />)).toBe('');
    const html = renderToStaticMarkup(<FileAuditPanel path="src/main.ts" events={events} onClose={() => undefined} copy={{ title: 'FILE REFERENCE', close: 'Close', empty: 'None', contentLabel: 'Captured content' }} />);
    expect(html).toContain('file-audit-panel');
    expect(html).toContain('src/main.ts');
    expect(html).toContain('filesystem.read');
    expect(html).toContain('file-bytes-here');
  });

  it('shows the empty note when no tool activity mentions the path', () => {
    const html = renderToStaticMarkup(<FileAuditPanel path="docs/none.md" events={events} onClose={() => undefined} copy={{ empty: 'None recorded' }} />);
    expect(html).toContain('None recorded');
  });
});
