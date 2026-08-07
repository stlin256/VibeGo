import type { PersistedSession, SessionPersistence } from '@ready4vibe/auth';
import type { SettingsStore } from '@ready4vibe/storage';

export const AUTH_SESSIONS_NAMESPACE = 'auth-sessions' as const;
export const AUTH_SESSIONS_KEY = 'v1' as const;

/** SettingsStore has no enumeration, so all durable sessions live in one
 * versioned snapshot. Only digests and metadata are stored — never tokens. */
export function createAuthSessionPersistence(settings: SettingsStore): SessionPersistence {
  const read = (): PersistedSession[] => {
    const stored = settings.get<unknown>(AUTH_SESSIONS_NAMESPACE, AUTH_SESSIONS_KEY);
    if (stored === undefined) return [];
    if (typeof stored !== 'object' || stored === null) return [];
    const sessions = (stored as Record<string, unknown>).sessions;
    return Array.isArray(sessions) ? (sessions as PersistedSession[]) : [];
  };
  const write = (sessions: readonly PersistedSession[]): void => {
    settings.set(AUTH_SESSIONS_NAMESPACE, AUTH_SESSIONS_KEY, { schemaVersion: 'ready4vibe_auth_sessions_v1', sessions });
  };
  return {
    load: () => read(),
    save: (session) => {
      write([...read().filter((entry) => entry.sessionKey !== session.sessionKey), session]);
    },
    drop: (sessionKey) => {
      write(read().filter((entry) => entry.sessionKey !== sessionKey));
    },
  };
}
