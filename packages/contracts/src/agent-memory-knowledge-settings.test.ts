import { describe, expect, it } from 'vitest';
import {
  AgentMemoryKnowledgeSettingsPatchSchema,
  AgentMemoryKnowledgeSettingsSchema,
  AgentMemoryKnowledgeSettingsStatusSchema,
} from './agent-memory-knowledge-settings.js';

const settings = {
  schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_v1' as const,
  enabled: false,
  knowledgeId: 'wiki_demo',
  autoRetrieve: false,
  maxItems: 8,
  maxBytes: 8_192,
  timeoutMs: 750,
};

describe('agent memory knowledge settings contracts', () => {
  it('accepts the versioned non-secret settings and status projection', () => {
    expect(AgentMemoryKnowledgeSettingsSchema.parse(settings)).toEqual(settings);
    expect(AgentMemoryKnowledgeSettingsPatchSchema.parse({ enabled: true, autoRetrieve: true })).toEqual({ enabled: true, autoRetrieve: true });
    expect(AgentMemoryKnowledgeSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_knowledge_settings_status_v0',
      settings,
      available: false,
      degraded: false,
      resourceType: null,
      resourceName: null,
      sourceRevision: null,
      tools: [],
      lastHealthAt: null,
      lastErrorCode: null,
    })).toMatchObject({ settings: { knowledgeId: 'wiki_demo' }, tools: [] });
  });

  it('rejects unknown, secret-shaped, absolute-path and out-of-range values', () => {
    expect(() => AgentMemoryKnowledgeSettingsPatchSchema.parse({})).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, extra: true })).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, knowledgeId: '../wiki' })).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, knowledgeId: 'token=secret' })).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, maxItems: 0 })).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, maxBytes: 128 * 1024 + 1 })).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, timeoutMs: 10_001 })).toThrow();
    expect(() => AgentMemoryKnowledgeSettingsSchema.parse({ ...settings, knowledgeId: 'C:\\private\\wiki' })).toThrow();
  });
});
