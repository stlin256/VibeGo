import type { JSX, LabelHTMLAttributes } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface LabelProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'className'> {
  className?: ClassValue;
}

export function Label({ className, ...props }: LabelProps): JSX.Element {
  return <label {...props} className={cn('ui-label', className)} />;
}
