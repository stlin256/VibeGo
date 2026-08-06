export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vibego.theme.v1';
const DEFAULT_THEME: Theme = 'light';

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

export function resolveTheme(value: unknown): Theme {
  return isTheme(value) ? value : DEFAULT_THEME;
}

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ThemeEnvironment {
  storage?: ThemeStorage | undefined;
  prefersDark?: (() => boolean) | undefined;
}

function defaultStorage(): ThemeStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function defaultPrefersDark(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/** Stored choice wins; otherwise the OS preference; otherwise light. */
export function loadTheme(environment: ThemeEnvironment = {}): Theme {
  const storage = environment.storage ?? defaultStorage();
  const stored = storage?.getItem(STORAGE_KEY);
  if (typeof stored === 'string' && stored.length <= 16 && isTheme(stored)) return stored;
  return (environment.prefersDark ?? defaultPrefersDark)() ? 'dark' : DEFAULT_THEME;
}

export function saveTheme(theme: Theme, environment: ThemeEnvironment = {}): void {
  const storage = environment.storage ?? defaultStorage();
  storage?.setItem(STORAGE_KEY, theme);
}

export function applyThemeToDocument(theme: Theme, documentElement: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  documentElement?.setAttribute('data-theme', theme);
}

export function cycleTheme(theme: Theme): Theme {
  return theme === 'light' ? 'dark' : 'light';
}
