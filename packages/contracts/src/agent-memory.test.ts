import { describe, expect, it } from 'vitest';
import {
  AgentMemoryItemSchema,
  AgentMemoryRecallRequestSchema,
  AgentMemorySettingsPatchSchema,
  AgentMemorySettingsSchema,
  AgentMemorySettingsStatusSchema,
  AgentMemoryStatusSchema,
  AgentMemoryWriteRequestSchema,
  findAgentMemoryPrivacyViolations,
} from './agent-memory.js';

const identity = { teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo', sessionId: 'session_demo' };
const request = {
  identity,
  runId: 'run_12345678',
  workspaceId: 'workspace_demo',
  query: 'remember the test command',
  maxItems: 8,
  maxBytes: 32_000,
};

describe('agent memory contracts', () => {
  it('accepts the versioned bounded request/result shapes', () => {
    expect(AgentMemoryRecallRequestSchema.parse(request)).toMatchObject({ runId: 'run_12345678', maxItems: 8 });
    expect(AgentMemoryItemSchema.parse({ id: 'memory_1', content: 'Use pnpm test.', kind: 'fact', source: 'tencentdb-memory-core', trust: 'trusted' })).toMatchObject({ kind: 'fact' });
    expect(AgentMemoryStatusSchema.parse({ schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false, degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'disabled', lastErrorCode: null, capabilities: [] })).toMatchObject({ mode: 'off' });
  });

  it('rejects unknown fields, malformed ids, and unbounded values', () => {
    expect(() => AgentMemoryRecallRequestSchema.parse({ ...request, extra: true })).toThrow();
    expect(() => AgentMemoryRecallRequestSchema.parse({ ...request, runId: 'run' })).toThrow();
    expect(() => AgentMemoryRecallRequestSchema.parse({ ...request, query: 'x'.repeat(16_385) })).toThrow();
    expect(() => AgentMemoryItemSchema.parse({ id: 'memory_1', content: 'x', kind: 'unknown', source: 'tencentdb-memory-core', trust: 'trusted' })).toThrow();
  });

  it('rejects secret-shaped content and absolute paths before an adapter can send it upstream', () => {
    expect(findAgentMemoryPrivacyViolations({ summary: 'apiKey=sk-' + 'x'.repeat(24) })).not.toHaveLength(0);
    expect(() => AgentMemoryWriteRequestSchema.parse({ identity, runId: 'run_12345678', summary: 'C:\\Users\\private\\repo', outcome: 'completed' })).toThrow(/absolute path/);
    expect(() => AgentMemoryWriteRequestSchema.parse({ identity, runId: 'run_12345678', summary: 'safe', facts: ['token=opaque-value'], outcome: 'completed' })).toThrow(/secret-shaped/);
  });

  it('bounds write-back payloads and keeps outcome explicit', () => {
    const value = AgentMemoryWriteRequestSchema.parse({ identity, runId: 'run_12345678', summary: 'Completed tests.', facts: ['All unit tests pass.'], decisions: ['Keep memory optional.'], evidenceRefs: ['evt_123'], outcome: 'completed' });
    expect(value.outcome).toBe('completed');
    expect(() => AgentMemoryWriteRequestSchema.parse({ identity, runId: 'run_12345678', summary: 'x', facts: Array.from({ length: 65 }, () => 'fact'), outcome: 'failed' })).toThrow();
  });

  it('validates the non-secret durable settings and status boundary', () => {
    const settings = AgentMemorySettingsSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_settings_v1', enabled: false, mode: 'memory-core',
      teamId: 'team_demo', agentId: 'agent_demo', userId: 'user_demo',
      upstreamRepo: 'https://github.com/TencentCloud/TencentDB-Agent-Memory', upstreamRef: 'feat/server_team',
      autoUpdate: true, updateIntervalMinutes: 60, fallbackToDirectProvider: true,
    });
    expect(settings.mode).toBe('memory-core');
    expect(AgentMemorySettingsPatchSchema.parse({ enabled: true, updateIntervalMinutes: 15 })).toEqual({ enabled: true, updateIntervalMinutes: 15 });
    expect(() => AgentMemorySettingsPatchSchema.parse({})).toThrow();
    expect(() => AgentMemorySettingsSchema.parse({ ...settings, upstreamRepo: 'C:\\secret\\repo' })).toThrow();
    expect(() => AgentMemorySettingsSchema.parse({ ...settings, apiKey: 'secret' })).toThrow();
    expect(() => AgentMemorySettingsSchema.parse({ ...settings, enabled: true, mode: 'off' })).toThrow();
    expect(AgentMemorySettingsStatusSchema.parse({ schemaVersion: 'ready4vibe_agent_memory_settings_status_v0', settings, status: { schemaVersion: 'ready4vibe_agent_memory_status_v0', enabled: false, mode: 'off', available: false, degraded: false, revision: null, previousRevision: null, lastHealthAt: null, lastUpdateAt: null, updateState: 'disabled', lastErrorCode: null, capabilities: [] }, currentRevision: null, previousRevision: null })).toMatchObject({ settings: { userId: 'user_demo' } });
  });
});
