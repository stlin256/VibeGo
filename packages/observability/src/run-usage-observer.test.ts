import { describe, expect, it } from 'vitest';
import type { ModelUsageRecord, StoredEvent } from '@ready4vibe/contracts';
import { ProviderUsageLifecycleAdapter, RunUsageObserver } from './index.js';

const runId = 'run_observer_01';
const at = '2026-08-05T12:00:00.000Z';

class Writer {
  readonly batches: Array<{ readonly modelUsages?: readonly ModelUsageRecord[] }> = [];
  fail = false;

  async appendBatch(batch: { readonly modelUsages?: readonly ModelUsageRecord[] }): Promise<void> {
    if (this.fail) throw new Error('ledger unavailable');
    this.batches.push(batch);
  }
}

function event<T>(seq: number, type: string, payload: T, source: StoredEvent['source'] = 'orchestrator'): StoredEvent<T> {
  return {
    version: 1,
    id: `event_observer_${seq}`,
    runId,
    type,
    source,
    correlationId: 'corr_observer_01',
    at,
    seq,
    payload,
  };
}

function settledEvents(overrides: { readonly inputTokens?: number; readonly outputTokens?: number } = {}): readonly StoredEvent[] {
  return [
    event(1, 'run.created', { config: { model: { provider: 'deepseek', name: 'deepseek-v4-flash' } } }, 'user'),
    event(2, 'turn.started', { turnId: 'turn_observer_01', index: 1 }),
    event(3, 'model.requested', { turnId: 'turn_observer_01', model: 'deepseek-v4-flash', providerId: 'deepseek', requestId: 'req_observer_01' }),
    event(4, 'model.usage', { turnId: 'turn_observer_01', inputTokens: overrides.inputTokens ?? 10, outputTokens: overrides.outputTokens ?? 4 }, 'model'),
    event(5, 'model.completed', { turnId: 'turn_observer_01', finishReason: 'stop' }, 'model'),
    event(6, 'run.completed', { summary: 'raw transcript must not be copied', exitReason: 'model-completed' }),
  ];
}

function observer(writer: Writer): RunUsageObserver {
  return new RunUsageObserver({ adapter: new ProviderUsageLifecycleAdapter({ writer }) });
}

describe('RunUsageObserver', () => {
  it('replays bounded run events into the existing usage writer', async () => {
    const writer = new Writer();
    const result = await observer(writer).recordTerminal(runId, settledEvents());

    expect(result).toMatchObject({ runId, status: 'recorded' });
    expect(result.usageIds[0]).toMatch(/^usage_[a-f0-9]{32}$/u);
    expect(writer.batches).toHaveLength(1);
    expect(writer.batches[0]?.modelUsages).toHaveLength(1);
    expect(writer.batches[0]?.modelUsages?.[0]).toMatchObject({
      runId,
      dataSource: 'run-event',
      tokens: { input: 10, output: 4 },
    });
    expect(JSON.stringify(writer.batches)).not.toMatch(/raw transcript|api[_-]?key|secret|C:\\|\/Users\//iu);
  });

  it('uses usage ids for idempotent duplicate terminal delivery', async () => {
    const writer = new Writer();
    const current = observer(writer);

    expect((await current.recordTerminal(runId, settledEvents())).status).toBe('recorded');
    expect((await current.recordTerminal(runId, settledEvents())).status).toBe('noop');
    expect(writer.batches).toHaveLength(1);
  });

  it('returns a conflict when the same terminal usage id changes content', async () => {
    const writer = new Writer();
    const current = observer(writer);

    await current.recordTerminal(runId, settledEvents());
    const result = await current.recordTerminal(runId, settledEvents({ inputTokens: 11 }));

    expect(result.status).toBe('conflict');
    expect(writer.batches).toHaveLength(1);
  });

  it('treats runs without usage events as a no-op', async () => {
    const writer = new Writer();
    const result = await observer(writer).recordTerminal(runId, [
      event(1, 'run.created', { config: { model: { provider: 'deepseek', name: 'deepseek-v4-flash' } } }, 'user'),
      event(2, 'run.cancelled', { reason: 'user-cancelled' }, 'user'),
    ]);

    expect(result).toEqual({ runId, status: 'noop', usageIds: [] });
    expect(writer.batches).toHaveLength(0);
  });

  it('keeps writer failure degraded and allows a later retry', async () => {
    const writer = new Writer();
    const current = observer(writer);
    writer.fail = true;

    expect((await current.recordTerminal(runId, settledEvents())).status).toBe('degraded');
    writer.fail = false;
    expect((await current.recordTerminal(runId, settledEvents())).status).toBe('recorded');
    expect(writer.batches).toHaveLength(1);
  });

  it('fails closed when events belong to another run', async () => {
    const writer = new Writer();
    const foreign = settledEvents().map((value) => ({ ...value, runId: 'run_foreign_01' }));

    const result = await observer(writer).recordTerminal(runId, foreign);

    expect(result).toMatchObject({ runId, status: 'rejected', errorCode: 'OBSERVABILITY_RUN_USAGE_INVALID' });
    expect(writer.batches).toHaveLength(0);
  });
});
