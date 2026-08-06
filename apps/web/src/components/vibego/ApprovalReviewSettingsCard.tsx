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
  readonly copy: ApprovalReviewSettingsCardCopy;
}

export interface ApprovalReviewSettingsCardCopy {
  readonly eyebrow: string;
  readonly ariaLabel: string;
  readonly unavailableNote: string;
  readonly unpairedNote: string;
  readonly enableLabel: string;
  readonly note: string;
  readonly reviewerSourceLabel: string;
  readonly sourceSameAsRun: string;
  readonly sourceDedicated: string;
  readonly dedicatedProfileLabel: string;
  readonly dedicatedHelp: string;
  readonly postureAriaLabel: string;
  readonly postureOffLabel: string;
  readonly postureOffDescription: string;
  readonly postureAdvisoryLabel: string;
  readonly postureAdvisoryDescription: string;
  readonly postureBoundedAutoLabel: string;
  readonly postureBoundedAutoDescription: string;
  readonly statusLabel: string;
  readonly revisionLabel: string;
  readonly policyLabel: string;
  readonly lastLatencyLabel: string;
  readonly statusUnavailable: string;
  readonly statusNotConfigured: string;
  readonly notMeasured: string;
  readonly lastErrorPrefix: string;
  readonly limitsAriaLabel: string;
  readonly maxLatencyLabel: string;
  readonly maxRequestBytesLabel: string;
  readonly maxResponseBytesLabel: string;
  readonly cacheTtlLabel: string;
  readonly scopeNote: string;
  readonly saving: string;
  readonly save: string;
  readonly probeHealth: string;
  readonly saveNote: string;
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
export function ApprovalReviewSettingsCard({ settings, unavailable = false, enabled, reviewerSource, dedicatedProfileId, posture, maxLatencyMs, maxRequestBytes, maxResponseBytes, cacheTtlMs, onEnabledChange, onReviewerSourceChange, onDedicatedProfileIdChange, onPostureChange, onMaxLatencyMsChange, onMaxRequestBytesChange, onMaxResponseBytesChange, onCacheTtlMsChange, onSave, onProbe, busy = false, copy }: ApprovalReviewSettingsCardProps): JSX.Element {
  const status = settings?.status ?? (unavailable ? 'blocked' : 'disabled');
  const statusLabel = unavailable ? copy.statusUnavailable : settings?.status ?? copy.statusNotConfigured;
  const dedicatedMissing = reviewerSource === 'dedicated' && dedicatedProfileId.trim().length === 0;
  const saveDisabled = busy || !onSave || (enabled && dedicatedMissing);
  const postureOptions = [
    ['off', copy.postureOffLabel, copy.postureOffDescription],
    ['advisory-low-risk', copy.postureAdvisoryLabel, copy.postureAdvisoryDescription],
    ['bounded-auto-low-risk', copy.postureBoundedAutoLabel, copy.postureBoundedAutoDescription],
  ] as const;
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

  return <div className="approval-review-setup" aria-label={copy.ariaLabel}>
    <div className="eyebrow">{copy.eyebrow}</div>
    {unavailable ? <p className="muted">{copy.unavailableNote}</p> : !settings ? <p className="muted">{copy.unpairedNote}</p> : <>
      <label className="toggle-row"><input type="checkbox" checked={enabled} disabled={busy} onChange={(event) => onEnabledChange(event.target.checked)} /><span>{copy.enableLabel}</span></label>
      <p className="muted">{copy.note}</p>
      <div className="approval-review-choice-grid">
        <label>{copy.reviewerSourceLabel}<select value={reviewerSource} disabled={busy} onChange={(event) => onReviewerSourceChange(event.target.value as ApprovalReviewSettingsStatus['reviewerSource'])}><option value="same-as-run">{copy.sourceSameAsRun}</option><option value="dedicated">{copy.sourceDedicated}</option></select></label>
        {reviewerSource === 'dedicated' && <label>{copy.dedicatedProfileLabel}<input value={dedicatedProfileId} maxLength={128} disabled={busy} onChange={(event) => onDedicatedProfileIdChange(event.target.value)} placeholder="reviewer-profile" autoComplete="off" aria-describedby="approval-review-dedicated-help" /></label>}
      </div>
      {reviewerSource === 'dedicated' && <p id="approval-review-dedicated-help" className="muted">{copy.dedicatedHelp}</p>}
      <div className="approval-review-posture-options" role="radiogroup" aria-label={copy.postureAriaLabel}>
        {postureOptions.map(([value, label, description]) => <button key={value} type="button" className="approval-review-posture-option" data-selected={posture === value ? 'true' : 'false'} role="radio" aria-checked={posture === value} disabled={busy || (enabled && value === 'off')} onClick={() => onPostureChange(value)}><strong>{label}</strong><span>{description}</span></button>)}
      </div>
      <div className="approval-review-status-grid" data-status={status} role="status" aria-live="polite">
        <div><span>{copy.statusLabel}</span><strong>{statusLabel}</strong></div>
        <div><span>{copy.revisionLabel}</span><strong>{settings.reviewerRevision}</strong></div>
        <div><span>{copy.policyLabel}</span><strong>{settings.policyRevision}</strong></div>
        <div><span>{copy.lastLatencyLabel}</span><strong>{settings.lastLatencyMs === null ? copy.notMeasured : `${settings.lastLatencyMs} ms`}</strong></div>
      </div>
      <p className="muted approval-review-guidance">{settings.lastErrorCode ? copy.lastErrorPrefix.replace('{code}', settings.lastErrorCode) : ''}{settings.nextStep}</p>
      <div className="approval-review-limits" aria-label={copy.limitsAriaLabel}>
        <label>{copy.maxLatencyLabel}<input type="number" min={LIMITS.maxLatencyMs.min} max={LIMITS.maxLatencyMs.max} value={maxLatencyMs} disabled={busy} onChange={(event) => onMaxLatencyMsChange(clamp(event.target.value, LIMITS.maxLatencyMs))} /></label>
        <label>{copy.maxRequestBytesLabel}<input type="number" min={LIMITS.maxRequestBytes.min} max={LIMITS.maxRequestBytes.max} value={maxRequestBytes} disabled={busy} onChange={(event) => onMaxRequestBytesChange(clamp(event.target.value, LIMITS.maxRequestBytes))} /></label>
        <label>{copy.maxResponseBytesLabel}<input type="number" min={LIMITS.maxResponseBytes.min} max={LIMITS.maxResponseBytes.max} value={maxResponseBytes} disabled={busy} onChange={(event) => onMaxResponseBytesChange(clamp(event.target.value, LIMITS.maxResponseBytes))} /></label>
        <label>{copy.cacheTtlLabel}<input type="number" min={LIMITS.cacheTtlMs.min} max={LIMITS.cacheTtlMs.max} value={cacheTtlMs} disabled={busy} onChange={(event) => onCacheTtlMsChange(clamp(event.target.value, LIMITS.cacheTtlMs))} /></label>
      </div>
      <p className="muted approval-review-scope-note">{copy.scopeNote}</p>
      <div className="inline-actions approval-review-actions"><Button type="button" disabled={saveDisabled} onClick={submit}>{busy ? copy.saving : copy.save}</Button><Button type="button" variant="outline" disabled={busy || !onProbe} onClick={onProbe}>{copy.probeHealth}</Button><span className="muted">{copy.saveNote}</span></div>
    </>}
  </div>;
}

function clamp(value: string, bounds: { readonly min: number; readonly max: number; readonly fallback: number }): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return bounds.fallback;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
