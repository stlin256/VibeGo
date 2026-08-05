import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemorySettingsStore, SqliteSettingsStore } from '@ready4vibe/storage';
import { ApprovalReviewSettingsError, ApprovalReviewSettingsManager } from './approval-review-settings.js';

describe('ApprovalReviewSettingsManager', () => {
  it('initializes disabled and persists only non-secret reviewer intent', () => {
    const settings = new InMemorySettingsStore();
    const manager = new ApprovalReviewSettingsManager({ settings, policyRevision: () => 'policy-1' });
    expect(manager.status()).toMatchObject({ enabled: false, reviewerSource: 'same-as-run', posture: 'off', status: 'disabled' });
    const persisted = settings.get<Record<string, unknown>>('llm-approval', 'v1');
    expect(JSON.stringify(persisted)).not.toMatch(/api[_-]?key|token|secret|C:\\private/iu);
  });

  it('enables same-as-run with a bounded default posture and fences stale revisions', () => {
    let now = new Date('2026-08-05T00:00:00.000Z');
    const manager = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), clock: () => now, policyRevision: () => 'policy-1' });
    const enabled = manager.patch({ enabled: true });
    expect(enabled).toMatchObject({ enabled: true, reviewerSource: 'same-as-run', posture: 'advisory-low-risk', status: 'ready', policyRevision: 'policy-1' });
    expect(() => manager.patch({ enabled: false, expectedRevision: 'reviewer-1' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    now = new Date('2026-08-05T00:00:01.000Z');
    const disabled = manager.patch({ enabled: false, expectedRevision: enabled.reviewerRevision });
    expect(disabled).toMatchObject({ enabled: false, posture: 'off', status: 'disabled' });
  });

  it('blocks dedicated mode without a profile and degrades it without provider coupling', async () => {
    let calls = 0;
    const manager = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => 'policy-1' });
    expect(() => manager.patch({ enabled: true, reviewerSource: 'dedicated' })).toThrowError(ApprovalReviewSettingsError);
    const configured = manager.patch({ enabled: true, reviewerSource: 'dedicated', dedicatedProfileId: 'profile-reviewer' });
    expect(configured).toMatchObject({ enabled: true, reviewerSource: 'dedicated', dedicatedProfileId: 'profile-reviewer', status: 'degraded', lastErrorCode: 'provider-unavailable' });
    const probed = await manager.probe();
    expect(probed.status).toBe('degraded');
    expect(calls).toBe(0);
  });

  it('marks a policy revision mismatch blocked until an explicit patch refreshes it', () => {
    let policy = 'policy-1';
    const manager = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore(), policyRevision: () => policy });
    manager.patch({ enabled: true });
    policy = 'policy-2';
    expect(manager.status()).toMatchObject({ status: 'blocked', lastErrorCode: 'revision-stale' });
    const refreshed = manager.patch({ enabled: true, expectedRevision: manager.settingsSnapshot().reviewerRevision });
    expect(refreshed).toMatchObject({ status: 'ready', policyRevision: 'policy-2' });
  });

  it('restores non-secret settings through SQLite without storing credentials or endpoints', () => {
    const path = join(tmpdir(), `ready4vibe-approval-review-${randomUUID()}.sqlite`);
    const firstStore = new SqliteSettingsStore(path);
    const first = new ApprovalReviewSettingsManager({ settings: firstStore, policyRevision: () => 'policy-1' });
    first.patch({ enabled: true, maxLatencyMs: 2_000 });
    firstStore.close();
    const reopenedStore = new SqliteSettingsStore(path);
    const reopened = new ApprovalReviewSettingsManager({ settings: reopenedStore, policyRevision: () => 'policy-1' });
    expect(reopened.settingsSnapshot()).toMatchObject({ enabled: true, limits: { maxLatencyMs: 2_000 } });
    expect(JSON.stringify(reopened.settingsSnapshot())).not.toMatch(/https?:\/\/|api[_-]?key|secret|token/iu);
    reopenedStore.close();
    rmSync(path, { force: true });
    rmSync(`${path}-wal`, { force: true });
    rmSync(`${path}-shm`, { force: true });
  });

  it('fails closed on secret/path/unknown patch fields', () => {
    const manager = new ApprovalReviewSettingsManager({ settings: new InMemorySettingsStore() });
    expect(() => manager.patch({ apiKey: 'sk-' + 'a'.repeat(24) })).toThrowError(ApprovalReviewSettingsError);
    expect(() => manager.patch({ dedicatedProfileId: 'C:\\private\\reviewer' })).toThrowError(ApprovalReviewSettingsError);
    expect(() => manager.patch({ endpoint: 'https://example.test' })).toThrowError(ApprovalReviewSettingsError);
  });
});
