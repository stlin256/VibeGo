import type { ModelEvent, ModelProvider, ModelRequest, StoredEvent } from '@ready4vibe/contracts';

export interface FakeModelScript {
  events: readonly ModelEvent[];
  delayMs?: number;
}

export class FakeModelProvider implements ModelProvider {
  readonly id = 'fake-model';
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: true } as const;
  readonly requests: ModelRequest[] = [];

  constructor(private readonly script: FakeModelScript) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    for (const event of this.script.events) {
      if (signal.aborted) return;
      if (this.script.delayMs) await new Promise((resolve) => setTimeout(resolve, this.script.delayMs));
      if (signal.aborted) return;
      yield event;
    }
  }
}

export function eventTypes(events: readonly StoredEvent[]): string[] {
  return events.map((event) => event.type);
}

