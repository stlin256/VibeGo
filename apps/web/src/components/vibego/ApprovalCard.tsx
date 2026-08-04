import type { JSX } from 'react';
import type { ApprovalSummary, RunConfigInput } from '../../api.js';
import { Button } from '../ui/index.js';

export interface ApprovalCardProps {
  readonly approval: ApprovalSummary;
  readonly sandboxMode: RunConfigInput['sandbox']['mode'];
  readonly onApprove?: ((approvalId: string, decision: 'allow' | 'deny') => void) | undefined;
}

/** Bounded approval presentation; the parent owns the authenticated decision. */
export function ApprovalCard({ approval, sandboxMode, onApprove }: ApprovalCardProps): JSX.Element {
  return (
    <div className="approval-card">
      <div>
        <div className="eyebrow">APPROVAL REQUIRED</div>
        <strong>{approval.toolId}@{approval.toolVersion}</strong>
        <p className="muted">{approval.risk} · {approval.argumentBytes} bytes · expires {new Date(approval.expiresAt).toLocaleTimeString()}</p>
        {approval.details && <p className="muted">sandbox: {approval.details.sandboxProvider ?? sandboxMode}{approval.details.network ? ` · network: ${approval.details.network}` : ''}{approval.details.sandboxImageDigest ? ` · image: ${approval.details.sandboxImageDigest}` : ''}</p>}
      </div>
      <div className="approval-actions">
        <Button onClick={() => onApprove?.(approval.approvalId, 'allow')}>Allow</Button>
        <Button variant="destructive" className="cancel-button" onClick={() => onApprove?.(approval.approvalId, 'deny')}>Deny</Button>
      </div>
    </div>
  );
}
