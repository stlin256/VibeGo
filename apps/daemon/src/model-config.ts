import type { ModelEvent, ModelProvider } from '@ready4vibe/contracts';
import { OpenAICompatibleProvider } from '@ready4vibe/model-openai';

export type ModelSettingsSource = 'environment' | 'web-memory' | 'unconfigured';

export interface ModelSettingsStatus {
  configured: boolean;
  providerId: string;
  baseUrl: string | null;
  modelName: string | null;
  source: ModelSettingsSource;
}

export interface ModelSettingsInput {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ModelSettingsManager {
  readonly provider: ModelProvider;
  status(): ModelSettingsStatus;
  configure(input: ModelSettingsInput): ModelSettingsStatus;
  clear(): ModelSettingsStatus;
}

export function createModelProvider(env: NodeJS.ProcessEnv = process.env): ModelProvider {
  const apiKey = env.READY4VIBE_MODEL_API_KEY;
  if (apiKey) {
    return new OpenAICompatibleProvider({
      id: 'openai-compatible',
      baseUrl: env.READY4VIBE_MODEL_BASE_URL ?? 'https://api.deepseek.com',
      apiKey,
      allowInsecureHttp: env.READY4VIBE_ALLOW_INSECURE_MODEL_HTTP === '1',
    });
  }
  return {
    id: 'unconfigured',
    capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
    async *stream(_request, _signal): AsyncIterable<ModelEvent> {
      yield {
        type: 'error',
        code: 'MODEL_PROVIDER_NOT_CONFIGURED',
        retryable: false,
        safeMessage: 'No model provider is configured for this daemon.',
      };
    },
  };
}

export class ModelSettingsError extends Error {
  constructor(readonly code: 'INVALID_PROVIDER' | 'INVALID_BASE_URL' | 'INVALID_API_KEY' | 'INVALID_MODEL', message: string) {
    super(message);
    this.name = 'ModelSettingsError';
  }
}

export class InMemoryModelSettingsManager implements ModelSettingsManager {
  readonly provider: SwitchingModelProvider;
  private currentStatus: ModelSettingsStatus;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const provider = createModelProvider(env);
    this.provider = new SwitchingModelProvider(provider);
    this.currentStatus = statusFromEnvironment(env, provider);
  }

  status(): ModelSettingsStatus {
    return { ...this.currentStatus };
  }

  configure(input: ModelSettingsInput): ModelSettingsStatus {
    const normalized = validateModelSettingsInput(input);
    const nextProvider = new OpenAICompatibleProvider({
      id: normalized.provider,
      baseUrl: normalized.baseUrl,
      apiKey: normalized.apiKey,
    });
    this.provider.replace(nextProvider);
    this.currentStatus = {
      configured: true,
      providerId: normalized.provider,
      baseUrl: normalized.baseUrl,
      modelName: normalized.model,
      source: 'web-memory',
    };
    return this.status();
  }

  clear(): ModelSettingsStatus {
    this.provider.replace(createUnconfiguredProvider());
    this.currentStatus = {
      configured: false,
      providerId: 'unconfigured',
      baseUrl: null,
      modelName: null,
      source: 'unconfigured',
    };
    return this.status();
  }
}

export class SwitchingModelProvider implements ModelProvider {
  constructor(private current: ModelProvider) {}

  get id(): string { return this.current.id; }
  get capabilities(): ModelProvider['capabilities'] { return this.current.capabilities; }

  replace(provider: ModelProvider): void {
    this.current = provider;
  }

  snapshot(): ModelProvider {
    return this.current;
  }

  stream(request: Parameters<ModelProvider['stream']>[0], signal: Parameters<ModelProvider['stream']>[1]): AsyncIterable<ModelEvent> {
    return this.current.stream(request, signal);
  }
}

function validateModelSettingsInput(input: ModelSettingsInput): ModelSettingsInput {
  if (input.provider !== 'openai-compatible') throw new ModelSettingsError('INVALID_PROVIDER', 'Only OpenAI-compatible providers are supported.');
  if (typeof input.baseUrl !== 'string' || input.baseUrl.length === 0 || input.baseUrl.length > 2_048) throw new ModelSettingsError('INVALID_BASE_URL', 'A valid HTTPS provider URL is required.');
  let parsed: URL;
  try { parsed = new URL(input.baseUrl); } catch { throw new ModelSettingsError('INVALID_BASE_URL', 'A valid HTTPS provider URL is required.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.search) throw new ModelSettingsError('INVALID_BASE_URL', 'Provider URL must use HTTPS without credentials or query parameters.');
  const baseUrl = parsed.toString().replace(/\/$/u, '');
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0 || input.apiKey.length > 4_096 || /[\r\n]/u.test(input.apiKey)) throw new ModelSettingsError('INVALID_API_KEY', 'The provider key is invalid.');
  if (typeof input.model !== 'string' || input.model.trim().length === 0 || input.model.length > 256 || /[\r\n]/u.test(input.model)) throw new ModelSettingsError('INVALID_MODEL', 'A model name is required.');
  return { provider: input.provider, baseUrl, apiKey: input.apiKey, model: input.model.trim() };
}

function statusFromEnvironment(env: NodeJS.ProcessEnv, provider: ModelProvider): ModelSettingsStatus {
  const apiKey = env.READY4VIBE_MODEL_API_KEY;
  if (!apiKey) return { configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured' };
  let baseUrl: string | null = null;
  try { baseUrl = new URL(env.READY4VIBE_MODEL_BASE_URL ?? 'https://api.deepseek.com').toString().replace(/\/$/u, ''); } catch { /* startup validation is handled by createModelProvider */ }
  return { configured: true, providerId: provider.id, baseUrl, modelName: env.READY4VIBE_MODEL_NAME ?? null, source: 'environment' };
}

function createUnconfiguredProvider(): ModelProvider {
  return {
    id: 'unconfigured',
    capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
    async *stream(_request, _signal): AsyncIterable<ModelEvent> {
      yield { type: 'error', code: 'MODEL_PROVIDER_NOT_CONFIGURED', retryable: false, safeMessage: 'No model provider is configured for this daemon.' };
    },
  };
}
