import {
  DEEPSEEK_CAPABILITY_SCHEMA_VERSION,
  DEEPSEEK_PROVIDER_SCHEMA_VERSION,
  DeepSeekConfigSchema,
  DeepSeekSettingsProfileSchema,
  DeepSeekSettingsStatusSchema,
  DeepSeekRunSnapshotSchema,
  ModelProviderSnapshotSchema,
  ModelProbeResultSchema,
  ModelSettingsProfileSchema,
  type DeepSeekConfig,
  type DeepSeekCapabilitySnapshot,
  type DeepSeekProbeResult,
  type DeepSeekSettingsProfile,
  type DeepSeekSettingsStatus,
  type DeepSeekRunSnapshot,
  type ModelEvent,
  type ModelProbeResult,
  type ModelProvider,
  type ModelProviderSnapshot,
  type ModelSettingsProfile,
} from '@ready4vibe/contracts';
import { DeepSeekProvider, probeDeepSeek, type FetchImplementation } from '@ready4vibe/model-deepseek';
import { OpenAICompatibleProvider, probeOpenAICompatibleModels, type ProbeFetchImplementation } from '@ready4vibe/model-openai';
import type { SettingsStore } from '@ready4vibe/storage';

export const MODEL_SETTINGS_NAMESPACE = 'model';
export const MODEL_SETTINGS_KEY = 'profile';
export const DEEPSEEK_SETTINGS_NAMESPACE = 'deepseek';
export const DEEPSEEK_SETTINGS_KEY = 'profile';

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
  /** Optional provider-specific metadata; never contains runtime credentials. */
  readonly deepSeekSnapshot?: DeepSeekRunSnapshot;
}

/** Write-only command input. The API key is never part of durable/status DTOs. */
export interface DeepSeekSettingsInput {
  endpointProfile: DeepSeekConfig['endpointProfile'];
  endpoint: string;
  model: string;
  apiKey: string;
  thinkingMode: DeepSeekConfig['thinkingMode'];
  toolCalling: DeepSeekConfig['toolCalling'];
  webSearch: DeepSeekConfig['webSearch'];
  reviewer: DeepSeekConfig['reviewer'];
  timeoutMs?: number;
  maxRetries?: number;
  contextLimit?: number | 'unknown';
  maxOutputTokens?: number;
  expectedRevision?: string;
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
  if (env.READY4VIBE_MODEL_PROVIDER === 'deepseek') {
    const binding = readDeepSeekEnvironmentBinding(env);
    if (binding) return binding.provider;
    return createUnconfiguredProvider();
  }
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
  constructor(readonly code: 'INVALID_PROVIDER' | 'INVALID_BASE_URL' | 'INVALID_API_KEY' | 'INVALID_MODEL' | 'INVALID_PROBE_ENDPOINT' | 'PERSISTENCE_FAILED' | 'CORRUPT_PROFILE' | 'INVALID_DEEPSEEK_CONFIG' | 'DEEPSEEK_CAPABILITY_REQUIRED' | 'REVISION_CONFLICT', message: string) {
    super(message);
    this.name = 'ModelSettingsError';
  }
}

export class InMemoryModelSettingsManager implements ModelSettingsManager, DeepSeekSettingsManager {
  readonly provider: SwitchingModelProvider;
  private currentStatus: ModelSettingsStatus;
  private currentApiKey: string | undefined;
  private currentModelName: string | null;
  private deepSeekEnvironment: DeepSeekEnvironmentBinding | undefined;
  private revision = 0;
  private readonly clock: () => Date;
  private readonly probeFetchImpl: ProbeFetchImplementation | undefined;
  private readonly settings: SettingsStore | undefined;
  private deepSeekConfig: DeepSeekConfig | undefined;
  private deepSeekProfile: DeepSeekSettingsProfile | undefined;
  private deepSeekCapability: DeepSeekCapabilitySnapshot | undefined;
  private deepSeekLastProbe: DeepSeekProbeResult | undefined;
  private deepSeekApiKey: string | undefined;
  private deepSeekRevision = 0;

  constructor(env: NodeJS.ProcessEnv = process.env, clock: () => Date = () => new Date(), probeFetchImpl?: ProbeFetchImplementation, settings?: SettingsStore) {
    this.settings = settings;
    this.clock = clock;
    const environmentBinding = env.READY4VIBE_MODEL_PROVIDER === 'deepseek' ? readDeepSeekEnvironmentBinding(env) : undefined;
    const environmentProvider = environmentBinding?.provider ?? createModelProvider(env);
    const hasEnvironmentCredential = Boolean(env.READY4VIBE_MODEL_API_KEY ?? env.READY4VIBE_DEEPSEEK_API_KEY);
    const persistedDeepSeekProfile = !hasEnvironmentCredential ? loadDeepSeekProfile(settings) : undefined;
    const persistedProfile = !hasEnvironmentCredential && !persistedDeepSeekProfile ? loadDurableProfile(settings) : undefined;
    const provider = persistedDeepSeekProfile || persistedProfile ? createUnconfiguredProvider() : environmentProvider;
    this.provider = new SwitchingModelProvider(provider);
    this.currentStatus = persistedDeepSeekProfile
      ? statusFromDeepSeekProfile(persistedDeepSeekProfile)
      : persistedProfile
        ? statusFromDurableProfile(persistedProfile)
        : statusFromEnvironment(env, provider, environmentBinding);
    this.currentApiKey = env.READY4VIBE_MODEL_API_KEY ?? env.READY4VIBE_DEEPSEEK_API_KEY;
    this.currentModelName = env.READY4VIBE_MODEL_NAME ?? persistedDeepSeekProfile?.model ?? persistedProfile?.modelName ?? null;
    this.deepSeekEnvironment = persistedDeepSeekProfile ? undefined : environmentBinding;
    this.deepSeekConfig = environmentBinding?.config ?? (persistedDeepSeekProfile ? configFromDeepSeekProfile(persistedDeepSeekProfile) : undefined);
    this.deepSeekProfile = persistedDeepSeekProfile;
    this.deepSeekApiKey = environmentBinding?.apiKey;
    this.deepSeekRevision = persistedDeepSeekProfile ? profileRevisionNumber(persistedDeepSeekProfile.profileRevision) : environmentBinding ? profileRevisionNumber(environmentBinding.config.revision) : 0;
    this.revision = persistedProfile ? profileRevisionNumber(persistedProfile.profileRevision) : 0;
    this.probeFetchImpl = probeFetchImpl;
  }

  status(): ModelSettingsStatus {
    return { ...this.currentStatus };
  }

  deepSeekStatus(): DeepSeekSettingsStatus {
    return DeepSeekSettingsStatusSchema.parse({
      schemaVersion: 'ready4vibe_deepseek_settings_status_v1',
      configured: this.currentStatus.providerId === 'deepseek' && this.currentStatus.configured,
      providerId: this.currentStatus.providerId === 'deepseek' ? 'deepseek' : 'unconfigured',
      source: this.deepSeekConfig ? this.currentStatus.source : 'unconfigured',
      credentialState: this.deepSeekConfig
        ? this.deepSeekApiKey ? 'available' : 'required'
        : 'none',
      profile: this.deepSeekProfile ?? (this.deepSeekConfig ? profileFromDeepSeekConfig(this.deepSeekConfig, this.deepSeekConfig.revision, this.deepSeekConfig.updatedAt) : null),
      capability: this.deepSeekCapability ?? null,
      lastProbe: this.deepSeekLastProbe ?? null,
    });
  }

  configureDeepSeek(input: DeepSeekSettingsInput): DeepSeekSettingsStatus {
    const normalized = validateDeepSeekSettingsInput(input);
    const currentRevision = this.deepSeekProfile?.profileRevision ?? this.deepSeekConfig?.revision;
    if (input.expectedRevision !== undefined && input.expectedRevision !== currentRevision) {
      throw new ModelSettingsError('REVISION_CONFLICT', 'DeepSeek settings changed; refresh before saving again.');
    }
    const nextRevision = this.deepSeekRevision + 1;
    const config = DeepSeekConfigSchema.parse({
      schemaVersion: 'deepseek-provider/v1',
      providerId: 'deepseek',
      endpointProfile: normalized.endpointProfile,
      endpoint: normalized.endpoint,
      model: normalized.model,
      authRef: 'secret.deepseek.process',
      thinkingMode: normalized.thinkingMode,
      toolCalling: normalized.toolCalling,
      webSearch: normalized.webSearch,
      reviewer: normalized.reviewer,
      timeoutMs: normalized.timeoutMs,
      maxRetries: normalized.maxRetries,
      contextLimit: normalized.contextLimit,
      maxOutputTokens: normalized.maxOutputTokens,
      revision: `deepseek-settings-${nextRevision}`,
      updatedAt: this.clock().toISOString(),
    });
    if ((config.thinkingMode === 'high' || config.thinkingMode === 'max')
      && (!this.deepSeekCapability || this.deepSeekCapability.status !== 'ready' || !this.deepSeekCapability.reasoning)) {
      throw new ModelSettingsError('DEEPSEEK_CAPABILITY_REQUIRED', 'Probe must declare reasoning support before high or max thinking can be enabled.');
    }
    if (config.webSearch === 'provider-owned'
      && (!this.deepSeekCapability || this.deepSeekCapability.status !== 'ready' || !this.deepSeekCapability.webSearch)) {
      throw new ModelSettingsError('DEEPSEEK_CAPABILITY_REQUIRED', 'Probe must declare provider-owned web search support before it can be enabled.');
    }
    let nextProvider: DeepSeekProvider;
    try {
      nextProvider = new DeepSeekProvider({ config, apiKey: normalized.apiKey, ...(this.deepSeekCapability ? { capability: this.deepSeekCapability } : {}) });
    } catch (error) {
      if (error instanceof Error && error.message === 'DEEPSEEK_THINKING_UNSUPPORTED') {
        throw new ModelSettingsError('DEEPSEEK_CAPABILITY_REQUIRED', 'Probe must declare reasoning support before high or max thinking can be enabled.');
      }
      throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'DeepSeek settings are invalid.');
    }
    const profile = profileFromDeepSeekConfig(config, `deepseek-settings-${nextRevision}`, config.updatedAt);
    persistDeepSeekProfile(this.settings, profile);
    deleteDurableProfile(this.settings);
    this.provider.replace(nextProvider);
    this.deepSeekConfig = config;
    this.deepSeekProfile = profile;
    this.deepSeekEnvironment = { provider: nextProvider, config, apiKey: normalized.apiKey };
    this.deepSeekApiKey = normalized.apiKey;
    this.deepSeekCapability = undefined;
    this.deepSeekLastProbe = undefined;
    this.deepSeekRevision = nextRevision;
    this.currentApiKey = normalized.apiKey;
    this.currentModelName = config.model;
    this.revision = nextRevision;
    this.currentStatus = statusFromDeepSeekConfig(config, 'web-memory', true);
    return this.deepSeekStatus();
  }

  clearDeepSeek(): DeepSeekSettingsStatus {
    if (this.currentStatus.source === 'environment' && this.deepSeekEnvironment) return this.deepSeekStatus();
    deleteDeepSeekProfile(this.settings);
    this.deepSeekConfig = undefined;
    this.deepSeekProfile = undefined;
    this.deepSeekCapability = undefined;
    this.deepSeekLastProbe = undefined;
    this.deepSeekApiKey = undefined;
    this.deepSeekEnvironment = undefined;
    if (this.provider.id === 'deepseek') this.provider.replace(createUnconfiguredProvider());
    this.currentStatus = {
      configured: false,
      providerId: 'unconfigured',
      baseUrl: null,
      modelName: null,
      source: 'unconfigured',
      credentialState: 'none',
    };
    this.currentApiKey = undefined;
    this.currentModelName = null;
    return this.deepSeekStatus();
  }

  async probeDeepSeek(input: { timeoutMs?: number } = {}): Promise<DeepSeekProbeResult> {
    const result = await probeDeepSeek({
      ...(this.deepSeekConfig ? { config: this.deepSeekConfig } : { config: defaultDeepSeekConfig() }),
      ...(this.deepSeekApiKey ? { apiKey: this.deepSeekApiKey } : {}),
      ...(this.probeFetchImpl ? { fetchImpl: this.probeFetchImpl as FetchImplementation } : {}),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      now: () => this.clock().toISOString(),
    });
    this.deepSeekLastProbe = result;
    if (result.status === 'ready' && result.capabilities) this.deepSeekCapability = result.capabilities;
    return result;
  }

  configure(input: ModelSettingsInput): ModelSettingsStatus {
    const normalized = validateModelSettingsInput(input);
    const nextRevision = this.revision + 1;
    const profile = createModelSettingsProfile(normalized, nextRevision, this.clock);
    persistDurableProfile(this.settings, profile);
    deleteDeepSeekProfile(this.settings);
    const nextProvider = new OpenAICompatibleProvider({
      id: normalized.provider,
      baseUrl: normalized.baseUrl,
      apiKey: normalized.apiKey,
    });
    this.provider.replace(nextProvider);
    this.currentApiKey = normalized.apiKey;
    this.currentModelName = normalized.model;
    this.deepSeekEnvironment = undefined;
    this.deepSeekConfig = undefined;
    this.deepSeekProfile = undefined;
    this.deepSeekCapability = undefined;
    this.deepSeekLastProbe = undefined;
    this.deepSeekApiKey = undefined;
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
    deleteDeepSeekProfile(this.settings);
    this.provider.replace(createUnconfiguredProvider());
    this.currentApiKey = undefined;
    this.currentModelName = null;
    this.deepSeekEnvironment = undefined;
    this.deepSeekConfig = undefined;
    this.deepSeekProfile = undefined;
    this.deepSeekCapability = undefined;
    this.deepSeekLastProbe = undefined;
    this.deepSeekApiKey = undefined;
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
    if (selection.provider === 'deepseek') {
      return this.bindDeepSeekRun(selection.name.trim());
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

  private bindDeepSeekRun(modelName: string): ModelProviderBinding {
    const environment = this.deepSeekEnvironment;
    if (!environment || !this.currentApiKey || this.provider.id !== 'deepseek') {
      throw new ModelSettingsError('INVALID_PROVIDER', 'The DeepSeek provider is not configured for this daemon.');
    }
    try {
      const capturedAt = this.clock().toISOString();
      const config = DeepSeekConfigSchema.parse({ ...environment.config, model: modelName });
      const provider = this.provider.snapshot();
      const snapshot = ModelProviderSnapshotSchema.parse({
        schemaVersion: 'ready4vibe_model_provider_snapshot_v1',
        providerId: 'deepseek',
        model: modelName,
        pricingModel: modelName,
        descriptorRevision: config.revision,
        endpointPolicy: { kind: 'explicit-url', baseUrl: config.endpoint },
        capabilities: {
          streaming: provider.capabilities.streaming,
          toolCalls: provider.capabilities.toolCalls,
          structuredOutput: provider.capabilities.structuredOutput,
          reasoning: false,
          promptCaching: false,
          audioInput: false,
          audioOutput: false,
        },
        ...(config.authRef ? { authRef: config.authRef } : {}),
        capturedAt,
      });
      const deepSeekSnapshot = DeepSeekRunSnapshotSchema.parse({
        schemaVersion: 'deepseek-provider-run/v1',
        providerId: 'deepseek',
        endpointProfile: config.endpointProfile,
        endpoint: config.endpoint,
        model: modelName,
        thinkingMode: config.thinkingMode,
        toolCalling: config.toolCalling,
        webSearch: config.webSearch,
        reviewer: config.reviewer,
        configRevision: config.revision,
        capabilityRevision: `${DEEPSEEK_CAPABILITY_SCHEMA_VERSION.replace('/v1', '')}-unprobed`,
        capturedAt,
      });
      return { provider, snapshot, deepSeekSnapshot };
    } catch {
      throw new ModelSettingsError('INVALID_MODEL', 'The requested model name is invalid.');
    }
  }
}

export interface DeepSeekSettingsManager {
  deepSeekStatus(): DeepSeekSettingsStatus;
  configureDeepSeek(input: DeepSeekSettingsInput): DeepSeekSettingsStatus;
  clearDeepSeek(): DeepSeekSettingsStatus;
  probeDeepSeek(input?: { timeoutMs?: number }): Promise<DeepSeekProbeResult>;
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

function validateDeepSeekSettingsInput(input: DeepSeekSettingsInput): Omit<DeepSeekSettingsInput, 'apiKey' | 'expectedRevision'> & { apiKey: string; endpoint: string; model: string; timeoutMs: number; maxRetries: number; maxOutputTokens: number } {
  if (!input || typeof input !== 'object') throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'DeepSeek settings are invalid.');
  if (typeof input.apiKey !== 'string' || input.apiKey.length === 0 || input.apiKey.length > 4_096 || /[\r\n]/u.test(input.apiKey)) throw new ModelSettingsError('INVALID_API_KEY', 'The provider key is invalid.');
  if (typeof input.endpoint !== 'string' || input.endpoint.length === 0 || input.endpoint.length > 2_048) throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'A complete HTTPS DeepSeek endpoint is required.');
  if (typeof input.model !== 'string' || input.model.trim().length === 0 || input.model.length > 128 || /[\r\n]/u.test(input.model)) throw new ModelSettingsError('INVALID_MODEL', 'A model name is required.');
  const timeoutMs = input.timeoutMs ?? 30_000;
  const maxRetries = input.maxRetries ?? 2;
  const maxOutputTokens = input.maxOutputTokens ?? 4_096;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120_000) throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'Probe timeout is outside the allowed range.');
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'Retry count is outside the allowed range.');
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 || maxOutputTokens > 1_000_000) throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'Output limit is outside the allowed range.');
  try {
    const parsedEndpoint = new URL(input.endpoint);
    if (parsedEndpoint.protocol !== 'https:' || parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) throw new Error('unsafe');
    const config = DeepSeekConfigSchema.parse({
      schemaVersion: 'deepseek-provider/v1',
      providerId: 'deepseek',
      endpointProfile: input.endpointProfile,
      endpoint: parsedEndpoint.toString().replace(/\/$/u, ''),
      model: input.model.trim(),
      thinkingMode: input.thinkingMode,
      toolCalling: input.toolCalling,
      webSearch: input.webSearch,
      reviewer: input.reviewer,
      timeoutMs,
      maxRetries,
      ...(input.contextLimit === undefined ? {} : { contextLimit: input.contextLimit }),
      maxOutputTokens,
      revision: 'deepseek-settings-input',
      updatedAt: new Date().toISOString(),
    });
    return {
      endpointProfile: config.endpointProfile,
      endpoint: config.endpoint,
      model: config.model,
      apiKey: input.apiKey,
      thinkingMode: config.thinkingMode,
      toolCalling: config.toolCalling,
      webSearch: config.webSearch,
      reviewer: config.reviewer,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      ...(config.contextLimit === undefined ? {} : { contextLimit: config.contextLimit }),
      maxOutputTokens: config.maxOutputTokens,
    };
  } catch (error) {
    if (error instanceof ModelSettingsError) throw error;
    throw new ModelSettingsError('INVALID_DEEPSEEK_CONFIG', 'DeepSeek settings are invalid.');
  }
}

function statusFromEnvironment(env: NodeJS.ProcessEnv, provider: ModelProvider, deepSeekBinding?: DeepSeekEnvironmentBinding): ModelSettingsStatus {
  const apiKey = env.READY4VIBE_MODEL_API_KEY ?? env.READY4VIBE_DEEPSEEK_API_KEY;
  if (!apiKey) return { configured: false, providerId: 'unconfigured', baseUrl: null, modelName: null, source: 'unconfigured', credentialState: 'none' };
  if (env.READY4VIBE_MODEL_PROVIDER === 'deepseek') {
    return {
      configured: deepSeekBinding !== undefined && provider.id === 'deepseek',
      providerId: 'deepseek',
      baseUrl: deepSeekBinding?.config.endpoint ?? null,
      modelName: env.READY4VIBE_MODEL_NAME ?? deepSeekBinding?.config.model ?? null,
      source: 'environment',
      credentialState: deepSeekBinding ? 'available' : 'required',
    };
  }
  let baseUrl: string | null = null;
  try { baseUrl = new URL(env.READY4VIBE_MODEL_BASE_URL ?? 'https://api.deepseek.com').toString().replace(/\/$/u, ''); } catch { /* startup validation is handled by createModelProvider */ }
  return { configured: true, providerId: provider.id, baseUrl, modelName: env.READY4VIBE_MODEL_NAME ?? null, source: 'environment', credentialState: 'available' };
}

interface DeepSeekEnvironmentBinding {
  readonly provider: DeepSeekProvider;
  readonly config: DeepSeekConfig;
  readonly apiKey: string;
}

function readDeepSeekEnvironmentBinding(env: NodeJS.ProcessEnv): DeepSeekEnvironmentBinding | undefined {
  const apiKey = env.READY4VIBE_DEEPSEEK_API_KEY ?? env.READY4VIBE_MODEL_API_KEY;
  if (!apiKey) return undefined;
  try {
    const config = DeepSeekConfigSchema.parse({
      schemaVersion: DEEPSEEK_PROVIDER_SCHEMA_VERSION,
      providerId: 'deepseek',
      endpointProfile: env.READY4VIBE_DEEPSEEK_ENDPOINT_PROFILE ?? 'openai-chat-completions',
      endpoint: env.READY4VIBE_DEEPSEEK_ENDPOINT ?? defaultDeepSeekEndpoint(env.READY4VIBE_DEEPSEEK_ENDPOINT_PROFILE),
      model: env.READY4VIBE_MODEL_NAME ?? 'deepseek-v4-flash',
      authRef: 'secret.deepseek.environment',
      thinkingMode: env.READY4VIBE_DEEPSEEK_THINKING_MODE ?? 'auto',
      toolCalling: env.READY4VIBE_DEEPSEEK_TOOL_CALLING ?? 'enabled',
      webSearch: env.READY4VIBE_DEEPSEEK_WEB_SEARCH ?? 'off',
      reviewer: env.READY4VIBE_DEEPSEEK_REVIEWER ?? 'off',
      timeoutMs: parseBoundedEnvironmentInteger(env.READY4VIBE_DEEPSEEK_TIMEOUT_MS, 30_000, 1, 120_000),
      maxRetries: parseBoundedEnvironmentInteger(env.READY4VIBE_DEEPSEEK_MAX_RETRIES, 2, 0, 5),
      contextLimit: parseOptionalEnvironmentInteger(env.READY4VIBE_DEEPSEEK_CONTEXT_LIMIT, 'unknown', 1, 10_000_000),
      maxOutputTokens: parseBoundedEnvironmentInteger(env.READY4VIBE_DEEPSEEK_MAX_OUTPUT_TOKENS, 4_096, 1, 1_000_000),
      revision: env.READY4VIBE_DEEPSEEK_CONFIG_REVISION ?? 'deepseek-config-environment',
      updatedAt: new Date().toISOString(),
    });
    return {
      provider: new DeepSeekProvider({ config, apiKey }),
      config,
      apiKey,
    };
  } catch {
    return undefined;
  }
}

function defaultDeepSeekEndpoint(profile: string | undefined): string {
  if (profile === 'openai-responses') return 'https://api.deepseek.com/v1/responses';
  if (profile === 'anthropic-messages') return 'https://api.deepseek.com/anthropic/v1/messages';
  return 'https://api.deepseek.com/v1/chat/completions';
}

function parseBoundedEnvironmentInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('invalid DeepSeek numeric environment value');
  return parsed;
}

function parseOptionalEnvironmentInteger(value: string | undefined, fallback: number | 'unknown', minimum: number, maximum: number): number | 'unknown' {
  if (value === undefined) return fallback;
  return parseBoundedEnvironmentInteger(value, typeof fallback === 'number' ? fallback : minimum, minimum, maximum);
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

function statusFromDeepSeekProfile(profile: DeepSeekSettingsProfile): ModelSettingsStatus {
  return statusFromDeepSeekConfig(configFromDeepSeekProfile(profile), 'durable-profile', false);
}

function statusFromDeepSeekConfig(config: DeepSeekConfig, source: ModelSettingsSource, credentialAvailable: boolean): ModelSettingsStatus {
  return {
    configured: credentialAvailable,
    providerId: 'deepseek',
    baseUrl: config.endpoint,
    modelName: config.model,
    source,
    credentialState: credentialAvailable ? 'available' : 'required',
  };
}

function profileFromDeepSeekConfig(config: DeepSeekConfig, profileRevision: string, updatedAt: string): DeepSeekSettingsProfile {
  return DeepSeekSettingsProfileSchema.parse({
    schemaVersion: 'ready4vibe_deepseek_settings_profile_v1',
    providerId: 'deepseek',
    endpointProfile: config.endpointProfile,
    endpoint: config.endpoint,
    model: config.model,
    thinkingMode: config.thinkingMode,
    toolCalling: config.toolCalling,
    webSearch: config.webSearch,
    reviewer: config.reviewer,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    ...(config.contextLimit === undefined ? {} : { contextLimit: config.contextLimit }),
    maxOutputTokens: config.maxOutputTokens,
    profileRevision,
    updatedAt,
  });
}

function configFromDeepSeekProfile(profile: DeepSeekSettingsProfile): DeepSeekConfig {
  return DeepSeekConfigSchema.parse({
    schemaVersion: 'deepseek-provider/v1',
    providerId: 'deepseek',
    endpointProfile: profile.endpointProfile,
    endpoint: profile.endpoint,
    model: profile.model,
    thinkingMode: profile.thinkingMode,
    toolCalling: profile.toolCalling,
    webSearch: profile.webSearch,
    reviewer: profile.reviewer,
    timeoutMs: profile.timeoutMs,
    maxRetries: profile.maxRetries,
    ...(profile.contextLimit === undefined ? {} : { contextLimit: profile.contextLimit }),
    maxOutputTokens: profile.maxOutputTokens,
    revision: profile.profileRevision,
    updatedAt: profile.updatedAt,
  });
}

function loadDeepSeekProfile(settings: SettingsStore | undefined): DeepSeekSettingsProfile | undefined {
  if (!settings) return undefined;
  const value = settings.get<unknown>(DEEPSEEK_SETTINGS_NAMESPACE, DEEPSEEK_SETTINGS_KEY);
  if (value === undefined) return undefined;
  try {
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'outputLimit' in value && !('maxOutputTokens' in value)) {
      const stored = value as Record<string, unknown>;
      const { outputLimit, ...withoutOutputLimit } = stored;
      return DeepSeekSettingsProfileSchema.parse({ ...withoutOutputLimit, maxOutputTokens: outputLimit });
    }
    return DeepSeekSettingsProfileSchema.parse(value);
  } catch {
    throw new ModelSettingsError('CORRUPT_PROFILE', 'Stored DeepSeek settings profile is invalid.');
  }
}

function persistDeepSeekProfile(settings: SettingsStore | undefined, profile: DeepSeekSettingsProfile): void {
  if (!settings) return;
  try {
    const { maxOutputTokens, ...withoutOutputLimit } = profile;
    // The generic settings store rejects token-shaped keys. Keep the durable
    // representation bounded and non-secret while exposing the versioned
    // profile contract at the daemon/Web boundary.
    settings.set(DEEPSEEK_SETTINGS_NAMESPACE, DEEPSEEK_SETTINGS_KEY, { ...withoutOutputLimit, outputLimit: maxOutputTokens });
  } catch {
    throw new ModelSettingsError('PERSISTENCE_FAILED', 'DeepSeek settings profile could not be saved.');
  }
}

function deleteDeepSeekProfile(settings: SettingsStore | undefined): void {
  if (!settings) return;
  settings.delete(DEEPSEEK_SETTINGS_NAMESPACE, DEEPSEEK_SETTINGS_KEY);
}

function defaultDeepSeekConfig(): DeepSeekConfig {
  return DeepSeekConfigSchema.parse({
    schemaVersion: 'deepseek-provider/v1',
    providerId: 'deepseek',
    endpointProfile: 'openai-chat-completions',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
    thinkingMode: 'auto',
    toolCalling: 'enabled',
    webSearch: 'off',
    reviewer: 'off',
    timeoutMs: 30_000,
    maxRetries: 2,
    maxOutputTokens: 4_096,
    revision: 'deepseek-settings-default',
    updatedAt: new Date().toISOString(),
  });
}

function profileRevisionNumber(value: string): number {
  const match = /^(?:settings|deepseek-settings)-(\d+)$/u.exec(value);
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
