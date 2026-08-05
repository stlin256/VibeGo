import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY, type CapabilityProfileRunSnapshot, type RunConfig } from '@ready4vibe/contracts';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { RunManager } from './run-manager.js';

const config = {
  workspaceId: 'workspace-1',
  userMessage: 'say hello',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: {
    maxTurns: 1,
    maxWallTimeMs: 60_000,
    maxModelInputTokens: 100,
    maxModelOutputTokens: 100,
    maxToolCalls: 10,
    maxOutputBytes: 100,
    maxContextBytes: 100_000,
  },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
};

function profile(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'ready4vibe_capability_profile_v1' as const,
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
    ...overrides,
  };
}

function snapshot(overrides: Record<string, unknown> = {}): CapabilityProfileRunSnapshot {
  const value = profile();
  return {
    schemaVersion: 'ready4vibe_capability_profile_run_snapshot_v1',
    profileRevision: 'profile-1',
    policyRevision: 'policy-1',
    status: 'ready',
    reasonCode: 'PROFILE_READY',
    requestedProfile: value,
    effectiveProfile: value,
    capturedAt: '2026-08-05T00:00:01.000Z',
    ...overrides,
  } as CapabilityProfileRunSnapshot;
}

function manager(eventStore: InMemoryEventStore, capture: (input: RunConfig) => CapabilityProfileRunSnapshot) {
  return new RunManager({
    eventStore,
    scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
    modelProvider: new FakeModelProvider({ events: [{ type: 'text-delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }] }),
    capabilityProfileForRun: capture,
  });
}

describe('RunManager capability profile snapshot boundary', () => {
  it('fails closed before provider binding or event creation when the profile is blocked', async () => {
    const eventStore = new InMemoryEventStore();
    const bind = vi.fn();
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: model,
      modelBindingForRun: bind,
      capabilityProfileForRun: () => snapshot({ status: 'blocked', reasonCode: 'WORKSPACE_UNAVAILABLE', effectiveProfile: null }),
    });

    await expect(runManager.start(config)).rejects.toMatchObject({ code: 'CAPABILITY_PROFILE_BLOCKED' });
    expect(bind).not.toHaveBeenCalled();
    expect(model.requests).toHaveLength(0);
    expect(eventStore.listRunIds()).toEqual([]);
  });

  it('captures one immutable snapshot per new run while settings change', async () => {
    const eventStore = new InMemoryEventStore();
    let current = snapshot({ profileRevision: 'profile-1' });
    const runManager = manager(eventStore, () => current);

    const first = await runManager.start(config);
    current = snapshot({ profileRevision: 'profile-2', capturedAt: '2026-08-05T00:00:02.000Z' });
    await vi.waitFor(() => expect(runManager.completion(first.runId)).toBeDefined());
    const firstSnapshot = await runManager.snapshot(first.runId);
    expect(firstSnapshot).toMatchObject({ capabilitySnapshot: { profileRevision: 'profile-1' } });

    const second = await runManager.start({ ...config, clientRequestId: 'client-2' });
    await vi.waitFor(() => expect(runManager.completion(second.runId)).toBeDefined());
    expect(await runManager.snapshot(second.runId)).toMatchObject({ capabilitySnapshot: { profileRevision: 'profile-2' } });
    expect((await eventStore.read(first.runId))[0]?.payload).toMatchObject({ capabilitySnapshot: { profileRevision: 'profile-1' } });
  });

  it('allows a narrowed degraded snapshot but never turns it into a host fallback', async () => {
    const eventStore = new InMemoryEventStore();
    const degraded = snapshot({
      status: 'degraded',
      reasonCode: 'CAPABILITY_NARROWED',
      requestedProfile: profile({ filesystemMode: 'workspace-write' }),
      effectiveProfile: profile({ filesystemMode: 'off' }),
    });
    const runManager = manager(eventStore, () => degraded);
    const started = await runManager.start(config);
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    expect(await runManager.snapshot(started.runId)).toMatchObject({ capabilitySnapshot: { status: 'degraded', effectiveProfile: { filesystemMode: 'off' } } });
  });

  it('captures a fresh snapshot during recovery instead of reusing the old run metadata', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append({ runId: 'run_recovered', type: 'run.created', source: 'user', correlationId: 'corr_old', payload: { config } });
    await eventStore.append({ runId: 'run_recovered', type: 'run.status', source: 'orchestrator', correlationId: 'corr_old', payload: { from: 'created', to: 'executing' } });
    let current = snapshot({ profileRevision: 'profile-9' });
    const runManager = manager(eventStore, () => current);
    await runManager.recoverAfterRestart();
    current = snapshot({ profileRevision: 'profile-10' });

    const retry = await runManager.retryRecovered('run_recovered');
    if (retry === 'not-found' || retry === 'not-recoverable') throw new Error('expected a recovery run');
    await vi.waitFor(() => expect(runManager.completion(retry.runId)).toBeDefined());
    expect(await runManager.snapshot(retry.runId)).toMatchObject({ capabilitySnapshot: { profileRevision: 'profile-10' } });
    expect((await eventStore.read('run_recovered')).some((event) => event.type === 'capability.profile')).toBe(false);
  });

  it('keeps the historical unbound interactive path compatible', async () => {
    const eventStore = new InMemoryEventStore();
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
    });
    const started = await runManager.start(config);
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    expect(await runManager.snapshot(started.runId)).not.toHaveProperty('capabilitySnapshot');
  });
});
