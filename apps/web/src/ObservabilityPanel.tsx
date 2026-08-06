import type { JSX } from 'react';
import type { AuditEventsResponse, UsageSummary } from './api.js';

export interface ObservabilityPanelProps {
  summary?: UsageSummary;
  audit?: AuditEventsResponse;
  loading?: boolean;
  unavailable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => Promise<void> | void;
}

export function ObservabilityPanel({ summary, audit, loading = false, unavailable = false, refreshing = false, onRefresh }: ObservabilityPanelProps): JSX.Element {
  const state = loading ? 'loading' : unavailable ? 'unavailable' : summary ? summary.status : 'empty';
  return (
    <section className="panel observability-panel" data-state={state} aria-label="Usage and audit">
      <div className="observability-header">
        <div>
          <div className="eyebrow">USAGE &amp; AUDIT</div>
          <h2>Run health</h2>
          <p className="muted">Bounded local telemetry; raw prompts and tool output stay out of this view.</p>
        </div>
        {onRefresh && <button className="observability-refresh" type="button" disabled={refreshing} onClick={() => { void onRefresh(); }}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>}
      </div>
      {loading && <div className="observability-state"><span className="goal-skeleton" /><p className="muted">Loading usage...</p></div>}
      {!loading && unavailable && <div className="observability-state"><strong>Telemetry is temporarily unavailable.</strong><p className="muted">Conversation and runs remain available; try again later.</p></div>}
      {!loading && !unavailable && !summary && <div className="observability-state"><strong>No usage recorded yet.</strong><p className="muted">The first run will populate this panel.</p></div>}
      {!loading && !unavailable && summary && <>
        <div className="observability-metrics">
          <div><span>model calls</span><strong>{summary.modelAttempts}</strong></div>
          <div><span>tool calls</span><strong>{summary.toolCalls}</strong></div>
          <div><span>input tokens</span><strong>{formatNumber(summary.tokens.input.total)}</strong></div>
          <div><span>output tokens</span><strong>{formatNumber(summary.tokens.output.total)}</strong></div>
        </div>
        <div className="observability-meta"><span data-status={summary.status}>{summary.status}</span><span>{summary.range}</span><span>samples {summary.resources.sampleCount}</span><span>cost {formatCost(summary)}</span></div>
        <div className="observability-audit" aria-label="Recent audit events">
          <div className="eyebrow">RECENT AUDIT</div>
          {audit?.events.length ? audit.events.slice(0, 5).map((event) => <div className="observability-audit-row" key={event.eventId} data-outcome={event.outcome}><span>{event.action}</span><span>{event.outcome}</span></div>) : <p className="muted">No audit events yet.</p>}
        </div>
      </>}
    </section>
  );
}

function formatNumber(value: number | null): string {
  return value === null ? 'unknown' : new Intl.NumberFormat().format(value);
}

function formatCost(summary: UsageSummary): string {
  if (summary.cost.amountMicros === null || summary.cost.currency === null) return 'unknown';
  const digits = summary.cost.amountMicros;
  const padded = digits.padStart(7, '0');
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/u, '');
  const fraction = padded.slice(-6).replace(/0+$/u, '').padEnd(4, '0');
  return `${summary.cost.currency} ${whole}.${fraction}`;
}
