import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { AgentLoop } from './index.js';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';

const config = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

function makeLoop(provider: FakeModelProvider, policy = DEFAULT_SCHEDULER_POLICY) {
  return {
    loop: new AgentLoop({ eventStore: new InMemoryEventStore(), scheduler: new Scheduler(policy), modelProvider: provider }),
  };
}

describe('AgentLoop', () => {
  it('persists a normal model turn and releases its lease', async () => {
    const provider = new FakeModelProvider({ events: [
      { type: 'text-delta', text: 'hello' },
      { type: 'usage', inputTokens: 3, outputTokens: 1 },
      { type: 'completed', finishReason: 'stop' },
    ] });
    const eventStore = new InMemoryEventStore();
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const loop = new AgentLoop({ eventStore, scheduler, modelProvider: provider });

    const result = await loop.run({ runId: 'run_normal', config: config() });
    const events = await eventStore.read('run_normal');
    expect(result).toMatchObject({ runId: 'run_normal', status: 'completed', output: 'hello' });
    expect(events.map((event) => event.type)).toEqual([
      'run.created', 'run.status', 'run.status', 'turn.started', 'run.status',
      'model.requested', 'model.delta', 'model.usage', 'model.completed',
      'turn.completed', 'run.status', 'run.completed',
    ]);
    expect(scheduler.activeCount()).toBe(0);
    expect(provider.requests[0]?.metadata.runId).toBe('run_normal');
  });

  it('turns a provider error into a safe failed run', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'error', code: 'UPSTREAM', retryable: true, safeMessage: 'provider unavailable' }] });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider });

    const result = await loop.run({ runId: 'run_error', config: config() });
    expect(result.status).toBe('failed');
    expect((await eventStore.read('run_error')).at(-1)?.type).toBe('run.failed');
    expect((await eventStore.read('run_error')).at(-1)?.payload).toMatchObject({ code: 'UPSTREAM' });
  });

  it('fails before emitting overflowing output', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'text-delta', text: '123456' }, { type: 'completed', finishReason: 'stop' }] });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider });

    const result = await loop.run({ runId: 'run_limit', config: config({ limits: { ...config().limits, maxOutputBytes: 5 } }) });
    expect(result).toMatchObject({ status: 'failed', output: '' });
    expect((await eventStore.read('run_limit')).map((event) => event.type)).toContain('run.failed');
  });

  it('cancels a queued run without acquiring a workspace lease', async () => {
    const provider = new FakeModelProvider({ delayMs: 10, events: [{ type: 'text-delta', text: 'hello' }, { type: 'completed', finishReason: 'stop' }] });
    const eventStore = new InMemoryEventStore();
    const scheduler = new Scheduler({ ...DEFAULT_SCHEDULER_POLICY, maxActiveRuns: 1 });
    const loop = new AgentLoop({ eventStore, scheduler, modelProvider: provider });
    const first = loop.run({ runId: 'run_first', config: config({ workspaceId: 'workspace-1' }) });
    await vi.waitFor(() => expect(provider.requests).toHaveLength(1));
    const controller = new AbortController();
    const second = loop.run({ runId: 'run_second', signal: controller.signal, config: config({ workspaceId: 'workspace-2' }) });
    controller.abort();

    await expect(second).resolves.toMatchObject({ runId: 'run_second', status: 'cancelled' });
    await expect(first).resolves.toMatchObject({ status: 'completed' });
    expect(scheduler.activeCount()).toBe(0);
  });

  it('handles an already-aborted request without leaving a queued promise', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const controller = new AbortController();
    controller.abort();
    const { loop } = makeLoop(provider);

    await expect(loop.run({ runId: 'run_preaborted', signal: controller.signal, config: config() })).resolves.toMatchObject({
      runId: 'run_preaborted',
      status: 'cancelled',
    });
  });

  it('runs independent workspaces concurrently through the scheduler', async () => {
    const provider = new FakeModelProvider({
      delayMs: 5,
      events: [{ type: 'text-delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }],
    });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler({ ...DEFAULT_SCHEDULER_POLICY, maxActiveRuns: 2 }), modelProvider: provider });

    const results = await Promise.all([
      loop.run({ runId: 'run_parallel_1', config: config({ workspaceId: 'workspace-1' }) }),
      loop.run({ runId: 'run_parallel_2', config: config({ workspaceId: 'workspace-2' }) }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['completed', 'completed']);
    expect(provider.requests).toHaveLength(2);
  });

  it('fails closed when a model asks for a tool before tools are implemented', async () => {
    const provider = new FakeModelProvider({ events: [
      { type: 'tool-call-delta', callId: 'call-1', name: 'shell', argumentsChunk: '{}' },
      { type: 'completed', finishReason: 'tool-calls' },
    ] });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider });

    const result = await loop.run({ runId: 'run_tool_unavailable', config: config() });
    expect(result.status).toBe('failed');
    expect((await eventStore.read('run_tool_unavailable')).at(-1)?.payload).toMatchObject({ code: 'TOOLS_UNAVAILABLE' });
  });
});
