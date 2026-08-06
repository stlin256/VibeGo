import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';
import { variantClass } from '../../lib/variants.js';

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'glow';
export type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const buttonVariantClasses: Record<ButtonVariant, string> = {
  default: 'ui-button--default',
  secondary: 'ui-button--secondary',
  outline: 'ui-button--outline',
  ghost: 'ui-button--ghost',
  destructive: 'ui-button--destructive',
  glow: 'ui-button--glow',
};

const buttonSizeClasses: Record<ButtonSize, string> = {
  default: 'ui-button--size-default',
  sm: 'ui-button--size-sm',
  lg: 'ui-button--size-lg',
  icon: 'ui-button--size-icon',
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: ClassValue;
  children?: ReactNode;
}

export function buttonVariants({ variant = 'default', size = 'default', className }: Pick<ButtonProps, 'variant' | 'size' | 'className'> = {}): string {
  return variantClass(variantClass('ui-button', buttonVariantClasses, variant), buttonSizeClasses, size, className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'default', loading = false, disabled = false, className, children, ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={props.type ?? 'button'}
      className={buttonVariants({ variant, size, className })}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
    >
      {loading && <span className="ui-button__spinner" aria-hidden="true" />}
      <span className="ui-button__content">{children}</span>
    </button>
  );
});
