import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_PROFILE, type CapabilityProfile, type RunSnapshot } from '../../api.js';
import { ConversationShell, isComposerSubmitShortcut, type ConversationCopy } from './ConversationShell.js';

const copy: ConversationCopy = {
  title: 'Conversation',
  hint: 'One run at a time',
  newMessage: 'NEW MESSAGE',
  inputLabel: 'Task input',
  inputPlaceholder: 'Describe a task',
  startRun: 'Start run',
  readyTitle: 'Ready',
  readyDescription: 'Describe what you want to build.',
  untrustedPolicy: 'untrusted content · external sandbox',
  trustedPolicy: 'trusted workspace · read-only',
  conversationEyebrow: 'CONVERSATION',
  conversationStream: 'Conversation stream',
  conversationTimeline: 'Conversation and run timeline',
  runConsole: 'RUN CONSOLE',
  waitingOutput: 'Waiting for model output…',
  runDetails: 'Run details',
  stopRun: 'Stop',
  timeline: 'Run timeline',
  metricQueue: 'queue',
  metricActive: 'active',
  metricLease: 'lease',
  metricEvents: 'events',
  recoveryEyebrow: 'RECOVERY REQUIRED',
  recoveryTitle: 'This run stopped safely after a daemon restart.',
  recoveryDescription: 'Retry creates a new run from the original safety policy; interrupted tool calls are never replayed.',
  recoveryAction: 'Retry as new run',
  approvalEyebrow: 'APPROVAL REQUIRED',
  approvalMeta: '{risk} · {bytes} bytes · expires {time}',
  approvalSandboxLabel: 'sandbox',
  approvalNetworkLabel: 'network',
  approvalImageLabel: 'image',
  approvalAllowOnce: 'Allow once',
  approvalAllowAriaLabel: 'Allow this approval once',
  approvalDeny: 'Deny',
  approvalSessionNote: 'Session-wide grants are managed in Permission settings.',
  reviewReviewedLabel: 'REVIEWED',
  reviewAskedLabel: 'ASKED',
  reviewDeniedLabel: 'DENIED',
  reviewUnavailableLabel: 'REVIEW UNAVAILABLE',
  reviewReviewedDescription: 'The bounded reviewer matched this exact low-risk key; the daemon policy still controls the one-time action.',
  reviewAskedDescription: 'The reviewer kept this request on the user approval path.',
  reviewDeniedDescription: 'The reviewer denied this request; no capability is widened.',
  reviewUnavailableDescription: 'The review could not complete; the normal deterministic approval gate remains active.',
  snapshotEyebrow: 'PERMISSION SNAPSHOT',
  snapshotTitle: 'Frozen for this run',
  snapshotAriaLabel: 'Frozen permission snapshot',
  snapshotRequested: 'requested',
  snapshotEffective: 'effective',
  snapshotProfileRevision: 'profile revision',
  snapshotPolicyRevision: 'policy revision',
  snapshotScopeLabel: 'Scope',
  snapshotBlocked: 'Reason: {reason}. The daemon will not silently widen this run.',
  snapshotGrantExpiry: 'Session grant expiry',
  snapshotActive: 'active',
  snapshotBlockedChip: 'blocked',
  reviewerEyebrow: 'APPROVAL REVIEW SNAPSHOT',
  reviewerOff: 'off',
  reviewerFrozen: 'revision {rev} · policy {policy} · frozen for this run',
  quickApproval: 'Approval',
  quickSandbox: 'Sandbox',
  quickModel: 'Model',
  approvalOnRequest: 'On request',
  approvalUntrusted: 'Untrusted',
  approvalNever: 'Never',
  sandboxReadOnly: 'Read-only',
  sandboxWorkspaceWrite: 'Workspace write',
  sandboxExternal: 'External',
};

function runFixture(status: RunSnapshot['status'] = 'executing'): RunSnapshot {
  return {
    version: 1,
    runId: 'run_shell',
    status,
    config: {} as never,
    lastEventSeq: 2,
    output: 'bounded output',
    scheduler: { queuePosition: null, activeRunCount: 1, workspaceLease: 'read' },
    ...(status === 'needs-recovery' ? { final: { summary: 'recovery', exitReason: 'daemon-restarted' as const } } : {}),
  };
}

function capabilityProfileFixture(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    schemaVersion: 'ready4vibe_capability_profile_v1',
    profileId: 'preview',
    transportMode: 'loopback',
    modelMode: 'fake',
    filesystemMode: 'off',
    shellMode: 'off',
    networkMode: 'off',
    mcpSkillMode: 'off',
    approvalMode: 'none',
    policyRevision: 'policy-1',
    requiresAcknowledgement: false,
    updatedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('isComposerSubmitShortcut', () => {
  it('submits on Enter and keeps newline behavior for Shift+Enter and IME composition', () => {
    expect(isComposerSubmitShortcut({ key: 'Enter', shiftKey: false })).toBe(true);
    expect(isComposerSubmitShortcut({ key: 'Enter', shiftKey: true })).toBe(false);
    expect(isComposerSubmitShortcut({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false);
    expect(isComposerSubmitShortcut({ key: 'a', shiftKey: false })).toBe(false);
  });
});

describe('ConversationShell', () => {
  it('renders the empty conversation and composer through typed props', () => {
    const html = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('Conversation and run timeline');
    expect(html).toContain('Conversation stream');
    expect(html).toContain('composer-panel');
    expect(html).toContain('aria-label="Task input"');
    expect(html).toContain('Describe what you want to build.');
    expect(html).toContain('Start run');
    expect(html).not.toContain('composer-tools');
  });

  it('renders quick approval, sandbox and model controls when profile changes are wired', () => {
    const html = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onProfileChange={() => undefined} />);
    expect(html).toContain('composer-tools');
    expect(html).toContain('>Approval<');
    expect(html).toContain('>Sandbox<');
    expect(html).toContain('>Model<');
    expect(html).toContain('On request');
    expect(html).toContain('Read-only');
    expect(html).toContain('deepseek-v4-flash');
    const custom = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={{ ...DEFAULT_RUN_PROFILE, model: { provider: 'openai-compatible', name: 'my-custom-model' } }} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onProfileChange={() => undefined} />);
    expect(custom).toContain('my-custom-model');
  });

  it('disables sandbox shortcuts that exceed the effective capability profile', () => {
    const restricted = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onProfileChange={() => undefined} capabilityProfile={capabilityProfileFixture()} />);
    expect(restricted).toContain('value="read-only"');
    expect(restricted).toContain('value="workspace-write" disabled=""');
    expect(restricted).toContain('value="external-sandbox" disabled=""');

    const blocked = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onProfileChange={() => undefined} capabilityProfile={null} />);
    expect(blocked).toContain('value="workspace-write" disabled=""');

    const writable = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onProfileChange={() => undefined} capabilityProfile={capabilityProfileFixture({ filesystemMode: 'workspace-write', shellMode: 'host-restricted' })} />);
    expect(writable).not.toContain('disabled=""');
  });

  it('preserves recovery and approval states without exposing paths or credentials', () => {
    const events = [
      { version: 1 as const, id: 'e1', seq: 1, runId: 'run_shell', type: 'tool.requested', at: '2026-08-05T00:00:00.000Z', payload: { callId: 'call_1', toolId: 'filesystem.write' } },
      { version: 1 as const, id: 'e2', seq: 2, runId: 'run_shell', type: 'tool.output', at: '2026-08-05T00:00:01.000Z', payload: { callId: 'call_1', bytes: 7, content: JSON.stringify({ stdout: 'safe', stderr: '', exitCode: 0 }) } },
    ];
    const html = renderToStaticMarkup(<ConversationShell run={{ ...runFixture('waiting-approval'), approvals: [{ approvalId: 'ap_1', runId: 'run_shell', turnId: 'turn_1', callId: 'call_1', toolId: 'filesystem.write', toolVersion: '1.0.0', risk: 'write', argumentBytes: 12, createdAt: 1, expiresAt: 2 }] }} events={events} message="" profile={{ ...DEFAULT_RUN_PROFILE, taskTrust: 'untrusted-content' }} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onApprove={() => undefined} />);
    expect(html).toContain('APPROVAL REQUIRED');
    expect(html).toContain('Allow');
    expect(html).toContain('Deny');
    expect(html).toContain('tool-step');
    expect(html).toContain('filesystem.write');
    expect(html).toContain('safe');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users/iu);

    const recovery = renderToStaticMarkup(<ConversationShell run={runFixture('needs-recovery')} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onRetry={() => undefined} />);
    expect(recovery).toContain('RECOVERY REQUIRED');
    expect(recovery).toContain('Retry as new run');
    expect(recovery).not.toContain('APPROVAL REQUIRED');
  });

  it('renders the immutable permission snapshot beside the run timeline', () => {
    const permissionSnapshot = {
      schemaVersion: 'ready4vibe_permission_profile_run_snapshot_v1',
      status: 'ready',
      reasonCode: 'PROFILE_READY',
      profileRevision: 'profile-1',
      policyRevision: 'policy-1',
      requestedProfile: { schemaVersion: 'ready4vibe_permission_profile_v1', profileId: 'workspace-coding', filesystemScope: 'workspace-only', processScope: 'none', networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'bounded-auto', taskTrust: 'trusted-workspace', workspaceId: 'workspace-default', policyRevision: 'policy-1', profileRevision: 'profile-1', requiresConfirmation: false, updatedAt: '2026-08-05T00:00:00.000Z' },
      effectiveProfile: { schemaVersion: 'ready4vibe_permission_profile_v1', profileId: 'workspace-coding', filesystemScope: 'workspace-only', processScope: 'none', networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'bounded-auto', taskTrust: 'trusted-workspace', workspaceId: 'workspace-default', policyRevision: 'policy-1', profileRevision: 'profile-1', requiresConfirmation: false, updatedAt: '2026-08-05T00:00:00.000Z' },
      effectiveScope: { kind: 'run', profileId: 'workspace-coding', filesystemScope: 'workspace-only', processScope: 'none', networkMode: 'off', mcpSkillMode: 'off', approvalPosture: 'bounded-auto', taskTrust: 'trusted-workspace', workspaceId: 'workspace-default' },
      grantId: null,
      grantExpiresAt: null,
      capturedAt: '2026-08-05T00:00:00.000Z',
    } as never;
    const html = renderToStaticMarkup(<ConversationShell run={{ ...runFixture('executing'), permissionSnapshot }} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('PERMISSION SNAPSHOT');
    expect(html).toContain('Frozen for this run');
    expect(html).toContain('profile-1');
    expect(html).toContain('workspace-coding');
    expect(html).not.toMatch(/api[_-]?key|Authorization|sessionId|accessToken|C:\\Users\\|\/home\//iu);
  });
});

describe('ConversationShell streaming controls', () => {
  it('turns the send button into a stop button while a run streams and drops the separate cancel button', () => {
    const html = renderToStaticMarkup(<ConversationShell run={runFixture('executing')} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('>Stop</span>');
    expect(html).not.toContain('cancel-button');
    expect(html).not.toContain('>Start run</span>');
  });

  it('restores the send button for terminal runs', () => {
    const html = renderToStaticMarkup(<ConversationShell run={runFixture('completed')} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} onCancel={() => undefined} />);
    expect(html).toContain('>Start run</span>');
    expect(html).not.toContain('>Stop</span>');
  });

  it('renders tool calls as ordered steps with status metadata outside the assistant text', () => {
    const events = [
      { version: 1 as const, id: 'e1', seq: 1, runId: 'run_shell', type: 'tool.started', at: '2026-08-05T00:00:00.000Z', payload: { callId: 'call_1', toolId: 'filesystem.list' } },
      { version: 1 as const, id: 'e2', seq: 2, runId: 'run_shell', type: 'tool.output', at: '2026-08-05T00:00:01.000Z', payload: { callId: 'call_1', bytes: 12, content: JSON.stringify(['src/']) } },
      { version: 1 as const, id: 'e3', seq: 3, runId: 'run_shell', type: 'tool.completed', at: '2026-08-05T00:00:02.000Z', payload: { callId: 'call_1', toolId: 'filesystem.list', success: true } },
      { version: 1 as const, id: 'e4', seq: 4, runId: 'run_shell', type: 'tool.started', at: '2026-08-05T00:00:03.000Z', payload: { callId: 'call_2', toolId: 'filesystem.search' } },
      { version: 1 as const, id: 'e5', seq: 5, runId: 'run_shell', type: 'tool.completed', at: '2026-08-05T00:00:04.000Z', payload: { callId: 'call_2', toolId: 'filesystem.search', success: false, code: 'PATH_GUARD' } },
    ];
    const html = renderToStaticMarkup(<ConversationShell run={runFixture('completed')} events={events} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} />);
    expect(html.match(/class="tool-step"/gu)?.length).toBe(2);
    expect(html.indexOf('filesystem.list')).toBeLessThan(html.indexOf('filesystem.search'));
    expect(html).toContain('data-status="success"');
    expect(html).toContain('data-status="failed"');
    expect(html).toContain('PATH_GUARD');
    expect(html).toContain('chat-text');
    expect(html).not.toContain('chat-message-assistant');
  });
});
