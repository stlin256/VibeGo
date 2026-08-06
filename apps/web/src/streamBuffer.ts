import type { StoredEvent } from './api.js';

export interface StreamFlushBatch {
  readonly text: string;
  readonly events: readonly StoredEvent[];
  readonly lastEventSeq: number;
}

export interface StreamBuffer {
  push(event: StoredEvent, textDelta: string): void;
  flush(): void;
  reset(): void;
}

/**
 * Coalesces high-frequency SSE deltas into batches flushed at most once per
 * interval, so React re-renders stay bounded during model streaming. Callers
 * flush() synchronously before state transitions that must render immediately
 * (approvals, run completion) and reset() when a new run starts.
 */
export function createStreamBuffer(onFlush: (batch: StreamFlushBatch) => void, intervalMs = 50): StreamBuffer {
  let text = '';
  let events: StoredEvent[] = [];
  let lastEventSeq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  };

  const flush = (): void => {
    clearTimer();
    if (text === '' && events.length === 0 && lastEventSeq === 0) return;
    const batch: StreamFlushBatch = { text, events, lastEventSeq };
    text = '';
    events = [];
    lastEventSeq = 0;
    onFlush(batch);
  };

  return {
    push(event: StoredEvent, textDelta: string): void {
      text += textDelta;
      events.push(event);
      lastEventSeq = event.seq;
      if (timer === undefined) timer = setTimeout(flush, intervalMs);
    },
    flush,
    reset(): void {
      clearTimer();
      text = '';
      events = [];
      lastEventSeq = 0;
    },
  };
}
