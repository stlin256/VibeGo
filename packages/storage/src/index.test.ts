import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore, SqliteEventStore } from './index.js';

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

  it('lists distinct run ids in insertion order', async () => {
    const store = new InMemoryEventStore();
    await store.append(event('run_1', 'run.created'));
    await store.append(event('run_2', 'run.created'));
    await store.append(event('run_1', 'run.status'));

    expect(store.listRunIds()).toEqual(['run_1', 'run_2']);
  });
});

describe('SqliteEventStore', () => {
  it('persists events across close and reopen', async () => {
    const databasePath = join(tmpdir(), `ready4vibe-${randomUUID()}.sqlite`);
    const first = new SqliteEventStore(databasePath);
    await first.append(event('run_sqlite', 'run.created'));
    await first.append(event('run_sqlite', 'run.started'));
    first.close();

    const reopened = new SqliteEventStore(databasePath);
    await expect(reopened.read('run_sqlite')).resolves.toHaveLength(2);
    expect(reopened.listRunIds()).toEqual(['run_sqlite']);
    expect(reopened.lastSeq('run_sqlite')).toBe(2);
    reopened.close();
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
  });

  it('rolls back a batch when a payload cannot be encoded', async () => {
    const store = new SqliteEventStore(':memory:');
    const cyclic: { type: string; self?: unknown } = { type: 'invalid' };
    cyclic.self = cyclic;

    await expect(store.appendBatch([
      event('run_atomic', 'before'),
      { ...event('run_atomic', 'invalid'), payload: cyclic },
    ])).rejects.toThrow('event payload must be JSON serializable');
    expect(store.lastSeq('run_atomic')).toBe(0);
    store.close();
  });

  it('rejects operations after close', async () => {
    const store = new SqliteEventStore(':memory:');
    store.close();
    await expect(store.read('run_closed')).rejects.toThrow('event store is closed');
  });
});
