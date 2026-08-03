import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalBrokerError, InMemoryApprovalBroker, type ApprovalRequest } from './approval.js';

const request = (overrides: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  approvalId: 'ap_test_1',
  runId: 'run_test',
  turnId: 'turn_test',
  callId: 'call_test',
  toolId: 'filesystem.write',
  toolVersion: '1.0.0',
  risk: 'write',
  argumentBytes: 24,
  createdAt: Date.now(),
  expiresAt: Date.now() + 10_000,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InMemoryApprovalBroker', () => {
  it('waits for one decision and exposes only safe pending metadata', async () => {
    const broker = new InMemoryApprovalBroker();
    const pending = request();
    const decision = broker.waitForDecision(pending);
    expect(broker.pending('run_test')).toEqual([pending]);
    expect(Object.isFrozen(broker.pending('run_test'))).toBe(true);
    expect(broker.decide(pending.approvalId, 'allow', pending.runId)).toBe('accepted');
    await expect(decision).resolves.toBe('allow');
    expect(broker.decide(pending.approvalId, 'deny', pending.runId)).toBe('already-decided');
    expect(broker.pending()).toEqual([]);
  });

  it('expires bounded requests and rejects later decisions', async () => {
    vi.useFakeTimers();
    const broker = new InMemoryApprovalBroker({ timeoutMs: 100 });
    const pending = request({ expiresAt: Date.now() + 100 });
    const decision = broker.waitForDecision(pending);
    vi.advanceTimersByTime(101);
    await expect(decision).resolves.toBe('expired');
    expect(broker.decide(pending.approvalId, 'allow', pending.runId)).toBe('expired');
  });

  it('cancels waits and bounds pending capacity', async () => {
    const broker = new InMemoryApprovalBroker({ maxPending: 1 });
    const controller = new AbortController();
    const first = broker.waitForDecision(request(), controller.signal);
    await expect(broker.waitForDecision(request({ approvalId: 'ap_test_2' }))).rejects.toMatchObject({ code: 'CAPACITY' });
    controller.abort();
    await expect(first).rejects.toEqual(new ApprovalBrokerError('CANCELLED', 'Approval wait was cancelled.'));
    expect(broker.pending()).toEqual([]);
    expect(broker.decide('ap_test_1', 'allow', 'run_test')).toBe('already-decided');
  });
});
