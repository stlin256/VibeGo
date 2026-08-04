import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ObservabilityPanel } from './ObservabilityPanel.js';
import type { AuditEventsResponse, UsageSummary } from './api.js';

const summary: UsageSummary = {
  schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: '2026-08-04T12:00:00.000Z', range: '24h', from: '2026-08-03T12:00:00.000Z', to: '2026-08-04T12:00:00.000Z',
  modelAttempts: 2, modelRequests: 1, toolCalls: 3,
  tokens: { input: { total: 100, knownRecords: 1, unknownRecords: 0 }, output: { total: 50, knownRecords: 1, unknownRecords: 0 }, cachedInput: { total: null, knownRecords: 0, unknownRecords: 1 }, reasoning: { total: null, knownRecords: 0, unknownRecords: 1 } },
  resources: { sampleCount: 4, droppedSampleCount: 0 }, cost: { currency: 'USD', amountMicros: '125000', accuracy: 'exact' },
};
const audit: AuditEventsResponse = {
  schemaVersion: 'ready4vibe_observability_api_v1', status: 'ready', generatedAt: summary.generatedAt, after: 0, nextAfter: null,
  events: [{ schemaVersion: 'ready4vibe_audit_event_v1', eventId: 'audit_panel_01', appendSequence: 1, at: summary.generatedAt, actor: 'system', transport: 'loopback', action: 'run.completed', targetKind: 'run', targetId: 'run_panel_01', outcome: 'succeeded', correlationId: 'corr_panel_01', previousHash: null, eventHash: 'a'.repeat(64) }],
};

describe('ObservabilityPanel', () => {
  it('renders bounded usage and audit fields without payloads', () => {
    const html = renderToStaticMarkup(<ObservabilityPanel summary={summary} audit={audit} onRefresh={() => undefined} />);
    expect(html).toContain('USAGE &amp; AUDIT');
    expect(html).toContain('model calls');
    expect(html).toContain('run.completed');
    expect(html).toContain('USD 0.1250');
    expect(html).not.toContain('eventHash');
  });

  it('keeps degraded telemetry non-blocking and explains the fallback', () => {
    const html = renderToStaticMarkup(<ObservabilityPanel unavailable onRefresh={() => undefined} />);
    expect(html).toContain('data-state="unavailable"');
    expect(html).toContain('Conversation and runs remain available');
  });
});
