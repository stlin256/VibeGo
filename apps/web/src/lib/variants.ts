import { cn, type ClassValue } from './cn.js';

/** Small bounded variant helper used by local primitives. */
export function variantClass<T extends string>(base: string, variants: Readonly<Record<T, string>>, value: T, className?: ClassValue): string {
  return cn(base, variants[value], className);
}
