const STORAGE_KEY = 'vibego.setup.v1';
const DISMISSED_VALUE = 'dismissed';

interface SetupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): SetupStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** First-run setup shows until the user finishes or skips it; then it stays dismissed. */
export function loadSetupDismissed(storage: SetupStorage | undefined = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return typeof raw === 'string' && raw.length <= 16 && raw === DISMISSED_VALUE;
  } catch {
    return false;
  }
}

export function saveSetupDismissed(storage: SetupStorage | undefined = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, DISMISSED_VALUE);
  } catch { /* best effort; the wizard simply reappears next launch */ }
}

export function resetSetupDismissed(storage: SetupStorage | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch { /* best effort */ }
}
