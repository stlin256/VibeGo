# Spec 63-10 dedicated reviewer live smoke evidence

- Date: 2026-08-06
- Status: planned implementation checkpoint
- Scope: explicit profile resolver plus `DedicatedApprovalReviewer` adapter

The offline runner is implemented as `scripts/smoke-dedicated-reviewer.mjs` and
the fixture passes 4/4 via
`node --test scripts/smoke-dedicated-reviewer.test.mjs`. It configures one
explicit in-memory profile, resolves the daemon-owned binding and invokes the
dedicated adapter without creating a run/event/listener/tool runtime. Fixture
cases cover authorization/credential blocking, bounded healthy output,
provider/malformed/resolver failures and secret-shaped input.

The fixture report contains only bounded provider/model/profile labels, status,
decision/reason code, latency and aggregate usage. It contains no key, secret
environment name, endpoint, prompt, raw response, headers, approval arguments,
path, full snapshot or event payload. A user-authorized live request is
recorded below for dedicated-provider evidence; a healthy adapter result is not
release or capacity evidence.

## Authorized live adapter evidence

- Checkout: `408c68b`
- Result: `status=healthy`, `decision=allow`, `reasonCode=eligible`
- Bounded latency: `3413 ms`
- Aggregate usage: `inputTokens=541`, `outputTokens=306`

The request used an explicit dedicated profile and a process-only credential
reference. It exercised only profile resolution and
`DedicatedApprovalReviewer`; it did not create a daemon listener, run, event,
ApprovalBroker grant or tool call. The credential, secret reference name,
endpoint, prompt, raw response and headers were not recorded.
