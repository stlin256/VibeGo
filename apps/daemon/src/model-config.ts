import type { ModelEvent, ModelProvider } from '@ready4vibe/contracts';
import { OpenAICompatibleProvider } from '@ready4vibe/model-openai';

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
