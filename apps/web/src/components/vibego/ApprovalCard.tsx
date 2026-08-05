import type { JSX } from 'react';
import type { ApprovalSummary, RunConfigInput } from '../../api.js';
import { Button } from '../ui/index.js';

export interface ApprovalCardProps {
  readonly approval: ApprovalSummary;
  readonly sandboxMode: RunConfigInput['sandbox']['mode'];
  readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined;
  readonly reviewStatus?: ApprovalReviewPresentation | undefined;
}

export type ApprovalReviewPresentationState = 'reviewed' | 'asked' | 'denied' | 'review-unavailable';

export interface ApprovalReviewPresentation {
  readonly state: ApprovalReviewPresentationState;
  readonly reasonCode?: string | undefined;
  readonly latencyMs?: number | undefined;
}

/** Bounded approval presentation; the parent owns the authenticated decision. */
export function ApprovalCard({ approval, sandboxMode, onApprove, reviewStatus }: ApprovalCardProps): JSX.Element {
  return (
    <div className="approval-card">
      <div>
        <div className="eyebrow">APPROVAL REQUIRED</div>
        <strong>{approval.toolId}@{approval.toolVersion}</strong>
        <p className="muted">{approval.risk} · {approval.argumentBytes} bytes · expires {new Date(approval.expiresAt).toLocaleTimeString()}</p>
        {approval.details && <p className="muted">sandbox: {approval.details.sandboxProvider ?? sandboxMode}{approval.details.network ? ` · network: ${approval.details.network}` : ''}{approval.details.sandboxImageDigest ? ` · image: ${approval.details.sandboxImageDigest}` : ''}</p>}
        {reviewStatus && <div className="approval-review-summary" data-review-status={reviewStatus.state} role="status" aria-live="polite"><strong>{reviewLabel(reviewStatus.state)}</strong><span>{reviewDescription(reviewStatus.state)}{reviewStatus.reasonCode ? ` · ${reviewStatus.reasonCode}` : ''}{reviewStatus.latencyMs === undefined ? '' : ` · ${reviewStatus.latencyMs} ms`}</span></div>}
      </div>
      <div className="approval-actions">
        <Button aria-label="Allow this approval once" onClick={() => onApprove?.(approval.approvalId, 'allow')}>Allow once</Button>
        <Button variant="destructive" className="cancel-button" onClick={() => onApprove?.(approval.approvalId, 'deny')}>Deny</Button>
      </div>
      <p className="approval-session-note">Session-wide grants are managed in Permission settings.</p>
    </div>
  );
}

function reviewLabel(state: ApprovalReviewPresentationState): string {
  switch (state) {
    case 'reviewed': return 'REVIEWED';
    case 'asked': return 'ASKED';
    case 'denied': return 'DENIED';
    case 'review-unavailable': return 'REVIEW UNAVAILABLE';
  }
}

function reviewDescription(state: ApprovalReviewPresentationState): string {
  switch (state) {
    case 'reviewed': return 'The bounded reviewer matched this exact low-risk key; the daemon policy still controls the one-time action.';
    case 'asked': return 'The reviewer kept this request on the user approval path.';
    case 'denied': return 'The reviewer denied this request; no capability is widened.';
    case 'review-unavailable': return 'The review could not complete; the normal deterministic approval gate remains active.';
  }
}
