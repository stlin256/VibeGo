import { describe, expect, it, vi } from 'vitest';
import type { AgentMemoryIdentity, AgentMemoryProvider, AgentMemoryStatus, AgentMemoryWriteRequest } from '@ready4vibe/contracts';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import type { ModelEvent, ModelProvider, ModelRequest } from '@ready4vibe/contracts';
import { Scheduler } from '@ready4vibe/scheduler';
import { InMemoryEventStore, InMemorySettingsStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { OpenAICompatibleProvider } from '@ready4vibe/model-openai';
import { AgentMemorySettingsManager } from './agent-memory-settings.js';
import { TencentMemoryProxyProvider } from './memory-proxy-provider.js';
import { RunManager, RunManagerError } from './run-manager.js';

const config = {
  workspaceId: 'workspace-recovery',
  userMessage: 'inspect the workspace',
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
  createdBySessionId: 'session-recovery',
  clientRequestId: 'client-recovery',
};

function event(runId: string, type: string, payload: unknown) {
  return { runId, type, source: 'system' as const, correlationId: `corr_${runId}`, payload };
}

function manager(eventStore: InMemoryEventStore): RunManager {
  return new RunManager({
    eventStore,
    scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
    modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
  });
}

function memoryStatus(): AgentMemoryStatus {
  return {
    schemaVersion: 'ready4vibe_agent_memory_status_v0',
    enabled: true,
    mode: 'memory-core',
    available: true,
    degraded: false,
    revision: 'rev_123',
    previousRevision: null,
    lastHealthAt: '2026-08-04T00:00:00.000Z',
    lastUpdateAt: null,
    updateState: 'ready',
    lastErrorCode: null,
    capabilities: ['recall', 'write-back'],
  };
}

function memoryProvider(identity: AgentMemoryIdentity, options: {
  recall?: AgentMemoryProvider['recall'];
  enqueueWrite?: (request: AgentMemoryWriteRequest) => Promise<{ accepted: boolean; queued: boolean }>;
} = {}): AgentMemoryProvider {
  const defaultRecall: AgentMemoryProvider['recall'] = vi.fn(async () => ({
    items: [{ id: 'memory_1', content: 'Use the bounded test workflow.', kind: 'preference' as const, source: 'tencentdb-memory-core' as const, trust: 'untrusted' as const }],
    sourceRevision: 'rev_123',
    elapsedMs: 1,
    degraded: false,
  }));
  const defaultWrite: AgentMemoryProvider['enqueueWrite'] = vi.fn(async () => ({ accepted: true, queued: true }));
  return {
    id: 'tencentdb-agent-memory',
    mode: 'memory-core',
    status: vi.fn(async () => memoryStatus()),
    recall: options.recall ?? defaultRecall,
    enqueueWrite: options.enqueueWrite ?? defaultWrite,
    close: vi.fn(async () => undefined),
  };
}

function memoryManager(providers: AgentMemoryProvider[]): AgentMemorySettingsManager {
  const manager = new AgentMemorySettingsManager({
    settings: new InMemorySettingsStore(),
    providerFactory: (identity) => {
      const provider = memoryProvider(identity);
      providers.push(provider);
      return provider;
    },
  });
  manager.patch({ enabled: true, teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' });
  return manager;
}

describe('RunManager restart recovery', () => {
  it('marks non-terminal runs once without restoring approval state', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append(event('run_recovery', 'run.created', { config }));
    await eventStore.append(event('run_recovery', 'run.status', { from: 'created', to: 'waiting-approval' }));
    const runManager = manager(eventStore);

    await expect(runManager.recoverAfterRestart()).resolves.toEqual({ marked: 1, skipped: 0 });
    await expect(runManager.snapshot('run_recovery')).resolves.toMatchObject({
      status: 'needs-recovery',
      approvals: [],
      final: { summary: 'Run requires recovery after daemon restart.', exitReason: 'daemon-restarted' },
    });
    const events = await eventStore.read('run_recovery');
    const marker = events.find((item) => item.type === 'run.needs_recovery');
    expect(marker?.payload).toEqual({ previousStatus: 'waiting-approval', reason: 'daemon-restarted' });
    expect(JSON.stringify(marker?.payload)).not.toMatch(/secret|token|argument|path/iu);

    await expect(runManager.recoverAfterRestart()).resolves.toEqual({ marked: 0, skipped: 1 });
    expect((await eventStore.read('run_recovery')).filter((item) => item.type === 'run.needs_recovery')).toHaveLength(1);
  });

  it('skips terminal runs', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append(event('run_done', 'run.created', { config }));
    await eventStore.append(event('run_done', 'run.status', { from: 'created', to: 'queued' }));
    await eventStore.append(event('run_done', 'run.status', { from: 'queued', to: 'planning' }));
    await eventStore.append(event('run_done', 'run.status', { from: 'planning', to: 'executing' }));
    await eventStore.append(event('run_done', 'run.status', { from: 'executing', to: 'completed' }));
    const runManager = manager(eventStore);

    await expect(runManager.recoverAfterRestart()).resolves.toEqual({ marked: 0, skipped: 1 });
    expect((await eventStore.read('run_done')).some((item) => item.type === 'run.needs_recovery')).toBe(false);
  });

  it('rejects an unknown workspace before queueing a run', async () => {
    const eventStore = new InMemoryEventStore();
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
      workspaceExists: (workspaceId) => workspaceId === 'workspace-ok',
    });
    await expect(runManager.start(config)).rejects.toBeInstanceOf(RunManagerError);
    expect(eventStore.listRunIds()).toEqual([]);
  });

  it('releases a captured disposable runtime after terminal completion without changing the run result', async () => {
    const eventStore = new InMemoryEventStore();
    const dispose = vi.fn(async () => undefined);
    const runtime = {
      descriptors: [],
      execute: vi.fn(async () => ({ output: { ok: true } })),
      dispose,
    };
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
      toolRuntimeForRun: () => runtime,
    });

    const started = await runManager.start(config);
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toMatchObject({ status: 'completed' }));
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('recalls bounded untrusted context and queues compact write-back after terminal state', async () => {
    const eventStore = new InMemoryEventStore();
    const providers: AgentMemoryProvider[] = [];
    const memory = memoryManager(providers);
    const model = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] });
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: model,
      agentMemorySettings: memory,
    });

    const started = await runManager.start(config);
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    const runProvider = providers.at(-1);
    expect(runProvider).toBeDefined();
    expect(vi.mocked(runProvider!.recall)).toHaveBeenCalledWith(expect.objectContaining({
      runId: started.runId,
      identity: expect.objectContaining({ sessionId: 'session-recovery' }),
    }));
    expect(model.requests[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('Use the bounded test workflow.') }),
    ]));
    await vi.waitFor(() => expect(vi.mocked(runProvider!.enqueueWrite)).toHaveBeenCalledWith(expect.objectContaining({
      runId: started.runId,
      outcome: 'completed',
      evidenceRefs: [`run:${started.runId}`],
    })));
    const events = await eventStore.read(started.runId);
    expect(JSON.stringify(events)).not.toMatch(/api[_-]?key|private key|C:\\|\/Users\//iu);
  });

  it('keeps runs available when recall/write fail and drops retrieval within context budget', async () => {
    const eventStore = new InMemoryEventStore();
    const providers: AgentMemoryProvider[] = [];
    const memory = new AgentMemorySettingsManager({
      settings: new InMemorySettingsStore(),
      providerFactory: (identity) => {
        const provider = memoryProvider(identity, {
          recall: vi.fn(async () => { throw new Error('recall unavailable'); }),
          enqueueWrite: vi.fn(async () => { throw new Error('write unavailable'); }),
        });
        providers.push(provider);
        return provider;
      },
    });
    memory.patch({ enabled: true, teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' });
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: model, agentMemorySettings: memory });

    const started = await runManager.start({ ...config, limits: { ...config.limits, maxContextBytes: 32 } });
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    expect(runManager.completion(started.runId)?.status).toBe('completed');
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: config.userMessage }]);
    expect(vi.mocked(providers.at(-1)!.enqueueWrite)).toHaveBeenCalledTimes(1);
  });

  it('keeps a captured run provider after settings are switched off', async () => {
    const eventStore = new InMemoryEventStore();
    const providers: AgentMemoryProvider[] = [];
    const memory = memoryManager(providers);
    const model = new FakeModelProvider({ delayMs: 10, events: [{ type: 'text-delta', text: 'done' }, { type: 'completed', finishReason: 'stop' }] });
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: model, agentMemorySettings: memory });

    const started = await runManager.start(config);
    memory.patch({ enabled: false });
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    const runProvider = providers.at(-1)!;
    expect(vi.mocked(runProvider.enqueueWrite)).toHaveBeenCalledWith(expect.objectContaining({ runId: started.runId, outcome: 'completed' }));
  });

  it('does not create or call a memory provider while memory is off', async () => {
    const eventStore = new InMemoryEventStore();
    const providerFactory = vi.fn(() => memoryProvider({ teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' }));
    const memory = new AgentMemorySettingsManager({ settings: new InMemorySettingsStore(), providerFactory });
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: model, agentMemorySettings: memory });

    const started = await runManager.start(config);
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    expect(providerFactory).not.toHaveBeenCalled();
    expect(runManager.completion(started.runId)?.status).toBe('completed');
  });

  it('uses the proxy model provider captured at run creation and keeps the base provider untouched', async () => {
    const eventStore = new InMemoryEventStore();
    const baseModel = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'base' }, { type: 'completed', finishReason: 'stop' }] });
    const proxy = new TencentMemoryProxyProvider({
      endpoint: 'https://proxy.example.test',
      identity: { teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' },
      fetchImpl: async () => responseFromChunks([
        'data: {"choices":[{"delta":{"content":"proxy"}}]}\n\n',
        'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    });
    const memory = new AgentMemorySettingsManager({
      settings: new InMemorySettingsStore(),
      providerFactory: () => proxy,
    });
    memory.patch({ enabled: true, mode: 'proxy', teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' });
    const runManager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: baseModel,
      agentMemorySettings: memory,
    });

    const started = await runManager.start(config);
    await vi.waitFor(() => expect(runManager.completion(started.runId)).toBeDefined());
    expect(runManager.completion(started.runId)).toMatchObject({ status: 'completed', output: 'proxy' });
    expect(baseModel.requests).toHaveLength(0);
  });

  it('runs a real OpenAI-compatible two-turn tool call through the application bridge', async () => {
    let fetchCalls = 0;
    const provider = new OpenAICompatibleProvider({
      id: 'openai-compatible',
      endpoint: 'https://provider.example.test/v1/chat/completions',
      apiKey: 'test-secret',
      fetchImpl: async () => {
        fetchCalls += 1;
        const chunks = fetchCalls === 1
          ? [
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_echo","function":{"name":"echo","arguments":"{\\"value\\":1}"}}]}}]}\n\n',
            'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
            'data: [DONE]\n\n',
          ]
          : [
            'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
            'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
          ];
        return responseFromChunks(chunks);
      },
    });
    const eventStore = new InMemoryEventStore();
    const runtime = {
      descriptors: [{ name: 'echo', id: 'test.echo', version: '1.0.0', risk: 'read' as const, summary: 'Echo a value' }],
      execute: vi.fn(async ({ input }: { input: unknown }) => ({ output: { received: input } })),
    };
    const manager = new RunManager({
      eventStore,
      scheduler: new Scheduler({ ...DEFAULT_SCHEDULER_POLICY, maxActiveRuns: 1 }),
      modelProvider: new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] }),
      modelBindingForRun: () => ({
        provider,
        snapshot: {
          schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
          providerId: 'openai-compatible',
          model: 'fixture-model',
          pricingModel: 'fixture-model',
          descriptorRevision: 'fixture-rev-1',
          endpointPolicy: { kind: 'explicit-url', baseUrl: 'https://provider.example.test/v1/chat/completions' },
          capabilities: {
            streaming: true,
            toolCalls: true,
            structuredOutput: false,
            reasoning: false,
            promptCaching: false,
            audioInput: false,
            audioOutput: false,
          },
          capturedAt: '2026-08-04T12:00:00.000Z',
        },
      }),
      toolRuntime: runtime,
    });

    const started = await manager.start({ ...config, model: { provider: 'openai-compatible', name: 'fixture-model' }, limits: { ...config.limits, maxTurns: 2 } });
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());

    expect(manager.completion(started.runId)).toMatchObject({ status: 'completed', output: 'done' });
    expect(fetchCalls).toBe(2);
    expect(runtime.execute).toHaveBeenCalledWith(expect.objectContaining({ callId: 'call_echo', input: { value: 1 } }));
    const events = await eventStore.read(started.runId);
    expect(events[0]?.payload).toMatchObject({ modelSnapshot: { providerId: 'openai-compatible', descriptorRevision: 'fixture-rev-1' } });
    expect(events.filter((event) => event.type === 'model.requested')).toHaveLength(2);
    expect(events.find((event) => event.type === 'model.requested')?.payload).toMatchObject({ providerId: 'openai-compatible' });
    expect(JSON.stringify(events)).not.toContain('test-secret');
    await expect(manager.snapshot(started.runId)).resolves.toMatchObject({ modelSnapshot: { providerId: 'openai-compatible', descriptorRevision: 'fixture-rev-1' } });
  });

  it('freezes the provider binding for an in-flight run when settings switch', async () => {
    const first = new FakeModelProvider({ delayMs: 10, events: [{ type: 'text-delta', text: 'first' }, { type: 'completed', finishReason: 'stop' }] });
    const second = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'second' }, { type: 'completed', finishReason: 'stop' }] });
    const snapshot = (revision: string) => ({
      schemaVersion: 'ready4vibe_model_provider_snapshot_v1' as const,
      providerId: 'fake-model',
      model: 'deterministic',
      pricingModel: 'deterministic',
      descriptorRevision: revision,
      endpointPolicy: { kind: 'provider-default' as const },
      capabilities: {
        streaming: true,
        toolCalls: true,
        structuredOutput: true,
        reasoning: false,
        promptCaching: false,
        audioInput: false,
        audioOutput: false,
      },
      capturedAt: '2026-08-04T12:00:00.000Z',
    });
    let binding = { provider: first, snapshot: snapshot('first-rev') };
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: first,
      modelBindingForRun: () => binding,
    });

    const started = await manager.start(config);
    binding = { provider: second, snapshot: snapshot('second-rev') };
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());

    expect(manager.completion(started.runId)).toMatchObject({ status: 'completed', output: 'first' });
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(0);
    expect((await manager.eventStore.read(started.runId))[0]?.payload).toMatchObject({ modelSnapshot: { descriptorRevision: 'first-rev' } });
  });

  it('freezes the DeepSeek-specific snapshot together with the provider binding', async () => {
    const first = new FakeModelProvider({ delayMs: 10, events: [{ type: 'text-delta', text: 'first' }, { type: 'completed', finishReason: 'stop' }] });
    const second = new FakeModelProvider({ events: [{ type: 'text-delta', text: 'second' }, { type: 'completed', finishReason: 'stop' }] });
    const deepSeekSnapshot = (revision: string) => ({
      schemaVersion: 'deepseek-provider-run/v1' as const,
      providerId: 'deepseek' as const,
      endpointProfile: 'openai-chat-completions' as const,
      endpoint: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-v4-flash',
      thinkingMode: 'auto' as const,
      toolCalling: 'enabled' as const,
      webSearch: 'off' as const,
      reviewer: 'off' as const,
      configRevision: revision,
      capabilityRevision: 'deepseek-capability-unprobed',
      capturedAt: '2026-08-05T00:00:00.000Z',
    });
    const genericSnapshot = (revision: string) => ({
      schemaVersion: 'ready4vibe_model_provider_snapshot_v1' as const,
      providerId: 'deepseek',
      model: 'deepseek-v4-flash',
      pricingModel: 'deepseek-v4-flash',
      descriptorRevision: revision,
      endpointPolicy: { kind: 'explicit-url' as const, baseUrl: 'https://api.deepseek.com/v1/chat/completions' },
      capabilities: { streaming: true, toolCalls: true, structuredOutput: false, reasoning: false, promptCaching: false, audioInput: false, audioOutput: false },
      capturedAt: '2026-08-05T00:00:00.000Z',
    });
    let binding = { provider: first, snapshot: genericSnapshot('first-rev'), deepSeekSnapshot: deepSeekSnapshot('deepseek-first') };
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: first,
      modelBindingForRun: () => binding,
    });

    const started = await manager.start({ ...config, model: { provider: 'deepseek', name: 'deepseek-v4-flash' } });
    binding = { provider: second, snapshot: genericSnapshot('second-rev'), deepSeekSnapshot: deepSeekSnapshot('deepseek-second') };
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());

    expect((await manager.eventStore.read(started.runId))[0]?.payload).toMatchObject({
      modelSnapshot: { descriptorRevision: 'first-rev' },
      deepSeekSnapshot: { configRevision: 'deepseek-first' },
    });
    expect(await manager.snapshot(started.runId)).toMatchObject({ deepSeekSnapshot: { configRevision: 'deepseek-first' } });
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(0);
  });
});

function responseFromChunks(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status });
}

describe('RunManager LLM run titles', () => {
  const titleConfig = { ...config, userMessage: 'please inspect the workspace layout carefully' };

  function titleProvider(titleEvents: ModelEvent[]): ModelProvider {
    return {
      id: 'title-fake',
      capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
      async *stream(request: ModelRequest) {
        if (request.metadata.turnId.startsWith('title_')) {
          for (const event of titleEvents) yield event;
          return;
        }
        yield { type: 'text-delta', text: 'run output' };
        yield { type: 'completed', finishReason: 'stop' };
      },
    };
  }

  it('asks the captured provider for a short title and projects it in run summaries', async () => {
    const eventStore = new InMemoryEventStore();
    const provider = titleProvider([
      { type: 'text-delta', text: '"Workspace layout inspection with an overly long generated title that must be clipped"' },
      { type: 'completed', finishReason: 'stop' },
    ]);
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, generateRunTitles: true });
    await runManager.start(titleConfig);
    await vi.waitFor(async () => {
      const summaries = await runManager.listRunSummaries();
      expect(summaries[0]?.title).not.toBe(titleConfig.userMessage);
    });
    const summaries = await runManager.listRunSummaries();
    expect(summaries[0]?.title.startsWith('Workspace layout inspection')).toBe(true);
    expect(summaries[0]?.title.length).toBeLessThanOrEqual(48);
    const events = await eventStore.read(summaries[0]!.runId);
    expect(events.filter((event) => event.type === 'run.titled')).toHaveLength(1);
  });

  it('keeps the message-derived title when title generation fails', async () => {
    const eventStore = new InMemoryEventStore();
    const provider = titleProvider([{ type: 'error', code: 'DEEPSEEK_HTTP_500', retryable: false, safeMessage: 'boom' }]);
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: provider, generateRunTitles: true });
    const { runId } = await runManager.start(titleConfig);
    await vi.waitFor(async () => {
      expect((await runManager.snapshot(runId))?.status).toBe('completed');
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const summaries = await runManager.listRunSummaries();
    expect(summaries[0]?.title).toBe(titleConfig.userMessage);
    const events = await eventStore.read(runId);
    expect(events.filter((event) => event.type === 'run.titled')).toHaveLength(0);
  });
});

describe('RunManager conversations', () => {
  function recordingProvider(requests: ModelRequest[]): ModelProvider {
    return {
      id: 'conversation-fake',
      capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
      async *stream(request: ModelRequest) {
        requests.push(request);
        yield { type: 'text-delta', text: `answer ${requests.length}` };
        yield { type: 'completed', finishReason: 'stop' };
      },
    };
  }

  it('feeds prior exchanges of the same conversation to the model as context', async () => {
    const eventStore = new InMemoryEventStore();
    const requests: ModelRequest[] = [];
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: recordingProvider(requests) });
    const first = await runManager.start({ ...config, userMessage: 'first question', conversationId: 'conv-test' });
    await vi.waitFor(() => expect(runManager.completion(first.runId)?.status).toBe('completed'));
    const second = await runManager.start({ ...config, userMessage: 'second question', conversationId: 'conv-test' });
    await vi.waitFor(() => expect(runManager.completion(second.runId)?.status).toBe('completed'));
    const messages = requests[1]?.messages as ReadonlyArray<{ role: string; content: string }>;
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]?.content).toBe('first question');
    expect(messages[1]?.content).toContain('answer 1');
    expect(messages[2]?.content).toBe('second question');
  });

  it('projects conversation exchanges chronologically and tags run summaries', async () => {
    const eventStore = new InMemoryEventStore();
    const requests: ModelRequest[] = [];
    const runManager = new RunManager({ eventStore, scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: recordingProvider(requests) });
    const first = await runManager.start({ ...config, userMessage: 'first question', conversationId: 'conv-test' });
    await vi.waitFor(() => expect(runManager.completion(first.runId)?.status).toBe('completed'));
    const other = await runManager.start({ ...config, userMessage: 'unrelated question' });
    await vi.waitFor(() => expect(runManager.completion(other.runId)?.status).toBe('completed'));
    const second = await runManager.start({ ...config, userMessage: 'second question', conversationId: 'conv-test' });
    await vi.waitFor(() => expect(runManager.completion(second.runId)?.status).toBe('completed'));
    const { messages } = await runManager.listConversationMessages('conv-test');
    expect(messages.map((message) => message.user)).toEqual(['first question', 'second question']);
    expect(messages.map((message) => message.runId)).toEqual([first.runId, second.runId]);
    expect(messages[0]?.assistant).toContain('answer');
    const summaries = await runManager.listRunSummaries();
    expect(summaries.find((summary) => summary.runId === first.runId)?.conversationId).toBe('conv-test');
    expect(summaries.find((summary) => summary.runId === other.runId)?.conversationId).toBeUndefined();
  });
});
