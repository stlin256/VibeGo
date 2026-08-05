import { describe, expect, it } from 'vitest';
import type { DeepSeekCapabilitySnapshot, DeepSeekConfig, DeepSeekReviewRequest } from '@ready4vibe/contracts';
import { DeepSeekProvider } from './index.js';
import {
  DeepSeekReviewProvider,
  evaluateDeepSeekSearchGate,
  mapDeepSeekSearchResponseToContextItems,
  resolveDeepSeekThinkingMode,
} from './capabilities.js';

const baseConfig: DeepSeekConfig = {
  schemaVersion: 'deepseek-provider/v1',
  providerId: 'deepseek',
  endpointProfile: 'openai-responses',
  endpoint: 'https://api.deepseek.com/v1/responses',
  model: 'deepseek-v4-flash',
  authRef: 'secret.deepseek.primary',
  thinkingMode: 'auto',
  toolCalling: 'enabled',
  webSearch: 'provider-owned',
  reviewer: 'advisory',
  timeoutMs: 10_000,
  maxRetries: 2,
  maxOutputTokens: 1_024,
  revision: 'cfg-1',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

const readyCapabilities: DeepSeekCapabilitySnapshot = {
  schemaVersion: 'deepseek-provider-capability/v1',
  providerId: 'deepseek',
  endpointProfile: 'openai-responses',
  model: 'deepseek-v4-flash',
  descriptorRevision: 'probe-1',
  capturedAt: '2026-08-05T10:00:00.000Z',
  status: 'ready',
  streaming: true,
  toolCalls: true,
  structuredOutput: false,
  reasoning: true,
  usage: true,
  webSearch: true,
  contextLimit: 100_000,
  outputLimit: 1_024,
  degradedReason: null,
};

const reviewRequest: DeepSeekReviewRequest = {
  schemaVersion: 'deepseek-provider-review/v1',
  requestId: 'review-1',
  approvalKey: 'a'.repeat(64),
  toolId: 'filesystem.read',
  risk: 'read-only',
  taskTrust: 'trusted-workspace',
  sandboxMode: 'workspace-write',
  network: 'restricted',
  summary: 'Read a bounded item from the selected workspace.',
};

function responseFor(events: string[], status = 200): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join('');
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

describe('DeepSeek capability gates', () => {
  it('allows off/auto safely and blocks high or max without a declared reasoning capability', () => {
    expect(resolveDeepSeekThinkingMode('off', { ...readyCapabilities, status: 'degraded', reasoning: false, degradedReason: 'probe unavailable' })).toEqual({ status: 'ready', effectiveMode: 'off' });
    expect(resolveDeepSeekThinkingMode('auto', readyCapabilities)).toEqual({ status: 'ready', effectiveMode: 'auto' });
    expect(resolveDeepSeekThinkingMode('high', { ...readyCapabilities, reasoning: false })).toEqual({ status: 'blocked', reasonCode: 'DEEPSEEK_THINKING_UNSUPPORTED' });
    expect(resolveDeepSeekThinkingMode('max', { ...readyCapabilities, status: 'degraded', degradedReason: 'probe unavailable' })).toEqual({ status: 'blocked', reasonCode: 'DEEPSEEK_THINKING_UNSUPPORTED' });
    expect(() => new DeepSeekProvider({ config: { ...baseConfig, thinkingMode: 'high' }, apiKey: 'runtime-secret' })).toThrow('DEEPSEEK_THINKING_UNSUPPORTED');
    expect(() => new DeepSeekProvider({ config: { ...baseConfig, thinkingMode: 'high' }, capability: readyCapabilities, apiKey: 'runtime-secret' })).not.toThrow();
  });

  it('requires Responses probe, enabled network and explicit approval for provider-owned search', () => {
    expect(evaluateDeepSeekSearchGate(baseConfig, readyCapabilities, { network: 'enabled', approvalGranted: true })).toEqual({ eligible: true });
    expect(evaluateDeepSeekSearchGate(baseConfig, readyCapabilities, { network: 'restricted', approvalGranted: true })).toMatchObject({ eligible: false, reasonCode: 'DEEPSEEK_SEARCH_DEGRADED' });
    expect(evaluateDeepSeekSearchGate(baseConfig, { ...readyCapabilities, webSearch: false }, { network: 'enabled', approvalGranted: true })).toMatchObject({ eligible: false });
    expect(evaluateDeepSeekSearchGate({ ...baseConfig, endpointProfile: 'openai-chat-completions', endpoint: 'https://api.deepseek.com/v1/chat/completions' }, readyCapabilities, { network: 'enabled', approvalGranted: true })).toMatchObject({ eligible: false });
  });

  it('maps only bounded untrusted retrieval context and never returns raw response data', () => {
    const mapped = mapDeepSeekSearchResponseToContextItems({
      schemaVersion: 'deepseek-provider-search/v1',
      query: 'bounded query',
      items: [{
        schemaVersion: 'deepseek-provider-search-item/v1',
        source: 'retrieval',
        trust: 'untrusted',
        referenceId: 'ref-1',
        title: 'Documentation',
        snippet: 'Bounded result text.',
        url: 'https://example.com/docs',
      }],
      truncated: false,
    });
    expect(mapped).toEqual([{
      id: 'deepseek-search:ref-1',
      source: 'retrieval',
      trust: 'untrusted',
      role: 'user',
      content: 'Documentation\nBounded result text.\nhttps://example.com/docs',
    }]);
    expect(JSON.stringify(mapped)).not.toContain('Authorization');
  });
});

describe('DeepSeekReviewProvider', () => {
  it('does not call the provider for ineligible operations', async () => {
    let calls = 0;
    const provider = new DeepSeekReviewProvider({
      config: baseConfig,
      apiKey: 'runtime-secret',
      fetchImpl: async () => { calls += 1; return responseFor([]); },
    });
    const decision = await provider.review({ ...reviewRequest, risk: 'network' }, new AbortController().signal);
    expect(decision).toMatchObject({ decision: 'unavailable', reason: 'DEEPSEEK_REVIEW_INELIGIBLE' });
    expect(calls).toBe(0);
  });

  it('returns an exact-key advisory decision from bounded JSON output', async () => {
    const provider = new DeepSeekReviewProvider({
      config: baseConfig,
      apiKey: 'runtime-secret',
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({ model: 'deepseek-v4-flash', stream: true });
        return responseFor([
          JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify({ decision: 'allow-advisory', requestId: reviewRequest.requestId, approvalKey: reviewRequest.approvalKey, reason: 'bounded read is eligible' }) }),
          JSON.stringify({ type: 'response.completed', response: { status: 'completed' } }),
          '[DONE]',
        ]);
      },
    });
    await expect(provider.review(reviewRequest, new AbortController().signal)).resolves.toMatchObject({
      decision: 'allow',
      requestId: reviewRequest.requestId,
      approvalKey: reviewRequest.approvalKey,
    });
  });

  it('maps malformed, mismatched and cancelled output to unavailable without retrying', async () => {
    let calls = 0;
    const malformed = new DeepSeekReviewProvider({
      config: baseConfig,
      apiKey: 'runtime-secret',
      fetchImpl: async () => { calls += 1; return responseFor([JSON.stringify({ type: 'response.output_text.delta', delta: '{not-json' }), '[DONE]']); },
    });
    await expect(malformed.review(reviewRequest, new AbortController().signal)).resolves.toMatchObject({ decision: 'unavailable' });

    const mismatched = new DeepSeekReviewProvider({
      config: baseConfig,
      apiKey: 'runtime-secret',
      fetchImpl: async () => { calls += 1; return responseFor([JSON.stringify({ type: 'response.output_text.delta', delta: JSON.stringify({ decision: 'allow', requestId: 'other', approvalKey: reviewRequest.approvalKey, reason: 'wrong key' }) }), '[DONE]']); },
    });
    await expect(mismatched.review(reviewRequest, new AbortController().signal)).resolves.toMatchObject({ decision: 'unavailable' });

    const cancelled = new AbortController();
    cancelled.abort();
    const provider = new DeepSeekReviewProvider({ config: baseConfig, apiKey: 'runtime-secret', fetchImpl: async () => { calls += 1; return responseFor([]); } });
    await expect(provider.review(reviewRequest, cancelled.signal)).resolves.toMatchObject({ decision: 'unavailable', reason: 'DEEPSEEK_REVIEW_CANCELLED' });
    expect(calls).toBe(2);
  });
});
