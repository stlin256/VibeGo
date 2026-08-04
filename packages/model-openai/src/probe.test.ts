import { describe, expect, it } from 'vitest';
import { probeOpenAICompatibleModels } from './probe.js';

function modelsResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('OpenAI-compatible model probe', () => {
  it('uses the complete explicit endpoint, sends no prompt, and returns unknown capabilities', async () => {
    let called: string | undefined;
    let init: RequestInit | undefined;
    const result = await probeOpenAICompatibleModels({
      endpoint: 'https://api.deepseek.com/models', providerId: 'deepseek', modelId: 'deepseek-v4-flash', apiKey: 'test-secret',
      fetchImpl: async (input, requestInit) => { called = input; init = requestInit; return modelsResponse({ object: 'list', data: [{ id: 'deepseek-v4-flash' }] }); },
      now: () => '2026-08-05T00:00:00.000Z',
    });
    expect(called).toBe('https://api.deepseek.com/models');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-secret', Accept: 'application/json' });
    expect(result).toMatchObject({ status: 'ready', capabilities: { modelId: 'deepseek-v4-flash', toolCalls: 'unknown', contextLimit: 'unknown' } });
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });

  it('maps auth, rate-limit, upstream and malformed responses to stable bounded errors', async () => {
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models', providerId: 'provider', modelId: 'model', fetchImpl: async () => modelsResponse({ error: 'secret body' }, 401) })).resolves.toMatchObject({ status: 'blocked', errorCode: 'auth-rejected' });
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models', providerId: 'provider', modelId: 'model', fetchImpl: async () => modelsResponse({}, 429) })).resolves.toMatchObject({ status: 'degraded', errorCode: 'rate-limited' });
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models', providerId: 'provider', modelId: 'model', fetchImpl: async () => modelsResponse({ error: 'secret body' }, 503) })).resolves.toMatchObject({ status: 'degraded', errorCode: 'provider-unreachable' });
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models', providerId: 'provider', modelId: 'model', fetchImpl: async () => new Response('{not-json', { status: 200 }) })).resolves.toMatchObject({ status: 'blocked', errorCode: 'protocol-mismatch' });
  });

  it('distinguishes a missing model and bounds unsafe endpoint/body/options', async () => {
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models', providerId: 'provider', modelId: 'missing', fetchImpl: async () => modelsResponse({ data: [{ id: 'other' }] }) })).resolves.toMatchObject({ status: 'blocked', errorCode: 'model-not-found' });
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models?token=secret', providerId: 'provider', modelId: 'model' })).rejects.toThrow('PROBE_ENDPOINT_INVALID');
    await expect(probeOpenAICompatibleModels({ endpoint: 'http://provider.test/models', providerId: 'provider', modelId: 'model' })).rejects.toThrow('PROBE_ENDPOINT_INVALID');
    await expect(probeOpenAICompatibleModels({ endpoint: 'http://127.0.0.1:11434/models', providerId: 'provider', modelId: 'model', allowInsecureHttp: true, maxResponseBytes: 1024, fetchImpl: async () => modelsResponse({ data: [{ id: 'model' }], extra: 'x'.repeat(2_000) }) })).resolves.toMatchObject({ errorCode: 'protocol-mismatch' });
    await expect(probeOpenAICompatibleModels({ endpoint: 'https://provider.test/models', providerId: 'provider', modelId: 'model', timeoutMs: 31_000 })).rejects.toThrow('PROBE_OPTIONS_INVALID');
  });
});
