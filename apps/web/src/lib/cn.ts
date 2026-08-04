export type ClassValue = string | false | null | undefined;

/** Compose source-owned utility classes without a styling runtime. */
export function cn(...values: readonly ClassValue[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(' ');
}
