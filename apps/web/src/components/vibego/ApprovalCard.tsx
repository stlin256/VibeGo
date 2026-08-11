import type { JSX } from 'react';
import type { ApprovalSummary, RunConfigInput } from '../../api.js';
import { Button } from '../ui/index.js';

export interface ApprovalCardProps {
  readonly approval: ApprovalSummary;
  readonly sandboxMode: RunConfigInput['sandbox']['mode'];
  readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined;
  readonly reviewStatus?: ApprovalReviewPresentation | undefined;
  readonly copy: ApprovalCardCopy;
}

export interface ApprovalCardCopy {
  readonly eyebrow: string;
  readonly meta: string;
  readonly sandboxLabel: string;
  readonly networkLabel: string;
  readonly imageLabel: string;
  readonly commandLabel: string;
  readonly allowOnce: string;
  readonly allowAriaLabel: string;
  readonly deny: string;
  readonly sessionNote: string;
  readonly reviewReviewedLabel: string;
  readonly reviewAskedLabel: string;
  readonly reviewDeniedLabel: string;
  readonly reviewUnavailableLabel: string;
  readonly reviewReviewedDescription: string;
  readonly reviewAskedDescription: string;
  readonly reviewDeniedDescription: string;
  readonly reviewUnavailableDescription: string;
}

export type ApprovalReviewPresentationState = 'reviewed' | 'asked' | 'denied' | 'review-unavailable';

export interface ApprovalReviewPresentation {
  readonly state: ApprovalReviewPresentationState;
  readonly reasonCode?: string | undefined;
  readonly latencyMs?: number | undefined;
}

/** Bounded approval presentation; the parent owns the authenticated decision. */
export function ApprovalCard({ approval, sandboxMode, onApprove, reviewStatus, copy }: ApprovalCardProps): JSX.Element {
  return (
    <div className="approval-card" data-risk={approval.risk}>
      <div>
        <div className="eyebrow">{copy.eyebrow}</div>
        <strong>{approval.toolId}@{approval.toolVersion}</strong>
        <p className="muted">{formatApprovalMeta(copy.meta, approval)}</p>
        {approval.details && <p className="muted">{copy.sandboxLabel}: {approval.details.sandboxProvider ?? sandboxMode}{approval.details.network ? ` · ${copy.networkLabel}: ${approval.details.network}` : ''}{approval.details.sandboxImageDigest ? ` · ${copy.imageLabel}: ${approval.details.sandboxImageDigest}` : ''}</p>}
        {approval.details?.command && <p className="muted approval-command"><code>{copy.commandLabel}: {approval.details.command}</code></p>}
        {reviewStatus && <div className="approval-review-summary" data-review-status={reviewStatus.state} role="status" aria-live="polite"><strong>{reviewLabel(copy, reviewStatus.state)}</strong><span>{reviewDescription(copy, reviewStatus.state)}{reviewStatus.reasonCode ? ` · ${reviewStatus.reasonCode}` : ''}{reviewStatus.latencyMs === undefined ? '' : ` · ${reviewStatus.latencyMs} ms`}</span></div>}
      </div>
      <div className="approval-actions">
        <Button aria-label={copy.allowAriaLabel} onClick={() => onApprove?.(approval.approvalId, 'allow')}>{copy.allowOnce}</Button>
        <Button variant="destructive" className="cancel-button" onClick={() => onApprove?.(approval.approvalId, 'deny')}>{copy.deny}</Button>
      </div>
      <p className="approval-session-note">{copy.sessionNote}</p>
    </div>
  );
}

function formatApprovalMeta(template: string, approval: ApprovalSummary): string {
  return template
    .replace('{risk}', approval.risk)
    .replace('{bytes}', String(approval.argumentBytes))
    .replace('{time}', new Date(approval.expiresAt).toLocaleTimeString());
}

function reviewLabel(copy: ApprovalCardCopy, state: ApprovalReviewPresentationState): string {
  switch (state) {
    case 'reviewed': return copy.reviewReviewedLabel;
    case 'asked': return copy.reviewAskedLabel;
    case 'denied': return copy.reviewDeniedLabel;
    case 'review-unavailable': return copy.reviewUnavailableLabel;
  }
}

function reviewDescription(copy: ApprovalCardCopy, state: ApprovalReviewPresentationState): string {
  switch (state) {
    case 'reviewed': return copy.reviewReviewedDescription;
    case 'asked': return copy.reviewAskedDescription;
    case 'denied': return copy.reviewDeniedDescription;
    case 'review-unavailable': return copy.reviewUnavailableDescription;
  }
}
