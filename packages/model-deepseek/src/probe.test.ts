import { describe, expect, it } from 'vitest';
import type { DeepSeekConfig } from '@ready4vibe/contracts';
import { probeDeepSeek } from './probe.js';

const config: DeepSeekConfig = {
  schemaVersion: 'deepseek-provider/v1',
  providerId: 'deepseek',
  endpointProfile: 'openai-chat-completions',
  endpoint: 'https://provider.test/v1/chat/completions',
  model: 'deepseek-v4-flash',
  authRef: 'secret.deepseek.primary',
  thinkingMode: 'auto',
  toolCalling: 'enabled',
  webSearch: 'off',
  reviewer: 'off',
  timeoutMs: 5_000,
  maxRetries: 2,
  maxOutputTokens: 128,
  revision: 'cfg-1',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

describe('DeepSeek explicit endpoint probe', () => {
  it('is write-only for credentials and probes the complete endpoint without path guessing', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await probeDeepSeek({
      config,
      apiKey: 'runtime-secret',
      now: () => '2026-08-05T10:00:00.000Z',
      fetchImpl: async (input, init) => {
        calls.push(init === undefined ? { input } : { input, init });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 2 } }), { status: 200 });
      },
    });
    expect(result).toMatchObject({ status: 'ready', errorCode: null, capabilities: { providerId: 'deepseek', usage: true } });
    expect(calls[0]?.input).toBe(config.endpoint);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.stringify(result)).not.toContain('runtime-secret');
    expect(JSON.stringify(calls[0]?.init?.body)).not.toContain('runtime-secret');
  });

  it('returns bounded credential and protocol errors without throwing provider data', async () => {
    await expect(probeDeepSeek({ config })).resolves.toMatchObject({ status: 'blocked', errorCode: 'DEEPSEEK_CREDENTIAL_REQUIRED', capabilities: null });
    await expect(probeDeepSeek({ config, apiKey: 'runtime-secret', fetchImpl: async () => new Response('{not-json', { status: 200 }) })).resolves.toMatchObject({ status: 'blocked', errorCode: 'DEEPSEEK_PROTOCOL_UNSUPPORTED' });
    await expect(probeDeepSeek({ config, apiKey: 'runtime-secret', fetchImpl: async () => new Response('provider-secret-body', { status: 401 }) })).resolves.toMatchObject({ status: 'blocked', errorCode: 'DEEPSEEK_HTTP_401' });
  });

  it('maps bounded upstream availability failures to degraded status', async () => {
    await expect(probeDeepSeek({ config, apiKey: 'runtime-secret', fetchImpl: async () => new Response('', { status: 503 }) })).resolves.toMatchObject({ status: 'degraded', errorCode: 'DEEPSEEK_HTTP_5XX' });
    await expect(probeDeepSeek({ config, apiKey: 'runtime-secret', fetchImpl: async () => { throw new Error('network secret'); } })).resolves.toMatchObject({ status: 'degraded', errorCode: 'DEEPSEEK_STREAM_DISCONNECTED' });
  });
});
