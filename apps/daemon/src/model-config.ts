import { ModelProviderSnapshotSchema, ModelProbeResultSchema, ModelSettingsProfileSchema, type ModelEvent, type ModelProbeResult, type ModelProvider, type ModelProviderSnapshot, type ModelSettingsProfile } from '@ready4vibe/contracts';
import { OpenAICompatibleProvider, probeOpenAICompatibleModels, type ProbeFetchImplementation } from '@ready4vibe/model-openai';
import type { SettingsStore } from '@ready4vibe/storage';

export const MODEL_SETTINGS_NAMESPACE = 'model';
export const MODEL_SETTINGS_KEY = 'profile';

export type ModelSettingsSource = 'environment' | 'web-memory' | 'durable-profile' | 'unconfigured';
export type ModelCredentialState = 'available' | 'required' | 'none';

export interface ModelSettingsStatus {
  configured: boolean;
  providerId: string;
  baseUrl: string | null;
  modelName: string | null;
  source: ModelSettingsSource;
  credentialState: ModelCredentialState;
}

export interface ModelSettingsInput {
  provider: 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ModelRunSelection {
  provider: string;
  name: string;
}

export interface ModelProviderBinding {
  readonly provider: ModelProvider;
  readonly snapshot: ModelProviderSnapshot;
}

export interface ModelSettingsManager {
  readonly provider: ModelProvider;
  status(): ModelSettingsStatus;
  configure(input: ModelSettingsInput): ModelSettingsStatus;
  clear(): ModelSettingsStatus;
  probe(input: { endpoint: string; timeoutMs?: number }): Promise<ModelProbeResult>;
  bindRun(selection: ModelRunSelection): ModelProviderBinding;
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
  constructor(readonly code: 'INVALID_PROVIDER' | 'INVALID_BASE_URL' | 'INVALID_API_KEY' | 'INVALID_MODEL' | 'INVALID_PROBE_ENDPOINT' | 'PERSISTENCE_FAILED' | 'CORRUPT_PROFILE', message: string) {
    super(message);
    this.name = 'ModelSettingsError';
  }
}

export class InMemoryModelSettingsManager implements ModelSettingsManager {
  readonly provider: SwitchingModelProvider;
  private currentStatus: ModelSettingsStatus;
  private currentApiKey: string | undefined;
  private currentModelName: string | null;
  private revision = 0;
  private readonly clock: () => Date;
  private readonly probeFetchImpl: ProbeFetchImplementation | undefined;
  private readonly settings: SettingsStore | undefined;

  constructor(env: NodeJS.ProcessEnv = process.env, clock: () => Date = () => new Date(), probeFetchImpl?: ProbeFetchImplementation, settings?: SettingsStore) {
    this.settings = settings;
    const environmentProvider = createModelProvider(env);
    const persistedProfile = !env.READY4VIBE_MODEL_API_KEY ? loadDurableProfile(settings) : undefined;
    const provider = persistedProfile ? createUnconfiguredProvider() : environmentProvider;
    this.provider = new SwitchingModelProvider(provider);
    this.currentStatus = persistedProfile ? statusFromDurableProfile(persistedProfile) : statusFromEnvironment(env, provider);
    this.currentApiKey = env.READY4VIBE_MODEL_API_KEY;
    this.currentModelName = env.READY4VIBE_MODEL_NAME ?? persistedProfile?.modelName ?? null;
    this.revision = persistedProfile ? profileRevisionNumber(persistedProfile.profileRevision) : 0;
    this.clock = clock;
    this.probeFetchImpl = probeFetchImpl;
  }

  status(): ModelSettingsStatus {
    return { ...this.currentStatus };
  }

  configure(input: ModelSettingsInput): ModelSettingsStatus {
    const normalized = validateModelSettingsInput(input);
    const nextRevision = this.revision + 1;
    const profile = createModelSettingsProfile(normalized, nextRevision, this.clock);
    persistDurableProfile(this.settings, profile);
    const nextProvider = new OpenAICompatibleProvider({
      id: normalized.provider,
      baseUrl: normalized.baseUrl,
      apiKey: normalized.apiKey,
    });
    this.provider.replace(nextProvider);
    this.currentApiKey = normalized.apiKey;
    this.currentModelName = normalized.model;
    this.revision = nextRevision;
    this.currentStatus = {
      configured: true,
      providerId: normalized.provider,
      baseUrl: normalized.baseUrl,
      modelName: normalized.model,
      source: 'web-memory',
      credentialState: 'available',
    };
    return this.status();
  }

  clear(): ModelSettingsStatus {
    deleteDurableProfile(this.settings);
    this.provider.replace(createUnconfiguredProvider());
    this.currentApiKey = undefined;
    this.currentModelName = null;
    this.revision += 1;
    this.currentStatus = {
      configured: false,
      providerId: 'unconfigured',
      baseUrl: null,
      modelName: null,
      source: 'unconfigured',
      credentialState: 'none',
    };
    return this.status();
  }

  async probe(input: { endpoint: string; timeoutMs?: number }): Promise<ModelProbeResult> {
    if (!this.currentStatus.configured || !this.currentApiKey) {
      return unavailableProbe(this.clock().toISOString(), 'credential-store-unavailable');
    }
    if (!this.currentModelName) return unavailableProbe(this.clock().toISOString(), 'model-not-found');
    try {
      return await probeOpenAICompatibleModels({
        endpoint: input.endpoint,
        providerId: this.currentStatus.providerId,
        modelId: this.currentModelName,
        apiKey: this.currentApiKey,
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
        ...(this.probeFetchImpl ? { fetchImpl: this.probeFetchImpl } : {}),
        now: () => this.clock().toISOString(),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'PROBE_ENDPOINT_INVALID') {
        throw new ModelSettingsError('INVALID_PROBE_ENDPOINT', 'A complete HTTPS model-list endpoint is required.');
      }
      if (error instanceof Error && error.message === 'PROBE_OPTIONS_INVALID') {
        throw new ModelSettingsError('INVALID_PROBE_ENDPOINT', 'Probe timeout is outside the allowed range.');
      }
      return unavailableProbe(this.clock().toISOString(), 'protocol-mismatch');
    }
  }

  bindRun(selection: ModelRunSelection): ModelProviderBinding {
    if (typeof selection.name !== 'string' || selection.name.trim().length === 0 || selection.name.length > 256 || /[\r\n]/u.test(selection.name)) {
      throw new ModelSettingsError('INVALID_MODEL', 'The requested model name is invalid.');
    }
    if (this.currentStatus.configured && selection.provider !== this.currentStatus.providerId) {
      throw new ModelSettingsError('INVALID_PROVIDER', 'The requested model provider is not configured for this daemon.');
    }
    const provider = this.provider.snapshot();
    let snapshot: ModelProviderSnapshot;
    try {
      snapshot = ModelProviderSnapshotSchema.parse({
        schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
        providerId: provider.id,
        model: selection.name.trim(),
        pricingModel: selection.name.trim(),
        descriptorRevision: `settings-${this.revision}`,
        endpointPolicy: this.currentStatus.baseUrl
          ? { kind: 'explicit-url', baseUrl: this.currentStatus.baseUrl }
          : { kind: 'provider-default' },
        capabilities: {
          streaming: provider.capabilities.streaming,
          toolCalls: provider.capabilities.toolCalls,
          structuredOutput: provider.capabilities.structuredOutput,
          reasoning: false,
          promptCaching: false,
          audioInput: false,
          audioOutput: false,
        },
        capturedAt: this.clock().toISOString(),
      });
    } catch {
      throw new ModelSettingsError('INVALID_MODEL', 'The requested model name is invalid.');
    }
    return { provider, snapshot };
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
  if (!apiKey) return { configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured', credentialState: 'none' };
  let baseUrl: string | null = null;
  try { baseUrl = new URL(env.READY4VIBE_MODEL_BASE_URL ?? 'https://api.deepseek.com').toString().replace(/\/$/u, ''); } catch { /* startup validation is handled by createModelProvider */ }
  return { configured: true, providerId: provider.id, baseUrl, modelName: env.READY4VIBE_MODEL_NAME ?? null, source: 'environment', credentialState: 'available' };
}

function statusFromDurableProfile(profile: ModelSettingsProfile): ModelSettingsStatus {
  return {
    configured: false,
    providerId: profile.providerId,
    baseUrl: profile.baseUrl,
    modelName: profile.modelName,
    source: 'durable-profile',
    credentialState: 'required',
  };
}

function profileRevisionNumber(value: string): number {
  const match = /^settings-(\d+)$/u.exec(value);
  const parsed = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function loadDurableProfile(settings: SettingsStore | undefined): ModelSettingsProfile | undefined {
  if (!settings) return undefined;
  const value = settings.get<unknown>(MODEL_SETTINGS_NAMESPACE, MODEL_SETTINGS_KEY);
  if (value === undefined) return undefined;
  try {
    return ModelSettingsProfileSchema.parse(value);
  } catch (error) {
    throw new ModelSettingsError('CORRUPT_PROFILE', 'Stored model endpoint profile is invalid.');
  }
}

function createModelSettingsProfile(input: ModelSettingsInput, revision: number, clock: () => Date): ModelSettingsProfile {
  return ModelSettingsProfileSchema.parse({
    schemaVersion: 'ready4vibe_model_settings_profile_v1',
    providerId: input.provider,
    baseUrl: input.baseUrl,
    modelName: input.model,
    profileRevision: `settings-${revision}`,
    updatedAt: clock().toISOString(),
  });
}

function persistDurableProfile(settings: SettingsStore | undefined, profile: ModelSettingsProfile): void {
  if (!settings) return;
  try {
    settings.set(MODEL_SETTINGS_NAMESPACE, MODEL_SETTINGS_KEY, profile);
  } catch (error) {
    throw new ModelSettingsError('PERSISTENCE_FAILED', 'Model endpoint profile could not be saved.');
  }
}

function deleteDurableProfile(settings: SettingsStore | undefined): void {
  if (!settings) return;
  try {
    settings.delete(MODEL_SETTINGS_NAMESPACE, MODEL_SETTINGS_KEY);
  } catch (error) {
    throw new ModelSettingsError('PERSISTENCE_FAILED', 'Model endpoint profile could not be cleared.');
  }
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

function unavailableProbe(checkedAt: string, errorCode: NonNullable<ModelProbeResult['errorCode']>): ModelProbeResult {
  return ModelProbeResultSchema.parse({
    schemaVersion: 'ready4vibe_model_probe_result_v1',
    status: 'blocked',
    checkedAt,
    latencyMs: null,
    revision: null,
    errorCode,
    capabilities: null,
  });
}
