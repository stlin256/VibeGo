import { describe, expect, it } from 'vitest';
import { focusableElements, nextFocusIndex } from './accessibility.js';

describe('Web accessibility helpers', () => {
  it('cycles focus forward and backward without unbounded indexes', () => {
    expect(nextFocusIndex(-1, 3)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
    expect(nextFocusIndex(2, 3)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
    expect(nextFocusIndex(0, 0)).toBe(-1);
    expect(nextFocusIndex(0, Number.MAX_SAFE_INTEGER + 1)).toBe(-1);
  });

  it('filters disabled, hidden and aria-hidden controls from a dialog scope', () => {
    const visible = { hidden: false, getAttribute: () => null } as unknown as HTMLElement;
    const hidden = { hidden: true, getAttribute: () => null } as unknown as HTMLElement;
    const ariaHidden = { hidden: false, getAttribute: () => 'true' } as unknown as HTMLElement;
    const root = { querySelectorAll: () => [visible, hidden, ariaHidden] } as unknown as HTMLElement;
    expect(focusableElements(root)).toEqual([visible]);
  });
});
