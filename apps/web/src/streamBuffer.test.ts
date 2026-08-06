import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredEvent } from './api.js';
import { createStreamBuffer, type StreamFlushBatch } from './streamBuffer.js';

function event(seq: number, type = 'model.delta'): StoredEvent {
  return { seq, type, payload: {}, version: 1, id: `evt-${seq}`, runId: 'run-1', at: `2026-08-06T00:00:${String(seq).padStart(2, '0')}Z` } as unknown as StoredEvent;
}

describe('createStreamBuffer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('coalesces rapid deltas into a single interval flush', () => {
    const batches: StreamFlushBatch[] = [];
    const buffer = createStreamBuffer((batch) => batches.push(batch));
    buffer.push(event(1), 'hel');
    buffer.push(event(2), 'lo');
    buffer.push(event(3), ' world');
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.text).toBe('hello world');
    expect(batches[0]?.events.map((item) => item.seq)).toEqual([1, 2, 3]);
    expect(batches[0]?.lastEventSeq).toBe(3);
  });

  it('flushes at most once per interval across bursts', () => {
    const batches: StreamFlushBatch[] = [];
    const buffer = createStreamBuffer((batch) => batches.push(batch));
    buffer.push(event(1), 'a');
    vi.advanceTimersByTime(50);
    buffer.push(event(2), 'b');
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(2);
    expect(batches[1]?.text).toBe('b');
  });

  it('flush() emits pending state synchronously and cancels the timer', () => {
    const batches: StreamFlushBatch[] = [];
    const buffer = createStreamBuffer((batch) => batches.push(batch));
    buffer.push(event(1), 'x');
    buffer.flush();
    expect(batches).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(batches).toHaveLength(1);
  });

  it('flush() on an empty buffer is a no-op', () => {
    const batches: StreamFlushBatch[] = [];
    const buffer = createStreamBuffer((batch) => batches.push(batch));
    buffer.flush();
    expect(batches).toHaveLength(0);
  });

  it('reset() drops pending state and the scheduled flush', () => {
    const batches: StreamFlushBatch[] = [];
    const buffer = createStreamBuffer((batch) => batches.push(batch));
    buffer.push(event(1), 'stale');
    buffer.reset();
    vi.advanceTimersByTime(200);
    expect(batches).toHaveLength(0);
    buffer.push(event(2), 'fresh');
    vi.advanceTimersByTime(50);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.text).toBe('fresh');
  });

  it('honours a custom flush interval', () => {
    const batches: StreamFlushBatch[] = [];
    const buffer = createStreamBuffer((batch) => batches.push(batch), 120);
    buffer.push(event(1), 'x');
    vi.advanceTimersByTime(119);
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(batches).toHaveLength(1);
  });
});
