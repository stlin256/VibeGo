export type ContextSource = 'system' | 'developer' | 'user' | 'model' | 'tool' | 'workspace' | 'retrieval';
export type ContextTrust = 'trusted' | 'untrusted';
export type ContextRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface ContextItem {
  id: string;
  source: ContextSource;
  trust: ContextTrust;
  role: ContextRole;
  content: string;
}

export interface ContextMessage {
  role: ContextRole;
  content: string;
}

export interface ContextBuildResult {
  messages: readonly ContextMessage[];
  droppedItemIds: readonly string[];
  droppedCount: number;
  bytes: number;
  compacted: boolean;
}

export class ContextBudgetError extends Error {
  constructor(readonly requiredBytes: number, readonly maxBytes: number) {
    super(`protected context exceeds byte budget: ${requiredBytes} > ${maxBytes}`);
    this.name = 'ContextBudgetError';
  }
}

export class ContextManager {
  private readonly items: ContextItem[] = [];

  constructor(private readonly maxContextBytes: number, initialItems: readonly ContextItem[] = []) {
    if (!Number.isSafeInteger(maxContextBytes) || maxContextBytes <= 0) {
      throw new Error('maxContextBytes must be a positive safe integer');
    }
    for (const item of initialItems) this.add(item);
  }

  add(item: ContextItem): void {
    if (!item.id || !item.content) throw new Error('context item id and content are required');
    if (this.items.some((existing) => existing.id === item.id)) throw new Error(`duplicate context item: ${item.id}`);
    this.items.push({ ...item });
  }

  remove(itemId: string): boolean {
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }

  clear(): void {
    this.items.length = 0;
  }

  size(): number {
    return this.items.length;
  }

  build(): ContextBuildResult {
    const rendered = this.items.map((item) => ({ item, message: this.toMessage(item) }));
    const protectedIndexes = new Set<number>();
    rendered.forEach(({ item }, index) => {
      if (item.role === 'system' || item.role === 'developer') protectedIndexes.add(index);
    });
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      if (rendered[index]?.item.role === 'user') {
        protectedIndexes.add(index);
        break;
      }
    }

    let bytes = [...protectedIndexes].reduce((sum, index) => sum + this.messageBytes(rendered[index]?.message), 0);
    if (bytes > this.maxContextBytes) throw new ContextBudgetError(bytes, this.maxContextBytes);
    const selected = new Set(protectedIndexes);
    const dropped = new Set<number>();
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      if (selected.has(index)) continue;
      const item = rendered[index];
      if (!item) continue;
      const itemBytes = this.messageBytes(item.message);
      if (bytes + itemBytes <= this.maxContextBytes) {
        selected.add(index);
        bytes += itemBytes;
      } else {
        dropped.add(index);
      }
    }

    const messages = [...selected].sort((a, b) => a - b).map((index) => rendered[index]?.message).filter((message): message is ContextMessage => message !== undefined);
    const droppedItemIds = [...dropped].sort((a, b) => a - b).map((index) => rendered[index]?.item.id).filter((id): id is string => id !== undefined);
    return {
      messages,
      droppedItemIds,
      droppedCount: droppedItemIds.length,
      bytes,
      compacted: droppedItemIds.length > 0,
    };
  }

  private toMessage(item: ContextItem): ContextMessage {
    const content = item.trust === 'untrusted'
      ? `[BEGIN_UNTRUSTED_CONTENT source=${item.source}]\n${item.content}\n[END_UNTRUSTED_CONTENT]`
      : item.content;
    return { role: item.role, content };
  }

  private messageBytes(message: ContextMessage | undefined): number {
    return message ? Buffer.byteLength(message.content, 'utf8') : 0;
  }
}
