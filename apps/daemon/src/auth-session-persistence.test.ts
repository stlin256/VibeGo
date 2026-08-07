import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { createAuthSessionPersistence } from './auth-session-persistence.js';

function session(sessionKey: string, expiresAt = 1_000): { sessionKey: string; csrfDigest: string; sessionId: string; expiresAt: number; createdAt: number } {
  return { sessionKey, csrfDigest: 'a'.repeat(64), sessionId: `session_${sessionKey.slice(0, 8)}`, expiresAt, createdAt: 500 };
}

describe('createAuthSessionPersistence', () => {
  it('saves, loads and drops sessions through the settings store', () => {
    const persistence = createAuthSessionPersistence(new InMemorySettingsStore());
    expect(persistence.load()).toEqual([]);

    persistence.save(session('a'.repeat(64)));
    persistence.save(session('b'.repeat(64), 2_000));
    expect(persistence.load().map((entry) => entry.sessionKey)).toEqual(['a'.repeat(64), 'b'.repeat(64)]);

    // Re-saving the same key replaces rather than duplicates.
    persistence.save(session('a'.repeat(64), 3_000));
    expect(persistence.load().find((entry) => entry.sessionKey === 'a'.repeat(64))?.expiresAt).toBe(3_000);
    expect(persistence.load()).toHaveLength(2);

    persistence.drop('a'.repeat(64));
    expect(persistence.load().map((entry) => entry.sessionKey)).toEqual(['b'.repeat(64)]);
  });

  it('tolerates a corrupt snapshot by returning an empty list', () => {
    const settings = new InMemorySettingsStore();
    settings.set('auth-sessions', 'v1', { schemaVersion: 'ready4vibe_auth_sessions_v1', sessions: 'not-an-array' });
    expect(createAuthSessionPersistence(settings).load()).toEqual([]);
  });
});
