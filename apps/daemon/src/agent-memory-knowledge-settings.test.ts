import { describe, expect, it, vi } from 'vitest';
import type {
  AgentMemoryKnowledgeProvider,
  AgentMemoryKnowledgeResult,
  AgentMemoryKnowledgeToolList,
  AgentMemoryStatus,
} from '@ready4vibe/contracts';
import { InMemorySettingsStore } from '@ready4vibe/storage';
import { AgentMemoryKnowledgeSettingsManager } from './agent-memory-knowledge-settings.js';

const toolList: AgentMemoryKnowledgeToolList = {
  schemaVersion: 'ready4vibe_agent_memory_knowledge_tools_v1',
  knowledgeId: 'wiki_demo',
  resourceType: 'wiki',
  name: 'Demo docs',
  summary: 'Bounded docs.',
  status: 'ready',
  tools: [{ name: 'search', description: 'Search docs.', params: { query: { type: 'string', required: true } } }],
  sourceRevision: 'knowledge_rev_1',
  elapsedMs: 1,
  degraded: false,
  errorCode: null,
};

const knowledgeResult: AgentMemoryKnowledgeResult = {
  schemaVersion: 'ready4vibe_agent_memory_knowledge_result_v1',
  knowledgeId: 'wiki_demo',
  toolName: 'search',
  items: [{ id: 'knowledge_1', content: 'Use the safe docs.', kind: 'knowledge', source: 'tencentdb-memory-knowledge', trust: 'untrusted' }],
  sourceRevision: 'knowledge_rev_1',
  elapsedMs: 1,
  degraded: false,
  errorCode: null,
};

function status(): AgentMemoryStatus {
  return {
    schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: true, mode: 'full-stack', available: true,
    degraded: false, revision: 'knowledge_rev_1', previousRevision: null, lastHealthAt: '2026-08-04T00:00:00.000Z',
    lastUpdateAt: null, updateState: 'ready', lastErrorCode: null, capabilities: ['knowledge'],
  };
}

function provider(options: { listTools?: AgentMemoryKnowledgeProvider['listTools']; call?: AgentMemoryKnowledgeProvider['call'] } = {}): AgentMemoryKnowledgeProvider {
  return {
    id: 'tencentdb-memory-knowledge',
    status: vi.fn(async () => status()),
    listTools: options.listTools ?? vi.fn(async () => toolList),
    call: options.call ?? vi.fn(async () => knowledgeResult),
    retrieve: vi.fn(async () => knowledgeResult),
    close: vi.fn(async () => undefined),
  };
}

describe('AgentMemoryKnowledgeSettingsManager', () => {
  it('defaults disabled and does not create or call a provider while off', () => {
    const factory = vi.fn(() => provider());
    const manager = new AgentMemoryKnowledgeSettingsManager({ settings: new InMemorySettingsStore(), providerFactory: factory });
    expect(manager.status()).toMatchObject({ settings: { enabled: false, autoRetrieve: false }, available: false, degraded: false });
    expect(manager.createRunSnapshot()).toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });

  it('probes only after explicit enable, persists bounded settings, and projects safe descriptors', async () => {
    const settings = new InMemorySettingsStore();
    const knowledge = provider();
    const manager = new AgentMemoryKnowledgeSettingsManager({ settings, provider: knowledge });
    manager.patch({ enabled: true, knowledgeId: 'wiki_demo' });
    const result = await manager.probe();
    expect(result).toMatchObject({ available: true, degraded: false, resourceType: 'wiki', resourceName: 'Demo docs', sourceRevision: 'knowledge_rev_1', tools: [{ name: 'search' }] });
    expect(vi.mocked(knowledge.listTools)).toHaveBeenCalledWith({ knowledgeId: 'wiki_demo' });
    expect(JSON.stringify(result)).not.toMatch(/endpoint|api[_-]?key|C:\\|\/Users\//iu);
    const restored = new AgentMemoryKnowledgeSettingsManager({ settings, provider: knowledge });
    expect(restored.settingsSnapshot()).toMatchObject({ enabled: true, knowledgeId: 'wiki_demo' });
  });

  it('returns bounded degraded status when probe fails and never exposes provider errors', async () => {
    const knowledge = provider({ listTools: vi.fn(async () => ({ ...toolList, degraded: true, tools: [], errorCode: 'schema' as const })) });
    const manager = new AgentMemoryKnowledgeSettingsManager({ settings: new InMemorySettingsStore(), provider: knowledge });
    manager.patch({ enabled: true });
    await expect(manager.probe()).resolves.toMatchObject({ available: false, degraded: true, lastErrorCode: 'schema', tools: [] });
  });

  it('creates a run snapshot only for autoRetrieve and freezes limits/provider ownership', async () => {
    const providers: AgentMemoryKnowledgeProvider[] = [];
    const factory = vi.fn(() => { const next = provider(); providers.push(next); return next; });
    const manager = new AgentMemoryKnowledgeSettingsManager({ settings: new InMemorySettingsStore(), providerFactory: factory });
    manager.patch({ enabled: true, autoRetrieve: false });
    expect(manager.createRunSnapshot()).toBeUndefined();
    manager.patch({ autoRetrieve: true, maxItems: 4, maxBytes: 4_096, timeoutMs: 500 });
    const snapshot = manager.createRunSnapshot();
    expect(snapshot).toMatchObject({ knowledgeId: 'wiki_demo', maxItems: 4, maxBytes: 4_096, timeoutMs: 500 });
    expect(factory).toHaveBeenCalledTimes(1);
    manager.patch({ enabled: false });
    expect(snapshot?.maxItems).toBe(4);
    await snapshot?.dispose();
    expect(vi.mocked(providers[0]!.close)).toHaveBeenCalledTimes(1);
  });
});
