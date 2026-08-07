import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { AccountError, DurableAccountManager } from './account-settings.js';

describe('DurableAccountManager', () => {
  it('creates exactly one account and verifies its password', () => {
    const manager = new DurableAccountManager({ settings: new InMemorySettingsStore(), clock: () => new Date('2026-08-08T00:00:00.000Z') });
    expect(manager.hasAccount()).toBe(false);
    expect(() => manager.verifyPassword('1234')).toThrowError(new AccountError('ACCOUNT_NOT_FOUND', 'No account exists yet.'));

    manager.createAccount('1234');
    expect(manager.hasAccount()).toBe(true);
    expect(manager.verifyPassword('1234')).toBe(true);
    expect(manager.verifyPassword('1235')).toBe(false);
    expect(manager.verifyPassword('')).toBe(false);
    expect(manager.verifyPassword(1234)).toBe(false);
    expect(() => manager.createAccount('abcd')).toThrowError(new AccountError('ACCOUNT_EXISTS', 'An account already exists.'));
  });

  it('rejects passwords outside the 4-128 character bounds', () => {
    const manager = new DurableAccountManager({ settings: new InMemorySettingsStore() });
    for (const password of ['', '123', 'x'.repeat(129), 1234, null, undefined]) {
      expect(() => manager.createAccount(password)).toThrowError(AccountError);
    }
    expect(manager.hasAccount()).toBe(false);
    manager.createAccount('x'.repeat(128));
    expect(manager.verifyPassword('x'.repeat(128))).toBe(true);
  });

  it('persists only a salted scrypt digest, never the password', () => {
    const settings = new InMemorySettingsStore();
    const manager = new DurableAccountManager({ settings });
    manager.createAccount('correct horse');
    const stored = settings.get<unknown>('account', 'v1');
    expect(JSON.stringify(stored)).not.toContain('correct horse');
    expect(stored).toMatchObject({ schemaVersion: 'ready4vibe_account_v1', algorithm: 'scrypt' });

    // A restarted manager against the same store still verifies.
    const restarted = new DurableAccountManager({ settings });
    expect(restarted.hasAccount()).toBe(true);
    expect(restarted.verifyPassword('correct horse')).toBe(true);
  });

  it('fails closed on corrupt stored records', () => {
    const settings = new InMemorySettingsStore();
    settings.set('account', 'v1', { schemaVersion: 'ready4vibe_account_v1', algorithm: 'scrypt', salt: 42 });
    const manager = new DurableAccountManager({ settings });
    expect(() => manager.verifyPassword('1234')).toThrowError(AccountError);
  });
});
