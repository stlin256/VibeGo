import type { JSX } from 'react';
import { Button } from '../ui/index.js';

export interface RecoveryCardCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly action: string;
}

export interface RecoveryCardProps {
  readonly copy: RecoveryCardCopy;
  readonly onRetry?: (() => void) | undefined;
}

/** Recovery presentation; retry remains an explicit new-run callback. */
export function RecoveryCard({ copy, onRetry }: RecoveryCardProps): JSX.Element {
  return (
    <div className="recovery-card">
      <div>
        <div className="eyebrow">{copy.eyebrow}</div>
        <strong>{copy.title}</strong>
        <p className="muted">{copy.description}</p>
      </div>
      <Button onClick={onRetry}>{copy.action}</Button>
    </div>
  );
}
