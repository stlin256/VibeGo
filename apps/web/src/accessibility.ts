const FOCUSABLE_SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function nextFocusIndex(currentIndex: number, count: number, backwards = false): number {
  if (!Number.isSafeInteger(count) || count <= 0) return -1;
  if (!Number.isSafeInteger(currentIndex) || currentIndex < 0 || currentIndex >= count) return backwards ? count - 1 : 0;
  return backwards ? (currentIndex - 1 + count) % count : (currentIndex + 1) % count;
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    return !element.hidden && element.getAttribute('aria-hidden') !== 'true';
  });
}

export function focusFirst(root: HTMLElement | null): void {
  if (!root) return;
  focusableElements(root)[0]?.focus();
}
