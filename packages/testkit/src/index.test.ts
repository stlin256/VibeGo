import { describe, expect, it } from 'vitest';
import { FakeModelProvider, eventTypes } from './index.js';

describe('testkit', () => {
  it('replays a deterministic model script', async () => {
    const provider = new FakeModelProvider({
      events: [
        { type: 'text-delta', text: 'hello' },
        { type: 'completed', finishReason: 'stop' },
      ],
    });
    const events: string[] = [];
    for await (const event of provider.stream({ model: 'fake', messages: [], tools: [], budget: { maxInputTokens: 1, maxOutputTokens: 1 }, metadata: { runId: 'run_1', turnId: 'turn_1', requestId: 'req_1' } }, new AbortController().signal)) {
      events.push(event.type);
    }
    expect(events).toEqual(['text-delta', 'completed']);
    expect(provider.requests).toHaveLength(1);
  });

  it('projects stored event types without exposing payloads', () => {
    expect(eventTypes([
      { version: 1, id: 'evt_1', seq: 1, at: 'now', runId: 'run_1', type: 'run.created', source: 'system', correlationId: 'c', payload: { secret: 'no' } },
    ])).toEqual(['run.created']);
  });
});

