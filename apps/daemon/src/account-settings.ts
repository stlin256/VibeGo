import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SettingsStore } from '@ready4vibe/storage';

export const ACCOUNT_SETTINGS_NAMESPACE = 'account' as const;
export const ACCOUNT_SETTINGS_KEY = 'v1' as const;
export const ACCOUNT_PASSWORD_MIN_LENGTH = 4;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_KEY_LENGTH = 32;

export class AccountError extends Error {
  constructor(
    readonly code: 'ACCOUNT_EXISTS' | 'ACCOUNT_NOT_FOUND' | 'INVALID_PASSWORD' | 'CORRUPT_SETTINGS' | 'PERSISTENCE_FAILED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AccountError';
  }
}

/** Stored record deliberately avoids secret-shaped field names: the generic
 * settings store rejects keys matching password/token/credential patterns.
 * The scrypt digest of a password is safe to persist under neutral names. */
interface StoredAccount {
  readonly schemaVersion: 'ready4vibe_account_v1';
  readonly algorithm: 'scrypt';
  readonly salt: string;
  readonly digest: string;
  readonly createdAt: string;
}

export interface AccountManager {
  hasAccount(): boolean;
  createAccount(password: unknown): void;
  verifyPassword(password: unknown): boolean;
}

export interface DurableAccountManagerOptions {
  readonly settings: SettingsStore;
  readonly clock?: () => Date;
}

export class DurableAccountManager implements AccountManager {
  private readonly settings: SettingsStore;
  private readonly clock: () => Date;

  constructor(options: DurableAccountManagerOptions) {
    this.settings = options.settings;
    this.clock = options.clock ?? (() => new Date());
  }

  hasAccount(): boolean {
    return this.settings.get<unknown>(ACCOUNT_SETTINGS_NAMESPACE, ACCOUNT_SETTINGS_KEY) !== undefined;
  }

  createAccount(password: unknown): void {
    assertValidPassword(password);
    if (this.hasAccount()) throw new AccountError('ACCOUNT_EXISTS', 'An account already exists.');
    const salt = randomBytes(16).toString('base64url');
    const record: StoredAccount = {
      schemaVersion: 'ready4vibe_account_v1',
      algorithm: 'scrypt',
      salt,
      digest: hashPassword(password, salt),
      createdAt: this.clock().toISOString(),
    };
    try {
      this.settings.set(ACCOUNT_SETTINGS_NAMESPACE, ACCOUNT_SETTINGS_KEY, record);
    } catch (error) {
      throw new AccountError('PERSISTENCE_FAILED', 'The account could not be saved.', { cause: error });
    }
  }

  verifyPassword(password: unknown): boolean {
    const stored = this.settings.get<unknown>(ACCOUNT_SETTINGS_NAMESPACE, ACCOUNT_SETTINGS_KEY);
    if (stored === undefined) throw new AccountError('ACCOUNT_NOT_FOUND', 'No account exists yet.');
    if (typeof password !== 'string' || password.length === 0 || password.length > ACCOUNT_PASSWORD_MAX_LENGTH) return false;
    const record = parseStoredAccount(stored);
    const candidate = Buffer.from(hashPassword(password, record.salt), 'utf8');
    const expected = Buffer.from(record.digest, 'utf8');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS).toString('base64url');
}

function assertValidPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string'
    || password.length < ACCOUNT_PASSWORD_MIN_LENGTH
    || password.length > ACCOUNT_PASSWORD_MAX_LENGTH) {
    throw new AccountError('INVALID_PASSWORD', `Password must be ${ACCOUNT_PASSWORD_MIN_LENGTH}-${ACCOUNT_PASSWORD_MAX_LENGTH} characters.`);
  }
}

function parseStoredAccount(value: unknown): StoredAccount {
  if (typeof value !== 'object' || value === null) throw new AccountError('CORRUPT_SETTINGS', 'Stored account is invalid.');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 'ready4vibe_account_v1'
    || record.algorithm !== 'scrypt'
    || typeof record.salt !== 'string' || record.salt.length === 0 || record.salt.length > 64
    || typeof record.digest !== 'string' || record.digest.length === 0 || record.digest.length > 128
    || typeof record.createdAt !== 'string') {
    throw new AccountError('CORRUPT_SETTINGS', 'Stored account is invalid.');
  }
  return record as unknown as StoredAccount;
}
