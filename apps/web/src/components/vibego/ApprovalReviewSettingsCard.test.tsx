import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalReviewSettingsCard } from './ApprovalReviewSettingsCard.js';

const settings = {
  schemaVersion: 'llm-approval/v1' as const,
  enabled: false,
  reviewerSource: 'same-as-run' as const,
  dedicatedProfileId: null,
  posture: 'off' as const,
  status: 'disabled' as const,
  reviewerRevision: 'reviewer-1',
  policyRevision: 'policy-1',
  limits: { maxLatencyMs: 1_500, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs: 0 },
  lastLatencyMs: null,
  lastErrorCode: null,
  lastHealthAt: null,
  nextStep: 'Enable bounded approval review explicitly in Settings.',
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const props = {
  settings,
  enabled: false,
  reviewerSource: 'same-as-run' as const,
  dedicatedProfileId: '',
  posture: 'off' as const,
  maxLatencyMs: 1_500,
  maxRequestBytes: 16_384,
  maxResponseBytes: 8_192,
  cacheTtlMs: 0,
  onEnabledChange: () => undefined,
  onReviewerSourceChange: () => undefined,
  onDedicatedProfileIdChange: () => undefined,
  onPostureChange: () => undefined,
  onMaxLatencyMsChange: () => undefined,
  onMaxRequestBytesChange: () => undefined,
  onMaxResponseBytesChange: () => undefined,
  onCacheTtlMsChange: () => undefined,
  onSave: () => undefined,
  onProbe: () => undefined,
};

describe('ApprovalReviewSettingsCard', () => {
  it('renders an off-by-default, bounded and secret-free settings surface', () => {
    const html = renderToStaticMarkup(<ApprovalReviewSettingsCard {...props} />);
    expect(html).toContain('Enable bounded approval review');
    expect(html).toContain('Use current run model');
    expect(html).toContain('Bounded auto');
    expect(html).toContain('Session-wide grants are managed in Permission settings.');
    expect(html).toContain('Changes apply to new runs only.');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/api[_-]?key|Authorization|private[_-]?key|C:\\Users\\|\/home\//iu);
  });

  it('marks a dedicated reviewer without a profile as blocked and keeps limits bounded', () => {
    const dedicated = { ...settings, enabled: true, reviewerSource: 'dedicated' as const, dedicatedProfileId: 'profile-reviewer', posture: 'advisory-low-risk' as const, status: 'degraded' as const, lastErrorCode: 'provider-unavailable' as const, nextStep: 'Probe the dedicated reviewer provider before relying on review automation.' };
    const html = renderToStaticMarkup(<ApprovalReviewSettingsCard {...props} settings={dedicated} enabled reviewerSource="dedicated" dedicatedProfileId="" posture="advisory-low-risk" />);
    expect(html).toContain('Dedicated reviewer (degraded until configured)');
    expect(html).toContain('provider-unavailable');
    expect(html).toContain('Probe the dedicated reviewer provider');
    expect(html).toContain('max="120000"');
    expect(html).toContain('max="262144"');
    expect(html).not.toContain('profile-reviewer');
  });
});
