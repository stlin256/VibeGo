import {
  DeepSeekCapabilitySnapshotSchema,
  DeepSeekConfigSchema,
  DeepSeekRunSnapshotSchema,
  DeepSeekSearchRequestSchema,
  DeepSeekSearchResponseSchema,
  ModelProviderSnapshotSchema,
  findDeepSeekPrivacyViolations,
  type DeepSeekCapabilitySnapshot,
  type DeepSeekRunSnapshot,
  type ModelProviderSnapshot,
} from '@ready4vibe/contracts';
import { ContextManager, type ContextBuildResult, type ContextItem } from '@ready4vibe/context';
import {
  evaluateDeepSeekSearchGate,
  mapDeepSeekSearchResponseToContextItems,
  resolveDeepSeekThinkingMode,
  type DeepSeekSearchExecutor,
} from '@ready4vibe/model-deepseek';

const UNPROBED_CAPABILITY_SUFFIX = '-unprobed';
const MAX_CONTEXT_BYTES = 128 * 1024;
const MAX_CONTEXT_ITEMS = 64;
const MAX_CONTEXT_TOKENS = 32_768;
const TOOL_TEXT = /^[^\u0000-\u001F\u007F\r\n]{1,2000}$/u;
const TOOL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/u;

export interface DeepSeekApplicationRunBindingInput {
  readonly modelSnapshot: unknown;
  readonly deepSeekSnapshot: unknown;
  readonly capabilitySnapshot?: unknown;
}

export interface DeepSeekApplicationRunBinding {
  readonly modelSnapshot: ModelProviderSnapshot;
  readonly deepSeekSnapshot: DeepSeekRunSnapshot;
  readonly capabilitySnapshot?: DeepSeekCapabilitySnapshot;
}

export type DeepSeekThinkingResolution =
  | { readonly status: 'ready'; readonly effectiveMode: DeepSeekRunSnapshot['thinkingMode'] }
  | { readonly status: 'blocked'; readonly reasonCode: 'DEEPSEEK_THINKING_UNSUPPORTED' | 'DEEPSEEK_SNAPSHOT_INVALID' };

export type DeepSeekToolCallingResolution =
  | { readonly status: 'ready'; readonly descriptors: readonly DeepSeekToolDescriptor[] }
  | { readonly status: 'blocked'; readonly descriptors: readonly []; readonly reasonCode: 'DEEPSEEK_TOOL_CALLING_DISABLED' | 'DEEPSEEK_TOOL_CAPABILITY_UNAVAILABLE' | 'DEEPSEEK_SNAPSHOT_INVALID' };

export interface DeepSeekToolDescriptor {
  readonly name: string;
  readonly id: string;
  readonly version: string;
  readonly risk: 'read' | 'write' | 'destructive' | 'network';
  readonly summary: string;
  readonly inputSchema?: Record<string, unknown>;
}

export type DeepSeekSearchGateResult =
  | { readonly eligible: true; readonly reasonCode: 'DEEPSEEK_SEARCH_READY' }
  | { readonly eligible: false; readonly reasonCode: 'DEEPSEEK_SEARCH_DEGRADED' | 'DEEPSEEK_SNAPSHOT_INVALID' };

export interface DeepSeekSearchContextResult {
  readonly status: 'ready' | 'degraded';
  readonly reasonCode?: 'DEEPSEEK_SEARCH_READY' | 'DEEPSEEK_SEARCH_DEGRADED' | 'DEEPSEEK_SEARCH_CANCELLED' | 'DEEPSEEK_SEARCH_TIMEOUT' | 'DEEPSEEK_SEARCH_PROTOCOL_INVALID' | 'DEEPSEEK_SEARCH_CONTEXT_LIMIT' | 'DEEPSEEK_SNAPSHOT_INVALID';
  readonly items: readonly ContextItem[];
  readonly projection?: ContextBuildResult;
}

export interface DeepSeekApplicationCapabilityOptions {
  readonly maxContextBytes?: number;
  readonly maxContextItems?: number;
  readonly maxContextTokens?: number;
  readonly searchExecutor?: DeepSeekSearchExecutor;
}

/**
 * Application-only capability boundary for a captured DeepSeek run.
 *
 * This class deliberately has no provider, fetch, credential, tool executor,
 * scheduler, approval store or event sink. It makes provider-specific
 * decisions explicit and bounded so a later application service can compose
 * them with existing authorities without adding a branch to AgentLoop.
 */
export class DeepSeekApplicationCapabilityService {
  private readonly binding: DeepSeekApplicationRunBinding | undefined;
  private readonly contextLimits: Required<Pick<DeepSeekApplicationCapabilityOptions, 'maxContextBytes' | 'maxContextItems' | 'maxContextTokens'>>;
  private readonly searchExecutor: DeepSeekSearchExecutor | undefined;

  constructor(input: DeepSeekApplicationRunBindingInput, options: DeepSeekApplicationCapabilityOptions = {}) {
    this.binding = parseBinding(input);
    this.contextLimits = {
      maxContextBytes: boundedPositive(options.maxContextBytes ?? MAX_CONTEXT_BYTES, MAX_CONTEXT_BYTES),
      maxContextItems: boundedPositive(options.maxContextItems ?? MAX_CONTEXT_ITEMS, MAX_CONTEXT_ITEMS),
      maxContextTokens: boundedPositive(options.maxContextTokens ?? MAX_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS),
    };
    this.searchExecutor = options.searchExecutor;
  }

  bindingSnapshot(): DeepSeekApplicationRunBinding | undefined {
    return this.binding;
  }

  resolveThinkingMode(): DeepSeekThinkingResolution {
    const binding = this.binding;
    if (!binding) return { status: 'blocked', reasonCode: 'DEEPSEEK_SNAPSHOT_INVALID' };
    const requested = binding.deepSeekSnapshot.thinkingMode;
    if (!binding.capabilitySnapshot) {
      return requested === 'off' || requested === 'auto'
        ? { status: 'ready', effectiveMode: 'off' }
        : { status: 'blocked', reasonCode: 'DEEPSEEK_THINKING_UNSUPPORTED' };
    }
    const resolved = resolveDeepSeekThinkingMode(requested, binding.capabilitySnapshot);
    return resolved.status === 'ready'
      ? { status: 'ready', effectiveMode: resolved.effectiveMode! }
      : { status: 'blocked', reasonCode: resolved.reasonCode! };
  }

  resolveToolCalling(descriptors: readonly DeepSeekToolDescriptor[]): DeepSeekToolCallingResolution {
    const binding = this.binding;
    if (!binding) return { status: 'blocked', descriptors: [], reasonCode: 'DEEPSEEK_SNAPSHOT_INVALID' };
    if (binding.deepSeekSnapshot.toolCalling !== 'enabled') {
      return { status: 'blocked', descriptors: [], reasonCode: 'DEEPSEEK_TOOL_CALLING_DISABLED' };
    }
    if (!binding.modelSnapshot.capabilities.toolCalls || (binding.capabilitySnapshot && !binding.capabilitySnapshot.toolCalls)) {
      return { status: 'blocked', descriptors: [], reasonCode: 'DEEPSEEK_TOOL_CAPABILITY_UNAVAILABLE' };
    }
    if (descriptors.length > 64) return { status: 'blocked', descriptors: [], reasonCode: 'DEEPSEEK_TOOL_CAPABILITY_UNAVAILABLE' };
    const normalized: DeepSeekToolDescriptor[] = [];
    for (const descriptor of descriptors) {
      if (!isSafeToolDescriptor(descriptor)) return { status: 'blocked', descriptors: [], reasonCode: 'DEEPSEEK_TOOL_CAPABILITY_UNAVAILABLE' };
      normalized.push(Object.freeze({ ...descriptor }));
    }
    return { status: 'ready', descriptors: Object.freeze(normalized) };
  }

  evaluateSearch(input: { readonly network: 'restricted' | 'enabled'; readonly approvalGranted: boolean }): DeepSeekSearchGateResult {
    const binding = this.binding;
    if (!binding || !binding.capabilitySnapshot) return { eligible: false, reasonCode: binding ? 'DEEPSEEK_SEARCH_DEGRADED' : 'DEEPSEEK_SNAPSHOT_INVALID' };
    const result = evaluateDeepSeekSearchGate(toConfig(binding.deepSeekSnapshot), binding.capabilitySnapshot, input);
    return result.eligible ? { eligible: true, reasonCode: 'DEEPSEEK_SEARCH_READY' } : result;
  }

  /**
   * Parse and budget a provider-owned search projection. The raw provider
   * response is never retained by this service; callers receive only bounded
   * untrusted context candidates and the ContextManager build metadata.
   */
  mapSearchResponse(input: unknown, gate: { readonly network: 'restricted' | 'enabled'; readonly approvalGranted: boolean }): DeepSeekSearchContextResult {
    const eligibility = this.evaluateSearch(gate);
    if (!eligibility.eligible) return { status: 'degraded', reasonCode: eligibility.reasonCode, items: [] };
    const parsedResponse = DeepSeekSearchResponseSchema.safeParse(input);
    if (!parsedResponse.success) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_PROTOCOL_INVALID', items: [] };
    const items = mapDeepSeekSearchResponseToContextItems(parsedResponse.data, {
      maxItems: this.contextLimits.maxContextItems,
      maxBytes: this.contextLimits.maxContextBytes,
    });
    if (items.length === 0 && parsedResponse.data.items.length > 0) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_CONTEXT_LIMIT', items: [] };
    const unique: ContextItem[] = [];
    const seen = new Set<string>();
    try {
      const manager = new ContextManager({
        maxBytes: this.contextLimits.maxContextBytes,
        maxItems: this.contextLimits.maxContextItems,
        maxTokens: this.contextLimits.maxContextTokens,
      });
      for (const item of items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const contextItem: ContextItem = {
          id: item.id,
          source: 'retrieval',
          trust: 'untrusted',
          role: 'user',
          content: item.content,
        };
        manager.add(contextItem);
        unique.push(contextItem);
      }
      const projection = manager.build();
      return { status: 'ready', reasonCode: 'DEEPSEEK_SEARCH_READY', items: unique, projection };
    } catch {
      return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_CONTEXT_LIMIT', items: [] };
    }
  }

  /**
   * Execute an optional provider-owned retrieval request after the immutable
   * run gate has passed. This is an application port, not a generic tool
   * runtime; all failures are bounded and fail-soft.
   */
  async search(
    request: unknown,
    gate: { readonly network: 'restricted' | 'enabled'; readonly approvalGranted: boolean },
    signal: AbortSignal,
  ): Promise<DeepSeekSearchContextResult> {
    const eligibility = this.evaluateSearch(gate);
    if (!eligibility.eligible) return { status: 'degraded', reasonCode: eligibility.reasonCode, items: [] };
    const parsedRequest = DeepSeekSearchRequestSchema.safeParse(request);
    if (!parsedRequest.success) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_PROTOCOL_INVALID', items: [] };
    if (signal.aborted) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_CANCELLED', items: [] };
    const executor = this.searchExecutor;
    if (!executor) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_DEGRADED', items: [] };
    try {
      const response = await executor.search(parsedRequest.data, signal);
      if (signal.aborted) return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_CANCELLED', items: [] };
      const parsedResponse = DeepSeekSearchResponseSchema.safeParse(response);
      if (!parsedResponse.success || parsedResponse.data.query !== parsedRequest.data.query) {
        return { status: 'degraded', reasonCode: 'DEEPSEEK_SEARCH_PROTOCOL_INVALID', items: [] };
      }
      return this.mapSearchResponse(parsedResponse.data, gate);
    } catch (error) {
      return { status: 'degraded', reasonCode: mapSearchFailureReason(error, signal), items: [] };
    }
  }
}

function parseBinding(input: DeepSeekApplicationRunBindingInput): DeepSeekApplicationRunBinding | undefined {
  const model = ModelProviderSnapshotSchema.safeParse(input.modelSnapshot);
  const deepSeek = DeepSeekRunSnapshotSchema.safeParse(input.deepSeekSnapshot);
  if (!model.success || !deepSeek.success) return undefined;
  if (model.data.providerId !== 'deepseek'
    || model.data.model !== deepSeek.data.model
    || model.data.descriptorRevision !== deepSeek.data.configRevision) return undefined;
  if (input.capabilitySnapshot === undefined) {
    if (!deepSeek.data.capabilityRevision.endsWith(UNPROBED_CAPABILITY_SUFFIX)) return undefined;
    return { modelSnapshot: model.data, deepSeekSnapshot: deepSeek.data };
  }
  const capability = DeepSeekCapabilitySnapshotSchema.safeParse(input.capabilitySnapshot);
  if (!capability.success
    || capability.data.providerId !== 'deepseek'
    || capability.data.model !== deepSeek.data.model
    || capability.data.endpointProfile !== deepSeek.data.endpointProfile
    || capability.data.descriptorRevision !== deepSeek.data.capabilityRevision) return undefined;
  return { modelSnapshot: model.data, deepSeekSnapshot: deepSeek.data, capabilitySnapshot: capability.data };
}

function toConfig(snapshot: DeepSeekRunSnapshot) {
  return DeepSeekConfigSchema.parse({
    schemaVersion: 'deepseek-provider/v1',
    providerId: 'deepseek',
    endpointProfile: snapshot.endpointProfile,
    endpoint: snapshot.endpoint,
    model: snapshot.model,
    thinkingMode: snapshot.thinkingMode,
    toolCalling: snapshot.toolCalling,
    webSearch: snapshot.webSearch,
    reviewer: snapshot.reviewer,
    timeoutMs: 30_000,
    maxRetries: 0,
    ...(snapshot.capabilityRevision.endsWith(UNPROBED_CAPABILITY_SUFFIX) ? {} : { contextLimit: 'unknown' as const }),
    maxOutputTokens: 1_024,
    revision: snapshot.configRevision,
    updatedAt: snapshot.capturedAt,
  });
}

function boundedPositive(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback;
}

function isSafeToolDescriptor(value: DeepSeekToolDescriptor): boolean {
  if (!value || typeof value !== 'object') return false;
  if (!TOOL_ID.test(value.id) || !TOOL_ID.test(value.name) || !TOOL_ID.test(value.version) || !TOOL_TEXT.test(value.summary)) return false;
  if (!['read', 'write', 'destructive', 'network'].includes(value.risk)) return false;
  if (value.inputSchema !== undefined) {
    if (typeof value.inputSchema !== 'object' || value.inputSchema === null || Array.isArray(value.inputSchema)) return false;
    if (findDeepSeekPrivacyViolations(value.inputSchema).length > 0) return false;
  }
  return true;
}

function mapSearchFailureReason(error: unknown, signal: AbortSignal): Exclude<DeepSeekSearchContextResult['reasonCode'], undefined> {
  if (signal.aborted) return 'DEEPSEEK_SEARCH_CANCELLED';
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'DEEPSEEK_SEARCH_CANCELLED') return 'DEEPSEEK_SEARCH_CANCELLED';
    if (code === 'DEEPSEEK_SEARCH_TIMEOUT') return 'DEEPSEEK_SEARCH_TIMEOUT';
    if (code === 'DEEPSEEK_SEARCH_PROTOCOL_INVALID') return 'DEEPSEEK_SEARCH_PROTOCOL_INVALID';
  }
  return 'DEEPSEEK_SEARCH_DEGRADED';
}
