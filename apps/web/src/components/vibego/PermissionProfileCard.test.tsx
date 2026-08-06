import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PermissionProfileCard } from './PermissionProfileCard.js';
import type { PermissionProfileCardCopy } from './PermissionProfileCard.js';

const copy: PermissionProfileCardCopy = {
  eyebrow: 'PERMISSION PROFILE',
  ariaLabel: 'Permission profile settings',
  unavailableNote: 'Permission settings are unavailable; existing run controls remain fail-closed and unchanged.',
  unpairedNote: 'Pair with the daemon to review permission profiles. Workspace coding remains the safe default.',
  profilesAriaLabel: 'Permission profiles',
  workspaceCodingLabel: 'Workspace coding',
  workspaceCodingDescription: 'Workspace-only files, network off, and bounded approvals for routine work.',
  fullHostLabel: 'Full host',
  fullHostDescription: 'High risk: host files and processes. Trusted sessions only; never a default.',
  safeBadge: 'SAFE DEFAULT',
  riskBadge: 'HIGH RISK',
  postureAriaLabel: 'Approval posture',
  postureEyebrow: 'APPROVAL POSTURE',
  boundedAutoLabel: 'Bounded auto',
  boundedAutoDescription: 'Routine exact-key workspace operations can proceed without repeated prompts.',
  sessionAutoLabel: 'Session auto',
  sessionAutoDescription: 'A confirmed trusted session may reuse a bounded host grant.',
  explicitLabel: 'Ask every time',
  explicitDescription: 'Keep the inline Allow/Deny decision visible for each approval.',
  fullHostPostureHint: 'Full host requires explicit or session-scoped approval.',
  statusLabel: 'Status',
  revisionLabel: 'Revision',
  requestedLabel: 'Requested',
  effectiveLabel: 'Effective',
  blockedValue: 'blocked',
  statusUnavailable: 'unavailable',
  statusLoading: 'loading',
  statusNotPaired: 'not paired',
  reasonLine: 'Reason: {reason}',
  nextLine: ' · Next: {next}',
  effectiveScopeLine: 'Effective scope: {filesystem} · process {process} · network {network} · posture {posture}',
  fullHostWarningTitle: 'Full host access is trusted-only and never automatic.',
  fullHostWarningBody: 'It may expose host files and processes. It does not enable network, MCP, Skill, Goal, Scheduler, Approval, or Sandbox bypass. Untrusted tasks remain blocked.',
  fullHostAckLabel: 'I understand the full-host risk for this trusted session.',
  fullHostSaveFirst: 'Save the full-host profile first, then confirm this session.',
  confirming: 'Confirming…',
  fullHostConfirmed: 'Full-host session confirmed',
  confirmFullHost: 'Confirm full-host session',
  grantTitle: 'Trusted session grant',
  grantMeta: 'Expires {time} · Uses {used}/{max}',
  revoking: 'Revoking…',
  revoke: 'Revoke full-host session',
  blockedSafely: 'Blocked safely.',
  degradedSafely: 'Degraded safely.',
  sessionInactive: 'Session access is no longer active.',
  nextStepFallback: 'Review the daemon status and choose the safer workspace profile.',
  saving: 'Saving…',
  save: 'Save permission profile',
  saveNote: 'Changes apply to new runs only.',
  notSet: 'not set',
};

const profile = {
  schemaVersion: 'ready4vibe_permission_profile_v1',
  profileId: 'workspace-coding',
  filesystemScope: 'workspace-only',
  processScope: 'none',
  networkMode: 'off',
  mcpSkillMode: 'off',
  approvalPosture: 'bounded-auto',
  taskTrust: 'trusted-workspace',
  workspaceId: 'workspace-default',
  policyRevision: 'policy-1',
  profileRevision: 'profile-1',
  requiresConfirmation: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
} as const;

const settings = {
  schemaVersion: 'ready4vibe_permission_profile_settings_status_v1',
  settings: { schemaVersion: 'ready4vibe_permission_profile_settings_v1', profile, currentRevision: 'profile-1', previousRevision: null, updatedAt: profile.updatedAt },
  resolution: { schemaVersion: 'ready4vibe_permission_profile_resolution_v1', status: 'ready', reasonCode: 'PROFILE_READY', requestedProfile: profile, effectiveProfile: profile, policyRevision: 'policy-1', evaluatedAt: profile.updatedAt, nextStep: 'Ready for a new run.' },
  currentRevision: 'profile-1',
  previousRevision: null,
} as const;

describe('PermissionProfileCard', () => {
  it('keeps workspace coding visibly safe and exposes all bounded posture choices', () => {
    const html = renderToStaticMarkup(<PermissionProfileCard settings={settings} selectedProfileId="workspace-coding" selectedApprovalPosture="bounded-auto" onProfileChange={() => undefined} onApprovalPostureChange={() => undefined} onSave={() => undefined} fullHostAcknowledged={false} onFullHostAcknowledgedChange={() => undefined} copy={copy} />);
    expect(html).toContain('Workspace coding');
    expect(html).toContain('SAFE DEFAULT');
    expect(html).toContain('Full host');
    expect(html).toContain('HIGH RISK');
    expect(html).toContain('Bounded auto');
    expect(html).toContain('Session auto');
    expect(html).toContain('Ask every time');
    expect(html).toContain('Changes apply to new runs only.');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\//iu);
  });

  it('requires an explicit trusted-session acknowledgement before full-host confirmation', () => {
    const fullHost = { ...profile, profileId: 'full-host', filesystemScope: 'host', processScope: 'host', approvalPosture: 'session-auto', taskTrust: 'trusted-user', workspaceId: undefined, requiresConfirmation: true } as const;
    const blockedStatus = { schemaVersion: 'ready4vibe_permission_status_v1', status: 'blocked', reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED', currentRevision: 'profile-2', requestedProfile: fullHost, effectiveProfile: null, effectiveScope: null, grant: null, grantExpiresAt: null, evaluatedAt: profile.updatedAt, nextStep: 'Confirm full-host access for this trusted session.' } as const;
    const fullHostSettings = { ...settings, settings: { ...settings.settings, profile: fullHost, currentRevision: 'profile-2' }, currentRevision: 'profile-2', resolution: { ...settings.resolution, status: 'blocked', reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED', requestedProfile: fullHost, effectiveProfile: null } } as const;
    const html = renderToStaticMarkup(<PermissionProfileCard settings={fullHostSettings} status={blockedStatus} selectedProfileId="full-host" selectedApprovalPosture="session-auto" onProfileChange={() => undefined} onApprovalPostureChange={() => undefined} fullHostAcknowledged={false} onFullHostAcknowledgedChange={() => undefined} onConfirmFullHost={() => undefined} copy={copy} />);
    expect(html).toContain('Full host access is trusted-only and never automatic.');
    expect(html).toContain('Confirm full-host session');
    expect(html).toContain('Blocked safely.');
    expect(html).toContain('FULL_HOST_CONFIRMATION_REQUIRED');
    expect(html).toContain('new runs only');
    expect(html).not.toContain('session-1');
    expect(html).not.toMatch(/token|secret|private key|C:\\Users\\|\/home\//iu);
  });

  it('renders bounded grant expiry and revoke without exposing grant identity', () => {
    const activeStatus = { schemaVersion: 'ready4vibe_permission_status_v1', status: 'ready', reasonCode: 'PROFILE_READY', currentRevision: 'profile-1', requestedProfile: profile, effectiveProfile: profile, effectiveScope: { kind: 'run', profileId: 'workspace-coding', filesystemScope: 'workspace-only', processScope: 'none', networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'bounded-auto', taskTrust: 'trusted-workspace', workspaceId: 'workspace-default' }, grant: { schemaVersion: 'ready4vibe_permission_session_grant_v1', grantId: 'grant_opaque', scope: { kind: 'session', profileId: 'workspace-coding', filesystemScope: 'workspace-only', processScope: 'none', networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'bounded-auto', taskTrust: 'trusted-workspace' }, policyRevision: 'policy-1', profileRevision: 'profile-1', issuedAt: '2026-08-05T00:00:00.000Z', expiresAt: '2026-08-05T01:00:00.000Z', maxUses: 10, usedUses: 2, status: 'active', revokedAt: null, auditRef: 'audit_opaque' }, grantExpiresAt: '2026-08-05T01:00:00.000Z', evaluatedAt: profile.updatedAt, nextStep: 'Ready.' } as never;
    const html = renderToStaticMarkup(<PermissionProfileCard settings={settings} status={activeStatus} selectedProfileId="workspace-coding" selectedApprovalPosture="bounded-auto" onProfileChange={() => undefined} onApprovalPostureChange={() => undefined} fullHostAcknowledged={false} onFullHostAcknowledgedChange={() => undefined} onRevoke={() => undefined} copy={copy} />);
    expect(html).toContain('Trusted session grant');
    expect(html).toContain('Uses 2/10');
    expect(html).toContain('Revoke full-host session');
    expect(html).not.toContain('grant_opaque');
    expect(html).not.toMatch(/sessionId|userId|accessToken|secret|C:\\Users\\/iu);
  });
});
