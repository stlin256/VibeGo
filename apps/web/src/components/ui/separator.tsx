import type { HTMLAttributes, JSX } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface SeparatorProps extends Omit<HTMLAttributes<HTMLDivElement>, 'aria-orientation' | 'className'> {
  orientation?: 'horizontal' | 'vertical';
  className?: ClassValue;
}

export function Separator({ orientation = 'horizontal', className, ...props }: SeparatorProps): JSX.Element {
  return <div {...props} role="separator" aria-orientation={orientation} className={cn('ui-separator', `ui-separator--${orientation}`, className)} />;
}
