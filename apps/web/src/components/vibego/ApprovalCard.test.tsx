import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalCard } from './ApprovalCard.js';

const approval = {
  approvalId: 'ap_card',
  runId: 'run_card',
  turnId: 'turn_card',
  callId: 'call_card',
  toolId: 'filesystem.write',
  toolVersion: '1.0.0',
  risk: 'write' as const,
  argumentBytes: 42,
  details: { sandboxProvider: 'docker' as const, sandboxImageDigest: 'sha256:demo', network: 'restricted' as const },
  createdAt: 1,
  expiresAt: 2,
};

const approvalWithoutDetails = {
  approvalId: approval.approvalId,
  runId: approval.runId,
  turnId: approval.turnId,
  callId: approval.callId,
  toolId: approval.toolId,
  toolVersion: approval.toolVersion,
  risk: approval.risk,
  argumentBytes: approval.argumentBytes,
  createdAt: approval.createdAt,
  expiresAt: approval.expiresAt,
} as const;

describe('ApprovalCard', () => {
  it('renders bounded approval metadata and preserves destructive deny semantics', () => {
    const html = renderToStaticMarkup(<ApprovalCard approval={approval} sandboxMode="external-sandbox" onApprove={() => undefined} />);
    expect(html).toContain('class="approval-card"');
    expect(html).toContain('APPROVAL REQUIRED');
    expect(html).toContain('filesystem.write@1.0.0');
    expect(html).toContain('sandbox: docker');
    expect(html).toContain('image: sha256:demo');
    expect(html).toContain('Allow');
    expect(html).toContain('Deny');
    expect(html).toContain('ui-button--destructive');
    expect(html).not.toMatch(/api[_-]?key|Authorization|C:\\Users\\|\/home\/|stdout|argv/iu);
  });

  it('does not invent sandbox details when the bounded projection omits them', () => {
    const html = renderToStaticMarkup(<ApprovalCard approval={approvalWithoutDetails} sandboxMode="read-only" />);
    expect(html).toContain('filesystem.write@1.0.0');
    expect(html).not.toContain('sandbox:');
    expect(html).not.toContain('sha256:demo');
  });

  it('explains a bounded reviewer outcome while keeping the one-time user action', () => {
    const html = renderToStaticMarkup(<ApprovalCard approval={approval} sandboxMode="workspace-write" reviewStatus={{ state: 'review-unavailable', reasonCode: 'timeout', latencyMs: 1_500 }} onApprove={() => undefined} />);
    expect(html).toContain('REVIEW UNAVAILABLE');
    expect(html).toContain('timeout');
    expect(html).toContain('Allow once');
    expect(html).toContain('Session-wide grants are managed in Permission settings.');
    expect(html).not.toContain('auto-approve all');
  });
});
