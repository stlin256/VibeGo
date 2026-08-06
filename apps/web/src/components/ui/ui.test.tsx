import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge.js';
import { Button } from './button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card.js';
import { Input } from './input.js';
import { Label } from './label.js';
import { Separator } from './separator.js';
import { Skeleton } from './skeleton.js';
import { Textarea } from './textarea.js';
import { Toast, ToastViewport } from './toast.js';
import { Tooltip } from './tooltip.js';

const uiDirectory = dirname(fileURLToPath(import.meta.url));

describe('VibeGo local UI primitives', () => {
  it('renders button variants, default type, loading and disabled semantics', () => {
    const html = renderToStaticMarkup(<Button variant="destructive" size="sm" loading>Delete</Button>);
    expect(html).toContain('class="ui-button ui-button--destructive ui-button--size-sm"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('ui-button__spinner');
  });

  it('forwards form, label and invalid accessibility attributes', () => {
    const html = renderToStaticMarkup(<><Label htmlFor="prompt">Prompt</Label><Input id="prompt" invalid aria-describedby="prompt-error" /><Textarea invalid aria-label="Details" /></>);
    expect(html).toContain('for="prompt"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="prompt-error"');
    expect(html).toContain('aria-label="Details"');
  });

  it('renders card composition, badge variants, separator orientation and labelled skeleton', () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardHeader><CardTitle>Run</CardTitle><CardDescription>Bounded status</CardDescription></CardHeader>
        <CardContent><Badge variant="outline">ready</Badge><Separator orientation="vertical" /><Skeleton label="Loading run" /></CardContent>
      </Card>,
    );
    expect(html).toContain('<section class="ui-card">');
    expect(html).toContain('ui-card__title');
    expect(html).toContain('ui-badge ui-badge--outline');
    expect(html).toContain('role="separator" aria-orientation="vertical"');
    expect(html).toContain('role="status" aria-label="Loading run"');
  });

  it('renders toast variants in a live viewport and tooltip bubble semantics', () => {
    const html = renderToStaticMarkup(
      <ToastViewport>
        <Toast variant="success" title="Run completed" description="Bounded output stored" onDismiss={() => undefined} />
        <Toast variant="error" title="Run failed" />
      </ToastViewport>,
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('ui-toast ui-toast--success');
    expect(html).toContain('role="status"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-label="Dismiss notification"');
    const tip = renderToStaticMarkup(<Tooltip content="Bounded hint"><span>Hover target</span></Tooltip>);
    expect(tip).toContain('role="tooltip"');
    expect(tip).toContain('ui-tooltip__bubble');
  });

  it('keeps primitives isolated from API, storage and credential access', () => {
    for (const file of readdirSync(uiDirectory).filter((entry) => entry.endsWith('.tsx') && entry !== 'ui.test.tsx')) {
      const source = readFileSync(join(uiDirectory, file), 'utf8');
      expect(source).not.toMatch(/api\.js|storage|localStorage|sessionStorage|api[_-]?key|secret|credential/iu);
    }
  });
});
