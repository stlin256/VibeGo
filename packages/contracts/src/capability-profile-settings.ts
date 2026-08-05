import { z } from 'zod';
import {
  CapabilityProfileResolutionSchema,
  CapabilityProfileSchema,
  type CapabilityProfile,
} from './capability-profile.js';

export const CAPABILITY_PROFILE_SETTINGS_SCHEMA_VERSION = 'ready4vibe_capability_profile_settings_v1' as const;
export const CAPABILITY_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION = 'ready4vibe_capability_profile_settings_status_v1' as const;

const REVISION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const ISO_TIMESTAMP = z.string().datetime({ offset: true }).max(64);

export const CapabilityProfileRevisionSchema = z.string().min(1).max(128).regex(REVISION);
export type CapabilityProfileRevision = z.infer<typeof CapabilityProfileRevisionSchema>;

/** Durable non-secret user intent. Runtime health is deliberately not stored here. */
export const CapabilityProfileSettingsSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_PROFILE_SETTINGS_SCHEMA_VERSION),
  profile: CapabilityProfileSchema,
  profileRevision: CapabilityProfileRevisionSchema,
  updatedAt: ISO_TIMESTAMP,
}).strict();
export type CapabilityProfileSettings = z.infer<typeof CapabilityProfileSettingsSchema>;

/** Complete replacement plus an optional optimistic-concurrency precondition. */
export const CapabilityProfileSettingsPatchSchema = z.object({
  profile: CapabilityProfileSchema,
  expectedRevision: CapabilityProfileRevisionSchema.optional(),
}).strict();
export type CapabilityProfileSettingsPatch = z.infer<typeof CapabilityProfileSettingsPatchSchema>;

export const CapabilityProfileSettingsStatusSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_PROFILE_SETTINGS_STATUS_SCHEMA_VERSION),
  settings: CapabilityProfileSettingsSchema,
  resolution: CapabilityProfileResolutionSchema,
  currentRevision: CapabilityProfileRevisionSchema,
  previousRevision: CapabilityProfileRevisionSchema.nullable(),
}).strict();
export type CapabilityProfileSettingsStatus = z.infer<typeof CapabilityProfileSettingsStatusSchema>;

export function parseCapabilityProfileSettings(value: unknown): CapabilityProfileSettings {
  return CapabilityProfileSettingsSchema.parse(value);
}

export function parseCapabilityProfileSettingsPatch(value: unknown): CapabilityProfileSettingsPatch {
  return CapabilityProfileSettingsPatchSchema.parse(value);
}

export function parseCapabilityProfileSettingsStatus(value: unknown): CapabilityProfileSettingsStatus {
  return CapabilityProfileSettingsStatusSchema.parse(value);
}

export type CapabilityProfileIntent = CapabilityProfile;
