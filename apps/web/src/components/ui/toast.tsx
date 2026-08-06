import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';
import { variantClass } from '../../lib/variants.js';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'title'> {
  readonly variant?: ToastVariant;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly onDismiss?: (() => void) | undefined;
  readonly className?: ClassValue;
}

const toastVariants: Record<ToastVariant, string> = {
  info: 'ui-toast--info',
  success: 'ui-toast--success',
  warning: 'ui-toast--warning',
  error: 'ui-toast--error',
};

/** Presentational toast; the caller owns visibility, timers and dismissal state. */
export function Toast({ variant = 'info', title, description, onDismiss, className, ...props }: ToastProps): JSX.Element {
  return (
    <div {...props} role={variant === 'warning' || variant === 'error' ? 'alert' : 'status'} className={variantClass('ui-toast', toastVariants, variant, className)}>
      <div className="ui-toast__body">
        <strong className="ui-toast__title">{title}</strong>
        {description !== undefined && <p className="ui-toast__description">{description}</p>}
      </div>
      {onDismiss && <button type="button" className="ui-toast__dismiss" aria-label="Dismiss notification" onClick={onDismiss}>×</button>}
    </div>
  );
}

export interface ToastViewportProps {
  readonly className?: ClassValue;
  readonly children: ReactNode;
}

/** Fixed stacking region for toasts; announce via a polite live region. */
export function ToastViewport({ className, children }: ToastViewportProps): JSX.Element {
  return <div className={cn('ui-toast-viewport', className)} aria-live="polite">{children}</div>;
}
