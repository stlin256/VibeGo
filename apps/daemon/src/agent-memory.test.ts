import { describe, expect, it } from 'vitest';
import { NoopAgentMemoryProvider } from './agent-memory.js';

const identity = { teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo' };
const request = { identity, runId: 'run_12345678', query: 'recall', maxItems: 4, maxBytes: 1_024 };

describe('NoopAgentMemoryProvider', () => {
  it('reports disabled without a sidecar or capability', async () => {
    const provider = new NoopAgentMemoryProvider();
    await expect(provider.status()).resolves.toEqual({
      schemaVersion: 'ready4vibe_agent_memory_status_v0',
      enabled: false,
      mode: 'off',
      available: false,
      degraded: false,
      revision: null,
      previousRevision: null,
      lastHealthAt: null,
      lastUpdateAt: null,
      updateState: 'disabled',
      lastErrorCode: null,
      capabilities: [],
    });
    expect(provider.id).toBe('none');
    expect(provider.mode).toBe('off');
  });

  it('returns empty recall and rejects write-back without invoking an upstream runtime', async () => {
    const provider = new NoopAgentMemoryProvider();
    await expect(provider.recall(request)).resolves.toMatchObject({ items: [], degraded: false, sourceRevision: null });
    await expect(provider.enqueueWrite({ identity, runId: 'run_12345678', summary: 'done', outcome: 'completed' })).resolves.toEqual({ accepted: false, queued: false });
    await expect(provider.close()).resolves.toBeUndefined();
  });

  it('fails closed on invalid or privacy-unsafe DTOs', async () => {
    const provider = new NoopAgentMemoryProvider();
    await expect(provider.recall({ ...request, runId: 'run' })).rejects.toThrow();
    await expect(provider.enqueueWrite({ identity, runId: 'run_12345678', summary: 'apiKey=sk-' + 'x'.repeat(24), outcome: 'completed' })).rejects.toThrow(/secret-shaped/);
  });
});
