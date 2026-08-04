import { describe, expect, it, vi } from 'vitest';
import type { AgentMemoryKnowledgeProvider, AgentMemoryKnowledgeResult, AgentMemoryKnowledgeToolList, AgentMemoryStatus } from '@ready4vibe/contracts';
import { DEFAULT_SCHEDULER_POLICY } from '@ready4vibe/contracts';
import { InMemoryEventStore, InMemorySettingsStore } from '@ready4vibe/storage';
import { FakeModelProvider } from '@ready4vibe/testkit';
import { Scheduler } from '@ready4vibe/scheduler';
import { AgentMemoryKnowledgeSettingsManager } from './agent-memory-knowledge-settings.js';
import { RunManager } from './run-manager.js';

const config = {
  workspaceId: 'workspace-knowledge',
  userMessage: 'find the authentication guidance',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 1, maxWallTimeMs: 60_000, maxModelInputTokens: 200, maxModelOutputTokens: 100, maxToolCalls: 10, maxOutputBytes: 10_000, maxContextBytes: 8_000 },
  createdBySessionId: 'session-knowledge',
  clientRequestId: 'client-knowledge',
};

const list: AgentMemoryKnowledgeToolList = {
  schemaVersion: 'ready4vibe_agent_memory_knowledge_tools_v1', knowledgeId: 'wiki_demo', resourceType: 'wiki', name: 'Demo docs', summary: null, status: 'ready',
  tools: [{ name: 'search', description: 'Search docs.', params: { query: { type: 'string', required: true } } }], sourceRevision: 'knowledge_rev_1', elapsedMs: 1, degraded: false, errorCode: null,
};

const result: AgentMemoryKnowledgeResult = {
  schemaVersion: 'ready4vibe_agent_memory_knowledge_result_v1', knowledgeId: 'wiki_demo', toolName: 'search',
  items: [{ id: 'knowledge_1', content: 'Authentication uses the guarded pairing flow.', kind: 'knowledge', source: 'tencentdb-memory-knowledge', trust: 'untrusted' }],
  sourceRevision: 'knowledge_rev_1', elapsedMs: 1, degraded: false, errorCode: null,
};

function knowledgeProvider(options: { call?: AgentMemoryKnowledgeProvider['call'] } = {}): AgentMemoryKnowledgeProvider {
  return {
    id: 'tencentdb-memory-knowledge',
    status: vi.fn(async (): Promise<AgentMemoryStatus> => ({ schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: true, mode: 'full-stack', available: true, degraded: false, revision: 'knowledge_rev_1', previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'ready', lastErrorCode: null, capabilities: ['knowledge'] })),
    listTools: vi.fn(async () => list),
    call: options.call ?? vi.fn(async () => result),
    retrieve: vi.fn(async () => result),
    close: vi.fn(async () => undefined),
  };
}

describe('RunManager bounded MemoryKnowledge integration', () => {
  it('injects only an explicit autoRetrieve snapshot as untrusted context and keeps settings changes isolated', async () => {
    const knowledge = knowledgeProvider();
    const settings = new AgentMemoryKnowledgeSettingsManager({ settings: new InMemorySettingsStore(), provider: knowledge });
    settings.patch({ enabled: true, autoRetrieve: true, knowledgeId: 'wiki_demo' });
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const manager = new RunManager({ eventStore: new InMemoryEventStore(), scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: model, agentMemoryKnowledgeSettings: settings });
    const started = await manager.start(config);
    settings.patch({ enabled: false });
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());
    expect(vi.mocked(knowledge.call)).toHaveBeenCalledWith(expect.objectContaining({ knowledgeId: 'wiki_demo', toolName: 'search', params: { query: config.userMessage }, maxItems: 8 }));
    expect(model.requests[0]?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('Authentication uses the guarded pairing flow.') })]));
    expect(model.requests[0]?.messages).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('BEGIN_UNTRUSTED_CONTENT') })]));
  });

  it('keeps the run available when knowledge provider times out or returns degraded', async () => {
    const knowledge = knowledgeProvider({ call: vi.fn(async () => ({ ...result, items: [], degraded: true, errorCode: 'timeout' as const })) });
    const settings = new AgentMemoryKnowledgeSettingsManager({ settings: new InMemorySettingsStore(), provider: knowledge });
    settings.patch({ enabled: true, autoRetrieve: true });
    const model = new FakeModelProvider({ events: [{ type: 'completed', finishReason: 'stop' }] });
    const manager = new RunManager({ eventStore: new InMemoryEventStore(), scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY), modelProvider: model, agentMemoryKnowledgeSettings: settings });
    const started = await manager.start(config);
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());
    expect(manager.completion(started.runId)?.status).toBe('completed');
    expect(model.requests[0]?.messages).toEqual([{ role: 'user', content: config.userMessage }]);
  });
});
