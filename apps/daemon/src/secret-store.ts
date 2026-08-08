import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Small encrypted-at-rest credential store. The generic SettingsStore
 * deliberately rejects secret-shaped keys, so runtime credentials live here
 * instead: AES-256-GCM with a per-install random master key. Both files are
 * written user-readable only (0600); protection relies on the OS account ACL
 * of the data directory, so it resists casual inspection and backup leaks,
 * not a process already running as the same OS user.
 */
export interface SecretStore {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  delete(name: string): void;
}

export class SecretStoreError extends Error {
  readonly code = 'SECRET_STORE_FAILED';

  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

const KEY_FILE = 'master.key';
const STORE_FILE = 'secrets.json';
const STORE_SCHEMA_VERSION = 'ready4vibe_secrets_v1';
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAX_SECRET_BYTES = 8 * 1024;
const MAX_STORE_BYTES = 256 * 1024;

interface SecretEntry {
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
}

export class FileSecretStore implements SecretStore {
  private readonly storePath: string;
  private readonly key: Buffer;

  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true });
    this.storePath = join(directory, STORE_FILE);
    this.key = this.loadOrCreateKey(join(directory, KEY_FILE));
  }

  get(name: string): string | undefined {
    assertValidName(name);
    const entry = this.readEntries()[name];
    if (!entry) return undefined;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(entry.iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64url'));
      const plain = Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64url')), decipher.final()]);
      const value = plain.toString('utf8');
      return value.length > 0 && value.length <= MAX_SECRET_BYTES ? value : undefined;
    } catch {
      // Tampered or key-rotated entries fail closed: callers see "missing".
      return undefined;
    }
  }

  set(name: string, value: string): void {
    assertValidName(name);
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET_BYTES) {
      throw new SecretStoreError('Secret value is outside the allowed bounds.');
    }
    const entries = this.readEntries();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    entries[name] = {
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      data: data.toString('base64url'),
    };
    this.writeEntries(entries);
  }

  delete(name: string): void {
    assertValidName(name);
    const entries = this.readEntries();
    if (!(name in entries)) return;
    delete entries[name];
    this.writeEntries(entries);
  }

  private loadOrCreateKey(keyPath: string): Buffer {
    try {
      const key = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'base64url');
      if (key.length === 32) return key;
    } catch { /* missing or unreadable: create below */ }
    const key = randomBytes(32);
    try {
      writeFileSync(keyPath, key.toString('base64url'), { mode: 0o600 });
      chmodSync(keyPath, 0o600);
    } catch {
      throw new SecretStoreError('The secret store master key could not be created.');
    }
    return key;
  }

  private readEntries(): Record<string, SecretEntry> {
    let raw: string;
    try {
      raw = readFileSync(this.storePath, 'utf8');
    } catch {
      return {};
    }
    if (raw.length > MAX_STORE_BYTES) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const record = parsed as Record<string, unknown>;
      if (record.schemaVersion !== STORE_SCHEMA_VERSION || typeof record.secrets !== 'object' || record.secrets === null) return {};
      const entries: Record<string, SecretEntry> = {};
      for (const [name, value] of Object.entries(record.secrets as Record<string, unknown>)) {
        if (!NAME_PATTERN.test(name) || typeof value !== 'object' || value === null) continue;
        const entry = value as Record<string, unknown>;
        if (typeof entry.iv !== 'string' || typeof entry.tag !== 'string' || typeof entry.data !== 'string') continue;
        entries[name] = { iv: entry.iv, tag: entry.tag, data: entry.data };
      }
      return entries;
    } catch {
      // A corrupt store fails closed to empty; writes start a fresh file.
      return {};
    }
  }

  private writeEntries(entries: Record<string, SecretEntry>): void {
    try {
      writeFileSync(this.storePath, JSON.stringify({ schemaVersion: STORE_SCHEMA_VERSION, secrets: entries }), { mode: 0o600 });
      chmodSync(this.storePath, 0o600);
    } catch {
      throw new SecretStoreError('The secret store could not be written.');
    }
  }
}

function assertValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) throw new SecretStoreError('Secret name is invalid.');
}
