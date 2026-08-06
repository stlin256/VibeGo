import type { JSX, ReactNode } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export type TooltipSide = 'top' | 'bottom';

export interface TooltipProps {
  readonly content: ReactNode;
  readonly side?: TooltipSide;
  readonly className?: ClassValue;
  readonly children: ReactNode;
}

/** Presentational tooltip; visibility is CSS-driven on hover/focus-within. */
export function Tooltip({ content, side = 'top', className, children }: TooltipProps): JSX.Element {
  return (
    <span className={cn('ui-tooltip', className)}>
      <span className="ui-tooltip__trigger">{children}</span>
      <span role="tooltip" className={cn('ui-tooltip__bubble', side === 'bottom' && 'ui-tooltip__bubble--bottom')}>{content}</span>
    </span>
  );
}
