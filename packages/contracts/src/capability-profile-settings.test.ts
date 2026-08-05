import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_PROFILE_RESOLUTION_SCHEMA_VERSION,
  CAPABILITY_PROFILE_SCHEMA_VERSION,
  CAPABILITY_PROFILE_SETTINGS_SCHEMA_VERSION,
  CAPABILITY_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION,
  parseCapabilityProfileSettings,
  parseCapabilityProfileSettingsPatch,
  parseCapabilityProfileSettingsStatus,
} from './index.js';

const profile = {
  schemaVersion: CAPABILITY_PROFILE_SCHEMA_VERSION,
  profileId: 'preview' as const,
  transportMode: 'loopback' as const,
  modelMode: 'fake' as const,
  filesystemMode: 'off' as const,
  shellMode: 'off' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalMode: 'none' as const,
  policyRevision: 'policy-1',
  requiresAcknowledgement: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const settings = {
  schemaVersion: CAPABILITY_PROFILE_SETTINGS_SCHEMA_VERSION,
  profile,
  profileRevision: 'profile-1',
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const resolution = {
  schemaVersion: CAPABILITY_PROFILE_RESOLUTION_SCHEMA_VERSION,
  status: 'ready' as const,
  reasonCode: 'PROFILE_READY' as const,
  requestedProfile: profile,
  effectiveProfile: profile,
  policyRevision: 'policy-1',
  evaluatedAt: '2026-08-05T00:00:00.000Z',
};

describe('capability profile settings contract', () => {
  it('accepts a secret-free durable snapshot and optimistic patch', () => {
    expect(parseCapabilityProfileSettings(settings).profileRevision).toBe('profile-1');
    expect(parseCapabilityProfileSettingsPatch({ profile, expectedRevision: 'profile-1' }).expectedRevision).toBe('profile-1');
  });

  it('rejects unknown, secret-shaped, path and malformed revision fields', () => {
    expect(() => parseCapabilityProfileSettings({ ...settings, apiKey: 'secret' })).toThrow();
    expect(() => parseCapabilityProfileSettings({ ...settings, profileRevision: 'C:\\workspace' })).toThrow();
    expect(() => parseCapabilityProfileSettingsPatch({ profile, expectedRevision: 'TOKEN=secret' })).toThrow();
    expect(() => parseCapabilityProfileSettingsPatch({ profile, profileRevision: 'profile-2' })).toThrow();
  });

  it('keeps the response projection versioned and strict', () => {
    expect(parseCapabilityProfileSettingsStatus({
      schemaVersion: CAPABILITY_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION,
      settings,
      resolution,
      currentRevision: 'profile-1',
      previousRevision: null,
    }).resolution.status).toBe('ready');
    expect(() => parseCapabilityProfileSettingsStatus({
      schemaVersion: CAPABILITY_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION,
      settings,
      resolution,
      currentRevision: 'profile-1',
      previousRevision: null,
      rawPolicy: { token: 'secret' },
    })).toThrow();
  });
});
