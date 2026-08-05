import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import type { PermissionProfileApplication } from '@ready4vibe/policy';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { RunManager } from './run-manager.js';

const config = {
  workspaceId: 'workspace-1',
  userMessage: 'inspect',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 1, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 10, maxOutputBytes: 1_000, maxContextBytes: 100_000 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
};

const permissionProfile = {
  schemaVersion: 'ready4vibe_permission_profile_v1' as const,
  profileId: 'workspace-coding' as const,
  filesystemScope: 'workspace-only' as const,
  processScope: 'none' as const,
  networkMode: 'off' as const,
  mcpSkillMode: 'off' as const,
  approvalPosture: 'bounded-auto' as const,
  taskTrust: 'trusted-workspace' as const,
  workspaceId: 'workspace-1',
  policyRevision: 'policy-1',
  profileRevision: 'profile-1',
  requiresConfirmation: false,
  updatedAt: '2026-08-05T00:00:00.000Z',
};

const permissionApplication: PermissionProfileApplication = {
  status: 'ready',
  reasonCode: 'PROFILE_READY',
  effectiveProfile: permissionProfile,
  approvalPolicy: 'on-request',
  networkAccess: 'restricted',
  dangerFullAccessConfirmed: false,
};

describe('RunManager permission profile seam', () => {
  it('captures the optional profile once and narrows the runtime without changing AgentLoop', async () => {
    const model = new FakeModelProvider({ events: [
      { type: 'tool-call-delta', callId: 'shell-call', name: 'shell.exec', argumentsChunk: '{}' },
      { type: 'completed', finishReason: 'tool-calls' },
    ] });
    const execute = vi.fn(async () => ({ output: 'must-not-run' }));
    const runtime = {
      descriptors: [
        { name: 'shell.exec', id: 'shell.exec', version: '1.0.0', risk: 'destructive' as const, summary: 'shell' },
        { name: 'filesystem.read', id: 'filesystem.read', version: '1.0.0', risk: 'read' as const, summary: 'read' },
      ],
      execute,
    };
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: model,
      toolRuntimeForRun: () => runtime,
      permissionProfileForRun: () => permissionApplication,
    });
    const started = await manager.start(config);
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());
    expect(manager.completion(started.runId)).toMatchObject({ status: 'failed' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the historical runtime path when no permission binding is supplied', async () => {
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const runtime = { descriptors: [{ name: 'filesystem.read', id: 'filesystem.read', version: '1.0.0', risk: 'read' as const, summary: 'read' }], execute: vi.fn(async () => ({ output: 'ok' })) };
    const manager = new RunManager({ eventStore: new InMemoryEventStore(), scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: model, toolRuntime: runtime });
    const started = await manager.start(config);
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());
    expect(manager.completion(started.runId)).toMatchObject({ status: 'completed' });
    expect(model.requests[0]?.tools).toHaveLength(1);
  });

  it('fails before run.created when the application reports a blocked binding', async () => {
    const eventStore = new InMemoryEventStore();
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const manager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: model,
      permissionProfileForRun: () => ({ ...permissionApplication, status: 'blocked', reasonCode: 'FULL_HOST_CONFIRMATION_REQUIRED', effectiveProfile: null }),
    });
    await expect(manager.start(config)).rejects.toMatchObject({ code: 'PERMISSION_PROFILE_BLOCKED' });
    expect(eventStore.listRunIds()).toEqual([]);
    expect(model.requests).toHaveLength(0);
  });
});
