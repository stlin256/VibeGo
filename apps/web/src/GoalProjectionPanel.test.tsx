import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GoalProjectionListResponse, SafeGoalProjection } from './api.js';
import { GoalProjectionPanel } from './GoalProjectionPanel.js';

const at = '2026-08-03T00:00:00.000Z';

function projection(todoCount = 1): GoalProjectionListResponse {
  const goal: SafeGoalProjection = {
    projectionVersion: 'goal_control_projection_v0',
    goal: {
      goalId: 'goal_12345678',
      title: 'Remote Vibe Coding',
      objective: 'Keep the long-running project moving safely.',
      workspaceId: 'default',
      status: 'active',
      controlRevision: 2,
      createdAt: at,
      updatedAt: at,
      schemaVersion: 1,
    },
    todos: Array.from({ length: todoCount }, (_, index) => ({
      todoId: `todo_${String(index).padStart(8, '0')}`,
      goalId: 'goal_12345678',
      role: 'agent' as const,
      status: index === 0 ? 'done' as const : 'open' as const,
      taskClass: 'advancement' as const,
      title: `Todo ${index}`,
      priority: 1,
    })),
    gates: [{ gateId: 'gate_12345678', goalId: 'goal_12345678', kind: 'owner_review', status: 'open', question: 'Review the current diff.', blocking: true, openedAt: at }],
    evidence: [{ evidenceId: 'evidence_12345678', goalId: 'goal_12345678', kind: 'validation', summary: 'Tests passed.', status: 'validated', refs: {}, recordedAt: at }],
    handoffs: [],
    quota: { spentTurnKeys: ['turn_goal:1'], totalSpent: 1 },
    lastEventId: 'gevt_12345678',
    lastAppendSequence: 4,
    sourceEventCount: 4,
    sourceChecksum: 'a'.repeat(64),
    controlRevision: 2,
  };
  return { schemaVersion: 'ready4vibe_goal_api_v0', goals: [goal] };
}

describe('GoalProjectionPanel', () => {
  it('renders loading, unavailable and empty states without write controls', () => {
    const loading = renderToStaticMarkup(<GoalProjectionPanel loading onRefresh={() => undefined} />);
    expect(loading).toContain('data-state="loading"');
    expect(loading).toContain('Loading goal projection');

    const unavailable = renderToStaticMarkup(<GoalProjectionPanel unavailable onRefresh={() => undefined} />);
    expect(unavailable).toContain('data-state="unavailable"');
    expect(unavailable).toContain('Interactive runs remain available');

    const empty = renderToStaticMarkup(<GoalProjectionPanel projection={{ schemaVersion: 'ready4vibe_goal_api_v0', goals: [] }} onRefresh={() => undefined} />);
    expect(empty).toContain('data-state="empty"');
    expect(empty).toContain('No long-term goals yet');
    expect(empty).not.toContain('Create goal');
    expect(empty).not.toContain('Claim');
  });

  it('renders bounded safe text and summaries without secrets, paths or claim hashes', () => {
    const base = projection(14);
    const original = base.goals[0]!;
    const maliciousTodo = { ...original.todos[0]!, title: '<img src=x onerror=alert(1)>', claimTokenHash: 'a'.repeat(64) };
    const maliciousGoal = { ...original, goal: { ...original.goal!, title: 'C:\\Users\\private\\project', objective: 'apiKey=sk-test-secret-1234567890' }, todos: [maliciousTodo, ...original.todos.slice(1)] as never } as never;
    const value = { ...base, goals: [maliciousGoal] as never };
    const html = renderToStaticMarkup(<GoalProjectionPanel projection={value} onRefresh={() => undefined} />);
    expect(html).toContain('data-state="ready"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('C:\\Users\\private');
    expect(html).not.toContain('sk-test-secret');
    expect(html).not.toContain('claimTokenHash');
    expect(html.match(/class="goal-item-main"/gu)?.length).toBe(14);
    expect(html).toContain('+2 more Todo items');
    expect(html).toContain('checksum');
  });

  it('disables refresh while a request is in flight', () => {
    const html = renderToStaticMarkup(<GoalProjectionPanel projection={projection()} refreshing onRefresh={() => undefined} />);
    expect(html).toContain('disabled=""');
    expect(html).toContain('Refreshing…');
  });
});
