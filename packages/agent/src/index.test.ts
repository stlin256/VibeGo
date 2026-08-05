import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SCHEDULER_POLICY, type ModelEvent, type ModelProvider } from '@ready4vibe/contracts';
import type { ContextItem } from '@ready4vibe/context';
import { AgentLoop } from './index.js';
import { InMemoryApprovalBroker } from './approval.js';
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

class SequenceModelProvider implements ModelProvider {
  readonly id = 'sequence-model';
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: true } as const;
  readonly requests: Array<{ messages: readonly unknown[]; tools: readonly unknown[] }> = [];

  constructor(private readonly scripts: readonly (readonly ModelEvent[])[]) {}

  async *stream(request: { messages: readonly unknown[]; tools: readonly unknown[] }, _signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    for (const event of this.scripts[Math.min(this.requests.length - 1, this.scripts.length - 1)] ?? []) yield event;
  }
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

    const result = await loop.run({
      runId: 'run_normal',
      config: config(),
      modelSnapshot: {
        schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
        providerId: 'fake-model',
        model: 'deterministic',
        pricingModel: 'deterministic',
        descriptorRevision: 'fake-rev-1',
        endpointPolicy: { kind: 'provider-default' },
        capabilities: {
          streaming: true,
          toolCalls: true,
          structuredOutput: true,
          reasoning: false,
          promptCaching: false,
          audioInput: false,
          audioOutput: false,
        },
        capturedAt: '2026-08-04T00:00:00.000Z',
      },
      capabilitySnapshot: {
        schemaVersion: 'ready4vibe_capability_profile_run_snapshot_v1',
        profileRevision: 'profile-1',
        policyRevision: 'policy-1',
        status: 'ready',
        reasonCode: 'PROFILE_READY',
        requestedProfile: {
          schemaVersion: 'ready4vibe_capability_profile_v1',
          profileId: 'preview',
          transportMode: 'loopback',
          modelMode: 'fake',
          filesystemMode: 'off',
          shellMode: 'off',
          networkMode: 'off',
          mcpSkillMode: 'off',
          approvalMode: 'none',
          policyRevision: 'policy-1',
          requiresAcknowledgement: false,
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
        effectiveProfile: {
          schemaVersion: 'ready4vibe_capability_profile_v1',
          profileId: 'preview',
          transportMode: 'loopback',
          modelMode: 'fake',
          filesystemMode: 'off',
          shellMode: 'off',
          networkMode: 'off',
          mcpSkillMode: 'off',
          approvalMode: 'none',
          policyRevision: 'policy-1',
          requiresAcknowledgement: false,
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
        capturedAt: '2026-08-04T00:00:00.000Z',
      },
      permissionSnapshot: {
        schemaVersion: 'ready4vibe_permission_profile_run_snapshot_v1',
        status: 'ready',
        reasonCode: 'PROFILE_READY',
        profileRevision: 'profile-1',
        policyRevision: 'policy-1',
        requestedProfile: {
          schemaVersion: 'ready4vibe_permission_profile_v1',
          profileId: 'workspace-coding',
          filesystemScope: 'workspace-only',
          processScope: 'none',
          networkMode: 'off',
          mcpSkillMode: 'off',
          approvalPosture: 'bounded-auto',
          taskTrust: 'trusted-workspace',
          workspaceId: 'workspace-1',
          policyRevision: 'policy-1',
          profileRevision: 'profile-1',
          requiresConfirmation: false,
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
        effectiveProfile: {
          schemaVersion: 'ready4vibe_permission_profile_v1',
          profileId: 'workspace-coding',
          filesystemScope: 'workspace-only',
          processScope: 'none',
          networkMode: 'off',
          mcpSkillMode: 'off',
          approvalPosture: 'bounded-auto',
          taskTrust: 'trusted-workspace',
          workspaceId: 'workspace-1',
          policyRevision: 'policy-1',
          profileRevision: 'profile-1',
          requiresConfirmation: false,
          updatedAt: '2026-08-04T00:00:00.000Z',
        },
        effectiveScope: {
          kind: 'run',
          profileId: 'workspace-coding',
          filesystemScope: 'workspace-only',
          processScope: 'none',
          networkMode: 'off',
          mcpSkillMode: 'off',
          approvalPosture: 'bounded-auto',
          taskTrust: 'trusted-workspace',
          workspaceId: 'workspace-1',
        },
        grantId: null,
        grantExpiresAt: null,
        capturedAt: '2026-08-04T00:00:00.000Z',
      },
    });
    const events = await eventStore.read('run_normal');
    expect(result).toMatchObject({ runId: 'run_normal', status: 'completed', output: 'hello' });
    expect(events.map((event) => event.type)).toEqual([
      'run.created', 'run.status', 'run.status', 'turn.started', 'run.status',
      'model.requested', 'model.delta', 'model.usage', 'model.completed',
      'turn.completed', 'run.status', 'run.completed',
    ]);
    expect(scheduler.activeCount()).toBe(0);
    expect(provider.requests[0]?.metadata.runId).toBe('run_normal');
    expect(events[0]?.payload).toMatchObject({ modelSnapshot: { providerId: 'fake-model', descriptorRevision: 'fake-rev-1' } });
    expect(events[0]?.payload).toMatchObject({ capabilitySnapshot: { profileRevision: 'profile-1', status: 'ready', effectiveProfile: { profileId: 'preview' } } });
    expect(events[0]?.payload).toMatchObject({ permissionSnapshot: { profileRevision: 'profile-1', effectiveScope: { kind: 'run' } } });
    expect(events.find((event) => event.type === 'model.requested')?.payload).toMatchObject({
      providerId: 'fake-model',
      requestId: provider.requests[0]?.metadata.requestId,
    });
  });

  it('persists an optional DeepSeek run snapshot without changing the loop path', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider });
    const deepSeekSnapshot = {
      schemaVersion: 'deepseek-provider-run/v1' as const,
      providerId: 'deepseek' as const,
      endpointProfile: 'openai-chat-completions' as const,
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-v4-flash',
      thinkingMode: 'auto' as const,
      toolCalling: 'enabled' as const,
      webSearch: 'off' as const,
      reviewer: 'off' as const,
      configRevision: 'deepseek-config-environment',
      capabilityRevision: 'deepseek-capability-unprobed',
      capturedAt: '2026-08-05T00:00:00.000Z',
    };

    await expect(loop.run({ runId: 'run_deepseek_snapshot', config: config(), deepSeekSnapshot })).resolves.toMatchObject({ status: 'completed' });
    const events = await eventStore.read('run_deepseek_snapshot');
    expect(events[0]?.payload).toMatchObject({ deepSeekSnapshot: { providerId: 'deepseek', configRevision: 'deepseek-config-environment' } });
    expect(JSON.stringify(events)).not.toContain('apiKey');
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

  it('compacts context before requesting the model and records only safe metadata', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider });
    const oldItem: ContextItem = { id: 'old-history', source: 'model', trust: 'trusted', role: 'assistant', content: 'old '.repeat(100) };

    const result = await loop.run({ runId: 'run_context_compact', contextItems: [oldItem], config: config({ limits: { ...config().limits, maxContextBytes: 40 } }) });
    const events = await eventStore.read('run_context_compact');
    expect(result.status).toBe('completed');
    expect(events.map((event) => event.type)).toContain('context.compacted');
    expect(provider.requests[0]?.messages).toEqual([{ role: 'user', content: 'say hello' }]);
  });

  it('fails before scheduling when protected context exceeds the budget', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler, modelProvider: provider });

    const result = await loop.run({ runId: 'run_context_too_large', config: config({ limits: { ...config().limits, maxContextBytes: 2 } }) });
    expect(result.status).toBe('failed');
    expect(scheduler.activeCount()).toBe(0);
    expect((await eventStore.read('run_context_too_large')).at(-1)?.payload).toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
  });

  it('enforces the model input token budget before scheduling', async () => {
    const provider = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const scheduler = new Scheduler(DEFAULT_SCHEDULER_POLICY);
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler, modelProvider: provider });

    const result = await loop.run({ runId: 'run_context_token_limit', config: config({ limits: { ...config().limits, maxModelInputTokens: 1 } }) });
    expect(result.status).toBe('failed');
    expect(scheduler.activeCount()).toBe(0);
    expect((await eventStore.read('run_context_token_limit')).at(-1)?.payload).toMatchObject({ code: 'CONTEXT_BUDGET_EXCEEDED' });
  });

  it('passes public tool descriptors and continues with bounded tool output', async () => {
    const provider = new SequenceModelProvider([
      [
        { type: 'tool-call-delta', callId: 'call-1', name: 'echo', argumentsChunk: '{"value":1}' },
        { type: 'completed', finishReason: 'tool-calls' },
      ],
      [
        { type: 'text-delta', text: 'done' },
        { type: 'completed', finishReason: 'stop' },
      ],
    ]);
    const eventStore = new InMemoryEventStore();
    const runtime = {
      descriptors: [{ name: 'echo', id: 'test.echo', version: '1.0.0', risk: 'read' as const, summary: 'Echo a value', inputSchema: { type: 'object' } }],
      execute: vi.fn(async ({ input }: { input: unknown }) => ({ output: { received: input } })),
    };
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime });

    const result = await loop.run({ runId: 'run_tool_round', config: config({ limits: { ...config().limits, maxTurns: 2 } }) });
    const events = await eventStore.read('run_tool_round');
    expect(result).toMatchObject({ status: 'completed', output: 'done' });
    expect(runtime.execute).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call-1', input: { value: 1 } }));
    expect(provider.requests[0]?.tools).toEqual([expect.objectContaining({ type: 'function' })]);
    expect(provider.requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call-1' }),
    ]));
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'tool.requested', 'tool.started', 'tool.output', 'tool.completed',
    ]));
  });

  it('fails closed on malformed arguments and unknown tools without executing', async () => {
    const provider = new SequenceModelProvider([[{ type: 'tool-call-delta', callId: 'bad', name: 'missing', argumentsChunk: '{' }, { type: 'completed', finishReason: 'tool-calls' }]]);
    const eventStore = new InMemoryEventStore();
    const runtime = {
      descriptors: [{ name: 'echo', id: 'test.echo', version: '1.0.0', risk: 'read' as const, summary: 'Echo' }],
      execute: vi.fn(async () => ({ output: 'never' })),
    };
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime });

    const result = await loop.run({ runId: 'run_tool_invalid', config: config() });
    const events = await eventStore.read('run_tool_invalid');
    expect(result).toMatchObject({ status: 'failed' });
    expect(events.at(-1)?.payload).toMatchObject({ code: 'TOOL_UNKNOWN' });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('records approval.required and does not fabricate an approval', async () => {
    const provider = new SequenceModelProvider([[{ type: 'tool-call-delta', callId: 'approve', name: 'write', argumentsChunk: '{}' }, { type: 'completed', finishReason: 'tool-calls' }]]);
    const eventStore = new InMemoryEventStore();
    const runtime = {
      descriptors: [{ name: 'write', id: 'test.write', version: '1.0.0', risk: 'write' as const, summary: 'Write' }],
      execute: vi.fn(async () => { throw Object.assign(new Error('prompt'), { code: 'APPROVAL_REQUIRED' }); }),
    };
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime });

    const result = await loop.run({ runId: 'run_tool_approval', config: config() });
    const events = await eventStore.read('run_tool_approval');
    expect(result).toMatchObject({ status: 'failed' });
    expect(events.map((event) => event.type)).toContain('approval.required');
    expect(events.at(-1)?.payload).toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });

  it('waits for allow, approves the same runtime intent, and retries the tool in place', async () => {
    const provider = new SequenceModelProvider([
      [{ type: 'tool-call-delta', callId: 'approve-once', name: 'write', argumentsChunk: '{}' }, { type: 'completed', finishReason: 'tool-calls' }],
      [{ type: 'text-delta', text: 'saved' }, { type: 'completed', finishReason: 'stop' }],
    ]);
    const eventStore = new InMemoryEventStore();
    const broker = new InMemoryApprovalBroker({ timeoutMs: 2_000 });
    let approved = false;
    const runtime = {
      descriptors: [{ name: 'write', id: 'test.write', version: '1.0.0', risk: 'write' as const, summary: 'Write' }],
      execute: vi.fn(async () => {
        if (!approved) throw Object.assign(new Error('prompt'), { code: 'APPROVAL_REQUIRED' });
        return { output: { ok: true } };
      }),
      approve: vi.fn(async () => { approved = true; }),
    };
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime, approvalBroker: broker });
    const running = loop.run({ runId: 'run_approval_allow', config: config({ limits: { ...config().limits, maxTurns: 2 } }) });
    await vi.waitFor(() => expect(broker.pending()).toHaveLength(1));
    const approvalId = broker.pending()[0]!.approvalId;
    expect((await eventStore.read('run_approval_allow')).map((event) => event.type)).toContain('approval.required');
    expect(broker.decide(approvalId, 'allow', 'run_approval_allow')).toBe('accepted');
    await expect(running).resolves.toMatchObject({ status: 'completed', output: 'saved' });
    expect(runtime.approve).toHaveBeenCalledOnce();
    expect(runtime.execute).toHaveBeenCalledTimes(2);
  });

  it('fails a denied approval without retrying the tool', async () => {
    const provider = new SequenceModelProvider([[{ type: 'tool-call-delta', callId: 'deny-once', name: 'write', argumentsChunk: '{}' }, { type: 'completed', finishReason: 'tool-calls' }]]);
    const eventStore = new InMemoryEventStore();
    const broker = new InMemoryApprovalBroker({ timeoutMs: 2_000 });
    const runtime = {
      descriptors: [{ name: 'write', id: 'test.write', version: '1.0.0', risk: 'write' as const, summary: 'Write' }],
      execute: vi.fn(async () => { throw Object.assign(new Error('prompt'), { code: 'APPROVAL_REQUIRED' }); }),
      approve: vi.fn(async () => undefined),
    };
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime, approvalBroker: broker });
    const running = loop.run({ runId: 'run_approval_deny', config: config() });
    await vi.waitFor(() => expect(broker.pending()).toHaveLength(1));
    expect(broker.decide(broker.pending()[0]!.approvalId, 'deny', 'run_approval_deny')).toBe('accepted');
    await expect(running).resolves.toMatchObject({ status: 'failed' });
    expect((await eventStore.read('run_approval_deny')).at(-1)?.payload).toMatchObject({ code: 'APPROVAL_DENIED' });
    expect(runtime.execute).toHaveBeenCalledOnce();
    expect(runtime.approve).not.toHaveBeenCalled();
  });

  it('cancels while waiting for approval and removes the pending request', async () => {
    const provider = new SequenceModelProvider([[{ type: 'tool-call-delta', callId: 'cancel-approval', name: 'write', argumentsChunk: '{}' }, { type: 'completed', finishReason: 'tool-calls' }]]);
    const eventStore = new InMemoryEventStore();
    const broker = new InMemoryApprovalBroker({ timeoutMs: 2_000 });
    const runtime = {
      descriptors: [{ name: 'write', id: 'test.write', version: '1.0.0', risk: 'write' as const, summary: 'Write' }],
      execute: vi.fn(async () => { throw Object.assign(new Error('prompt'), { code: 'APPROVAL_REQUIRED' }); }),
      approve: vi.fn(async () => undefined),
    };
    const controller = new AbortController();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime, approvalBroker: broker });
    const running = loop.run({ runId: 'run_approval_cancel', signal: controller.signal, config: config() });
    await vi.waitFor(() => expect(broker.pending()).toHaveLength(1));
    controller.abort();
    await expect(running).resolves.toMatchObject({ status: 'cancelled' });
    expect(broker.pending()).toEqual([]);
  });

  it('enforces maxToolCalls before executing a batch', async () => {
    const provider = new SequenceModelProvider([[
      { type: 'tool-call-delta', callId: 'one', name: 'echo', argumentsChunk: '{}' },
      { type: 'tool-call-delta', callId: 'two', name: 'echo', argumentsChunk: '{}' },
      { type: 'completed', finishReason: 'tool-calls' },
    ]]);
    const eventStore = new InMemoryEventStore();
    const runtime = {
      descriptors: [{ name: 'echo', id: 'test.echo', version: '1.0.0', risk: 'read' as const, summary: 'Echo' }],
      execute: vi.fn(async () => ({ output: 'never' })),
    };
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, toolRuntime: runtime });

    const result = await loop.run({ runId: 'run_tool_limit', config: config({ limits: { ...config().limits, maxToolCalls: 1 } }) });
    expect(result).toMatchObject({ status: 'failed' });
    expect((await eventStore.read('run_tool_limit')).at(-1)?.payload).toMatchObject({ code: 'MAX_TOOL_CALLS_EXCEEDED' });
    expect(runtime.execute).not.toHaveBeenCalled();
  });

  it('bounds accumulated tool arguments before parsing or execution', async () => {
    const provider = new FakeModelProvider({ events: [
      { type: 'tool-call-delta', callId: 'large', name: 'echo', argumentsChunk: 'x'.repeat(256 * 1024 + 1) },
      { type: 'completed', finishReason: 'tool-calls' },
    ] });
    const eventStore = new InMemoryEventStore();
    const loop = new AgentLoop({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider });

    const result = await loop.run({ runId: 'run_tool_argument_limit', config: config() });
    expect(result).toMatchObject({ status: 'failed' });
    expect((await eventStore.read('run_tool_argument_limit')).at(-1)?.payload).toMatchObject({ code: 'TOOL_ARGUMENT_LIMIT_EXCEEDED' });
  });
});
