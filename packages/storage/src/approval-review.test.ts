import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ApprovalReviewEventDraft, ApprovalReviewEventStore } from '@ready4vibe/contracts';
import { SqliteEventStore } from './index.js';
import {
  ApprovalReviewEventConflictError,
  InMemoryApprovalReviewEventStore,
  SqliteApprovalReviewEventStore,
  SqliteApprovalReviewEventStoreError,
} from './approval-review.js';

const at = '2026-08-05T00:00:00.000Z';
const fingerprint = 'b'.repeat(64);

function draft(eventId = 'reviewevt_1', overrides: Partial<ApprovalReviewEventDraft> = {}): ApprovalReviewEventDraft {
  return {
    schemaVersion: 'llm-approval/v1',
    eventId,
    idempotencyKey: `${eventId}:requested`,
    eventType: 'review.requested',
    reviewId: 'review_1',
    runId: 'run_12345678',
    turnId: 'turn_1',
    correlationId: 'call_1',
    approvalKeyFingerprint: fingerprint,
    reviewerRevision: 'reviewer-1',
    policyRevision: 'policy-1',
    decision: null,
    reasonCode: 'eligible',
    latencyMs: null,
    expiresAt: null,
    at,
    ...overrides,
  };
}

function databasePath(): string {
  return join(tmpdir(), `ready4vibe-review-${randomUUID()}.sqlite`);
}

function cleanup(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-wal`, { force: true });
  rmSync(`${path}-shm`, { force: true });
}

async function assertStore(factory: () => ApprovalReviewEventStore): Promise<void> {
  const store = factory();
  const first = await store.append(draft());
  expect(first.appendSequence).toBe(1);
  const repeated = await store.append(draft());
  expect(repeated).toEqual(first);
  await expect(store.append(draft('reviewevt_1', { reasonCode: 'policy-ask' }))).rejects.toBeInstanceOf(ApprovalReviewEventConflictError);
  await expect(store.append(draft('reviewevt_2', { idempotencyKey: draft().idempotencyKey, reasonCode: 'policy-ask' }))).rejects.toBeInstanceOf(ApprovalReviewEventConflictError);
  const completed = draft('reviewevt_2', {
    idempotencyKey: 'review_1:completed',
    eventType: 'review.completed',
    decision: 'allow',
    reasonCode: 'eligible',
    latencyMs: 42,
    expiresAt: '2026-08-05T00:00:02.000Z',
  });
  const batch = await store.appendBatch([completed, completed]);
  expect(batch.map((event) => event.appendSequence)).toEqual([2, 2]);
  expect((await store.read('run_12345678')).map((event) => event.appendSequence)).toEqual([1, 2]);
  expect((await store.read('run_12345678', 1, 1)).map((event) => event.eventId)).toEqual(['reviewevt_2']);
  store.close();
}

describe('ApprovalReviewEventStore', () => {
  it('provides bounded in-memory idempotency and append ordering', async () => {
    await assertStore(() => new InMemoryApprovalReviewEventStore());
  });

  it('persists an independent reviewer table across restart without touching run_events', async () => {
    const path = databasePath();
    const runStore = new SqliteEventStore(path);
    await runStore.append({ runId: 'run_12345678', type: 'run.created', source: 'system', correlationId: 'corr_1', payload: { ok: true } });
    const first = new SqliteApprovalReviewEventStore(path);
    await first.append(draft());
    const inspection = new DatabaseSync(path);
    const tables = inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toContain('approval_review_events');
    inspection.close();
    expect((await runStore.read('run_12345678')).length).toBe(1);
    first.close();
    runStore.close();

    const reopened = new SqliteApprovalReviewEventStore(path);
    expect((await reopened.read('run_12345678')).map((event) => event.appendSequence)).toEqual([1]);
    reopened.close();
    cleanup(path);
  });

  it('serializes concurrent SQLite writers and keeps appendBatch atomic', async () => {
    const path = databasePath();
    const first = new SqliteApprovalReviewEventStore(path);
    const second = new SqliteApprovalReviewEventStore(path);
    const results = await Promise.all([
      first.append(draft('reviewevt_1')),
      second.append(draft('reviewevt_2', { idempotencyKey: 'review_2:requested', reviewId: 'review_2', correlationId: 'call_2' })),
    ]);
    expect(results.map((event) => event.appendSequence).sort()).toEqual([1, 2]);
    await expect(first.appendBatch([
      draft('reviewevt_3', { idempotencyKey: 'review_3:requested', reviewId: 'review_3' }),
      draft('reviewevt_1', { reasonCode: 'policy-ask' }),
    ])).rejects.toBeInstanceOf(ApprovalReviewEventConflictError);
    expect((await first.read('run_12345678')).map((event) => event.appendSequence)).toEqual([1, 2]);
    first.close();
    second.close();
    cleanup(path);
  });

  it('rejects invalid cursors, bounded limits and closed operations', async () => {
    const store = new SqliteApprovalReviewEventStore(':memory:');
    await expect(store.read('run_12345678', -1)).rejects.toBeInstanceOf(SqliteApprovalReviewEventStoreError);
    await expect(store.read('run_12345678', 0, 0)).rejects.toBeInstanceOf(SqliteApprovalReviewEventStoreError);
    store.close();
    await expect(store.read('run_12345678')).rejects.toThrow('closed');
  });
});
