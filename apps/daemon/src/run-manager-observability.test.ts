import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { ProviderUsageLifecycleAdapter, RunUsageObserver } from '@ready4vibe/observability';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore, InMemoryObservabilityLedger } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { RunManager } from './run-manager.js';

const config = {
  workspaceId: 'workspace_observability',
  userMessage: 'summarize the workspace',
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
  createdBySessionId: 'session_observability',
  clientRequestId: 'client_observability',
};

async function waitForTerminal(manager: RunManager, runId: string): Promise<NonNullable<Awaited<ReturnType<RunManager['snapshot']>>>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await manager.snapshot(runId);
    if (snapshot && ['completed', 'failed', 'cancelled', 'timed-out', 'needs-recovery'].includes(snapshot.status)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('run did not reach a terminal state');
}

function observer(ledger: InMemoryObservabilityLedger): RunUsageObserver {
  return new RunUsageObserver({ adapter: new ProviderUsageLifecycleAdapter({ writer: ledger }) });
}

describe('RunManager observability bridge', () => {
  it('writes replayed model usage after a completed run without changing the result', async () => {
    const ledger = new InMemoryObservabilityLedger();
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [
        { type: 'usage', inputTokens: 12, outputTokens: 5 },
        { type: 'completed', finishReason: 'stop' },
      ] }),
      observabilityUsageObserver: observer(ledger),
    });

    const started = await manager.start(config);
    const snapshot = await waitForTerminal(manager, started.runId);
    for (let attempt = 0; attempt < 100 && (await ledger.listModelUsage()).length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(snapshot.status).toBe('completed');
    await expect(ledger.listModelUsage()).resolves.toMatchObject([{ runId: started.runId, tokens: { input: 12, output: 5 }, dataSource: 'run-event' }]);
  });

  it('keeps the original run result when the observability writer fails', async () => {
    const failingObserver = new RunUsageObserver({
      adapter: new ProviderUsageLifecycleAdapter({
        writer: { appendBatch: async () => { throw new Error('ledger offline'); } },
      }),
    });
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [
        { type: 'usage', inputTokens: 4, outputTokens: 2 },
        { type: 'completed', finishReason: 'stop' },
      ] }),
      observabilityUsageObserver: failingObserver,
    });

    const started = await manager.start({ ...config, clientRequestId: 'client_observability_failure' });
    await expect(waitForTerminal(manager, started.runId)).resolves.toMatchObject({ status: 'completed' });
  });
});
