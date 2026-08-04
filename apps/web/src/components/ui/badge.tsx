import type { HTMLAttributes, JSX } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';
import { variantClass } from '../../lib/variants.js';

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';
export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  variant?: BadgeVariant;
  className?: ClassValue;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'ui-badge--default',
  secondary: 'ui-badge--secondary',
  outline: 'ui-badge--outline',
  destructive: 'ui-badge--destructive',
};

export function Badge({ variant = 'default', className, ...props }: BadgeProps): JSX.Element {
  return <span {...props} className={variantClass('ui-badge', badgeVariants, variant, className)} />;
}
