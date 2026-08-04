import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RecoveryCard } from './RecoveryCard.js';

describe('RecoveryCard', () => {
  it('keeps retry explicitly scoped to a new run and remains path/secret free', () => {
    const html = renderToStaticMarkup(<RecoveryCard onRetry={() => undefined} />);
    expect(html).toContain('class="recovery-card"');
    expect(html).toContain('RECOVERY REQUIRED');
    expect(html).toContain('Retry creates a new run');
    expect(html).toContain('Retry as new run');
    expect(html).toContain('ui-button');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\/|tool arguments/iu);
  });
});
