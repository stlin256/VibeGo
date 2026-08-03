import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('ratio-first responsive layout contract', () => {
  it('keeps explicit width and aspect-ratio compositions for the documented form factors', () => {
    expect(styles).toContain('@media (min-width: 1280px) and (min-aspect-ratio: 3/2)');
    expect(styles).toContain('@media (min-width: 900px) and (max-aspect-ratio: 1/1)');
    expect(styles).toContain('@media (min-width: 768px) and (max-width: 1199px) and (min-aspect-ratio: 23/20)');
    expect(styles).toContain('@media (max-width: 599px)');
    expect(styles).toContain('prefers-reduced-motion');
  });

  it('keeps the conversation-first shell and moves settings behind a drawer', () => {
    expect(styles).toContain('.workspace-rail');
    expect(styles).toContain('.conversation-column');
    expect(styles).toContain('.context-rail');
    expect(styles).toContain('.settings-panel[data-open="false"]');
    expect(styles).toContain('grid-template-columns: minmax(176px, 210px) minmax(0, 1fr) minmax(280px, 340px)');
    expect(styles).toContain('.goal-panel { overflow: hidden; }');
    expect(styles).toContain('.goal-panel-header { flex-wrap: wrap; }');
    expect(styles).toContain('.conversation-stream');
    expect(styles).toContain('.composer-panel { position: sticky;');
  });
});
