export type ContextSource = 'system' | 'developer' | 'user' | 'model' | 'tool' | 'workspace' | 'retrieval';
export type ContextTrust = 'trusted' | 'untrusted';
export type ContextRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';
export type ContextPreservation = 'none' | 'objective' | 'approval' | 'cancellation' | 'failure' | 'snapshot';

export interface ContextItem {
  id: string;
  source: ContextSource;
  trust: ContextTrust;
  role: ContextRole;
  content: string;
  /** Protected items are retained before ordinary history during compaction. */
  preserve?: ContextPreservation;
  /** Optional append-only source sequence used by compaction references. */
  sequence?: number;
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
  tokens: number;
  compacted: boolean;
}

export interface ContextBudgetOptions {
  readonly maxBytes: number;
  readonly maxTokens?: number;
  readonly maxItems?: number;
  readonly tokenEstimator?: (message: ContextMessage) => number;
}

export interface ContextCompactionInput {
  readonly id: string;
  readonly summary: string;
  readonly sequence: number;
}

export interface ContextCompactionResult {
  readonly compacted: boolean;
  readonly summaryItemId?: string;
  readonly sourceSeqStart?: number;
  readonly sourceSeqEnd?: number;
  readonly sourceItemIds: readonly string[];
}

export class ContextBudgetError extends Error {
  readonly code = 'context_budget_exceeded';

  constructor(
    readonly requiredBytes: number,
    readonly maxBytes: number,
    readonly requiredTokens = 0,
    readonly maxTokens = Number.MAX_SAFE_INTEGER,
  ) {
    super(`protected context exceeds budget: ${requiredBytes} bytes/${requiredTokens} tokens`);
    this.name = 'ContextBudgetError';
  }
}

export class ContextManager {
  private readonly items: ContextItem[] = [];
  private readonly options: {
    readonly maxBytes: number;
    readonly maxTokens: number;
    readonly maxItems: number;
    readonly tokenEstimator?: (message: ContextMessage) => number;
  };

  constructor(options: number | ContextBudgetOptions, initialItems: readonly ContextItem[] = []) {
    const normalized = typeof options === 'number' ? { maxBytes: options } : options;
    if (!Number.isSafeInteger(normalized.maxBytes) || normalized.maxBytes <= 0) throw new Error('maxContextBytes must be a positive safe integer');
    const maxTokens = normalized.maxTokens ?? Number.MAX_SAFE_INTEGER;
    const maxItems = normalized.maxItems ?? 256;
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('maxContextTokens must be a positive safe integer');
    if (!Number.isSafeInteger(maxItems) || maxItems <= 0 || maxItems > 4_096) throw new Error('maxContextItems must be a positive bounded integer');
    this.options = {
      maxBytes: normalized.maxBytes,
      maxTokens,
      maxItems,
      ...(normalized.tokenEstimator === undefined ? {} : { tokenEstimator: normalized.tokenEstimator }),
    };
    for (const item of initialItems) this.add(item);
  }

  add(item: ContextItem): void {
    if (!item.id || !item.content) throw new Error('context item id and content are required');
    if (this.items.some((existing) => existing.id === item.id)) throw new Error(`duplicate context item: ${item.id}`);
    if (this.items.length >= this.options.maxItems) throw new Error('context item limit exceeded');
    if (item.sequence !== undefined && (!Number.isSafeInteger(item.sequence) || item.sequence <= 0)) throw new Error('context item sequence must be positive');
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
      if (item.role === 'system' || item.role === 'developer' || (item.preserve !== undefined && item.preserve !== 'none')) protectedIndexes.add(index);
    });
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      if (rendered[index]?.item.role === 'user') {
        protectedIndexes.add(index);
        break;
      }
    }

    let bytes = [...protectedIndexes].reduce((sum, index) => sum + this.messageBytes(rendered[index]?.message), 0);
    let tokens = [...protectedIndexes].reduce((sum, index) => sum + this.messageTokens(rendered[index]?.message), 0);
    if (bytes > this.options.maxBytes || tokens > this.options.maxTokens) throw new ContextBudgetError(bytes, this.options.maxBytes, tokens, this.options.maxTokens);
    const selected = new Set(protectedIndexes);
    const dropped = new Set<number>();
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      if (selected.has(index)) continue;
      const item = rendered[index];
      if (!item) continue;
      const itemBytes = this.messageBytes(item.message);
      const itemTokens = this.messageTokens(item.message);
      if (bytes + itemBytes <= this.options.maxBytes && tokens + itemTokens <= this.options.maxTokens) {
        selected.add(index);
        bytes += itemBytes;
        tokens += itemTokens;
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
      tokens,
      compacted: droppedItemIds.length > 0,
    };
  }

  /**
   * Adds a bounded summary without deleting source items. The source sequence
   * range is retained as metadata so replay can explain what was compacted.
   */
  compact(input: ContextCompactionInput): ContextCompactionResult {
    if (!input.id || !input.summary || !Number.isSafeInteger(input.sequence) || input.sequence <= 0) throw new Error('invalid compaction input');
    const built = this.build();
    const sourceItems = new Set(built.droppedItemIds);
    if (sourceItems.size === 0) return { compacted: false, sourceItemIds: [] };
    const dropped = this.items.filter((item) => sourceItems.has(item.id));
    const sequences = dropped.map((item, index) => item.sequence ?? index + 1).sort((a, b) => a - b);
    this.add({
      id: input.id,
      source: 'model',
      trust: 'trusted',
      role: 'assistant',
      content: input.summary,
      preserve: 'snapshot',
      sequence: input.sequence,
    });
    return {
      compacted: true,
      summaryItemId: input.id,
      sourceSeqStart: sequences[0]!,
      sourceSeqEnd: sequences.at(-1)!,
      sourceItemIds: dropped.map((item) => item.id),
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

  private messageTokens(message: ContextMessage | undefined): number {
    if (!message) return 0;
    const estimated = this.options.tokenEstimator?.(message) ?? Math.max(1, Math.ceil(this.messageBytes(message) / 4));
    if (!Number.isSafeInteger(estimated) || estimated < 0) throw new Error('token estimator must return a non-negative safe integer');
    return estimated;
  }
}
