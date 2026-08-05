import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { DedicatedReviewerProfilesError, DedicatedReviewerProfilesManager } from './dedicated-reviewer-profiles.js';

const input = (profileId: string, overrides: Partial<{ endpoint: string; modelName: string; apiKey: string }> = {}) => ({
  profileId,
  providerId: 'openai-compatible' as const,
  endpoint: overrides.endpoint ?? 'https://reviewer.example.test/v1/chat/completions',
  modelName: overrides.modelName ?? 'reviewer-model',
  apiKey: overrides.apiKey ?? 'sk-' + 'r'.repeat(24),
});

describe('DedicatedReviewerProfilesManager', () => {
  it('persists metadata but resolves an explicit runtime provider only while its credential is present', () => {
    const settings = new InMemorySettingsStore();
    const first = new DedicatedReviewerProfilesManager({ settings });
    const configured = first.configure(input('reviewer-primary'));
    expect(configured).toMatchObject({ profiles: [{ profileId: 'reviewer-primary', credentialState: 'available' }] });
    const binding = first.resolve('reviewer-primary');
    expect(binding).toMatchObject({ profileId: 'reviewer-primary', provider: { id: 'openai-compatible' }, modelSnapshot: { providerId: 'openai-compatible', model: 'reviewer-model' } });
    expect(JSON.stringify(settings.get('llm-approval', 'profiles'))).not.toMatch(/sk-|api[_-]?key|secret|token/iu);

    const restarted = new DedicatedReviewerProfilesManager({ settings });
    expect(restarted.status()).toMatchObject({ profiles: [{ profileId: 'reviewer-primary', credentialState: 'required' }] });
    expect(restarted.resolve('reviewer-primary')).toBeUndefined();
  });

  it('keeps profile selection explicit and snapshots isolated across profiles', () => {
    const manager = new DedicatedReviewerProfilesManager({ settings: new InMemorySettingsStore() });
    const first = manager.configure(input('reviewer-one', { modelName: 'model-one' }));
    const second = manager.configure(input('reviewer-two', { modelName: 'model-two' }));
    const one = manager.resolve('reviewer-one');
    const two = manager.resolve('reviewer-two');
    expect(first.profiles.map((profile) => profile.profileId)).toEqual(['reviewer-one']);
    expect(second.profiles.map((profile) => profile.profileId)).toEqual(['reviewer-one', 'reviewer-two']);
    expect(one?.modelSnapshot.model).toBe('model-one');
    expect(two?.modelSnapshot.model).toBe('model-two');
    expect(one?.provider).not.toBe(two?.provider);
    expect(manager.resolve('active-run-provider')).toBeUndefined();
  });

  it('freezes an earlier binding when the same profile is replaced for later runs', () => {
    const manager = new DedicatedReviewerProfilesManager({ settings: new InMemorySettingsStore() });
    manager.configure(input('reviewer-primary', { modelName: 'model-before' }));
    const before = manager.resolve('reviewer-primary');
    const currentRevision = manager.status().profiles[0]?.profileRevision;
    if (!currentRevision) throw new Error('profile revision missing from status');
    manager.configure({ ...input('reviewer-primary', { modelName: 'model-after' }), expectedRevision: currentRevision });
    const after = manager.resolve('reviewer-primary');
    expect(before?.modelSnapshot.model).toBe('model-before');
    expect(after?.modelSnapshot.model).toBe('model-after');
    expect(before?.provider).not.toBe(after?.provider);
  });

  it('fails closed on stale revisions, malformed inputs and unknown profiles', () => {
    const manager = new DedicatedReviewerProfilesManager({ settings: new InMemorySettingsStore() });
    expect(() => manager.configure({ ...input('reviewer-primary'), endpoint: 'https://example.test/v1/chat/completions?token=secret' })).toThrowError(expect.objectContaining({ code: 'INVALID_PROFILE' }));
    const configured = manager.configure(input('reviewer-primary'));
    expect(() => manager.configure({ ...input('reviewer-primary'), expectedRevision: 'reviewer-profile-0' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(manager.resolve('missing')).toBeUndefined();
    expect(() => manager.remove('reviewer-primary', 'reviewer-profile-0')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(manager.remove('reviewer-primary', configured.profiles[0]?.profileRevision)).toMatchObject({ profiles: [] });
  });

  it('bounds the number of profiles and rejects provider mismatches', () => {
    const manager = new DedicatedReviewerProfilesManager({ settings: new InMemorySettingsStore() });
    for (let index = 0; index < 8; index += 1) manager.configure(input(`reviewer-${index}`));
    expect(() => manager.configure(input('reviewer-overflow'))).toThrowError(expect.objectContaining({ code: 'PROFILE_LIMIT' }));
    expect(() => manager.configure({ ...input('reviewer-invalid'), providerId: 'deepseek' as never })).toThrowError(DedicatedReviewerProfilesError);
  });

  it('does not activate a runtime credential when metadata persistence fails', () => {
    const failingSettings = {
      get: () => undefined,
      set: () => { throw new Error('disk unavailable'); },
      delete: () => undefined,
      close: () => undefined,
    };
    const manager = new DedicatedReviewerProfilesManager({ settings: failingSettings });
    expect(() => manager.configure(input('reviewer-primary'))).toThrowError(expect.objectContaining({ code: 'PERSISTENCE_FAILED' }));
    expect(manager.status()).toMatchObject({ profiles: [] });
    expect(manager.resolve('reviewer-primary')).toBeUndefined();
  });
});
