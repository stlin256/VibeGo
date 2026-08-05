import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDedicatedReviewerSmokeArgs, runDedicatedReviewerSmoke } from './smoke-dedicated-reviewer.mjs';

const endpoint = 'https://provider.example/v1/chat/completions';

function fakeFetch({ status = 200, body = 'data: {"choices":[{"delta":{"content":"{\\"schemaVersion\\":\\"llm-approval/v1\\",\\"reviewId\\":\\"review_dedicated_smoke\\",\\"decision\\":\\"ask-user\\",\\"reasonCode\\":\\"eligible\\",\\"explanation\\":\\"bounded\\",\\"approvalKeyFingerprint\\":\\"FINGERPRINT\\"}"},"finish_reason":null}],"usage":{"prompt_tokens":12,"completion_tokens":5}}\n\ndata: [DONE]\n\n' } = {}) {
  return async (_input, init) => {
    const request = JSON.parse(init?.body ?? '{}');
    const fingerprint = request.messages?.[1]?.content?.match(/"approvalKeyFingerprint":"([a-f0-9]{64})"/u)?.[1] ?? 'a'.repeat(64);
    const rendered = body.replace('FINGERPRINT', fingerprint);
    return new Response(rendered, { status, headers: { 'content-type': 'text/event-stream' } });
  };
}

test('dedicated reviewer smoke requires explicit authorization and secret reference', async () => {
  assert.throws(() => parseDedicatedReviewerSmokeArgs(['--secret-env', 'VIBEGO_TEST_KEY']), /authorize/iu);
  const options = parseDedicatedReviewerSmokeArgs(['--authorize', '--endpoint', endpoint, '--secret-env', 'VIBEGO_TEST_KEY']);
  const blocked = await runDedicatedReviewerSmoke(options, { secretValue: () => undefined });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasonCode, 'DEDICATED_REVIEWER_SECRET_MISSING');
  assert.doesNotMatch(JSON.stringify(blocked), /VIBEGO_TEST_KEY|provider\.example|runtime-secret/iu);
});

test('dedicated smoke resolves the explicit profile and emits bounded aggregate evidence', async () => {
  const options = parseDedicatedReviewerSmokeArgs(['--authorize', '--endpoint', endpoint, '--profile-id', 'reviewer_fixture', '--secret-env', 'VIBEGO_TEST_KEY']);
  const result = await runDedicatedReviewerSmoke(options, { secretValue: () => 'runtime-secret', fetchImpl: fakeFetch() });
  assert.equal(result.status, 'healthy');
  assert.equal(result.decision, 'ask-user');
  assert.equal(result.reasonCode, 'eligible');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 5 });
  assert.deepEqual(Object.keys(result).sort(), ['decision', 'latencyMs', 'model', 'profile', 'provider', 'reasonCode', 'schemaVersion', 'status', 'usage']);
  assert.doesNotMatch(JSON.stringify(result), /runtime-secret|provider\.example|prompt|transcript|command|VIBEGO_TEST_KEY/iu);
});

test('dedicated smoke maps provider, malformed response and resolver failures to bounded outcomes', async () => {
  const options = parseDedicatedReviewerSmokeArgs(['--authorize', '--endpoint', endpoint, '--secret-env', 'VIBEGO_TEST_KEY']);
  const failed = await runDedicatedReviewerSmoke(options, { secretValue: () => 'runtime-secret', fetchImpl: fakeFetch({ status: 503, body: '' }) });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.decision, 'unavailable');
  const malformed = await runDedicatedReviewerSmoke(options, { secretValue: () => 'runtime-secret', fetchImpl: fakeFetch({ body: 'data: not-json\n\n' }) });
  assert.equal(malformed.reasonCode, 'malformed-response');
  const unavailable = await runDedicatedReviewerSmoke(options, { secretValue: () => 'runtime-secret', profileManager: { resolve: () => undefined } });
  assert.equal(unavailable.reasonCode, 'DEDICATED_REVIEWER_PROFILE_UNAVAILABLE');
});

test('dedicated smoke rejects secret-shaped profile/model input', () => {
  assert.throws(() => parseDedicatedReviewerSmokeArgs(['--authorize', '--profile-id', 'api_key', '--secret-env', 'VIBEGO_TEST_KEY']), /profile-id/iu);
  assert.throws(() => parseDedicatedReviewerSmokeArgs(['--authorize', '--model', 'sk-secret', '--secret-env', 'VIBEGO_TEST_KEY']), /model/iu);
});
