# Spec 52: Capability profiles, core harness closure and first-run experience

- Status: R1 strict contract/resolver and R2/R3a durable settings projection
  with authenticated API implemented (profile cards and run snapshot binding
  remain pending; no default run-path behavior change)
- Date: 2026-08-04
- Scope: `apps/web`, `apps/daemon`, `packages/goal-control`, settings
  persistence, policy/approval boundaries, transport/certificate adapters,
  real-model smoke and the Host-first release path
- Related: [Spec 25: Configuration onboarding](25-configuration-onboarding.md),
  [Spec 28: Model provider onboarding](28-model-provider-onboarding.md),
  [Spec 30: External shell and sandbox wiring](30-external-shell-sandbox-wiring.md),
  [Spec 36: Durable settings](36-durable-workspace-settings.md),
  [Spec 37: Ratio-first Web](37-ratio-responsive-ui.md),
  [Spec 38: Conversation-first Web](38-conversation-first-web-shell.md),
  [Spec 42: VibeGo Web design system](42-shadcn-style-web-design-system.md),
  [Spec 48: Approval/sandbox/shell closure](48-approval-sandbox-shell-runtime.md),
  [Spec 49: MCP/Skill transport](49-mcp-skill-transport-and-capability-lifecycle.md),
  [Spec 50: Observability lifecycle](50-observability-lifecycle-integration.md),
  [Spec 51: Host-first release](51-host-first-release-and-client-boundary.md),
  [Spec 34: Goal Control](34-goal-control-plane-loopx-integration.md),
  [Spec 40: Goal mutations](40-goal-write-api-and-bounded-mutations.md),
  [Spec 47: Model/Context/AgentLoop productionization](47-model-context-agent-loop-productionization.md)

## 1. Purpose

VibeGo has separate specifications for onboarding, workspace settings, model
providers, approval, sandboxing, responsive Web layout and Host-first
distribution. This specification joins those boundaries into one user-visible
flow:

```text
install Host -> pair -> choose a capability profile -> choose workspace
-> configure model -> review permissions -> start the first conversation
-> progressively unlock a capability when the task actually needs it
```

The goal is a low-friction, secure first run. A user must not edit `.env`, YAML,
JSONL, SQLite files or shell scripts to reach the first useful conversation.
The flow must remain understandable on desktop, portrait displays, phones,
tablets and foldables, while the daemon remains the only authority for
capability decisions.

This is a product and integration gate. It does not enable host commands,
network access, MCP/Skill processes or automatic run admission by itself.

## 1.1 Mandatory pre-implementation verification gate

The completed gate is recorded in [the 2026-08-05 verification report](../reports/52-prerequisite-verification-2026-08-05.md).
It authorizes only the isolated contract/resolver slices below; it does not
claim that the later release requirements in R4–R7 are complete.

Before implementing any Spec 52 code, the implementer **must re-verify the
execution status of every preceding and related specification**. The existence
of a document marked `implemented`, an earlier test count or a previous agent
report is not sufficient evidence.

The verification must be performed against the current checkout, current
branch and current dependency lockfile, and recorded before the first Spec 52
runtime change. At minimum it must:

1. Read the current implementation status, roadmap and all related Spec/ADR
   documents listed in this file.
2. Run `git status --short --branch`, inspect `git diff` and
   `git diff --cached`, and preserve unrelated user/agent changes.
3. Confirm the package manager, Node version, workspace graph and lockfile are
   the ones used by the current checkout.
4. Map every prerequisite requirement to actual source files, tests and a
   passing focused command. The map must cover at least Specs 25, 27, 28, 30,
   31, 36, 37, 38, 40, 41, 42, 48, 49 and 51, plus the applicable ADRs and
   `docs/harness-contracts.md`.
5. Re-run affected module typechecks/tests and the full `pnpm verify` gate
   before claiming the prerequisites are complete. If a full gate is too
   expensive during exploration, it may be deferred temporarily, but it is
   mandatory before the first implementation commit.
6. Check that the documented test counts, status labels, links, Markdown
   fences and implementation notes agree with the current tree. A stale,
   contradictory or missing status is a blocking finding.
7. Record each prerequisite as `verified`, `partially implemented`,
   `blocked` or `not applicable`, with evidence and the exact follow-up.

If any prerequisite is `partially implemented`, `blocked` or contradictory,
Spec 52 implementation must stop. The next action is to update the relevant
Spec/ADR/implementation-status/roadmap or finish the prerequisite in a
separate, independently testable Git change. Spec 52 must not introduce a
compatibility layer that silently compensates for an unverified earlier
boundary.

This gate is also required again before each later Spec 52 phase that changes
an authority boundary (profile contracts, RunManager integration, approval or
sandbox wiring, and Host-first release acceptance). The verification report
belongs in the corresponding implementation commit or its linked review; it
must not be kept only in chat history.

## 2. Product outcomes

### 2.1 Required outcomes

1. A fresh Host starts with a safe, bounded profile and explains what is and is
   not enabled.
2. A user can reach a first conversation through the Web UI without manually
   editing configuration files.
3. Every capability has a visible owner, scope, status and disable action.
4. Enabling a capability is progressive and contextual: a blocked action offers
   a precise next step instead of sending the user to an unrelated admin page.
5. Settings changes affect new runs only. A running run keeps its provider,
   workspace, policy, approval and sandbox snapshot.
6. The same profile semantics are used for local and LAN access. LAN transport
   still requires the existing TLS, pairing, Origin and CSRF gates.
7. The experience is useful without enabling any side-effecting capability.
8. Explicitly goal-bound runs use a governed Goal preflight and admission path;
   unbound interactive runs retain their existing behavior.
9. A release candidate has working, tested Tailscale/SSH transport adapters,
   an explicit ACME certificate adapter and a redacted live LLM smoke report.
10. Every core Harness component has contract, unit, integration and
    failure-path evidence. A design-only or fake-only core component cannot be
    marked release-complete.

### 2.2 Non-goals

- No multi-user roles or organization policy engine.
- No second scheduler, approval broker, quota authority or execution runtime.
- No implicit public exposure, UPnP, mDNS login or plaintext public HTTP.
- No automatic host fallback when an external sandbox is unavailable.
- No persistence of API keys, private keys, raw environment values or complete
  transcripts in browser storage, settings responses or events.
- No native Android/iOS/HarmonyOS implementation in this phase. Native clients
  are post-release consumers and do not block Web/Host release.
- No requirement to copy Codex UI or source; only the interaction principles
  and safety boundaries are considered.

## 3. Capability profile model

The profile is a versioned, non-secret user intent. The daemon resolves it
against the current server policy and available runtimes. The browser never
gets to widen a server decision; it may only request a stricter profile.

### 3.1 Initial profiles

The first release defines three presets and an advanced custom path. Names are
user-facing labels; the stable identifiers are contract values.

| Profile | Intended use | Default capabilities | Approval posture |
| --- | --- | --- | --- |
| `preview` | Explore the UI and inspect a run without side effects | no host tools, no shell, no MCP/Skill, no network; fake or explicitly configured model | no side-effecting action can be allowed |
| `workspace-coding` | Recommended single-user coding workflow | one selected workspace, explicit model, workspace-scoped filesystem through existing ToolExecutor, external sandbox only when configured, network off by default | bounded low-risk grants may be reused; write, shell, network and unknown tools remain policy-controlled |
| `advanced-local` | Experienced local user who accepts host-runner risk | selected workspace, opt-in host-restricted runner, explicit environment allowlist, network still off by default | explicit acknowledgement; dangerous or untrusted work always asks and never silently falls back |
| `custom` | Advanced settings | individually selected capabilities | server policy and approval compiler remain authoritative |

The `workspace-coding` preset must not imply that a host shell is available.
When an external digest-pinned sandbox is healthy, shell execution is scoped to
that sandbox and its captured run snapshot. When it is unavailable, the UI shows
`degraded` or `blocked`; it does not silently execute on the host.

### 3.2 Transport is separate from capability

Loopback, LAN TLS, Tailscale and SSH are transport choices, not capability
profiles. A LAN user does not receive more tool authority than a loopback user.
The first-run flow must expose Tailscale/SSH only as explicit, health-checked
transport adapters; selecting a transport never enables tools or public
exposure. The actual adapters are a release requirement below, not a reason to
relax the existing auth/pairing boundary.

### 3.3 Versioned profile fields

The R1 contract lives in `packages/contracts` and must reject unknown
fields and secret-shaped values. The minimum shape is:

```text
schemaVersion
profileId
transportMode
workspaceId?
modelMode
filesystemMode
shellMode
networkMode
mcpSkillMode
approvalMode
sandboxRef?
policyRevision
requiresAcknowledgement
updatedAt
```

The contract must not contain an API key, private key, raw environment map,
absolute workspace path or complete tool arguments. A resolved run snapshot adds
the provider, workspace and sandbox revisions required by existing RunManager
and event contracts, without changing their authority.

#### 3.3.1 R1 contract freeze

ADR 0033 freezes the first contract slice as `capability-profile/v1`. The
request contains only bounded intent and revision metadata:

```text
schemaVersion
profileId
transportMode
workspaceId?
modelMode
filesystemMode
shellMode
networkMode
mcpSkillMode
approvalMode
sandboxRef?
policyRevision
requiresAcknowledgement
updatedAt
```

`workspaceId`, `sandboxRef` and `policyRevision` are opaque bounded ids; they
are not paths, image names, credentials or arbitrary JSON. Each enum is
strictly allowlisted, every object is `.strict()`, and shared privacy guards
reject secret-shaped values, environment maps, control characters and absolute
paths. The contract is metadata-only: it does not resolve a workspace, probe a
provider, start a process, or grant an approval.

### 3.4 Core Harness closure contract

Spec 52 is also the release-closure gate for the core Harness. The following
components are in scope; each must have a versioned contract, focused unit
tests, an application/integration test and bounded failure-path evidence before
the release is called complete:

| Component | Required release evidence |
| --- | --- |
| Contracts and storage | strict schemas, migrations, idempotency, restart and concurrency tests |
| Model and context | explicit provider endpoint, stream/retry/cancel fixtures, byte/token budgets and a real LLM smoke |
| AgentLoop and RunManager | multi-turn/tool-intent fixture, provider/profile snapshot, cancellation, recovery and no duplicate execution |
| Scheduler | concurrent admission, resource limits, workspace lease, cancellation and release tests |
| Approval and policy | allow/ask/deny, exact bounded grants, stale revision, continuation and untrusted-task tests |
| Sandbox and shell | host restriction, digest-pinned container smoke, process-tree termination and no host fallback |
| Tool, MCP and Skill | manifest privacy, real transport lifecycle, capability snapshot and registry activation tests |
| Goal Control | reducer/storage/write API, claim concurrency, gate/quota/shouldRun, governed admission and validated writeback |
| Auth, transport and certificates | pairing/TLS, LAN, Tailscale, SSH, ACME staging, renewal and rollback evidence |
| Web and onboarding | profile flow, approval/recovery, ratio variants, keyboard/accessibility and degraded states |
| Observability and recovery | usage/cost/resource/audit lifecycle, bounded diagnostics and restart/retry evidence |

The matrix must not contain an unresolved `planned`, `unknown` or
`partially-implemented` item for a component required by the Web Host release.
Native clients are explicitly excluded from this matrix. A real external
dependency may use a separate, opt-in smoke command, but a release candidate
cannot claim completion without its recorded result.

## 4. First-run journey

### 4.1 Fresh Host

The Host launcher starts the daemon and opens the same-origin Web URL. The
health screen reports only bounded transport, storage and configuration state.
It must not claim that a model, tool or sandbox is usable merely because the
daemon is healthy.

### 4.2 Pairing and transport

The local browser receives the existing pairing flow. A remote browser must use
the existing one-time pairing/token and TLS requirements. The screen explains
why insecure LAN mode is development-only and gives a stable remediation code
when a certificate is missing.

### 4.3 Choose a profile

The user sees the three presets before advanced settings. Each card shows:

- what the agent can read, write, execute and access;
- whether a sandbox is required;
- whether network is enabled;
- when an approval card will appear;
- a one-click downgrade/disable action.

`workspace-coding` is recommended only after a workspace is selected. The
default before that selection is `preview`.

The core path should take no more than five screens and no more than three
blocking choices before the first conversation. Advanced settings are
progressively disclosed and never required for the first preview run.

### 4.4 Workspace selection

The user selects an existing registered workspace or adds one through the
existing guided flow. The browser receives a label and bounded status, not an
unnecessary absolute host path. Unknown IDs, path escapes and deleted roots
fail closed.

### 4.5 Model setup

The user chooses an explicit provider and model. The secret input is submitted
through the authenticated settings boundary, is cleared after use, and is not
written to browser storage, events, URLs or normal API responses. A provider
probe returns only bounded health and capability metadata. A failed probe keeps
the profile usable in `preview` mode.

### 4.6 Sandbox and capability review

The review screen is a compact permission summary, not a second configuration
file editor. It lists each capability as `off`, `ready`, `degraded`, `blocked` or
`approval-required`. The user must acknowledge the warning before enabling the
advanced local host runner or networked capability.

The review screen must not offer an “allow everything” shortcut.

### 4.7 First conversation

The first screen after onboarding is the conversation timeline, not an admin
form. The composer is reachable immediately. A preview task can explain the
current profile without invoking a tool. The `New task` action clears the draft
and focuses the composer in one action.

If a task needs a disabled capability, the timeline displays a bounded inline
card with:

1. the requested capability and scope;
2. the reason it is blocked or needs approval;
3. the exact settings action that can enable it;
4. a safe alternative, where one exists;
5. a reminder that enabling it affects new runs only.

The card must not expose secrets, raw environment values, absolute paths or
unbounded tool output.

### 4.8 Goal-governed run path

The Web may offer an explicit `governed` run mode when the user selects a Goal
and, where applicable, a Todo. The daemon application service must then:

1. replay the current Goal projection and evaluate `shouldRun`/Gate/quota
   preflight;
2. return a bounded, explainable decision when a Gate, stale revision, claim or
   quota blocks the run;
3. create a `GoalRunBinding` only after preflight succeeds;
4. pass the bound run to the existing `RunManager`, `Scheduler`, `Approval`,
   `Sandbox` and `WorkspaceRegistry` authorities;
5. reserve/spend quota only through the Goal event service, after the run and
   its independent validation succeed; and
6. write validated Evidence/Todo completion only after the verification gate.

An unbound user-created interactive run must not be silently intercepted by
Goal quota or `shouldRun`. Goal admission must not execute tools, provide
approval, bypass a sandbox, acquire a second scheduler lease or modify
`run_events`. Goal events remain in the independent `goal_events` stream. A
retry or recovery path must never spend quota or replay an old tool call twice.

## 5. Ongoing interaction model

### 5.1 Conversation shell

The design keeps Spec 38 authoritative:

- the conversation/run timeline is the primary reading surface;
- the composer is at the end of the reading flow;
- workspace navigation is secondary;
- Goal, transport, memory, sandbox and guardrail state live in a collapsible
  context rail;
- Settings and advanced profile editing use a Sheet/Drawer;
- approval and recovery cards remain inline with the run timeline.

### 5.2 Capability status and actions

Every capability status has a stable reason code and a user action:

| State | Meaning | User action |
| --- | --- | --- |
| `off` | Explicitly disabled | Enable through the scoped Settings sheet |
| `ready` | Configured and healthy | Use within the current profile policy |
| `degraded` | Optional provider/runtime unavailable | Retry probe, choose fallback or continue without it |
| `blocked` | Policy, workspace or safety gate rejects it | Inspect the reason; no bypass button |
| `approval-required` | One operation awaits user decision | Allow or deny the bounded operation |

Toggles are optimistic only in the UI. The daemon persists the validated
profile, returns its revision, and remains authoritative when a browser is
stale or concurrent.

### 5.3 Responsive variants

The UI uses the existing width + `aspect-ratio` strategy and does not sniff
device names:

| Viewport | Default composition |
| --- | --- |
| Wide desktop | Workspace rail + conversation + persistent context rail |
| Portrait desktop | Conversation first, context in a collapsible sheet |
| Phone / fold cover | Conversation only, bottom Details/Settings sheet |
| Unfolded/wide/tri-fold | Two panes when the ratio allows it; otherwise portrait stack |
| Tablet | Conversation plus one collapsible rail |

All variants must preserve a reachable composer, 44px-equivalent touch targets,
safe-area insets, inline approval actions and readable long error messages.

### 5.4 Transport and certificate experience

The Settings sheet exposes transport as a separate, explicit section:

- **LAN TLS** shows certificate metadata, pairing state and stable remediation
  codes; it never falls back to plaintext for public access.
- **Tailscale** uses an injected adapter to verify the local Tailscale runtime,
  tailnet address/identity and Serve/Funnel state. Serve is the default private
  mode; Funnel/public exposure requires a separate acknowledgement, explicit
  domain/ACL review and the existing pairing boundary.
- **SSH** uses an argv-only `ssh -N -L` adapter with host-key verification,
  bounded lifecycle, cancellation and process-tree termination. Web never asks
  for or stores an SSH password/private-key byte sequence.
- **ACME** is an explicit certificate action, not a daemon-startup side effect.
  The UI shows challenge type, domain, current/previous revision, renewal
  status and stable errors without displaying account keys or private keys.

When any adapter is unavailable, the UI reports `degraded` or `blocked` and
keeps loopback available. It must not silently change the transport or widen
the public exposure.

## 6. Security and authority invariants

1. `CapabilityProfileResolver` is a daemon application-service concern. Web
   components do not decide authorization.
2. Existing `Approval`, `Sandbox`, `Scheduler`, `WorkspaceRegistry`,
   `RunManager`, `AgentLoop`, `run_events` and `goal_events` remain the only
   authorities for their domains.
3. Profile resolution may narrow a capability but never bypasses a server
   policy, approval, sandbox, scheduler lease or workspace guard.
4. Auto-approval is limited to the existing exact approval key, bounded TTL/use
   count and policy revision. Model text never grants approval.
5. Untrusted content cannot silently upgrade a profile. Host-restricted mode is
   visibly different from strong isolation.
6. A runtime failure is fail-closed for the affected capability and fail-soft
   for the rest of the Web/run experience. There is no implicit host fallback.
7. A run captures a provider/profile/workspace/sandbox/policy snapshot before
   `run.created`; later Settings changes affect only later runs.
8. LAN access remains authenticated and TLS-gated. Public access is never
   enabled by a profile selection.
9. Goal `shouldRun` and quota are consulted only for an explicit governed
   binding. A normal unbound interactive run remains runnable under its existing
   RunManager/Scheduler path.
10. Tailscale and SSH adapters are explicit transport processes/ports with
    bounded argv, identity/host-key verification, cancellation and teardown.
    They cannot create a second Web server or execution authority.
11. ACME issuance, renewal and revocation use an explicit action and an
    atomic current/previous certificate store. Private key bytes remain in the
    platform secret boundary and never enter Web, events, logs or Goal state.
12. A live LLM call is required for release evidence, but it is isolated from
    the default offline verification gate, bounded in cost/time, and cannot
    enable host tools or persist credentials.

## 7. Persistence and migration

Only validated non-secret profile intent is stored in the existing durable
settings boundary. The persisted record includes a schema version, profile
revision, selected workspace ID and capability modes. It excludes credentials,
private keys, absolute paths in public responses and raw model/tool payloads.

On restart:

- the last validated profile is loaded;
- unavailable providers/runtimes are marked `degraded`, not fabricated as
  healthy;
- a stale or incompatible profile is downgraded to `preview` with a stable
  reason code;
- no old tool call, approval decision or run is replayed;
- a user can reset to `preview` without deleting event history.

## 8. Implementation phases

### 52-R0: Contract and UX gate

- Freeze the profile identifiers, status/reason codes and privacy rules.
- Add acceptance fixtures for fresh, stale, degraded and reset states.
- Map each UI action to an existing daemon application-service endpoint.
- Do not change default run creation or enable a new runtime.

### 52-R1: Pure profile resolver

- Add versioned contracts and a pure resolver over server capabilities,
  workspace state, policy revision and runtime health.
- Test monotonic tightening: a client request can only reduce authority.
- Test profile snapshot isolation and stale revision fail-closed behavior.

The contract-only commit precedes the resolver commit. Both remain below the
daemon application boundary and are independently mergeable.

#### R1 contract implementation (2026-08-05)

`@ready4vibe/contracts` now exports the strict
`ready4vibe_capability_profile_v1` schema and parser. Its focused suite has 71
tests, including five capability-profile cases for all four profile ids,
unknown-field rejection, secret/path/environment rejection, acknowledgement
requirements and external-sandbox references. `@ready4vibe/policy` now adds a
pure `CapabilityProfileResolver` with deterministic narrowing and health gates;
its focused package suite has 24 tests. Neither slice changes the daemon run
path or starts any runtime.

### 52-R2: Onboarding and capability status UI

- Implement the first-run stepper, profile cards, review screen and contextual
  blocked-capability cards in the existing conversation shell.
- Reuse Spec 42 primitives when that phase begins; do not introduce a second UI
  framework.
- Add desktop, portrait, phone, foldable and tablet viewport fixtures.

### 52-R3: Existing runtime integration

- Wire the resolver through existing settings, approval, sandbox, scheduler,
  workspace and RunManager application boundaries.
- Verify that disabled modes make zero provider/process/network calls.
- Verify that a changed profile never alters an already running run.

#### R2/R3a application-settings slice (2026-08-05, implemented)

The first application-boundary slice persists only the validated,
secret-free profile intent in the existing `daemon_settings` boundary. The
daemon exposes a versioned `GET/PATCH /api/v1/settings/capability-profile`
projection containing the current profile revision and the pure resolver's
effective profile, status and reason code. The policy evidence is injected by
the daemon from existing transport, workspace, model, filesystem, sandbox and
MCP settings; the browser cannot widen it. Updates use an expected revision
and fail closed on stale or concurrent writes. Resetting the profile returns
to `preview` without deleting run or Goal history.

This slice deliberately does **not** attach the profile to `RunConfig`, change
`RunManager.start`, alter the AgentLoop state machine, grant a tool, start a
process, call a provider, change Scheduler/Approval/Sandbox authority, or
modify `run_events`/`goal_events`. Profile/run snapshot binding and contextual
Web cards remain the next independently tested slice.

The implementation is covered by strict contracts in
`packages/contracts/src/capability-profile-settings.ts`, the durable daemon
manager in `apps/daemon/src/capability-profile-settings.ts`, and authenticated
server fixtures for restart, stale revision, reset, privacy and LAN auth. The
focused contract suite has 74 tests and the daemon focused settings/API suite
has 35 tests at this gate.

### 52-R4: Goal governed admission

- Add the explicit governed run mode and `GoalRunBinding` application-service
  composition described above.
- Connect `shouldRun`, Gate, claim, quota reservation/spend and validated
  Evidence/Todo completion without changing unbound interactive runs.
- Add deterministic end-to-end fixtures for Gate blocks, stale revisions,
  concurrent claims, quota conflicts, successful validation and failed
  verification.

### 52-R5: Tailscale, SSH and ACME adapters

- Implement injected, argv-only Tailscale Serve/Funnel, SSH local-forward and
  ACME client ports with platform-specific lifecycle adapters.
- Verify Tailscale identity/ACL state, SSH host keys and process teardown on
  Windows/macOS/Linux; do not silently install binaries or change system ACLs.
- Exercise ACME against a staging CA, including issuance, renewal, failure,
  current/previous rollback and secret-store boundaries. Production issuance is
  an explicit user action.

### 52-R6: Core Harness closure and required live model smoke

- Complete the core Harness matrix in Section 3.4; no core component may remain
  design-only or fake-only for the release candidate.
- Add a separately named `pnpm smoke:model` command. It must require an
  explicit provider URL, model and out-of-band secret reference, and must
  refuse tracked-file credentials.
- The live smoke must traverse the configured provider through the daemon
  application boundary, `RunManager`, `AgentLoop` and `ContextManager`, produce
  a bounded successful response, and verify event/privacy redaction. It must
  not invoke host tools, network tools, MCP/Skill or shell.
- Store only a redacted report containing provider/model revision, status,
  latency, bounded token counters and error classification. Never store the
  key, full prompt, full response or raw headers.
- Keep `pnpm verify` network-free for ordinary development; a Spec 52 release
  review is not allowed to pass until the live smoke report is attached.

### 52-R7: Host-first release acceptance

- Run the full path from installed Host to first conversation with no Node/pnpm
  on the remote device.
- Verify auto-open URL, pairing, model setup, workspace setup, first run,
  governed Goal run, approval continuation, degraded runtime, transport adapter
  selection and reset/restart behavior.
- Keep the release package, current/previous update flow and rollback rules from
  Spec 51 authoritative.

## 9. Test and acceptance requirements

### 9.1 Functional tests

- Fresh install reaches `preview` without editing a file.
- Selecting `workspace-coding` requires a registered workspace.
- `advanced-local` requires explicit acknowledgement and never enables network
  implicitly.
- Disabled model, tool, shell, MCP/Skill and sandbox modes make no external
  request or child-process call.
- A provider/runtime outage produces `degraded` or `blocked` without a Web 500
  or a changed original run result.
- A profile change affects only newly created runs.
- Stale profile revisions and concurrent updates fail closed.
- Reset returns to `preview` and does not delete run or Goal history.
- A governed Goal run is blocked by a closed Gate, stale claim or exhausted
  quota, while an unbound interactive run is not silently intercepted.
- A validated governed run records binding/evidence and spends quota exactly
  once; failed validation records neither completion nor spend.

### 9.2 Security and privacy tests

- Secret-shaped fields, API keys, tokens, private keys, environment maps and
  absolute paths are rejected by the profile contract.
- The browser never stores credentials or raw capability payloads.
- An untrusted task cannot upgrade a profile or reuse an old approval.
- Host runner failure never triggers an unapproved host fallback.
- LAN access without the required TLS/pairing gate is rejected.
- Tailscale Serve/Funnel and SSH forwarding cannot widen tool permissions or
  bypass pairing; disconnect and cancellation terminate their child processes.
- ACME staging issuance/renewal/revocation keeps private key bytes out of
  settings, events, logs and Web responses, and failed rotation preserves the
  previous certificate.

### 9.3 UX and accessibility tests

- One-action `New task` focus behavior remains intact.
- Dialog/Sheet focus return, Escape handling, keyboard navigation and reduced
  motion are covered.
- Desktop, portrait desktop, phone, fold cover/unfold, wide/tri-fold and tablet
  fixtures preserve the composer and approval controls.
- Long Goal titles, tool output, error codes and system font scaling do not
  create horizontal scrolling or hide the primary action.
- Web bundle and startup budgets remain compatible with a low-resource Host.

### 9.4 Core Harness and external integration tests

- Every row in the Section 3.4 matrix has a focused unit test, an application
  integration test and an explicit failure/recovery fixture.
- `pnpm smoke:container` passes when a supported digest-pinned engine is
  intentionally supplied; the report is bounded and redacted.
- `pnpm smoke:tailscale` and `pnpm smoke:ssh` pass with installed, explicitly
  selected adapters, and injected fake ports cover unavailable binaries and
  teardown without requiring them on every developer machine.
- `pnpm smoke:acme -- --staging` completes a staging issuance/renewal failure
  and rollback path; production CA calls require a separate user action.
- `pnpm smoke:model` makes at least one real LLM API call through the configured
  daemon/RunManager/AgentLoop/ContextManager path. The command is mandatory for
  release review, bounded in cost and timeout, and never part of ordinary
  offline unit tests.

The live smoke commands must classify provider, network, authentication,
certificate, schema, quota and cancellation failures separately. A missing
optional adapter may keep a local development build in `degraded`, but no
release candidate may silently omit required evidence.

The phase is complete only when `pnpm typecheck`, the affected module tests,
the full `pnpm verify` gate and `pnpm diff:check` pass, and the implementation
status/roadmap are updated in the same change set.

## 10. Exit criteria

Spec 52 is ready for release review when a new user can install one Host,
complete pairing, choose a safe profile, configure a workspace and model, start
a conversation, understand a blocked capability, approve one bounded operation,
start both an unbound interactive run and a governed Goal run, use a verified
transport/certificate adapter where selected, pass the required real LLM smoke,
restart the Host and continue without editing a configuration file. All of this
must preserve the existing event authorities and default-off behavior.

Release review is blocked until:

1. the mandatory pre-implementation verification gate is complete;
2. every core Harness row in Section 3.4 is verified with current evidence;
3. Goal governed admission, quota/evidence writeback and interactive-run
   regression tests pass;
4. Tailscale/SSH adapter and ACME staging evidence is present for the supported
   release targets;
5. `pnpm smoke:model` has succeeded with an out-of-band real provider secret;
6. the Host-first install, pairing, onboarding, approval, recovery and
   rollback flow passes on the release target; and
7. `pnpm typecheck`, affected tests, `pnpm verify`, `pnpm diff:check` and
   `git diff --check` pass with synchronized documentation.

The final release must be able to explain, in the UI, why a capability is off,
how to enable it safely, what scope it receives and how to turn it off again.
Native clients are not part of this exit gate; the Web client is the supported
release client.
