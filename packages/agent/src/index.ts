import { v7 as uuidv7 } from 'uuid';
import { ContextBudgetError, ContextManager, type ContextItem } from '@ready4vibe/context';
import {
  assertTransition,
  parseRunConfig,
  type EventStore,
  type ModelEvent,
  type ModelProvider,
  type ModelRequest,
  type RunConfig,
  type RunStatus,
  type SchedulerLease,
  type SchedulerRequest,
} from '@ready4vibe/contracts';
import { Scheduler, SchedulerCancelledError } from '@ready4vibe/scheduler';

export interface AgentRunRequest {
  config: RunConfig;
  runId?: string;
  priority?: SchedulerRequest['priority'];
  signal?: AbortSignal;
  contextItems?: readonly ContextItem[];
}

export interface AgentRunResult {
  runId: string;
  status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>;
  output: string;
  lastSeq: number;
}

export interface AgentLoopOptions {
  eventStore: EventStore;
  scheduler: Scheduler;
  modelProvider: ModelProvider;
  toolRuntime?: ToolRuntime;
}

export type AgentToolRisk = 'read' | 'write' | 'destructive' | 'network';

/** Public, model-facing metadata. Implementations must not expose handlers or secrets. */
export interface AgentToolDescriptor {
  readonly name: string;
  readonly id: string;
  readonly version: string;
  readonly risk: AgentToolRisk;
  readonly summary: string;
  readonly inputSchema?: Record<string, unknown>;
}

export interface ToolRuntimeRequest {
  readonly runId: string;
  readonly turnId: string;
  readonly callId: string;
  readonly descriptor: AgentToolDescriptor;
  readonly input: unknown;
  readonly config: RunConfig;
  readonly signal: AbortSignal;
}

export interface ToolRuntimeResult {
  readonly output: unknown;
}

export interface ToolRuntime {
  readonly descriptors: readonly AgentToolDescriptor[];
  execute(request: ToolRuntimeRequest): Promise<ToolRuntimeResult>;
}

export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const config = parseRunConfig(request.config);
    const runId = request.runId ?? `run_${uuidv7()}`;
    const correlationId = `corr_${uuidv7()}`;
    let status: RunStatus = 'created';
    let output = '';
    let lease: SchedulerLease | undefined;
    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort();
      this.options.scheduler.cancelQueued(runId);
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    if (request.signal?.aborted) onAbort();

    const transition = async (next: RunStatus, reason?: string): Promise<void> => {
      assertTransition(status, next);
      await this.append(runId, 'run.status', 'orchestrator', correlationId, {
        from: status,
        to: next,
        ...(reason ? { reason } : {}),
      });
      status = next;
    };

    const result = (finalStatus: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>): AgentRunResult => ({
      runId,
      status: finalStatus,
      output,
      lastSeq: this.options.eventStore.lastSeq(runId),
    });

    const cancel = async (reason: string): Promise<AgentRunResult> => {
      if (status !== 'cancelling') await transition('cancelling', reason);
      await transition('cancelled', reason);
      await this.append(runId, 'run.cancelled', 'orchestrator', correlationId, { reason });
      return result('cancelled');
    };

    const fail = async (code: string, safeMessage: string, retryable: boolean): Promise<AgentRunResult> => {
      await transition('failed', code);
      await this.append(runId, 'run.failed', 'orchestrator', correlationId, { code, safeMessage, retryable });
      return result('failed');
    };

    try {
      await this.append(runId, 'run.created', 'user', correlationId, { config });
      let contextResult: ReturnType<ContextManager['build']>;
      try {
        const context = new ContextManager(config.limits.maxContextBytes, [
          ...(request.contextItems ?? []),
          {
            id: `${runId}:user-message`,
            source: 'user',
            trust: 'trusted',
            role: 'user',
            content: config.userMessage,
          },
        ]);
        contextResult = context.build();
      } catch (error) {
        if (error instanceof ContextBudgetError) {
          return await fail('CONTEXT_BUDGET_EXCEEDED', 'The context exceeds the configured budget.', false);
        }
        throw error;
      }
      if (contextResult.compacted) {
        await this.append(runId, 'context.compacted', 'orchestrator', correlationId, {
          droppedCount: contextResult.droppedCount,
          droppedItemIds: contextResult.droppedItemIds,
          bytes: contextResult.bytes,
        });
      }
      await transition('queued');
      if (controller.signal.aborted) return await cancel('user-cancelled-while-queued');

      const schedulerRequest = this.toSchedulerRequest(runId, config, request.priority);
      try {
        lease = await this.options.scheduler.acquire(schedulerRequest);
      } catch (error) {
        if (controller.signal.aborted || error instanceof SchedulerCancelledError) {
          return await cancel('user-cancelled-while-queued');
        }
        return await fail('SCHEDULER_REJECTED', 'The run could not be scheduled.', false);
      }

      if (controller.signal.aborted) return await cancel('user-cancelled-before-start');
      await transition('planning');
      const messages: unknown[] = [...contextResult.messages];
      const toolRuntime = this.options.toolRuntime;
      const modelTools = this.options.modelProvider.capabilities.toolCalls && toolRuntime
        ? toolRuntime.descriptors.map(toModelTool)
        : [];
      let turnIndex = 0;
      let toolCallCount = 0;

      while (turnIndex < config.limits.maxTurns) {
        if (controller.signal.aborted) return await cancel('user-cancelled-before-model');
        turnIndex += 1;
        const turnId = `turn_${uuidv7()}`;
        await this.append(runId, 'turn.started', 'orchestrator', turnId, { turnId, index: turnIndex });
        await transition('executing');

        const modelRequest: ModelRequest = {
          model: config.model.name,
          messages,
          tools: modelTools,
          budget: {
            maxInputTokens: config.limits.maxModelInputTokens,
            maxOutputTokens: config.limits.maxModelOutputTokens,
          },
          metadata: { runId, turnId, requestId: `req_${uuidv7()}` },
        };
        await this.append(runId, 'model.requested', 'orchestrator', turnId, {
          turnId,
          model: config.model.name,
          toolCount: modelTools.length,
        });

        let completed = false;
        let finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' | undefined;
        let turnText = '';
        const calls = new Map<string, PendingToolCall>();
        try {
          for await (const event of this.options.modelProvider.stream(modelRequest, controller.signal)) {
            if (controller.signal.aborted) return await cancel('user-cancelled-during-model');
            if (event.type === 'text-delta') {
              const nextOutput = output + event.text;
              if (Buffer.byteLength(nextOutput) > config.limits.maxOutputBytes) {
                await this.append(runId, 'model.error', 'policy', turnId, {
                  code: 'OUTPUT_LIMIT_EXCEEDED',
                  retryable: false,
                  safeMessage: 'The model output exceeded the configured limit.',
                });
                controller.abort();
                return await fail('OUTPUT_LIMIT_EXCEEDED', 'The model output exceeded the configured limit.', false);
              }
              output = nextOutput;
              turnText += event.text;
              await this.append(runId, 'model.delta', 'model', turnId, { turnId, kind: 'text', text: event.text });
            } else if (event.type === 'tool-call-delta') {
              const previous = calls.get(event.callId);
              const nextCall: PendingToolCall = {
                callId: event.callId,
                argumentsText: (previous?.argumentsText ?? '') + event.argumentsChunk,
              };
              const nextName = event.name ?? previous?.name;
              if (nextName) nextCall.name = nextName;
              calls.set(event.callId, nextCall);
              await this.append(runId, 'model.delta', 'model', turnId, {
                turnId,
                kind: 'tool-call',
                callId: event.callId,
                ...(event.name ? { name: event.name } : {}),
                argumentsChunk: event.argumentsChunk,
              });
            } else if (event.type === 'usage') {
              await this.append(runId, 'model.usage', 'model', turnId, {
                turnId,
                ...(event.inputTokens === undefined ? {} : { inputTokens: event.inputTokens }),
                ...(event.outputTokens === undefined ? {} : { outputTokens: event.outputTokens }),
              });
            } else if (event.type === 'completed') {
              finishReason = event.finishReason;
              await this.append(runId, 'model.completed', 'model', turnId, { turnId, finishReason: event.finishReason });
              completed = true;
              break;
            } else {
              await this.append(runId, 'model.error', 'model', turnId, event);
              controller.abort();
              return await fail(event.code, event.safeMessage, event.retryable);
            }
          }
        } catch {
          if (controller.signal.aborted) return await cancel('user-cancelled-during-model');
          await this.append(runId, 'model.error', 'model', turnId, {
            code: 'MODEL_PROVIDER_ERROR',
            retryable: true,
            safeMessage: 'The model provider failed while streaming.',
          });
          return await fail('MODEL_PROVIDER_ERROR', 'The model provider failed while streaming.', true);
        }

        if (controller.signal.aborted) return await cancel('user-cancelled-during-model');
        if (!completed) return await fail('MODEL_STREAM_ENDED', 'The model stream ended unexpectedly.', true);
        if (calls.size === 0) {
          await this.append(runId, 'turn.completed', 'orchestrator', turnId, { turnId, outputBytes: Buffer.byteLength(output) });
          await transition('completed');
          await this.append(runId, 'run.completed', 'orchestrator', correlationId, {
            summary: output,
            exitReason: finishReason === 'tool-calls' ? 'tool-calls-without-call' : 'model-completed',
          });
          return result('completed');
        }

        if (!toolRuntime || !this.options.modelProvider.capabilities.toolCalls) {
          controller.abort();
          return await fail('TOOLS_UNAVAILABLE', 'Tool calls are not enabled for this run.', false);
        }
        if (toolCallCount + calls.size > config.limits.maxToolCalls) {
          controller.abort();
          return await fail('MAX_TOOL_CALLS_EXCEEDED', 'The run exceeded its tool-call limit.', false);
        }

        const toolResults: Array<{ call: PendingToolCall; descriptor: AgentToolDescriptor; content: string }> = [];
        for (const call of calls.values()) {
          const toolResult = await this.executeToolCall(runId, turnId, call, config, controller.signal);
          if (toolResult.failure) {
            controller.abort();
            return await fail(toolResult.failure.code, toolResult.failure.message, false);
          }
          toolCallCount += 1;
          toolResults.push({ call, descriptor: toolResult.descriptor, content: toolResult.content });
        }

        messages.push({
          role: 'assistant',
          ...(turnText ? { content: turnText } : { content: null }),
          tool_calls: toolResults.map(({ call, descriptor }) => ({
            id: call.callId,
            type: 'function',
            function: { name: descriptor.name, arguments: call.argumentsText.trim() || '{}' },
          })),
        });
        for (const { call, content } of toolResults) {
          messages.push({ role: 'tool', tool_call_id: call.callId, content });
        }
        await this.append(runId, 'turn.completed', 'orchestrator', turnId, {
          turnId,
          outputBytes: Buffer.byteLength(output),
          toolCallCount: calls.size,
        });
        if (turnIndex >= config.limits.maxTurns) {
          return await fail('MAX_TURNS_EXCEEDED', 'The run exceeded its turn limit.', false);
        }
        await transition('planning');
      }

      return await fail('MAX_TURNS_EXCEEDED', 'The run exceeded its turn limit.', false);
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      lease?.release();
    }
  }

  private toSchedulerRequest(runId: string, config: RunConfig, priority: SchedulerRequest['priority']): SchedulerRequest {
    return {
      runId,
      workspaceId: config.workspaceId,
      workspaceAccess: config.sandbox.mode === 'read-only' ? 'read' : 'write',
      ...(priority ? { priority } : {}),
      resources: {
        modelCalls: 1,
        ...(this.options.toolRuntime ? { toolProcesses: 1 } : {}),
        externalSandboxes: config.sandbox.mode === 'external-sandbox' ? 1 : 0,
      },
    };
  }

  private async executeToolCall(
    runId: string,
    turnId: string,
    call: PendingToolCall,
    config: RunConfig,
    signal: AbortSignal,
  ): Promise<{ descriptor: AgentToolDescriptor; content: string; failure?: undefined } | { failure: { code: string; message: string } }> {
    const runtime = this.options.toolRuntime;
    if (!runtime) return { failure: { code: 'TOOLS_UNAVAILABLE', message: 'Tool calls are not enabled for this run.' } };
    const descriptor = runtime.descriptors.find((entry) => entry.name === call.name || entry.id === call.name);
    await this.append(runId, 'tool.requested', 'orchestrator', turnId, {
      callId: call.callId,
      ...(descriptor ? { toolId: descriptor.id, toolVersion: descriptor.version, risk: descriptor.risk } : { toolName: call.name ?? 'unknown' }),
      argumentBytes: Buffer.byteLength(call.argumentsText),
    });
    if (!descriptor) {
      await this.append(runId, 'tool.completed', 'tool', turnId, { callId: call.callId, success: false, code: 'TOOL_UNKNOWN' });
      return { failure: { code: 'TOOL_UNKNOWN', message: 'The requested tool is not available.' } };
    }

    let input: unknown;
    try {
      input = JSON.parse(call.argumentsText.trim() || '{}');
    } catch {
      await this.append(runId, 'tool.completed', 'tool', turnId, { callId: call.callId, toolId: descriptor.id, toolVersion: descriptor.version, success: false, code: 'TOOL_INPUT_INVALID' });
      return { failure: { code: 'TOOL_INPUT_INVALID', message: 'The tool arguments were not valid JSON.' } };
    }

    await this.append(runId, 'tool.started', 'tool', turnId, {
      callId: call.callId,
      toolId: descriptor.id,
      toolVersion: descriptor.version,
      risk: descriptor.risk,
    });
    try {
      const result = await runtime.execute({ runId, turnId, callId: call.callId, descriptor, input, config, signal });
      const serialized = serializeToolOutput(result.output, config.limits.maxOutputBytes);
      await this.append(runId, 'tool.output', 'tool', turnId, {
        callId: call.callId,
        content: serialized.content,
        bytes: serialized.bytes,
        truncated: serialized.truncated,
      });
      await this.append(runId, 'tool.completed', 'tool', turnId, {
        callId: call.callId,
        toolId: descriptor.id,
        toolVersion: descriptor.version,
        success: true,
        bytes: serialized.bytes,
        truncated: serialized.truncated,
      });
      return { descriptor, content: serialized.content };
    } catch (error) {
      const failure = safeToolFailure(error);
      if (failure.code === 'APPROVAL_REQUIRED') {
        await this.append(runId, 'approval.required', 'policy', turnId, {
          approvalId: `ap_${uuidv7()}`,
          callId: call.callId,
          toolId: descriptor.id,
          toolVersion: descriptor.version,
          reasonCode: failure.code,
        });
      }
      await this.append(runId, 'tool.completed', 'tool', turnId, {
        callId: call.callId,
        toolId: descriptor.id,
        toolVersion: descriptor.version,
        success: false,
        code: failure.code,
      });
      return { failure };
    }
  }

  private append<TPayload>(
    runId: string,
    type: string,
    source: 'user' | 'orchestrator' | 'model' | 'tool' | 'policy' | 'sandbox' | 'system',
    correlationId: string,
    payload: TPayload,
  ): Promise<unknown> {
    return this.options.eventStore.append({ runId, type, source, correlationId, payload });
  }
}

interface PendingToolCall {
  callId: string;
  name?: string;
  argumentsText: string;
}

function toModelTool(descriptor: AgentToolDescriptor): unknown {
  return {
    type: 'function',
    function: {
      name: descriptor.name,
      description: descriptor.summary,
      parameters: descriptor.inputSchema ?? { type: 'object' },
    },
  };
}

function serializeToolOutput(value: unknown, maximumBytes: number): { content: string; bytes: number; truncated: boolean } {
  const serialized = safeJsonStringify(value);
  const bytes = Buffer.byteLength(serialized);
  if (bytes <= maximumBytes) return { content: serialized, bytes, truncated: false };
  const content = new TextDecoder().decode(new TextEncoder().encode(serialized).slice(0, maximumBytes));
  return { content, bytes: Buffer.byteLength(content), truncated: true };
}

function safeJsonStringify(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    return result === undefined ? 'null' : result;
  } catch {
    return '"[unserializable tool output]"';
  }
}

function safeToolFailure(error: unknown): { code: string; message: string } {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : 'TOOL_FAILED';
  const messages: Record<string, string> = {
    APPROVAL_REQUIRED: 'User approval is required for this tool.',
    TOOL_FORBIDDEN: 'The tool request is forbidden.',
    SANDBOX_UNAVAILABLE: 'The requested sandbox is unavailable.',
    TOOL_EXECUTION_UNAVAILABLE: 'The tool execution provider is unavailable.',
    TOOL_HANDLER_UNAVAILABLE: 'The tool implementation is unavailable.',
    TOOL_INPUT_INVALID: 'The tool arguments were invalid.',
  };
  return { code, message: messages[code] ?? 'The tool request failed safely.' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
