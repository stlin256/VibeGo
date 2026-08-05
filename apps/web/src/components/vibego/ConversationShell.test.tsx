import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_PROFILE, type RunSnapshot } from '../../api.js';
import { ConversationShell, type ConversationCopy } from './ConversationShell.js';

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

describe('ConversationShell', () => {
  it('renders the empty conversation and composer through typed props', () => {
    const html = renderToStaticMarkup(<ConversationShell run={undefined} events={[]} message="" profile={DEFAULT_RUN_PROFILE} composerRef={{ current: null }} copy={copy} onMessageChange={() => undefined} onSubmit={() => undefined} />);
    expect(html).toContain('Conversation and run timeline');
    expect(html).toContain('Conversation stream');
    expect(html).toContain('composer-panel');
    expect(html).toContain('aria-label="Task input"');
    expect(html).toContain('Describe what you want to build.');
    expect(html).toContain('Start run');
    expect(html).toContain('trusted workspace · read-only');
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
    expect(html).toContain('TOOL OUTPUTS');
    expect(html).toContain('safe');
    expect(html).toContain('untrusted content · external sandbox');
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
