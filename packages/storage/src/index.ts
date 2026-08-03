import { v7 as uuidv7 } from 'uuid';
import type { EventStore, NewDomainEvent, StoredEvent } from '@ready4vibe/contracts';

export class InMemoryEventStore implements EventStore {
  private readonly events = new Map<string, StoredEvent[]>();

  async append<TPayload>(event: NewDomainEvent<TPayload>): Promise<StoredEvent<TPayload>> {
    const stored = this.buildStored(event);
    const current = this.events.get(event.runId) ?? [];
    current.push(stored as StoredEvent);
    this.events.set(event.runId, current);
    return stored;
  }

  async appendBatch<TPayload>(events: readonly NewDomainEvent<TPayload>[]): Promise<StoredEvent<TPayload>[]> {
    if (events.length === 0) return [];
    const runId = events[0]?.runId;
    if (!runId || events.some((event) => event.runId !== runId)) {
      throw new Error('appendBatch requires a non-empty single runId');
    }

    const current = this.events.get(runId) ?? [];
    const stored = events.map((event, index) => ({
      ...event,
      version: 1 as const,
      id: `evt_${uuidv7()}`,
      seq: current.length + index + 1,
      at: new Date().toISOString(),
    }));
    this.events.set(runId, [...current, ...(stored as StoredEvent[])]);
    return stored;
  }

  async read<TPayload = unknown>(runId: string, afterSeq = 0): Promise<StoredEvent<TPayload>[]> {
    return (this.events.get(runId) ?? []).filter((event) => event.seq > afterSeq) as StoredEvent<TPayload>[];
  }

  lastSeq(runId: string): number {
    return this.events.get(runId)?.at(-1)?.seq ?? 0;
  }

  private buildStored<TPayload>(event: NewDomainEvent<TPayload>): StoredEvent<TPayload> {
    return {
      ...event,
      version: 1,
      id: `evt_${uuidv7()}`,
      seq: this.lastSeq(event.runId) + 1,
      at: new Date().toISOString(),
    };
  }
}

