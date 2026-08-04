import { describe, expect, it } from 'vitest';
import {
  AgentMemoryKnowledgeCallRequestSchema,
  AgentMemoryKnowledgeResultSchema,
  AgentMemoryKnowledgeToolListSchema,
} from './agent-memory-knowledge.js';

describe('agent memory knowledge contracts', () => {
  it('accepts versioned bounded list/call/result DTOs', () => {
    expect(AgentMemoryKnowledgeCallRequestSchema.parse({
      knowledgeId: 'wiki_demo',
      toolName: 'search',
      params: { query: 'authentication', limit: 5 },
      maxItems: 8,
      maxBytes: 8_192,
    })).toMatchObject({ knowledgeId: 'wiki_demo', toolName: 'search' });
    expect(AgentMemoryKnowledgeToolListSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_knowledge_tools_v1',
      knowledgeId: 'wiki_demo',
      resourceType: 'wiki',
      name: 'Docs',
      summary: null,
      status: 'ready',
      tools: [{ name: 'search', description: 'Search pages.', params: { query: { type: 'string', required: true } } }],
      sourceRevision: null,
      elapsedMs: 2,
      degraded: false,
      errorCode: null,
    })).toMatchObject({ resourceType: 'wiki', tools: [{ name: 'search' }] });
    expect(AgentMemoryKnowledgeResultSchema.parse({
      schemaVersion: 'ready4vibe_agent_memory_knowledge_result_v1',
      knowledgeId: 'wiki_demo',
      toolName: 'search',
      items: [{ id: 'knowledge_1', content: 'Use the auth module.', kind: 'knowledge', source: 'tencentdb-memory-knowledge', trust: 'untrusted' }],
      sourceRevision: null,
      elapsedMs: 2,
      degraded: false,
      errorCode: null,
    })).toMatchObject({ items: [{ source: 'tencentdb-memory-knowledge' }] });
  });

  it('rejects unknown fields, unsafe ids, oversized params, secrets and absolute paths', () => {
    expect(() => AgentMemoryKnowledgeCallRequestSchema.parse({ knowledgeId: 'wiki_demo', toolName: 'search', params: {}, maxItems: 1, maxBytes: 1, extra: true })).toThrow();
    expect(() => AgentMemoryKnowledgeCallRequestSchema.parse({ knowledgeId: '../wiki', toolName: 'search', params: {}, maxItems: 1, maxBytes: 1 })).toThrow();
    expect(() => AgentMemoryKnowledgeCallRequestSchema.parse({ knowledgeId: 'wiki_demo', toolName: 'search', params: { query: 'x'.repeat(16_385) }, maxItems: 1, maxBytes: 1 })).toThrow();
    expect(() => AgentMemoryKnowledgeCallRequestSchema.parse({ knowledgeId: 'wiki_demo', toolName: 'search', params: { query: 'token=secret' }, maxItems: 1, maxBytes: 1 })).toThrow();
    expect(() => AgentMemoryKnowledgeCallRequestSchema.parse({ knowledgeId: 'wiki_demo', toolName: 'search', params: { query: 'C:\\Users\\private\\repo' }, maxItems: 1, maxBytes: 1 })).toThrow();
  });
});
