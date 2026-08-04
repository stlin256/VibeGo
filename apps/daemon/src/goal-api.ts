import type { GoalProjection, GoalTodo, StoredGoalEvent } from '@ready4vibe/contracts';
import { GoalProjectionBuilder, type GoalEventStore } from '@ready4vibe/goal-control';

export const GOAL_API_SCHEMA_VERSION = 'ready4vibe_goal_api_v0' as const;
export const DEFAULT_GOAL_EVENT_PAGE_SIZE = 500;
export const MAX_GOAL_EVENT_PAGE_SIZE = 1_000;

/**
 * Read-only store capabilities required by the daemon projection API.
 * The API deliberately does not depend on append, claim, or any execution
 * runtime. The injected implementation may be SQLite or an in-memory test
 * double, while the canonical event stream remains goal-local.
 */
export interface GoalProjectionStore extends Pick<GoalEventStore, 'read' | 'lastSequence'> {
  listGoalIds(): readonly string[];
}

export type SafeGoalTodo = Omit<GoalTodo, 'claimTokenHash'>;
export type SafeGoalProjection = Omit<GoalProjection, 'todos'> & { todos: SafeGoalTodo[] };
export type SafeGoalEvent = Omit<StoredGoalEvent<Record<string, unknown>>, 'payload'> & {
  payload: Record<string, unknown>;
};

export interface GoalProjectionListResponse {
  readonly schemaVersion: typeof GOAL_API_SCHEMA_VERSION;
  readonly goals: readonly SafeGoalProjection[];
}

export interface GoalEventReplayResponse {
  readonly schemaVersion: typeof GOAL_API_SCHEMA_VERSION;
  readonly goalId: string;
  readonly afterSequence: number;
  readonly nextAfter: number;
  readonly lastAppendSequence: number;
  readonly hasMore: boolean;
  readonly events: readonly SafeGoalEvent[];
}

export async function listGoalProjections(
  store: GoalProjectionStore,
  builder = new GoalProjectionBuilder(),
): Promise<GoalProjectionListResponse> {
  const goals: SafeGoalProjection[] = [];
  for (const goalId of [...store.listGoalIds()].sort((left, right) => left.localeCompare(right))) {
    const projection = await readGoalProjection(store, goalId, builder);
    if (projection) goals.push(projection);
  }
  return { schemaVersion: GOAL_API_SCHEMA_VERSION, goals };
}

export async function readGoalProjection(
  store: GoalProjectionStore,
  goalId: string,
  builder = new GoalProjectionBuilder(),
): Promise<SafeGoalProjection | undefined> {
  if (!store.listGoalIds().includes(goalId)) return undefined;
  const events = await store.read(goalId);
  if (events.length === 0) return undefined;
  return redactGoalProjection(builder.build(events));
}

export async function readGoalEventPage(
  store: GoalProjectionStore,
  goalId: string,
  afterSequence: number,
  limit: number,
): Promise<GoalEventReplayResponse | undefined> {
  if (!store.listGoalIds().includes(goalId)) return undefined;
  const lastAppendSequence = store.lastSequence(goalId);
  const events = await store.read(goalId, afterSequence);
  const page = events.slice(0, limit).map((event) => redactEvent(event));
  const nextAfter = page.at(-1)?.appendSequence ?? afterSequence;
  return {
    schemaVersion: GOAL_API_SCHEMA_VERSION,
    goalId,
    afterSequence,
    nextAfter,
    lastAppendSequence,
    hasMore: nextAfter < lastAppendSequence,
    events: page,
  };
}

export function redactGoalProjection(projection: GoalProjection): SafeGoalProjection {
  return {
    ...projection,
    todos: projection.todos.map(({ claimTokenHash: _claimTokenHash, ...todo }) => todo),
  };
}

function redactEvent(event: StoredGoalEvent): SafeGoalEvent {
  const { payload, ...metadata } = event;
  return {
    ...metadata,
    payload: redactClaimHashes(payload) as Record<string, unknown>,
  };
}

/**
 * The contracts permit a claim hash internally so that optimistic release can
 * be verified. It is still an implementation secret at the HTTP boundary.
 * Contract validation has already rejected API keys, tokens, paths and other
 * secret-shaped fields before this function runs; recurse defensively for
 * nested future payloads without mutating the stored event.
 */
function redactClaimHashes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactClaimHashes(entry));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'claimTokenHash')
      .map(([key, child]) => [key, redactClaimHashes(child)]),
  );
}
