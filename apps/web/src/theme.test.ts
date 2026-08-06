import { describe, expect, it } from 'vitest';
import { applyThemeToDocument, cycleTheme, isTheme, loadTheme, resolveTheme, saveTheme } from './theme.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('theme helpers', () => {
  it('validates and resolves theme values with a light default', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('blue')).toBe(false);
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme(undefined)).toBe('light');
  });

  it('prefers the stored choice, then the OS preference, then light', () => {
    expect(loadTheme({ storage: memoryStorage({ 'vibego.theme.v1': 'dark' }), prefersDark: () => false })).toBe('dark');
    expect(loadTheme({ storage: memoryStorage(), prefersDark: () => true })).toBe('dark');
    expect(loadTheme({ storage: memoryStorage(), prefersDark: () => false })).toBe('light');
    expect(loadTheme({ storage: memoryStorage({ 'vibego.theme.v1': 'neon-forever-and-ever' }), prefersDark: () => true })).toBe('dark');
  });

  it('persists a bounded theme value', () => {
    const storage = memoryStorage();
    saveTheme('dark', { storage });
    expect(storage.getItem('vibego.theme.v1')).toBe('dark');
  });

  it('applies data-theme to the document element', () => {
    const attributes = new Map<string, string>();
    const element = { setAttribute: (name: string, value: string) => void attributes.set(name, value) } as unknown as HTMLElement;
    applyThemeToDocument('dark', element);
    expect(attributes.get('data-theme')).toBe('dark');
    expect(() => applyThemeToDocument('light', null)).not.toThrow();
  });

  it('cycles between light and dark', () => {
    expect(cycleTheme('light')).toBe('dark');
    expect(cycleTheme('dark')).toBe('light');
  });
});
