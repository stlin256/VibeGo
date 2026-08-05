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
path, full snapshot or event payload. A user-authorized live request is still
required for dedicated-provider evidence; a healthy adapter result is not
release or capacity evidence.
