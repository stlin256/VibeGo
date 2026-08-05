import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalReviewDecisionRecordSchema,
  type ApprovalReviewDecisionRecord,
  type ApprovalReviewRequest,
  type ApprovalReviewerSnapshot,
  type ModelEvent,
  DEFAULT_SCHEDULER_POLICY,
} from '@ready4vibe/contracts';
import { InMemoryApprovalReviewEventStore, InMemoryEventStore } from '@ready4vibe/storage';
import { Scheduler } from '@ready4vibe/scheduler';
import type { ApprovalReviewer } from '@ready4vibe/agent';
import type { ApprovalReviewBinding } from '@ready4vibe/agent';
import { RunManager } from './run-manager.js';

const config = {
  workspaceId: 'workspace-1',
  userMessage: 'save a file',
  model: { provider: 'fake', name: 'deterministic' },
  taskTrust: 'trusted-workspace' as const,
  sandbox: { mode: 'read-only' as const, network: 'restricted' as const },
  approval: 'on-request' as const,
  limits: { maxTurns: 2, maxWallTimeMs: 60_000, maxModelInputTokens: 100, maxModelOutputTokens: 100, maxToolCalls: 10, maxOutputBytes: 1_000, maxContextBytes: 100_000 },
  createdBySessionId: 'session-1',
  clientRequestId: 'client-approval-review',
};

class SequenceProvider {
  readonly id = 'fake';
  readonly capabilities = { streaming: true, toolCalls: true, structuredOutput: true } as const;
  readonly requests: unknown[] = [];
  private index = 0;
  constructor(private readonly scripts: readonly (readonly ModelEvent[])[]) {}
  async *stream(request: unknown): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    for (const event of this.scripts[Math.min(this.index++, this.scripts.length - 1)] ?? []) yield event;
  }
}

const snapshot = (): ApprovalReviewerSnapshot => ({
  schemaVersion: 'llm-approval/v1',
  reviewerSource: 'same-as-run',
  dedicatedProfileId: null,
  providerId: 'fake',
  modelId: 'deterministic',
  descriptorRevision: 'descriptor-1',
  policyRevision: 'policy-1',
  reviewerRevision: 'reviewer-1',
  posture: 'bounded-auto-low-risk',
  limits: { maxLatencyMs: 1_000, maxRequestBytes: 16_384, maxResponseBytes: 8_192, cacheTtlMs: 0 },
  status: 'ready',
  capturedAt: '2026-08-05T00:00:00.000Z',
});

class AllowReviewer implements ApprovalReviewer {
  readonly snapshot = snapshot();
  readonly requests: ApprovalReviewRequest[] = [];
  async review(request: ApprovalReviewRequest): Promise<ApprovalReviewDecisionRecord> {
    this.requests.push(request);
    return ApprovalReviewDecisionRecordSchema.parse({
      schemaVersion: 'llm-approval/v1',
      reviewId: request.reviewId,
      decision: 'allow',
      reasonCode: 'eligible',
      explanation: 'Exact bounded key is eligible.',
      reviewerRevision: request.reviewerRevision,
      policyRevision: request.policyRevision,
      latencyMs: 0,
      expiresAt: request.deadlineAt,
      approvalKeyFingerprint: request.approvalKeyFingerprint,
      reviewedAt: '2026-08-05T00:00:00.000Z',
    });
  }
}

function binding(reviewer: AllowReviewer): ApprovalReviewBinding {
  return {
    reviewer,
    snapshot: reviewer.snapshot,
    context: {
      workspaceId: 'workspace-1',
      taskTrust: 'trusted-workspace',
      permission: { profileId: 'workspace-coding', profileRevision: 'profile-1', status: 'ready', approvalPosture: 'bounded-auto', effectiveScope: 'run' },
      sandbox: { mode: 'read-only', provider: null, status: 'ready', network: 'restricted' },
      network: 'restricted',
      policyRevision: 'policy-1',
      reviewerRevision: 'reviewer-1',
    },
  };
}

describe('RunManager ApprovalReviewBroker application seam', () => {
  it('auto-resolves only through the normal delegate approval events', async () => {
    const provider = new SequenceProvider([
      [
        { type: 'tool-call-delta', callId: 'read-call', name: 'read', argumentsChunk: '{}' },
        { type: 'completed', finishReason: 'tool-calls' },
      ],
      [
        { type: 'text-delta', text: 'saved' },
        { type: 'completed', finishReason: 'stop' },
      ],
    ]);
    let approved = false;
    const runtime = {
      descriptors: [{ name: 'read', id: 'filesystem.read', version: '1.0.0', risk: 'read' as const, summary: 'Read' }],
      execute: vi.fn(async () => {
        if (!approved) throw Object.assign(new Error('approval required'), { code: 'APPROVAL_REQUIRED' });
        return { output: 'ok' };
      }),
      approve: vi.fn(async () => { approved = true; }),
    };
    const reviewer = new AllowReviewer();
    const eventStore = new InMemoryEventStore();
    const reviewEventStore = new InMemoryApprovalReviewEventStore();
    const manager = new RunManager({
      eventStore,
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: provider,
      toolRuntime: runtime,
      approvalReviewForRun: () => binding(reviewer),
      approvalReviewEventStore: reviewEventStore,
    });
    const started = await manager.start(config);
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());
    expect(manager.completion(started.runId)).toMatchObject({ status: 'completed', output: 'saved' });
    expect(reviewer.requests).toHaveLength(1);
    expect(await manager.snapshot(started.runId)).toMatchObject({ approvalReviewerSnapshot: { reviewerRevision: 'reviewer-1', posture: 'bounded-auto-low-risk' } });
    expect(runtime.approve).toHaveBeenCalledOnce();
    const events = await eventStore.read(started.runId);
    expect(events.map((event) => event.type)).toContain('approval.required');
    expect(events.map((event) => event.type)).toContain('approval.decided');
    await vi.waitFor(async () => expect((await reviewEventStore.read(started.runId)).map((event) => event.eventType)).toEqual(['review.requested', 'review.completed']));
    const projectedEvents = await eventStore.read(started.runId);
    expect(projectedEvents.map((event) => event.type)).toContain('review.requested');
    expect(projectedEvents.map((event) => event.type)).toContain('review.completed');
    expect(manager.approvalBroker.pending(started.runId)).toEqual([]);
    reviewEventStore.close();
  });

  it('keeps the old interactive path when the application binding factory fails', async () => {
    const provider = new SequenceProvider([[{ type: 'completed', finishReason: 'stop' }]]);
    const manager = new RunManager({
      eventStore: new InMemoryEventStore(),
      scheduler: new Scheduler(DEFAULT_SCHEDULER_POLICY),
      modelProvider: provider,
      approvalReviewForRun: () => { throw new Error('reviewer unavailable'); },
    });
    const started = await manager.start({ ...config, userMessage: 'say hello', clientRequestId: 'client-no-review' });
    await vi.waitFor(() => expect(manager.completion(started.runId)).toBeDefined());
    expect(manager.completion(started.runId)).toMatchObject({ status: 'completed', output: '' });
  });
});
