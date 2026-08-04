# Spec 48: Approval, sandbox and shell runtime closure

- Status: 48-R2 implementation complete (host-restricted runner slice); R3 pending
- Date: 2026-08-04
- Related: [harness contracts](../harness-contracts.md), [Spec 01](01-sandbox-approval.md), [Spec 10](10-sandbox-execution.md), [Spec 18](18-tool-wiring.md), [Spec 30](30-external-shell-sandbox-wiring.md), [upstream harness research](../research/upstream-harness-implementations.md)

## Goal

Complete the real execution closure for untrusted coding tasks while keeping
Codex-like approval ergonomics: low-risk repeated work can proceed under a
bounded, visible grant; dangerous or ambiguous work pauses for a clear user
decision; every execution is still constrained by Scheduler, WorkspaceRegistry,
Sandbox and audit policy. The implementation must be useful on Windows first
and retain adapters for macOS/Linux.

## Current baseline and gap

- Path, argv, approval and external Docker/Podman planning contracts exist and
  have unit tests.
- Filesystem and external shell adapters are explicitly gated and default off.
- The repository has not yet completed a repeatable real-container/host-process
  smoke matrix or the full untrusted-task approval loop.
- `host-restricted` must remain a path/environment restriction, not a claim of
  kernel isolation.

## Research gate (48-R0)

Read the Codex permission, approval, sandbox and execpolicy files pinned in
`docs/research/upstream-harness-implementations.md`, plus OpenHands' sandbox
warning. Record semantic differences only; do not copy Rust policy code,
prompts, profile names or UI. Re-run the license check before any reuse.

## Safety model

### Compiled policy, not prompt intent

At run start the application compiles a policy from:

- selected workspace id and server-side root;
- sandbox strength and immutable resource limits;
- network mode (`none`, restricted allowlist, or explicitly approved);
- tool risk/capability metadata;
- project trust and user/session grants;
- Scheduler concurrency and workspace read/write lease.

The compiled policy is attached to a run/tool snapshot. Model text cannot
weaken it. A client request can only choose a stricter mode; the server may
upgrade `allow` to `ask` or `deny`, never the reverse.

### Approval ergonomics

Automatic approval is allowed only for a bounded low-risk class whose exact
approval key includes tool name/version, workspace id, normalized arguments
fingerprint, sandbox/network mode and policy revision. The grant has a short
expiry, a maximum use count and a visible reason. It is not a blanket shell
permission. The UI shows the effective sandbox and network constraints before
the action runs.

The default untrusted-task profile is fail-closed for shell, network, writes
outside the workspace, privilege changes, secret access and unknown tools. A
user may create a session grant from the authenticated Web surface; grant and
revoke events contain only safe metadata and hashes.

### Process and filesystem boundary

- commands are argv arrays; a shell string is rejected unless a platform
  adapter explicitly declares why it is needed;
- cwd, path, environment, stdin, stdout/stderr, timeout, file count and output
  bytes are bounded server-side;
- paths are normalized, resolved against the workspace allowlist and checked
  again after symlink resolution;
- environment inheritance is an explicit allowlist; daemon secrets are never
  inherited by default;
- writes use temporary files and atomic rename; patch results carry before/after
  hashes and bounded diff metadata;
- cancellation terminates the process tree on Windows, macOS and Linux;
- no command, environment value, absolute path or raw tool output enters an
  event, audit projection or browser response.

### External sandbox

Docker/Podman or a future VM adapter must be selected explicitly, image
digests must be pinned, and the runner must probe the engine before accepting a
run. Network is disabled by default, and resource limits are applied by the
engine and re-checked in the runner. Image pulls, host fallback, privileged
containers and host mounts outside the selected workspace are separate
explicit decisions and are not part of the MVP.

## Implementation phases

### 48-R1: policy compiler and approval matrix

Write table-driven tests for risk classes, exact approval keys, project trust,
network amendments, grant expiry/use count, stale policy revisions and unknown
tool/schema. Implement a pure compiler that returns `allow | ask | deny`, safe
reason codes, effective sandbox/network and audit metadata.

Exit: no runtime or HTTP wiring changes; all policy decisions are deterministic
and fail closed.

#### R1 contract slice (2026-08-04)

The first implementation slice adds a pure compiler in `@ready4vibe/policy`.
It accepts a server-resolved tool descriptor and a precomputed argument
fingerprint; it never receives or stores raw tool arguments, paths, commands,
environment values, or secrets. The compiler returns `allow | ask | deny`, a
stable safe reason code, effective sandbox/network metadata, and bounded audit
metadata. A request can only become stricter than the server policy.

Session grants are keyed by tool id/version, workspace id, normalized argument
fingerprint, sandbox/provider, network mode, task trust, and policy revision.
They carry a short expiry, a bounded use count, and a visible reason. A stale
revision, exhausted/expired grant, unknown tool, missing schema, unsupported
sandbox, untrusted host execution, network mismatch, or privilege-like risk
fails closed. This slice does not change `AgentLoop`, `RunManager`, HTTP,
`run_events`, `goal_events`, Scheduler, Sandbox, or WorkspaceRegistry wiring.

### 48-R2: host-restricted process runner

Complete the injected platform process adapter with bounded argv/cwd/env,
output, timeout and process-tree cancellation. Add Windows fixtures for `.cmd`,
PowerShell and process-tree termination without executing arbitrary user data in
the test process. Keep host-restricted clearly labeled in contracts and UI.

Exit: platform tests cover path traversal, symlinks, command injection,
environment leakage, timeout, cancellation, output truncation and restart.

#### R2 contract slice (2026-08-04)

The host-restricted runner is an opt-in adapter in
`@ready4vibe/sandbox-runtime`. It accepts only an argv array, an absolute
server-resolved workspace root/cwd, an explicit environment allowlist and
bounded timeout/output limits. It resolves both workspace and cwd through an
injected `realpath` port, rejects root/escape/symlink cases, always spawns with
`shell:false`, and exposes only capped stdout/stderr and exit metadata. `.cmd`
and PowerShell invocations remain argv fixtures; no shell string is accepted.

Process-tree termination is an injected platform port. The Windows adapter may
use `taskkill /T /F` behind that port; tests use a fake terminator and never
execute arbitrary user data. The runner is not registered by the daemon or
`AgentLoop` in R2, so the existing explicit tool/sandbox gates and default-off
behavior remain unchanged.

### 48-R3: container/Podman smoke runner

Add an opt-in integration command that uses a locally installed, digest-pinned
engine. It must probe, start a bounded container, execute a harmless fixture,
capture redacted status and dispose deterministically. The command is never
part of unit CI or daemon startup and never pulls an image implicitly.

#### R3 contract and implementation (2026-08-04)

The command is `pnpm smoke:container -- --runtime <docker|podman> --image
<name@sha256:digest> [--workspace <absolute-root>]`. The image is required to
be an immutable digest; the workspace defaults to the current directory only
after the CLI resolves it to an absolute server-side path. The command accepts
no user-provided container command. It runs the fixed harmless fixture
`sh -c "printf ready4vibe-smoke"` with `network=restricted`, an empty writable
root set, `--pull=never`, `--rm`, `--init`, bounded pids/memory/CPU/timeout and
output limits. `shell:false` is used for both the engine probe and container
launch.

The probe invokes only `<runtime> version` with a minimal environment and
bounded output. The result is a versioned, redacted report containing runtime,
digest, status (`healthy|unavailable|failed|cancelled`), exit/timing flags and
stable error codes; raw engine/container output, environment values and paths
are never emitted. Missing engines are `unavailable`; invalid digests,
network/resource violations, timeout, cancellation, fixture mismatch and
cleanup failures are fail-closed `failed`/`cancelled` outcomes.

The implementation exposes injected probe/spawn/executor ports so unit tests
can cover healthy engine, missing engine, wrong digest, network/resource
violations, timeout, cancellation and deterministic cleanup without starting a
real engine. A real smoke is explicitly invoked by the user and is excluded
from `pnpm verify` and daemon startup.

The contract is implemented by `ContainerSmokeRunner`,
`ContainerCliRuntimeProbe` and `scripts/smoke-container.mjs`. The runner keeps
raw probe/container output out of `ContainerSmokeReport`, maps unavailable,
timeout, cancellation, fixture mismatch and cleanup failures to stable codes,
and reuses the existing `ContainerCliRunner`/`ExternalSandboxExecutor` ports.
Focused tests cover 30 `sandbox-runtime` cases plus the CLI parser/exit mapping;
no test starts a real engine or arbitrary host command.

Exit: healthy engine, missing engine, wrong digest, port/network violation,
resource limit, timeout, cancellation and cleanup are reproducible.

### 48-R4: AgentLoop and Web approval continuation

Connect the existing `approval.required` event to the broker and Web card. A
decision is single-use and versioned; duplicate approve/deny is a no-op or
conflict. Approval resumption re-enters the same run only at the explicit
continuation point and never replays an old tool call. If the broker/runtime is
unavailable, the run remains paused or fails closed.

Exit: untrusted-task end-to-end fixture demonstrates ask → approve → execute →
bounded result, and ask → deny/cancel/restart paths do not execute the command.

## Acceptance matrix

- auto-approval cannot authorize unknown tools, writes outside workspace,
  network or privilege changes;
- a stale grant, policy revision or run snapshot fails closed;
- two concurrent runs cannot acquire the same workspace write lease;
- shell and container limits are enforced before execution, not only reported
  afterwards;
- Windows process tree cancellation releases Scheduler/sandbox leases;
- no-sandbox/host-restricted warning is visible and accurately worded;
- failed approval, sandbox or audit writes never change the originating action
  result or silently retry a command;
- recovery and retry create new attempts and never replay old tool arguments;
- Goal quota, memory, MCP and observability never bypass approval/sandbox;
- focused tests plus `pnpm typecheck`, `pnpm test`, `pnpm diff:check` and
  `git diff --check` pass.

## Non-goals and boundaries

- no blanket “always allow” mode, arbitrary shell endpoint or hidden host
  fallback;
- no direct changes to the AgentLoop core state machine, Scheduler authority,
  `run_events`, `goal_events` or WorkspaceRegistry;
- no VM implementation, image registry, remote execution service or automatic
  image update;
- no assumption that a container is safe when privileged mounts/network are
  enabled;
- no copying Codex/OpenHands sandbox or approval source code.

## Implementation-agent handoff prompt

> Read this Spec, the harness contracts and the pinned Codex/OpenHands study.
> Inspect and preserve the dirty worktree. Write policy, Windows and fake
> runner tests first. Implement a native TypeScript policy compiler and
> injected platform/container adapters; do not vendor Codex, add a second
> scheduler, weaken the server-side gate, or enable host tools by default.
> Keep commands, env, paths, secrets and raw output out of events/logs/Web.
> Update this Spec, its ADR and implementation status before committing, then
> run the full verification gate and any explicitly opt-in sandbox smoke.
