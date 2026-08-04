import { describe, expect, it } from 'vitest';
import { replayModelEvents } from './runtime.js';
import { translateAnthropicEvent, translateOpenAIResponsesEvent } from './protocol.js';

describe('provider protocol fixtures', () => {
  it('normalizes OpenAI Responses text, function arguments, usage and completion', () => {
    const events = [
      ...translateOpenAIResponsesEvent({ type: 'response.output_text.delta', delta: 'hello' }),
      ...translateOpenAIResponsesEvent({ type: 'response.function_call_arguments.delta', call_id: 'call-1', name: 'echo', delta: '{"value":1}' }),
      ...translateOpenAIResponsesEvent({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 4, output_tokens: 2 } } }),
    ];
    expect(replayModelEvents(events)).toMatchObject({ text: 'hello', toolCalls: [{ callId: 'call-1', name: 'echo' }], usage: { inputTokens: 4, outputTokens: 2 }, finishReason: 'stop' });
  });

  it('normalizes Anthropic-shaped content blocks and never exposes malformed payloads', () => {
    const events = [
      ...translateAnthropicEvent({ type: 'message_start', message: { usage: { input_tokens: 7 } } }),
      ...translateAnthropicEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } }),
      ...translateAnthropicEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call-2', name: 'echo' } }),
      ...translateAnthropicEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
      ...translateAnthropicEvent({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 3 } }),
      ...translateAnthropicEvent({ type: 'message_stop' }),
    ];
    expect(replayModelEvents(events)).toMatchObject({ text: 'hi', toolCalls: [{ callId: 'tool_call_0', name: 'echo', arguments: '{}' }], finishReason: 'tool-calls' });
    expect(translateAnthropicEvent({ type: 'content_block_delta', delta: { type: 'text_delta' } })[0]).toMatchObject({ type: 'error', code: 'MODEL_TEXT_SCHEMA' });
  });
});
