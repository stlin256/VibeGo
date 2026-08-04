/**
 * Public MemoryCore v3 envelope fixtures used by adapter compatibility tests.
 * They intentionally contain no credentials, transcript, paths, or upstream
 * implementation details beyond the documented health/search/write shapes.
 */
export const MEMORY_CORE_V3_FIXTURES = {
  health: {
    status: 'ok',
    version: 'a'.repeat(40),
  },
  search: {
    code: 0,
    message: 'ok',
    request_id: 'request_fixture_1',
    data: {
      items: [{ id: 'memory_fixture_1', type: 'fact', content: 'Use the bounded test workflow.', score: 0.8 }],
    },
  },
  conversationAdd: {
    code: 0,
    message: 'ok',
    request_id: 'request_fixture_2',
    data: { accepted_ids: ['message_fixture_1'] },
  },
} as const;
