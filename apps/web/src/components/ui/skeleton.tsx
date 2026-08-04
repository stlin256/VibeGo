import type { HTMLAttributes, JSX } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  label?: string;
  className?: ClassValue;
}

export function Skeleton({ label, className, ...props }: SkeletonProps): JSX.Element {
  return <span {...props} className={cn('ui-skeleton', className)} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
