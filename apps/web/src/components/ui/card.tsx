import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  className?: ClassValue;
  children?: ReactNode;
}

export function Card({ className, ...props }: CardProps): JSX.Element {
  return <section {...props} className={cn('ui-card', className)} />;
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
