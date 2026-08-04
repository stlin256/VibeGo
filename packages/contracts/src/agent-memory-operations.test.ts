import { describe, expect, it } from 'vitest';
import { AgentMemoryOperationsSchema, AGENT_MEMORY_OPERATIONS_SCHEMA_VERSION } from './agent-memory-operations.js';

const base = {
  schemaVersion: AGENT_MEMORY_OPERATIONS_SCHEMA_VERSION,
  currentRevision: 'a'.repeat(40),
  previousRevision: null,
  healthLatencyMs: 12,
  recall: { hits: 2, misses: 1, lastAt: '2026-08-04T00:00:00.000Z' },
  writeQueue: { pending: 1, inFlight: true, accepted: 3, failed: 0, lastAttemptAt: null, lastErrorCode: null },
  updates: [{ at: '2026-08-04T00:00:00.000Z', operation: 'probe', outcome: 'succeeded', fromRevision: 'a'.repeat(40), toRevision: 'a'.repeat(40), elapsedMs: 12, errorCode: null }],
};

describe('AgentMemoryOperationsSchema', () => {
  it('accepts bounded diagnostics and rejects unknown fields', () => {
    expect(AgentMemoryOperationsSchema.parse(base)).toEqual(base);
    expect(() => AgentMemoryOperationsSchema.parse({ ...base, secret: 'sk-' + 'x'.repeat(24) })).toThrow();
    expect(() => AgentMemoryOperationsSchema.parse({ ...base, updates: [{ ...base.updates[0], message: 'C:\\private\\key' }] })).toThrow(/absolute path/iu);
    expect(() => AgentMemoryOperationsSchema.parse({ ...base, unknown: true })).toThrow();
  });

  it('caps counters, history and elapsed values', () => {
    expect(() => AgentMemoryOperationsSchema.parse({ ...base, recall: { ...base.recall, hits: 1_000_000_001 } })).toThrow();
    expect(() => AgentMemoryOperationsSchema.parse({ ...base, updates: Array.from({ length: 33 }, () => base.updates[0]) })).toThrow();
    expect(() => AgentMemoryOperationsSchema.parse({ ...base, healthLatencyMs: 60_001 })).toThrow();
  });
});
