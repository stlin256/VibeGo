import { describe, expect, it, vi } from 'vitest';
import {
  ModelReplayError,
  RequestReplayLedger,
  RetryingModelProvider,
  replayModelEvents,
  retryPlanFor,
  waitForRetry,
} from './runtime.js';

describe('model stream replay', () => {
  it('replays text, tool calls, usage and terminal state deterministically', () => {
    const events = [
      { type: 'text-delta' as const, text: 'hel' },
      { type: 'text-delta' as const, text: 'lo' },
      { type: 'tool-call-delta' as const, callId: 'call-1', name: 'echo', argumentsChunk: '{"value":' },
      { type: 'tool-call-delta' as const, callId: 'call-1', argumentsChunk: '1}' },
      { type: 'usage' as const, inputTokens: 12, outputTokens: 4 },
      { type: 'completed' as const, finishReason: 'tool-calls' as const },
    ];
    const first = replayModelEvents(events);
    const second = replayModelEvents([...events]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ text: 'hello', toolCalls: [{ callId: 'call-1', name: 'echo', arguments: '{"value":1}' }], finishReason: 'tool-calls' });
  });

  it('fails closed on provider errors, unknown tools names and oversized arguments', () => {
    expect(() => replayModelEvents([{ type: 'error', code: 'UPSTREAM', retryable: true, safeMessage: 'unavailable' }])).toThrowError(ModelReplayError);
    expect(() => replayModelEvents([{ type: 'tool-call-delta', callId: 'call-1', argumentsChunk: '{}' }, { type: 'completed', finishReason: 'tool-calls' }])).toThrow(/name/iu);
    expect(() => replayModelEvents([{ type: 'tool-call-delta', callId: 'call-1', name: 'echo', argumentsChunk: 'x'.repeat(256 * 1024 + 1) }])).toThrow(/limit/iu);
  });
});

describe('request replay and retry', () => {
  it('treats the same request payload as a no-op and a changed payload as conflict', () => {
    const ledger = new RequestReplayLedger();
    expect(ledger.record('req-1', { model: 'a', messages: ['hello'] })).toBe('new');
    expect(ledger.record('req-1', { messages: ['hello'], model: 'a' })).toBe('noop');
    expect(() => ledger.record('req-1', { model: 'b', messages: ['hello'] })).toThrow(/conflict/iu);
  });

  it('plans bounded retries for transport, 429 and 5xx but not auth errors', () => {
    expect(retryPlanFor({ kind: 'http', status: 429, retryAfterMs: 10_000 }, 1, { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 200 })).toMatchObject({ reason: 'rate-limit', delayMs: 200 });
    expect(retryPlanFor({ kind: 'http', status: 503 }, 2, { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 200 })).toMatchObject({ reason: 'upstream-5xx', delayMs: 100 });
    expect(retryPlanFor({ kind: 'http', status: 401 }, 1, { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 200 })).toBeUndefined();
    expect(retryPlanFor({ kind: 'transport' }, 3, { maxAttempts: 3, baseDelayMs: 50, maxDelayMs: 200 })).toBeUndefined();
  });

  it('aborts retry backoff without waiting or invoking the model again', async () => {
    const controller = new AbortController();
    const sleep = vi.fn(async (_delayMs: number, signal: AbortSignal) => {
      signal.throwIfAborted();
    });
    controller.abort();
    await expect(waitForRetry(100, controller.signal, sleep)).rejects.toMatchObject({ name: 'AbortError' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries only a pre-stream transient error and never replays a partial stream', async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;
    const provider = new RetryingModelProvider({
      provider: {
        id: 'scripted',
        capabilities: { streaming: true, toolCalls: true, structuredOutput: false },
        async *stream() {
          calls += 1;
          if (calls === 1) {
            yield { type: 'error', code: 'MODEL_HTTP_503', retryable: true, safeMessage: 'provider unavailable' };
            return;
          }
          yield { type: 'text-delta', text: 'ok' };
          yield { type: 'completed', finishReason: 'stop' };
        },
      },
      policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10 },
      sleep,
    });
    const events = [];
    for await (const event of provider.stream({ model: 'm', messages: [], tools: [], budget: { maxInputTokens: 1, maxOutputTokens: 1 }, metadata: { runId: 'run', turnId: 'turn', requestId: 'request' } }, new AbortController().signal)) events.push(event);
    expect(events).toEqual([{ type: 'text-delta', text: 'ok' }, { type: 'completed', finishReason: 'stop' }]);
    expect(calls).toBe(2);
    expect(sleep).toHaveBeenCalledOnce();

    const partial = new RetryingModelProvider({
      provider: {
        id: 'partial',
        capabilities: { streaming: true, toolCalls: true, structuredOutput: false },
        async *stream() {
          yield { type: 'text-delta', text: 'partial' };
          yield { type: 'error', code: 'MODEL_HTTP_503', retryable: true, safeMessage: 'provider unavailable' };
        },
      },
      policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10 },
      sleep,
    });
    const partialEvents = [];
    for await (const event of partial.stream({ model: 'm', messages: [], tools: [], budget: { maxInputTokens: 1, maxOutputTokens: 1 }, metadata: { runId: 'run', turnId: 'turn', requestId: 'request-2' } }, new AbortController().signal)) partialEvents.push(event);
    expect(partialEvents).toHaveLength(2);
    expect(partialEvents[0]).toMatchObject({ type: 'text-delta', text: 'partial' });
  });
});
