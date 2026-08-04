import type { ModelEvent } from '@ready4vibe/contracts';

/**
 * Clean-room translators for the small stream fragments used by the R1
 * fixtures. They accept unknown JSON and emit only canonical, bounded events;
 * provider-specific payloads never escape into the event stream.
 */
export function translateOpenAIResponsesEvent(input: unknown): ModelEvent[] {
  const record = asRecord(input);
  const type = typeof record?.type === 'string' ? record.type : '';
  if (type === 'response.output_text.delta') {
    return textDelta(record?.delta);
  }
  if (type === 'response.function_call_arguments.delta') {
    const callId = stringValue(record?.call_id) ?? stringValue(record?.item_id);
    const argumentsChunk = stringValue(record?.delta);
    if (!callId || argumentsChunk === undefined) return [schemaError('MODEL_RESPONSES_TOOL_SCHEMA')];
    const name = stringValue(record?.name);
    return [{ type: 'tool-call-delta', callId, ...(name ? { name } : {}), argumentsChunk }];
  }
  if (type === 'response.completed') {
    const response = asRecord(record?.response);
    const usage = asRecord(response?.usage);
    const events: ModelEvent[] = [];
    if (typeof usage?.input_tokens === 'number' || typeof usage?.output_tokens === 'number') {
      events.push({
        type: 'usage',
        ...(typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
        ...(typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
      });
    }
    events.push({ type: 'completed', finishReason: mapFinishReason(stringValue(response?.status) ?? 'completed') });
    return events;
  }
  if (type === 'response.failed') return [schemaError('MODEL_RESPONSES_FAILED', true)];
  return [];
}

export function translateAnthropicEvent(input: unknown): ModelEvent[] {
  const record = asRecord(input);
  const type = typeof record?.type === 'string' ? record.type : '';
  if (type === 'content_block_start') {
    const block = asRecord(record?.content_block);
    if (block?.type === 'tool_use') {
      const blockIndex = typeof record?.index === 'number' ? record.index : undefined;
      const callId = blockIndex === undefined ? stringValue(block.id) : `tool_call_${blockIndex}`;
      const name = stringValue(block.name);
      if (!callId || !name) return [schemaError('MODEL_ANTHROPIC_TOOL_SCHEMA')];
      return [{ type: 'tool-call-delta', callId, name, argumentsChunk: '' }];
    }
    return [];
  }
  if (type === 'content_block_delta') {
    const delta = asRecord(record?.delta);
    if (delta?.type === 'text_delta') return textDelta(delta.text);
    if (delta?.type === 'input_json_delta') {
      const callId = stringValue(record?.index) ?? 'tool_call_0';
      const argumentsChunk = stringValue(delta.partial_json);
      return argumentsChunk === undefined ? [schemaError('MODEL_ANTHROPIC_TOOL_SCHEMA')] : [{ type: 'tool-call-delta', callId, argumentsChunk }];
    }
    return [];
  }
  if (type === 'message_start') {
    const message = asRecord(record?.message);
    const usage = asRecord(message?.usage);
    if (typeof usage?.input_tokens !== 'number') return [];
    return [{ type: 'usage', inputTokens: usage.input_tokens }];
  }
  if (type === 'message_delta') {
    const delta = asRecord(record?.delta);
    const usage = asRecord(record?.usage);
    const events: ModelEvent[] = [];
    if (typeof usage?.output_tokens === 'number') events.push({ type: 'usage', outputTokens: usage.output_tokens });
    if (delta?.stop_reason) events.push({ type: 'completed', finishReason: mapFinishReason(stringValue(delta.stop_reason) ?? 'stop') });
    return events;
  }
  if (type === 'message_stop') return [{ type: 'completed', finishReason: 'stop' }];
  if (type === 'error') return [schemaError('MODEL_ANTHROPIC_ERROR', true)];
  return [];
}

function textDelta(value: unknown): ModelEvent[] {
  return typeof value === 'string' ? [{ type: 'text-delta', text: value }] : [schemaError('MODEL_TEXT_SCHEMA')];
}

function schemaError(code: string, retryable = false): ModelEvent {
  return { type: 'error', code, retryable, safeMessage: 'The model provider returned an unsupported event.' };
}

function mapFinishReason(reason: string): 'stop' | 'tool-calls' | 'length' | 'content-filter' {
  if (reason === 'tool_calls' || reason === 'tool_use') return 'tool-calls';
  if (reason === 'length' || reason === 'max_tokens') return 'length';
  if (reason === 'content_filter' || reason === 'refusal') return 'content-filter';
  return 'stop';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
