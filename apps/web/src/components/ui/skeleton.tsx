import type { HTMLAttributes, JSX } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';
import { variantClass } from '../../lib/variants.js';

export type SkeletonVariant = 'line' | 'card' | 'circle' | 'text' | 'title';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  variant?: SkeletonVariant;
  label?: string;
  className?: ClassValue;
}

const skeletonVariants: Record<SkeletonVariant, string> = {
  line: '',
  card: 'ui-skeleton--card',
  circle: 'ui-skeleton--circle',
  text: 'ui-skeleton--text',
  title: 'ui-skeleton--title',
};

export function Skeleton({ variant = 'line', label, className, ...props }: SkeletonProps): JSX.Element {
  return <span {...props} className={variantClass('ui-skeleton', skeletonVariants, variant, className)} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
