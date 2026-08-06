import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContextRail } from './ContextRail.js';

const copy = {
  ariaLabel: 'Run context',
  connectionEyebrow: 'CONNECTION',
  connectionTitle: 'Connected workspace',
  description: 'Bounded local session',
  readingDaemon: 'Reading daemon status…',
  transport: 'transport',
  tls: 'TLS',
  sandbox: 'sandbox',
  safetyTitle: 'Guardrails',
  guardrails: ['Untrusted content is sandboxed', 'Approval is explicit', 'SSE is resumable'],
};

describe('ContextRail', () => {
  it('renders read-only projection slots and bounded safety metadata without fetching', () => {
    const html = renderToStaticMarkup(<ContextRail open goalProjectionLoading={false} goalProjectionUnavailable goalProjectionRefreshing={false} observabilityLoading={false} observabilityUnavailable observabilityRefreshing={false} copy={copy} />);
    expect(html).toContain('aria-label="Run context"');
    expect(html).toContain('Goal control');
    expect(html).toContain('USAGE &amp; AUDIT');
    expect(html).toContain('Telemetry is temporarily unavailable');
    expect(html).toContain('Untrusted content is sandboxed');
    expect(html).not.toMatch(/C:\\Users|api[_-]?key|Authorization/iu);
  });

  it('renders tablist semantics while keeping all panels mounted', () => {
    const html = renderToStaticMarkup(<ContextRail open goalProjectionLoading={false} goalProjectionUnavailable goalProjectionRefreshing={false} observabilityLoading={false} observabilityUnavailable observabilityRefreshing={false} copy={copy} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('hidden=""');
    expect(html).toContain('Goal control');
    expect(html).toContain('USAGE &amp; AUDIT');
  });

  it('keeps the existing connection health projection in a Card primitive', () => {
    const html = renderToStaticMarkup(<ContextRail open goalProjectionLoading={false} goalProjectionUnavailable goalProjectionRefreshing={false} observabilityLoading={false} observabilityUnavailable goalProjection={undefined} observabilityRefreshing={false} health={{ status: 'ok', service: 'ready4vibe-daemon', version: 'test', transport: { kind: 'https-lan', tlsRequired: true, boundAddresses: ['127.0.0.1'] }, auth: { pairingRequired: false }, storage: { kind: 'memory', status: 'ready' }, sandbox: { availableModes: ['read-only'], externalRequiredForUntrusted: true }, approval: { supportedDecisions: ['allow', 'prompt', 'forbidden'] } }} copy={copy} />);
    expect(html).toContain('class="ui-card panel connection-panel"');
    expect(html).toContain('https-lan');
    expect(html).toContain('<dt>TLS</dt><dd>required</dd>');
    expect(html).toContain('Connected workspace');
  });
});
