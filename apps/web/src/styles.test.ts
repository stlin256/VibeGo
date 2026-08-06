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
    expect(styles).toContain('grid-template-columns: minmax(176px, 210px) minmax(0, 1fr)');
    expect(styles).toContain('.goal-panel { overflow: hidden; }');
    expect(styles).toContain('.goal-panel-header { flex-wrap: wrap; }');
    expect(styles).toContain('.conversation-stream');
    expect(styles).toContain('.composer-panel { position: sticky;');
  });

  it('keeps the 42c/42d settings tabs, status cards and overflow guards source-owned', () => {
    expect(styles).toContain('.settings-tabs');
    expect(styles).toContain('.settings-tab[aria-selected="true"]');
    expect(styles).toContain('.settings-tab-panel[hidden]');
    expect(styles).toContain('.settings-section[data-status="degraded"]');
    expect(styles).toContain('.settings-run-fields');
    expect(styles).toContain('.settings-section .inline-actions label');
    expect(styles).toContain('body { overflow-x: hidden; }');
    expect(styles).toContain('.goal-panel { overflow: hidden; }');
  });

  it('keeps the Phase 56a language control and accessibility hooks bounded', () => {
    expect(styles).toContain('.locale-control');
    expect(styles).toContain('.locale-control select { min-height: 44px;');
    expect(styles).toContain('.sr-only');
    expect(styles).toContain('button { border: 0; border-radius: var(--vibego-radius-sm); min-height: 44px;');
    expect(styles).toContain('prefers-reduced-motion');
  });

  it('keeps Phase 56c safe-area and fold-segment hooks optional', () => {
    expect(styles).toContain('env(safe-area-inset-bottom');
    expect(styles).toContain('env(viewport-segment-left 1 0');
    expect(styles).toContain('@media (horizontal-viewport-segments: 2)');
    expect(styles).toContain('@media (horizontal-viewport-segments: 3)');
    expect(styles).toContain('ratio-first layout above');
  });

  it('keeps deployment readiness bounded beside certificate guidance', () => {
    expect(styles).toContain('.deployment-readiness');
    expect(styles).toContain('.deployment-readiness[data-status="blocked"]');
  });

  it('keeps the Phase 42a semantic token and primitive contracts brand-aware', () => {
    expect(styles).toContain('--background: var(--vibego-bg-canvas)');
    expect(styles).toContain('--primary: var(--vibego-primary)');
    expect(styles).toContain('--destructive: var(--vibego-signal-red)');
    expect(styles).toContain('.ui-button--size-icon { width: 44px;');
    expect(styles).toContain('.ui-card {');
    expect(styles).toContain('.ui-skeleton {');
    expect(styles).toContain('.ui-button__spinner');
  });

  it('keeps reviewer settings and approval explanations ratio-safe', () => {
    expect(styles).toContain('.approval-review-setup');
    expect(styles).toContain('.approval-review-status-grid');
    expect(styles).toContain('.approval-review-summary[data-review-status="review-unavailable"]');
    expect(styles).toContain('.reviewer-run-summary');
    expect(styles).toContain('.approval-review-choice-grid, .approval-review-limits, .approval-review-posture-options { grid-template-columns: 1fr; }');
  });
});
