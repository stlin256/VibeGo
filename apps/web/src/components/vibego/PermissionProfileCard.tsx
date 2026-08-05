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
}

const PROFILE_OPTIONS: readonly {
  readonly id: 'workspace-coding' | 'full-host';
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: 'workspace-coding',
    label: 'Workspace coding',
    description: 'Workspace-only files, network off, and bounded approvals for routine work.',
  },
  {
    id: 'full-host',
    label: 'Full host',
    description: 'High risk: host files and processes. Trusted sessions only; never a default.',
  },
];

const POSTURE_OPTIONS: readonly {
  readonly id: 'bounded-auto' | 'session-auto' | 'explicit';
  readonly label: string;
  readonly description: string;
}[] = [
  { id: 'bounded-auto', label: 'Bounded auto', description: 'Routine exact-key workspace operations can proceed without repeated prompts.' },
  { id: 'session-auto', label: 'Session auto', description: 'A confirmed trusted session may reuse a bounded host grant.' },
  { id: 'explicit', label: 'Ask every time', description: 'Keep the inline Allow/Deny decision visible for each approval.' },
];

/**
 * Presentation-only permission controls. The daemon remains the authority for
 * profile resolution, grants and approval decisions; this component never
 * receives or persists bearer/session credentials.
 */
export function PermissionProfileCard({ settings, status, unavailable = false, selectedProfileId, selectedApprovalPosture, onProfileChange, onApprovalPostureChange, onSave, saveBusy = false, fullHostAcknowledged, onFullHostAcknowledgedChange, onConfirmFullHost, confirmBusy = false, onRevoke, revokeBusy = false }: PermissionProfileCardProps): JSX.Element {
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
  const statusLabel = statusValue ? statusValue : unavailable ? 'unavailable' : settings ? 'loading' : 'not paired';

  return (
    <div className="permission-profile-setup" aria-label="Permission profile settings">
      <div className="eyebrow">PERMISSION PROFILE</div>
      {unavailable ? <p className="muted">Permission settings are unavailable; existing run controls remain fail-closed and unchanged.</p> : !settings ? <p className="muted">Pair with the daemon to review permission profiles. Workspace coding remains the safe default.</p> : <>
        <div className="permission-profile-options" role="radiogroup" aria-label="Permission profiles">
          {PROFILE_OPTIONS.map((option) => <button key={option.id} type="button" className="permission-profile-option" data-selected={selectedProfileId === option.id ? 'true' : 'false'} data-risk={option.id === 'full-host' ? 'high' : 'bounded'} role="radio" aria-checked={selectedProfileId === option.id} disabled={saveBusy || confirmBusy} onClick={() => onProfileChange(option.id)}>
            <span className="permission-profile-option-heading"><strong>{option.label}</strong>{option.id === 'workspace-coding' ? <span className="permission-safe-badge">SAFE DEFAULT</span> : <span className="permission-risk-badge">HIGH RISK</span>}</span>
            <span>{option.description}</span>
          </button>)}
        </div>
        <div className="permission-posture-options" role="radiogroup" aria-label="Approval posture">
          <div className="eyebrow">APPROVAL POSTURE</div>
          {POSTURE_OPTIONS.map((option) => {
            const disabled = fullHostSelected && option.id === 'bounded-auto';
            return <button key={option.id} type="button" className="permission-posture-option" data-selected={selectedApprovalPosture === option.id ? 'true' : 'false'} disabled={disabled || saveBusy || confirmBusy} role="radio" aria-checked={selectedApprovalPosture === option.id} onClick={() => onApprovalPostureChange(option.id)} title={disabled ? 'Full host requires explicit or session-scoped approval.' : undefined}><strong>{option.label}</strong><span>{option.description}</span></button>;
          })}
        </div>
        <div className="permission-status-grid" data-status={statusValue ?? 'unknown'}>
          <div><span>Status</span><strong>{statusLabel}</strong></div>
          <div><span>Revision</span><strong>{status?.currentRevision ?? settings.currentRevision ?? '—'}</strong></div>
          <div><span>Requested</span><strong>{requestedProfile?.profileId ?? selectedProfileId}</strong></div>
          <div><span>Effective</span><strong>{effectiveProfile?.profileId ?? 'blocked'}</strong></div>
        </div>
        <p className="muted permission-guidance">Reason: {reasonCode ?? 'not_evaluated'}{nextStep ? ` · Next: ${nextStep}` : ''}</p>
        {effectiveProfile && <p className="muted permission-effective-summary">Effective scope: {effectiveProfile.filesystemScope} · process {effectiveProfile.processScope} · network {effectiveProfile.networkMode} · posture {effectiveProfile.approvalPosture}</p>}
        {fullHostSelected && <div className="permission-full-host-warning" role="alert">
          <strong>Full host access is trusted-only and never automatic.</strong>
          <p>It may expose host files and processes. It does not enable network, MCP, Skill, Goal, Scheduler, Approval, or Sandbox bypass. Untrusted tasks remain blocked.</p>
          <label className="toggle-row"><input type="checkbox" checked={fullHostAcknowledged} disabled={confirmBusy || saveBusy} onChange={(event) => onFullHostAcknowledgedChange(event.target.checked)} /><span>I understand the full-host risk for this trusted session.</span></label>
          {!savedFullHost && <p className="muted">Save the full-host profile first, then confirm this session.</p>}
          <Button type="button" disabled={!canConfirm} onClick={onConfirmFullHost}>{confirmBusy ? 'Confirming…' : fullHostConfirmed ? 'Full-host session confirmed' : 'Confirm full-host session'}</Button>
        </div>}
        {grant && <div className="permission-grant-summary" data-status={grant.status}>
          <div><strong>Trusted session grant</strong><span>{grant.status}</span></div>
          <p className="muted">Expires {formatTimestamp(status?.grantExpiresAt ?? grant.expiresAt)} · Uses {grant.usedUses}/{grant.maxUses}</p>
          {onRevoke && <Button type="button" variant="destructive" className="cancel-button" disabled={revokeBusy || grant.status === 'revoked'} onClick={onRevoke}>{revokeBusy ? 'Revoking…' : 'Revoke full-host session'}</Button>}
        </div>}
        {(statusValue === 'blocked' || statusValue === 'degraded' || statusValue === 'revoked' || statusValue === 'expired') && <p className="permission-next-step" data-status={statusValue}><strong>{statusValue === 'blocked' ? 'Blocked safely.' : statusValue === 'degraded' ? 'Degraded safely.' : 'Session access is no longer active.'}</strong> {nextStep ?? 'Review the daemon status and choose the safer workspace profile.'}</p>}
        <div className="inline-actions permission-actions"><Button type="button" disabled={saveBusy || !onSave} onClick={onSave}>{saveBusy ? 'Saving…' : 'Save permission profile'}</Button><span className="muted permission-save-note">Changes apply to new runs only.</span></div>
      </>}
    </div>
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'not set';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'not set';
}

// Keep these references in this module so contract aliases remain part of the
// compile-time API boundary even when a consumer only imports the component.
export type PermissionProfileCardProfile = PermissionProfile;
export type PermissionProfileCardProfileId = PermissionProfileId;
export type PermissionProfileCardPosture = PermissionApprovalPosture;
