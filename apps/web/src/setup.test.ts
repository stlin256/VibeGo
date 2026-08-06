import { describe, expect, it } from 'vitest';
import { loadSetupDismissed, resetSetupDismissed, saveSetupDismissed } from './setup.js';

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('first-run setup state', () => {
  it('defaults to not dismissed and persists dismissal only', () => {
    const target = storage();
    expect(loadSetupDismissed(target)).toBe(false);
    saveSetupDismissed(target);
    expect(loadSetupDismissed(target)).toBe(true);
    expect(JSON.stringify([...target.values.keys()])).not.toMatch(/api[_-]?key|token|secret/iu);
  });

  it('rejects unexpected stored values and can reset', () => {
    const target = storage({ 'vibego.setup.v1': 'yes' });
    expect(loadSetupDismissed(target)).toBe(false);
    saveSetupDismissed(target);
    resetSetupDismissed(target);
    expect(loadSetupDismissed(target)).toBe(false);
  });

  it('tolerates unavailable storage', () => {
    expect(loadSetupDismissed(undefined)).toBe(false);
    expect(() => saveSetupDismissed(undefined)).not.toThrow();
    expect(() => resetSetupDismissed(undefined)).not.toThrow();
  });
});
