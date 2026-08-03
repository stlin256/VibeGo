import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from './index.js';

const event = (runId: string, type: string) => ({
  runId,
  type,
  source: 'system' as const,
  correlationId: `corr_${runId}`,
  payload: { type },
});

describe('InMemoryEventStore', () => {
  it('assigns monotonic per-run sequence numbers', async () => {
    const store = new InMemoryEventStore();
    const first = await store.append(event('run_1', 'run.created'));
    const second = await store.append(event('run_1', 'run.started'));
    const other = await store.append(event('run_2', 'run.created'));

    expect([first.seq, second.seq, other.seq]).toEqual([1, 2, 1]);
    expect(first.id).toMatch(/^evt_/);
  });

  it('appends a batch atomically for one run', async () => {
    const store = new InMemoryEventStore();
    const batch = await store.appendBatch([event('run_1', 'a'), event('run_1', 'b')]);

    expect(batch.map((item) => item.seq)).toEqual([1, 2]);
    await expect(store.appendBatch([event('run_1', 'c'), event('run_2', 'd')])).rejects.toThrow(
      'appendBatch requires a non-empty single runId',
    );
    expect(store.lastSeq('run_1')).toBe(2);
  });

  it('reads only events after the requested cursor', async () => {
    const store = new InMemoryEventStore();
    await store.appendBatch([event('run_1', 'a'), event('run_1', 'b'), event('run_1', 'c')]);

    const events = await store.read('run_1', 1);
    expect(events.map((item) => item.type)).toEqual(['b', 'c']);
  });
});

