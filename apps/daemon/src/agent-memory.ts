import {
  AgentMemoryRecallRequestSchema,
  AgentMemoryStatusSchema,
  AgentMemoryWriteRequestSchema,
  type AgentMemoryProvider,
  type AgentMemoryRecallRequest,
  type AgentMemoryRecallResult,
  type AgentMemoryStatus,
  type AgentMemoryWriteRequest,
  type AgentMemoryWriteResult,
} from '@ready4vibe/contracts';

const NOOP_STATUS: AgentMemoryStatus = {
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
};

/**
 * Safe Phase 0 provider. It validates bounded DTOs but never calls a network,
 * SDK, subprocess, prompt builder, or AgentLoop. Later adapters can replace it
 * at the daemon application-service boundary without changing run authorities.
 */
export class NoopAgentMemoryProvider implements AgentMemoryProvider {
  readonly id = 'none' as const;
  readonly mode = 'off' as const;

  async status(_signal?: AbortSignal): Promise<AgentMemoryStatus> {
    return AgentMemoryStatusSchema.parse(NOOP_STATUS);
  }

  async recall(request: AgentMemoryRecallRequest): Promise<AgentMemoryRecallResult> {
    AgentMemoryRecallRequestSchema.parse(request);
    return {
      items: [],
      sourceRevision: null,
      elapsedMs: 0,
      degraded: false,
    };
  }

  async enqueueWrite(request: AgentMemoryWriteRequest): Promise<AgentMemoryWriteResult> {
    AgentMemoryWriteRequestSchema.parse(request);
    return { accepted: false, queued: false };
  }

  async close(): Promise<void> {
    // No process, socket, timer, or queue exists in the no-op implementation.
  }
}
