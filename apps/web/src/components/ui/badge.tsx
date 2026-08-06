import type { HTMLAttributes, JSX } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';
import { variantClass } from '../../lib/variants.js';

export type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive' | 'amber' | 'lime';
export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
  className?: ClassValue;
}

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'ui-badge--default',
  secondary: 'ui-badge--secondary',
  outline: 'ui-badge--outline',
  destructive: 'ui-badge--destructive',
  amber: 'ui-badge--amber',
  lime: 'ui-badge--lime',
};

export function Badge({ variant = 'default', dot = false, pulse = false, className, ...props }: BadgeProps): JSX.Element {
  return <span {...props} className={variantClass('ui-badge', badgeVariants, variant, cn(dot && 'ui-badge--dot', pulse && 'ui-badge--pulse', className))} />;
}
