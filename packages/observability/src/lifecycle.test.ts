import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, ModelUsageRecord, ResourceSample, ToolUsageRecord } from '@ready4vibe/contracts';
import {
  FakeRunManagerLifecycleFixture,
  ObservabilityLifecycleRecorder,
  type ObservabilityLifecycleBatch,
  type ObservabilityLifecycleWriter,
} from './lifecycle.js';

const at = '2026-08-05T00:00:00.000Z';
const runId = 'run_lifecycle_01';

function modelUsage(attempt = 1): ModelUsageRecord {
  return {
    schemaVersion: 'ready4vibe_model_usage_v1',
    usageId: `usage_${attempt}`,
    runId,
    turnId: `turn_${attempt}`,
    requestId: `request_${attempt}`,
    providerId: 'fake',
    model: 'fake-model',
    requestModel: 'fake-model',
    pricingModel: 'fake-model',
    attempt,
    startedAt: at,
    completedAt: at,
    status: 'completed',
    tokens: { input: 10, output: 4 },
    tokenAccuracy: 'reported',
    inputTokenSemantics: 'fresh',
    dataSource: 'provider-usage',
  };
}

function toolUsage(attempt = 1): ToolUsageRecord {
  return {
    schemaVersion: 'ready4vibe_tool_usage_v1',
    usageId: `tool_usage_${attempt}`,
    runId,
    turnId: `turn_${attempt}`,
    callId: `call_${attempt}`,
    toolId: 'fixture.read',
    attempt,
    startedAt: at,
    completedAt: at,
    durationMs: 2,
    status: 'completed',
    risk: 'read',
    runtime: 'host-restricted',
    accuracy: 'measured',
  };
}

function resourceSample(attempt = 1): ResourceSample {
  return {
    schemaVersion: 'ready4vibe_resource_sample_v1',
    sampleId: `sample_${attempt}`,
    sampledAt: at,
    scope: 'run',
    runId,
    source: 'node',
    accuracy: 'measured',
    cpu: { milliPercent: 100, cpuTimeMs: 2 },
    memory: { rssBytes: '1024' },
    samplingIntervalMs: 5_000,
    droppedSampleCount: 0,
  };
}

function audit(attempt = 1): Omit<AuditEvent, 'appendSequence' | 'previousHash' | 'eventHash'> {
  return {
    schemaVersion: 'ready4vibe_audit_event_v1',
    eventId: `audit_${attempt}`,
    at,
    actor: 'system',
    transport: 'loopback',
    action: 'run.completed',
    targetKind: 'run',
    targetId: runId,
    outcome: 'succeeded',
    correlationId: `corr_${attempt}`,
  };
}

function writerFixture(): { writer: ObservabilityLifecycleWriter; batches: ObservabilityLifecycleBatch[]; fail: (value: boolean) => void } {
  const batches: ObservabilityLifecycleBatch[] = [];
  let shouldFail = false;
  const writer: ObservabilityLifecycleWriter = {
    appendBatch: vi.fn(async (batch) => {
      if (shouldFail) throw new Error('writer unavailable');
      batches.push(batch);
      return undefined;
    }),
  };
  return { writer, batches, fail: (value) => { shouldFail = value; } };
}

describe('ObservabilityLifecycleRecorder', () => {
  it('replays create, pause, cancel, recover and terminal without a runtime and writes one batch', async () => {
    const { writer, batches } = writerFixture();
    const fixture = new FakeRunManagerLifecycleFixture(new ObservabilityLifecycleRecorder(writer));
    const base = {
      runId,
      logicalAttemptId: 'attempt_1',
      attempt: 1,
      at,
      observation: { modelUsage: modelUsage(), toolUsage: toolUsage(), resourceSample: resourceSample(), audit: audit() },
    } as const;

    expect((await fixture.create(base)).status).toBe('ignored');
    expect((await fixture.pause({ ...base, transitionId: 'pause_1' })).status).toBe('ignored');
    expect((await fixture.cancel({ ...base, transitionId: 'cancel_1' })).status).toBe('ignored');
    expect((await fixture.recover({ ...base, transitionId: 'recover_1' })).status).toBe('ignored');
    expect((await fixture.terminal({ ...base, transitionId: 'terminal_1', terminalStatus: 'completed' })).status).toBe('recorded');
    expect((await fixture.terminal({ ...base, transitionId: 'terminal_1', terminalStatus: 'completed' })).status).toBe('noop');
    expect(batches).toHaveLength(1);
    expect(batches[0]?.modelUsages).toHaveLength(1);
    expect(batches[0]?.toolUsages).toHaveLength(1);
    expect(batches[0]?.resourceSamples).toHaveLength(1);
    expect(batches[0]?.auditEvents).toHaveLength(1);
  });

  it('makes the same logical attempt a no-op and changed payload a conflict', async () => {
    const { writer, batches } = writerFixture();
    const recorder = new ObservabilityLifecycleRecorder(writer);
    const input = {
      runId,
      logicalAttemptId: 'attempt_same',
      attempt: 1,
      phase: 'terminal' as const,
      at,
      terminalStatus: 'completed' as const,
      observation: { modelUsage: modelUsage(), audit: audit() },
    };
    expect((await recorder.record(input)).status).toBe('recorded');
    expect((await recorder.record(input)).status).toBe('noop');
    expect((await recorder.record({ ...input, observation: { modelUsage: { ...modelUsage(), tokens: { input: 11, output: 4 } }, audit: audit() } })).status).toBe('conflict');
    expect(batches).toHaveLength(1);
  });

  it('keeps retry attempts separate while preserving one append per attempt', async () => {
    const { writer, batches } = writerFixture();
    const fixture = new FakeRunManagerLifecycleFixture(new ObservabilityLifecycleRecorder(writer));
    const first = {
      runId,
      logicalAttemptId: 'attempt_first',
      attempt: 1,
      at,
      observation: { modelUsage: modelUsage(1), resourceSample: resourceSample(1), audit: audit(1) },
    } as const;
    const second = {
      runId,
      logicalAttemptId: 'attempt_second',
      attempt: 2,
      at,
      observation: { modelUsage: modelUsage(2), resourceSample: resourceSample(2), audit: audit(2) },
    } as const;
    expect((await fixture.create(first)).status).toBe('ignored');
    expect((await fixture.terminal({ ...first, terminalStatus: 'failed' as const })).status).toBe('recorded');
    expect((await fixture.retry(second)).status).toBe('ignored');
    expect((await fixture.terminal({ ...second, terminalStatus: 'completed' as const })).status).toBe('recorded');
    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.modelUsages?.[0]?.attempt)).toEqual([1, 2]);
  });

  it('does not append a resource when sampling is disabled', async () => {
    const { writer, batches } = writerFixture();
    const recorder = new ObservabilityLifecycleRecorder(writer);
    const result = await recorder.record({
      runId,
      logicalAttemptId: 'attempt_disabled',
      attempt: 1,
      phase: 'terminal',
      at,
      sampling: 'disabled',
      terminalStatus: 'cancelled',
      observation: { resourceSample: resourceSample(), audit: audit() },
    });
    expect(result.status).toBe('recorded');
    expect(batches[0]).not.toHaveProperty('resourceSamples');
    expect(batches[0]?.auditEvents).toHaveLength(1);
  });

  it('returns degraded on writer failure and allows a later idempotent retry', async () => {
    const { writer, batches, fail } = writerFixture();
    const recorder = new ObservabilityLifecycleRecorder(writer);
    fail(true);
    const input = {
      runId,
      logicalAttemptId: 'attempt_retry_writer',
      attempt: 1,
      phase: 'terminal' as const,
      at,
      terminalStatus: 'failed' as const,
      observation: { modelUsage: modelUsage(), audit: audit() },
    };
    expect((await recorder.record(input)).status).toBe('degraded');
    fail(false);
    expect((await recorder.record(input)).status).toBe('recorded');
    expect(batches).toHaveLength(1);
  });

  it('retries a failed terminal transition without replaying any runtime work', async () => {
    const { writer, batches, fail } = writerFixture();
    const recorder = new ObservabilityLifecycleRecorder(writer);
    const fixture = new FakeRunManagerLifecycleFixture(recorder);
    const input = {
      runId,
      logicalAttemptId: 'attempt_transition_retry',
      attempt: 1,
      at,
      transitionId: 'terminal_delivery_1',
      terminalStatus: 'failed' as const,
      observation: { modelUsage: modelUsage(), audit: audit() },
    };
    fail(true);
    expect((await fixture.terminal(input)).status).toBe('degraded');
    fail(false);
    expect((await fixture.terminal(input)).status).toBe('recorded');
    expect((await fixture.terminal(input)).status).toBe('noop');
    expect(batches).toHaveLength(1);
  });

  it('rejects secrets and absolute paths before the writer is called', async () => {
    const { writer, batches } = writerFixture();
    const recorder = new ObservabilityLifecycleRecorder(writer);
    const result = await recorder.record({
      runId,
      logicalAttemptId: 'attempt_private',
      attempt: 1,
      phase: 'terminal',
      at,
      terminalStatus: 'failed',
      observation: {
        audit: { ...audit(), safeDetails: { note: 'authorization: Bearer abc' } },
      },
    });
    expect(result.status).toBe('rejected');
    expect(result.errorCode).toBe('OBSERVABILITY_LIFECYCLE_PRIVACY');
    expect(batches).toHaveLength(0);
  });

  it('serializes concurrent duplicate delivery to one writer call', async () => {
    const { writer, batches } = writerFixture();
    const recorder = new ObservabilityLifecycleRecorder(writer);
    const input = {
      runId,
      logicalAttemptId: 'attempt_concurrent',
      attempt: 1,
      phase: 'terminal' as const,
      at,
      terminalStatus: 'completed' as const,
      observation: { modelUsage: modelUsage(), audit: audit() },
    };
    const results = await Promise.all([recorder.record(input), recorder.record(input), recorder.record(input)]);
    expect(results.map((item) => item.status).sort()).toEqual(['noop', 'noop', 'recorded']);
    expect(batches).toHaveLength(1);
  });

  it('rejects a changed payload while the original append is still in flight', async () => {
    let release!: () => void;
    const batches: ObservabilityLifecycleBatch[] = [];
    const writer: ObservabilityLifecycleWriter = {
      appendBatch: vi.fn(async (batch) => {
        await new Promise<void>((resolve) => { release = resolve; });
        batches.push(batch);
      }),
    };
    const recorder = new ObservabilityLifecycleRecorder(writer);
    const input = {
      runId,
      logicalAttemptId: 'attempt_inflight_conflict',
      attempt: 1,
      phase: 'terminal' as const,
      at,
      terminalStatus: 'completed' as const,
      observation: { modelUsage: modelUsage(), audit: audit() },
    };
    const first = recorder.record(input);
    await Promise.resolve();
    expect((await recorder.record({ ...input, observation: { modelUsage: { ...modelUsage(), tokens: { input: 12, output: 4 } }, audit: audit() } })).status).toBe('conflict');
    release();
    expect((await first).status).toBe('recorded');
    expect(batches).toHaveLength(1);
  });
});
