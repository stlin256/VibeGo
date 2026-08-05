import type { JSX } from 'react';
import type { ApprovalReviewSettingsPatchInput, ApprovalReviewSettingsStatus } from '../../api.js';
import { Button } from '../ui/index.js';

export interface ApprovalReviewSettingsCardProps {
  readonly settings?: ApprovalReviewSettingsStatus | undefined;
  readonly unavailable?: boolean;
  readonly enabled: boolean;
  readonly reviewerSource: ApprovalReviewSettingsStatus['reviewerSource'];
  readonly dedicatedProfileId: string;
  readonly posture: ApprovalReviewSettingsStatus['posture'];
  readonly maxLatencyMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly cacheTtlMs: number;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onReviewerSourceChange: (source: ApprovalReviewSettingsStatus['reviewerSource']) => void;
  readonly onDedicatedProfileIdChange: (profileId: string) => void;
  readonly onPostureChange: (posture: ApprovalReviewSettingsStatus['posture']) => void;
  readonly onMaxLatencyMsChange: (value: number) => void;
  readonly onMaxRequestBytesChange: (value: number) => void;
  readonly onMaxResponseBytesChange: (value: number) => void;
  readonly onCacheTtlMsChange: (value: number) => void;
  readonly onSave?: ((input: ApprovalReviewSettingsPatchInput) => void) | undefined;
  readonly onProbe?: (() => void) | undefined;
  readonly busy?: boolean;
}

const LIMITS = {
  maxLatencyMs: { min: 250, max: 120_000, fallback: 1_500 },
  maxRequestBytes: { min: 1_024, max: 256 * 1024, fallback: 16_384 },
  maxResponseBytes: { min: 1_024, max: 64 * 1024, fallback: 8_192 },
  cacheTtlMs: { min: 0, max: 5 * 60 * 1_000, fallback: 0 },
} as const;

/**
 * Settings-only presentation for the bounded reviewer. Credentials, provider
 * endpoints and raw model content intentionally have no props in this card.
 */
export function ApprovalReviewSettingsCard({ settings, unavailable = false, enabled, reviewerSource, dedicatedProfileId, posture, maxLatencyMs, maxRequestBytes, maxResponseBytes, cacheTtlMs, onEnabledChange, onReviewerSourceChange, onDedicatedProfileIdChange, onPostureChange, onMaxLatencyMsChange, onMaxRequestBytesChange, onMaxResponseBytesChange, onCacheTtlMsChange, onSave, onProbe, busy = false }: ApprovalReviewSettingsCardProps): JSX.Element {
  const status = settings?.status ?? (unavailable ? 'blocked' : 'disabled');
  const statusLabel = unavailable ? 'Unavailable' : settings?.status ?? 'Not configured';
  const dedicatedMissing = reviewerSource === 'dedicated' && dedicatedProfileId.trim().length === 0;
  const saveDisabled = busy || !onSave || (enabled && dedicatedMissing);
  const submit = (): void => {
    if (!onSave) return;
    const input: ApprovalReviewSettingsPatchInput = {
      enabled,
      reviewerSource,
      posture: enabled ? posture === 'off' ? 'advisory-low-risk' : posture : 'off',
      maxLatencyMs,
      maxRequestBytes,
      maxResponseBytes,
      cacheTtlMs,
      ...(reviewerSource === 'dedicated' ? { dedicatedProfileId: dedicatedProfileId.trim() || null } : {}),
      ...(settings?.reviewerRevision ? { expectedRevision: settings.reviewerRevision } : {}),
    };
    onSave(input);
  };

  return <div className="approval-review-setup" aria-label="Approval review settings">
    <div className="eyebrow">LLM APPROVAL REVIEW</div>
    {unavailable ? <p className="muted">Approval review settings are unavailable. Existing deterministic approval remains unchanged.</p> : !settings ? <p className="muted">Pair with the daemon to configure bounded approval review.</p> : <>
      <label className="toggle-row"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => onEnabledChange(event.target.checked)} /><span>Enable bounded approval review</span></label>
      <p className="muted">When enabled, a bounded model call may review exact low-risk requests. It can add latency and provider cost; it never grants capabilities or replaces the user for high-risk work.</p>
      <div className="approval-review-choice-grid">
        <label>Reviewer source<select value={reviewerSource} disabled={busy} onChange={(event) => onReviewerSourceChange(event.target.value as ApprovalReviewSettingsStatus['reviewerSource'])}><option value="same-as-run">Use current run model</option><option value="dedicated">Dedicated reviewer (degraded until configured)</option></select></label>
        {reviewerSource === 'dedicated' && <label>Dedicated profile ID<input value={dedicatedProfileId} maxLength={128} disabled={busy} onChange={(event) => onDedicatedProfileIdChange(event.target.value)} placeholder="reviewer-profile" autoComplete="off" aria-describedby="approval-review-dedicated-help" /></label>}
      </div>
      {reviewerSource === 'dedicated' && <p id="approval-review-dedicated-help" className="muted">Only a non-secret daemon profile ID is accepted. Credentials and endpoints stay in the daemon.</p>}
      <div className="approval-review-posture-options" role="radiogroup" aria-label="Approval review posture">
        {([
          ['off', 'Off', 'Keep every approval on the normal user path.'],
          ['advisory-low-risk', 'Advisory', 'Explain low-risk requests; you still choose Allow once.'],
          ['bounded-auto-low-risk', 'Bounded auto', 'Only exact trusted low-risk keys may be auto-resolved through the existing ApprovalBroker.'],
        ] as const).map(([value, label, description]) => <button key={value} type="button" className="approval-review-posture-option" data-selected={posture === value ? 'true' : 'false'} role="radio" aria-checked={posture === value} disabled={busy || (enabled && value === 'off')} onClick={() => onPostureChange(value)}><strong>{label}</strong><span>{description}</span></button>)}
      </div>
      <div className="approval-review-status-grid" data-status={status} role="status" aria-live="polite">
        <div><span>Status</span><strong>{statusLabel}</strong></div>
        <div><span>Revision</span><strong>{settings.reviewerRevision}</strong></div>
        <div><span>Policy</span><strong>{settings.policyRevision}</strong></div>
        <div><span>Last latency</span><strong>{settings.lastLatencyMs === null ? 'not measured' : `${settings.lastLatencyMs} ms`}</strong></div>
      </div>
      <p className="muted approval-review-guidance">{settings.lastErrorCode ? `Last safe error: ${settings.lastErrorCode}. ` : ''}{settings.nextStep}</p>
      <div className="approval-review-limits" aria-label="Bounded reviewer limits">
        <label>Max latency (ms)<input type="number" min={LIMITS.maxLatencyMs.min} max={LIMITS.maxLatencyMs.max} value={maxLatencyMs} disabled={busy} onChange={(event) => onMaxLatencyMsChange(clamp(event.target.value, LIMITS.maxLatencyMs))} /></label>
        <label>Max request bytes<input type="number" min={LIMITS.maxRequestBytes.min} max={LIMITS.maxRequestBytes.max} value={maxRequestBytes} disabled={busy} onChange={(event) => onMaxRequestBytesChange(clamp(event.target.value, LIMITS.maxRequestBytes))} /></label>
        <label>Max response bytes<input type="number" min={LIMITS.maxResponseBytes.min} max={LIMITS.maxResponseBytes.max} value={maxResponseBytes} disabled={busy} onChange={(event) => onMaxResponseBytesChange(clamp(event.target.value, LIMITS.maxResponseBytes))} /></label>
        <label>Cache TTL (ms)<input type="number" min={LIMITS.cacheTtlMs.min} max={LIMITS.cacheTtlMs.max} value={cacheTtlMs} disabled={busy} onChange={(event) => onCacheTtlMsChange(clamp(event.target.value, LIMITS.cacheTtlMs))} /></label>
      </div>
      <p className="muted approval-review-scope-note">Always asks you for destructive, network, full-host, untrusted, ambiguous or unavailable-sandbox requests. Session-wide grants are managed in Permission settings.</p>
      <div className="inline-actions approval-review-actions"><Button type="button" disabled={saveDisabled} onClick={submit}>{busy ? 'Saving…' : 'Save approval review'}</Button><Button type="button" variant="outline" disabled={busy || !onProbe} onClick={onProbe}>Probe health</Button><span className="muted">Changes apply to new runs only.</span></div>
    </>}
  </div>;
}

function clamp(value: string, bounds: { readonly min: number; readonly max: number; readonly fallback: number }): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
