import type { JSX, LabelHTMLAttributes } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface LabelProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, 'className'> {
  required?: boolean;
  className?: ClassValue;
}

export function Label({ required = false, className, ...props }: LabelProps): JSX.Element {
  return <label {...props} className={cn('ui-label', required && 'ui-label--required', className)} />;
}
