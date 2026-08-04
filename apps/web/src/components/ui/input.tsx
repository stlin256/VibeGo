import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  invalid?: boolean;
  className?: ClassValue;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid = false, className, ...props }, ref) {
  return <input {...props} ref={ref} className={cn('ui-input', invalid && 'ui-input--invalid', className)} aria-invalid={invalid ? true : undefined} />;
});
