import type { JSX } from 'react';
import { Button } from '../ui/index.js';

export interface RecoveryCardProps {
  readonly onRetry?: (() => void) | undefined;
}

/** Recovery presentation; retry remains an explicit new-run callback. */
export function RecoveryCard({ onRetry }: RecoveryCardProps): JSX.Element {
  return (
    <div className="recovery-card">
      <div>
        <div className="eyebrow">RECOVERY REQUIRED</div>
        <strong>This run stopped safely after a daemon restart.</strong>
        <p className="muted">Retry creates a new run from the original safety policy; interrupted tool calls are never replayed.</p>
      </div>
      <Button onClick={onRetry}>Retry as new run</Button>
    </div>
  );
}
