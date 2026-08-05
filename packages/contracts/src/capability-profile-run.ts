import { z } from 'zod';
import {
  CapabilityProfileResolutionSchema,
  CapabilityProfileSchema,
  CapabilityResolutionReasonCodeSchema,
  CapabilityResolutionStatusSchema,
} from './capability-profile.js';
import { CapabilityProfileRevisionSchema } from './capability-profile-settings.js';

export const CAPABILITY_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION = 'ready4vibe_capability_profile_run_snapshot_v1' as const;

const ISO_TIMESTAMP = z.string().datetime({ offset: true }).max(64);

/**
 * The one capability decision captured for a run. This is metadata only: it
 * contains no credentials, paths, environment values, tool arguments or
 * runtime responses.
 */
export const CapabilityProfileRunSnapshotSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_PROFILE_RUN_SNAPSHOT_SCHEMA_VERSION),
  profileRevision: CapabilityProfileRevisionSchema,
  policyRevision: CapabilityProfileRevisionSchema,
  status: CapabilityResolutionStatusSchema,
  reasonCode: CapabilityResolutionReasonCodeSchema,
  requestedProfile: CapabilityProfileSchema,
  effectiveProfile: CapabilityProfileSchema.nullable(),
  capturedAt: ISO_TIMESTAMP,
}).strict().superRefine((value, context) => {
  if (value.status === 'blocked' && value.effectiveProfile !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'blocked snapshots cannot contain an effective profile' });
  }
  if (value.status !== 'blocked' && value.effectiveProfile === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile'], message: 'ready or degraded snapshots require an effective profile' });
  }
  if (value.requestedProfile.policyRevision !== value.policyRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['policyRevision'], message: 'policyRevision must match requestedProfile.policyRevision' });
  }
  if (value.effectiveProfile && value.effectiveProfile.policyRevision !== value.policyRevision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['effectiveProfile', 'policyRevision'], message: 'effective profile policy revision must match policyRevision' });
  }
});
export type CapabilityProfileRunSnapshot = z.infer<typeof CapabilityProfileRunSnapshotSchema>;

export function parseCapabilityProfileRunSnapshot(value: unknown): CapabilityProfileRunSnapshot {
  return CapabilityProfileRunSnapshotSchema.parse(value);
}

/** Compile-time assertion that the snapshot remains a capability-only value. */
// Keep the imported resolution schema referenced by generated declarations for
// consumers that use this module as their snapshot boundary. The schema itself
// remains owned by capability-profile.ts and is not duplicated here.
export type CapabilityProfileRunResolution = z.infer<typeof CapabilityProfileResolutionSchema>;
