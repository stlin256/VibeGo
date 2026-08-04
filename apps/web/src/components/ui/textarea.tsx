import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn, type ClassValue } from '../../lib/cn.js';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {
  invalid?: boolean;
  className?: ClassValue;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid = false, className, ...props }, ref) {
  return <textarea {...props} ref={ref} className={cn('ui-textarea', invalid && 'ui-textarea--invalid', className)} aria-invalid={invalid ? true : undefined} />;
});
