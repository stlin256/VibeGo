import { describe, expect, it } from 'vitest';
import {
  DedicatedReviewerProfileProjectionSchema,
  DedicatedReviewerProfileSchema,
  DedicatedReviewerProfilesStatusSchema,
} from './dedicated-reviewer-profile.js';

const profile = {
  schemaVersion: 'ready4vibe_dedicated_reviewer_profile_v1' as const,
  profileId: 'reviewer-primary',
  providerId: 'openai-compatible',
  endpoint: 'https://api.example.test/v1/chat/completions',
  modelName: 'reviewer-model',
  profileRevision: 'reviewer-profile-1',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

describe('dedicated reviewer profile contracts', () => {
  it('accepts bounded non-secret metadata and status projection', () => {
    expect(DedicatedReviewerProfileSchema.parse(profile)).toEqual(profile);
    expect(DedicatedReviewerProfileProjectionSchema.parse({ ...profile, credentialState: 'available' })).toMatchObject({
      profileId: 'reviewer-primary',
      credentialState: 'available',
    });
    expect(DedicatedReviewerProfilesStatusSchema.parse({
      schemaVersion: 'ready4vibe_dedicated_reviewer_profiles_status_v1',
      currentRevision: 'reviewer-profiles-1',
      profiles: [{ ...profile, credentialState: 'required' }],
      updatedAt: '2026-08-06T00:00:00.000Z',
    }).profiles).toHaveLength(1);
  });

  it('rejects unknown, secret-shaped and absolute-path fields', () => {
    expect(() => DedicatedReviewerProfileSchema.parse({ ...profile, apiKey: 'sk-' + 'a'.repeat(24) })).toThrow();
    expect(() => DedicatedReviewerProfileSchema.parse({ ...profile, credentialRef: 'secret.reviewer' })).toThrow();
    expect(() => DedicatedReviewerProfileSchema.parse({ ...profile, endpoint: 'https://example.test/v1/chat/completions?token=secret' })).toThrow();
    expect(() => DedicatedReviewerProfileSchema.parse({ ...profile, endpoint: 'C:\\private\\reviewer' })).toThrow();
    expect(() => DedicatedReviewerProfileSchema.parse({ ...profile, modelName: 'token=secret-value' })).toThrow();
    expect(() => DedicatedReviewerProfileProjectionSchema.parse({ ...profile, credentialState: 'available', secret: 'nope' })).toThrow();
  });

  it('enforces a bounded profile count and strict revisions', () => {
    const profiles = Array.from({ length: 9 }, (_, index) => ({ ...profile, profileId: `reviewer-${index}` }));
    expect(() => DedicatedReviewerProfilesStatusSchema.parse({
      schemaVersion: 'ready4vibe_dedicated_reviewer_profiles_status_v1',
      currentRevision: 'reviewer-profiles-1',
      profiles: profiles.map((item) => ({ ...item, credentialState: 'required' })),
      updatedAt: '2026-08-06T00:00:00.000Z',
    })).toThrow();
    expect(() => DedicatedReviewerProfileSchema.parse({ ...profile, profileRevision: 'revision with spaces' })).toThrow();
  });
});
