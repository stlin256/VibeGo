import type { JSX } from 'react';
import type {
  PermissionApprovalPosture,
  PermissionProfile,
  PermissionProfileId,
  PermissionProfileSettingsStatus,
  PermissionStatus,
} from '../../api.js';
import { Button } from '../ui/index.js';

export interface PermissionProfileCardProps {
  readonly settings?: PermissionProfileSettingsStatus | undefined;
  readonly status?: PermissionStatus | undefined;
  readonly unavailable?: boolean;
  readonly selectedProfileId: 'workspace-coding' | 'full-host';
  readonly selectedApprovalPosture: 'bounded-auto' | 'session-auto' | 'explicit';
  readonly onProfileChange: (profileId: 'workspace-coding' | 'full-host') => void;
  readonly onApprovalPostureChange: (posture: 'bounded-auto' | 'session-auto' | 'explicit') => void;
  readonly onSave?: (() => void) | undefined;
  readonly saveBusy?: boolean;
  readonly fullHostAcknowledged: boolean;
  readonly onFullHostAcknowledgedChange: (acknowledged: boolean) => void;
  readonly onConfirmFullHost?: (() => void) | undefined;
  readonly confirmBusy?: boolean;
  readonly onRevoke?: (() => void) | undefined;
  readonly revokeBusy?: boolean;
  readonly copy: PermissionProfileCardCopy;
}

export interface PermissionProfileCardCopy {
  readonly eyebrow: string;
  readonly ariaLabel: string;
  readonly unavailableNote: string;
  readonly unpairedNote: string;
  readonly profilesAriaLabel: string;
  readonly workspaceCodingLabel: string;
  readonly workspaceCodingDescription: string;
  readonly fullHostLabel: string;
  readonly fullHostDescription: string;
  readonly safeBadge: string;
  readonly riskBadge: string;
  readonly postureAriaLabel: string;
  readonly postureEyebrow: string;
  readonly boundedAutoLabel: string;
  readonly boundedAutoDescription: string;
  readonly sessionAutoLabel: string;
  readonly sessionAutoDescription: string;
  readonly explicitLabel: string;
  readonly explicitDescription: string;
  readonly fullHostPostureHint: string;
  readonly statusLabel: string;
  readonly revisionLabel: string;
  readonly requestedLabel: string;
  readonly effectiveLabel: string;
  readonly blockedValue: string;
  readonly statusUnavailable: string;
  readonly statusLoading: string;
  readonly statusNotPaired: string;
  readonly reasonLine: string;
  readonly nextLine: string;
  readonly effectiveScopeLine: string;
  readonly fullHostWarningTitle: string;
  readonly fullHostWarningBody: string;
  readonly fullHostAckLabel: string;
  readonly fullHostSaveFirst: string;
  readonly confirming: string;
  readonly fullHostConfirmed: string;
  readonly confirmFullHost: string;
  readonly grantTitle: string;
  readonly grantMeta: string;
  readonly revoking: string;
  readonly revoke: string;
  readonly blockedSafely: string;
  readonly degradedSafely: string;
  readonly sessionInactive: string;
  readonly nextStepFallback: string;
  readonly saving: string;
  readonly save: string;
  readonly saveNote: string;
  readonly notSet: string;
}

/**
 * Presentation-only permission controls. The daemon remains the authority for
 * profile resolution, grants and approval decisions; this component never
 * receives or persists bearer/session credentials.
 */
export function PermissionProfileCard({ settings, status, unavailable = false, selectedProfileId, selectedApprovalPosture, onProfileChange, onApprovalPostureChange, onSave, saveBusy = false, fullHostAcknowledged, onFullHostAcknowledgedChange, onConfirmFullHost, confirmBusy = false, onRevoke, revokeBusy = false, copy }: PermissionProfileCardProps): JSX.Element {
  const resolution = settings?.resolution;
  const requestedProfile = status?.requestedProfile ?? resolution?.requestedProfile ?? settings?.settings.profile;
  const effectiveProfile = status?.effectiveProfile ?? resolution?.effectiveProfile ?? null;
  const statusValue = status?.status ?? resolution?.status;
  const reasonCode = status?.reasonCode ?? resolution?.reasonCode;
  const nextStep = status?.nextStep ?? resolution?.nextStep;
  const grant = status?.grant;
  const fullHostSelected = selectedProfileId === 'full-host';
  const savedFullHost = settings?.settings.profile.profileId === 'full-host';
  const fullHostConfirmed = statusValue === 'ready' || statusValue === 'degraded'
    ? (effectiveProfile?.profileId === 'full-host' && Boolean(grant || status?.effectiveScope))
    : false;
  const canConfirm = fullHostSelected && savedFullHost && fullHostAcknowledged && Boolean(onConfirmFullHost) && !confirmBusy;
  const statusLabel = statusValue ? statusValue : unavailable ? copy.statusUnavailable : settings ? copy.statusLoading : copy.statusNotPaired;
  const profileOptions = [
    { id: 'workspace-coding', label: copy.workspaceCodingLabel, description: copy.workspaceCodingDescription },
    { id: 'full-host', label: copy.fullHostLabel, description: copy.fullHostDescription },
  ] as const;
  const postureOptions = [
    { id: 'bounded-auto', label: copy.boundedAutoLabel, description: copy.boundedAutoDescription },
    { id: 'session-auto', label: copy.sessionAutoLabel, description: copy.sessionAutoDescription },
    { id: 'explicit', label: copy.explicitLabel, description: copy.explicitDescription },
  ] as const;

  return (
    <div className="permission-profile-setup" aria-label={copy.ariaLabel}>
      <div className="eyebrow">{copy.eyebrow}</div>
      {unavailable ? <p className="muted">{copy.unavailableNote}</p> : !settings ? <p className="muted">{copy.unpairedNote}</p> : <>
        <div className="permission-profile-options" role="radiogroup" aria-label={copy.profilesAriaLabel}>
          {profileOptions.map((option) => <button key={option.id} type="button" className="permission-profile-option" data-selected={selectedProfileId === option.id ? 'true' : 'false'} data-risk={option.id === 'full-host' ? 'high' : 'bounded'} role="radio" aria-checked={selectedProfileId === option.id} disabled={saveBusy || confirmBusy} onClick={() => onProfileChange(option.id)}>
            <span className="permission-profile-option-heading"><strong>{option.label}</strong>{option.id === 'workspace-coding' ? <span className="permission-safe-badge">{copy.safeBadge}</span> : <span className="permission-risk-badge">{copy.riskBadge}</span>}</span>
            <span>{option.description}</span>
          </button>)}
        </div>
        <div className="permission-posture-options" role="radiogroup" aria-label={copy.postureAriaLabel}>
          <div className="eyebrow">{copy.postureEyebrow}</div>
          {postureOptions.map((option) => {
            const disabled = fullHostSelected && option.id === 'bounded-auto';
            return <button key={option.id} type="button" className="permission-posture-option" data-selected={selectedApprovalPosture === option.id ? 'true' : 'false'} disabled={disabled || saveBusy || confirmBusy} role="radio" aria-checked={selectedApprovalPosture === option.id} onClick={() => onApprovalPostureChange(option.id)} title={disabled ? copy.fullHostPostureHint : undefined}><strong>{option.label}</strong><span>{option.description}</span></button>;
          })}
        </div>
        <div className="permission-status-grid" data-status={statusValue ?? 'unknown'}>
          <div><span>{copy.statusLabel}</span><strong>{statusLabel}</strong></div>
          <div><span>{copy.revisionLabel}</span><strong>{status?.currentRevision ?? settings.currentRevision ?? '—'}</strong></div>
          <div><span>{copy.requestedLabel}</span><strong>{requestedProfile?.profileId ?? selectedProfileId}</strong></div>
          <div><span>{copy.effectiveLabel}</span><strong>{effectiveProfile?.profileId ?? copy.blockedValue}</strong></div>
        </div>
        <p className="muted permission-guidance">{fill(copy.reasonLine, { reason: reasonCode ?? 'not_evaluated' })}{nextStep ? fill(copy.nextLine, { next: nextStep }) : ''}</p>
        {effectiveProfile && <p className="muted permission-effective-summary">{fill(copy.effectiveScopeLine, { filesystem: effectiveProfile.filesystemScope, process: effectiveProfile.processScope, network: effectiveProfile.networkMode, posture: effectiveProfile.approvalPosture })}</p>}
        {fullHostSelected && <div className="permission-full-host-warning" role="alert">
          <strong>{copy.fullHostWarningTitle}</strong>
          <p>{copy.fullHostWarningBody}</p>
          <label className="toggle-row"><input type="checkbox" checked={fullHostAcknowledged} disabled={confirmBusy || saveBusy} onChange={(event) => onFullHostAcknowledgedChange(event.target.checked)} /><span>{copy.fullHostAckLabel}</span></label>
          {!savedFullHost && <p className="muted">{copy.fullHostSaveFirst}</p>}
          <Button type="button" disabled={!canConfirm} onClick={onConfirmFullHost}>{confirmBusy ? copy.confirming : fullHostConfirmed ? copy.fullHostConfirmed : copy.confirmFullHost}</Button>
        </div>}
        {grant && <div className="permission-grant-summary" data-status={grant.status}>
          <div><strong>{copy.grantTitle}</strong><span>{grant.status}</span></div>
          <p className="muted">{fill(copy.grantMeta, { time: formatTimestamp(status?.grantExpiresAt ?? grant.expiresAt, copy.notSet), used: String(grant.usedUses), max: String(grant.maxUses) })}</p>
          {onRevoke && <Button type="button" variant="destructive" className="cancel-button" disabled={revokeBusy || grant.status === 'revoked'} onClick={onRevoke}>{revokeBusy ? copy.revoking : copy.revoke}</Button>}
        </div>}
        {(statusValue === 'blocked' || statusValue === 'degraded' || statusValue === 'revoked' || statusValue === 'expired') && <p className="permission-next-step" data-status={statusValue}><strong>{statusValue === 'blocked' ? copy.blockedSafely : statusValue === 'degraded' ? copy.degradedSafely : copy.sessionInactive}</strong> {nextStep ?? copy.nextStepFallback}</p>}
        <div className="inline-actions permission-actions"><Button type="button" disabled={saveBusy || !onSave} onClick={onSave}>{saveBusy ? copy.saving : copy.save}</Button><span className="muted permission-save-note">{copy.saveNote}</span></div>
      </>}
    </div>
  );
}

function fill(template: string, params: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (match: string, name: string) => (name in params ? params[name] ?? match : match));
}

function formatTimestamp(value: string | null | undefined, notSet: string): string {
  if (!value) return notSet;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : notSet;
}

// Keep these references in this module so contract aliases remain part of the
// compile-time API boundary even when a consumer only imports the component.
export type PermissionProfileCardProfile = PermissionProfile;
export type PermissionProfileCardProfileId = PermissionProfileId;
export type PermissionProfileCardPosture = PermissionApprovalPosture;
