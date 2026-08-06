import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';
import { variantClass } from '../../lib/variants.js';

export type CardVariant = 'default' | 'surface' | 'elevated' | 'ghost';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  variant?: CardVariant;
  interactive?: boolean;
  className?: ClassValue;
  children?: ReactNode;
}

const cardVariants: Record<CardVariant, string> = {
  default: '',
  surface: 'ui-card--surface',
  elevated: 'ui-card--elevated',
  ghost: 'ui-card--ghost',
};

export function Card({ variant = 'default', interactive = false, className, ...props }: CardProps): JSX.Element {
  return <section {...props} className={variantClass('ui-card', cardVariants, variant, cn(interactive && 'ui-card--interactive', className))} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement> & { className?: ClassValue }): JSX.Element {
  return <div {...props} className={cn('ui-card__header', className)} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement> & { className?: ClassValue }): JSX.Element {
  return <h3 {...props} className={cn('ui-card__title', className)} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement> & { className?: ClassValue }): JSX.Element {
  return <p {...props} className={cn('ui-card__description', className)} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement> & { className?: ClassValue }): JSX.Element {
  return <div {...props} className={cn('ui-card__content', className)} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement> & { className?: ClassValue }): JSX.Element {
  return <div {...props} className={cn('ui-card__footer', className)} />;
}

export function CardMedia({ className, ...props }: HTMLAttributes<HTMLDivElement> & { className?: ClassValue }): JSX.Element {
  return <div {...props} className={cn('ui-card__media', className)} />;
}
