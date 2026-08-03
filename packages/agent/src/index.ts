import { v7 as uuidv7 } from 'uuid';
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
      const turnId = `turn_${uuidv7()}`;
      await this.append(runId, 'turn.started', 'orchestrator', turnId, { turnId, index: 1 });
      await transition('executing');

      const modelRequest: ModelRequest = {
        model: config.model.name,
        messages: [{ role: 'user', content: config.userMessage }],
        tools: [],
        budget: {
          maxInputTokens: config.limits.maxModelInputTokens,
          maxOutputTokens: config.limits.maxModelOutputTokens,
        },
        metadata: { runId, turnId, requestId: `req_${uuidv7()}` },
      };
      await this.append(runId, 'model.requested', 'orchestrator', turnId, {
        turnId,
        model: config.model.name,
        toolCount: 0,
      });

      let completed = false;
      try {
        for await (const event of this.options.modelProvider.stream(modelRequest, controller.signal)) {
          if (controller.signal.aborted) return await cancel('user-cancelled-during-model');
          const handled = await this.handleModelEvent(runId, turnId, correlationId, event, output, config);
          output = handled.output;
          if (handled.failure) {
            controller.abort();
            return await fail(handled.failure.code, handled.failure.message, false);
          }
          if (handled.completed) {
            completed = true;
            break;
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
      await this.append(runId, 'turn.completed', 'orchestrator', turnId, { turnId, outputBytes: Buffer.byteLength(output) });
      await transition('completed');
      await this.append(runId, 'run.completed', 'orchestrator', correlationId, {
        summary: output,
        exitReason: 'model-completed',
      });
      return result('completed');
    } finally {
      request.signal?.removeEventListener('abort', onAbort);
      lease?.release();
    }
  }

  private async handleModelEvent(
    runId: string,
    turnId: string,
    correlationId: string,
    event: ModelEvent,
    currentOutput: string,
    config: RunConfig,
  ): Promise<{ output: string; completed: boolean; failure?: { code: string; message: string } }> {
    if (event.type === 'text-delta') {
      const output = currentOutput + event.text;
      if (Buffer.byteLength(output) > config.limits.maxOutputBytes) {
        await this.append(runId, 'model.error', 'policy', turnId, {
          code: 'OUTPUT_LIMIT_EXCEEDED',
          retryable: false,
          safeMessage: 'The model output exceeded the configured limit.',
        });
        return { output: currentOutput, completed: false, failure: { code: 'OUTPUT_LIMIT_EXCEEDED', message: 'The model output exceeded the configured limit.' } };
      }
      await this.append(runId, 'model.delta', 'model', turnId, { turnId, kind: 'text', text: event.text });
      return { output, completed: false };
    }
    if (event.type === 'tool-call-delta') {
      await this.append(runId, 'model.delta', 'model', turnId, {
        turnId,
        kind: 'tool-call',
        callId: event.callId,
        ...(event.name ? { name: event.name } : {}),
        argumentsChunk: event.argumentsChunk,
      });
      return {
        output: currentOutput,
        completed: false,
        failure: { code: 'TOOLS_UNAVAILABLE', message: 'Tool calls are not enabled in the fake-model loop.' },
      };
    }
    if (event.type === 'usage') {
      await this.append(runId, 'model.usage', 'model', turnId, {
        turnId,
        ...(event.inputTokens === undefined ? {} : { inputTokens: event.inputTokens }),
        ...(event.outputTokens === undefined ? {} : { outputTokens: event.outputTokens }),
      });
      return { output: currentOutput, completed: false };
    }
    if (event.type === 'completed') {
      await this.append(runId, 'model.completed', 'model', turnId, { turnId, finishReason: event.finishReason });
      return { output: currentOutput, completed: true };
    }
    await this.append(runId, 'model.error', 'model', turnId, event);
    return { output: currentOutput, completed: false, failure: { code: event.code, message: event.safeMessage } };
  }

  private toSchedulerRequest(runId: string, config: RunConfig, priority: SchedulerRequest['priority']): SchedulerRequest {
    return {
      runId,
      workspaceId: config.workspaceId,
      workspaceAccess: config.sandbox.mode === 'read-only' ? 'read' : 'write',
      ...(priority ? { priority } : {}),
      resources: {
        modelCalls: 1,
        externalSandboxes: config.sandbox.mode === 'external-sandbox' ? 1 : 0,
      },
    };
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
