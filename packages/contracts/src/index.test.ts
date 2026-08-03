import { describe, expect, it } from 'vitest';
import { RunConfigSchema, assertTransition, canTransition, parseRunConfig } from './index.js';

const validConfig = {
  workspaceId: 'workspace-1',
  userMessage: 'run the tests',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'workspace-write' as const, writableRoots: ['C:/workspace'], network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: {
    maxTurns: 8,
    maxWallTimeMs: 60_000,
    maxModelInputTokens: 4_000,
    maxModelOutputTokens: 2_000,
    maxToolCalls: 20,
    maxOutputBytes: 1_000_000,
    maxContextBytes: 2_000_000,
  },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-1',
};

describe('harness contracts', () => {
  it('accepts a valid run configuration and rejects unsafe limits', () => {
    expect(parseRunConfig(validConfig)).toMatchObject({ workspaceId: 'workspace-1' });
    expect(() => RunConfigSchema.parse({ ...validConfig, limits: { ...validConfig.limits, maxTurns: 0 } })).toThrow();
  });

  it('requires external sandbox mode to declare a supported provider', () => {
    expect(() => RunConfigSchema.parse({
      ...validConfig,
      taskTrust: 'untrusted-content',
      sandbox: { mode: 'external-sandbox', provider: 'docker', network: 'restricted' },
    })).not.toThrow();
    expect(() => RunConfigSchema.parse({
      ...validConfig,
      sandbox: { mode: 'external-sandbox', provider: 'host', network: 'restricted' },
    })).toThrow();
  });

  it('enforces the run state machine', () => {
    expect(canTransition('created', 'queued')).toBe(true);
    expect(canTransition('waiting-approval', 'needs-recovery')).toBe(true);
    expect(canTransition('completed', 'executing')).toBe(false);
    expect(() => assertTransition('queued', 'completed')).toThrow('invalid run transition');
  });
});
