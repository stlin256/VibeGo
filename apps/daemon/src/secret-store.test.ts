import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSecretStore, SecretStoreError } from './secret-store.js';

describe('daemon file secret store', () => {
  it('round-trips secrets across instances and never stores plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-secrets-'));
    try {
      const first = new FileSecretStore(root);
      first.set('model.deepseek.api-key', 'sk-test-secret-value');
      const stored = await readFile(join(root, 'secrets.json'), 'utf8');
      expect(stored).not.toContain('sk-test-secret-value');
      const masterKey = await readFile(join(root, 'master.key'), 'utf8');
      expect(masterKey.trim()).toMatch(/^[A-Za-z0-9_-]{43}$/u);

      const restarted = new FileSecretStore(root);
      expect(restarted.get('model.deepseek.api-key')).toBe('sk-test-secret-value');
      restarted.delete('model.deepseek.api-key');
      expect(new FileSecretStore(root).get('model.deepseek.api-key')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed on tampered ciphertext and corrupt store files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-secrets-'));
    try {
      const store = new FileSecretStore(root);
      store.set('model.deepseek.api-key', 'sk-test-secret-value');
      const path = join(root, 'secrets.json');
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { secrets: Record<string, { data: string }> };
      parsed.secrets['model.deepseek.api-key']!.data = parsed.secrets['model.deepseek.api-key']!.data.slice(0, -2) + 'xx';
      await writeFile(path, JSON.stringify(parsed));
      expect(new FileSecretStore(root).get('model.deepseek.api-key')).toBeUndefined();

      await writeFile(path, '{not json');
      expect(new FileSecretStore(root).get('model.deepseek.api-key')).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects invalid names and out-of-bounds values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ready4vibe-secrets-'));
    try {
      const store = new FileSecretStore(root);
      expect(() => store.get('../escape')).toThrowError(SecretStoreError);
      expect(() => store.set('model.deepseek.api-key', '')).toThrowError(SecretStoreError);
      expect(() => store.set('model.deepseek.api-key', 'x'.repeat(9 * 1024))).toThrowError(SecretStoreError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
