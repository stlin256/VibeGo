import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApprovalReviewSmokeArgs, runApprovalReviewSmoke } from './smoke-approval-review.mjs';

const endpoint = 'https://provider.example/v1/chat/completions';

function fakeProvider(output = (request) => JSON.stringify({
  schemaVersion: 'llm-approval/v1',
  reviewId: request.metadata.requestId,
  decision: 'ask-user',
  reasonCode: 'eligible',
  explanation: 'Bounded smoke decision.',
  approvalKeyFingerprint: request.messages[1].content.match(/"approvalKeyFingerprint":"([a-f0-9]{64})"/u)?.[1] ?? 'a'.repeat(64),
})) {
  return {
    id: 'deepseek',
    capabilities: { streaming: true, toolCalls: false, structuredOutput: false },
    async *stream(request) {
      yield { type: 'usage', inputTokens: 42, outputTokens: 9 };
      yield { type: 'text-delta', text: output(request) };
      yield { type: 'completed', finishReason: 'stop' };
    },
  };
}

test('approval-review smoke requires explicit authorization and a secret reference', async () => {
  assert.throws(() => parseApprovalReviewSmokeArgs(['--endpoint', endpoint, '--secret-env', 'VIBEGO_TEST_KEY']), /authorize/iu);
  const options = parseApprovalReviewSmokeArgs(['--authorize', '--endpoint', endpoint, '--secret-env', 'VIBEGO_TEST_KEY']);
  const blocked = await runApprovalReviewSmoke(options, { secretValue: () => undefined });
  assert.deepEqual(blocked, { schemaVersion: 'llm-approval-smoke/v1', provider: 'deepseek', model: 'deepseek-v4-flash', status: 'blocked', decision: null, reasonCode: 'APPROVAL_REVIEW_SECRET_MISSING', latencyMs: 0, usage: { inputTokens: null, outputTokens: null } });
});

test('approval-review smoke emits only bounded decision, latency and aggregate usage', async () => {
  const options = parseApprovalReviewSmokeArgs(['--authorize', '--endpoint', endpoint, '--secret-env', 'VIBEGO_TEST_KEY']);
  const result = await runApprovalReviewSmoke(options, { secretValue: () => 'runtime-secret', provider: fakeProvider() });
  assert.equal(result.status, 'healthy');
  assert.equal(result.decision, 'ask-user');
  assert.equal(result.reasonCode, 'eligible');
  assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 9 });
  assert.doesNotMatch(JSON.stringify(result), /runtime-secret|prompt|transcript|command|C:\\Users|provider\.example/iu);
});

test('approval-review smoke maps provider failure and mismatched output to bounded unavailable', async () => {
  const options = parseApprovalReviewSmokeArgs(['--authorize', '--endpoint', endpoint, '--secret-env', 'VIBEGO_TEST_KEY']);
  const failed = await runApprovalReviewSmoke(options, { secretValue: () => 'runtime-secret', provider: { ...fakeProvider(), async *stream() { yield { type: 'error', code: 'MODEL_HTTP_503', retryable: true, safeMessage: 'provider unavailable' }; } } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.decision, 'unavailable');
  assert.equal(failed.reasonCode, 'provider-unavailable');
  const mismatch = await runApprovalReviewSmoke(options, { secretValue: () => 'runtime-secret', provider: fakeProvider((request) => JSON.stringify({ schemaVersion: 'llm-approval/v1', reviewId: 'other-review', decision: 'allow', reasonCode: 'eligible', explanation: 'x', approvalKeyFingerprint: 'a'.repeat(64) })) });
  assert.equal(mismatch.reasonCode, 'fingerprint-mismatch');
});
