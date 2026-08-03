# Spec 30: Guided external shell and sandbox wiring

Status: Implemented (MVP slice)

## Goal

Connect the existing Docker/Podman launch planner and CLI runner to the
agent's `shell.exec` tool without creating a host-process fallback. The user
must be able to discover and enable the capability from the authenticated Web
Settings flow; no `.env`, YAML, or hand-edited JSON is required.

This slice remains single-user and LAN-safe. It does not add Git, MCP/Skill
connections, public-network exposure, or multi-workspace persistence.

## Safety contract

- Shell is disabled at daemon startup and is never registered merely because a
  Docker/Podman executable happens to be installed.
- The Settings flow has three explicit states: unavailable, detected-but-off,
  and enabled. Enabling requires a successful capability probe and a pinned
  image digest (`name@sha256:<64 hex>`). Mutable tags are not accepted by the
  Web path; the lower-level planner may retain its explicit opt-in only for
  deterministic tests and future development profiles.
- `shell.exec` is registered only with `supportedSandboxModes: ["external-sandbox"]`.
  Every request is run through `ToolExecutorRuntime`, `ApprovalPolicy`,
  `SandboxResolver`, `PathGuard`, `ArgvGuard`, the scheduler process/sandbox
  leases, and the existing `ContainerCliRunner` with `shell:false`.
- There is no host `ProcessRunner` fallback. Missing, unhealthy, or
  capability-mismatched Docker/Podman state returns a stable unavailable error
  before the handler starts.
- Network is `restricted` by default and maps to a container network with no
  outbound access. Enabling network requires a separate user action in the
  Web Settings panel and remains subject to the tool intent's network policy;
  it is not inferred from a run profile.
- The runtime uses hard upper bounds for memory, CPU, pids, wall time, and
  combined output. User-facing controls may select values within those bounds
  but cannot remove them. The workspace mount is read-only unless the run's
  explicit external-sandbox policy names bounded writable roots.
- Untrusted content cannot use read-only/workspace-write host execution or
  danger-full-access. It must select an available external sandbox, otherwise
  the run fails closed with `SANDBOX_UNAVAILABLE`.
- Shell has destructive risk and never receives an automatic allow from a
  generic read/write approval cache. The existing approval continuation must
  show the argv summary, sandbox provider, image digest, network mode, and
  bounded workspace roots before the user can allow one request.

## Guided Web settings

The authenticated Settings panel, not browser storage, owns the runtime
configuration boundary. It should provide:

1. A read-only capability card showing provider (`docker` or `podman`), a
   secret-free health state, runtime version when available, and safe resource
   ceilings.
2. A provider selector and image-digest field with inline validation and a
   small explanation of why mutable tags are rejected.
3. An explicit “Enable external shell” switch, disabled until the probe and
   digest validation succeed, plus a separate restricted/enabled network
   choice with a warning for enabled network.
4. A clear disable action. Disable affects new runs; an in-flight run keeps its
   captured runtime snapshot and remains cancellable.

The UI never asks for a private key, bearer token, environment snapshot, or
absolute host path. Runtime settings are process-memory only for this slice;
they are not written to `localStorage`, EventStore, SSE payloads, URLs, or
logs. The existing non-secret run profile continues to store only per-run
choices such as sandbox mode and limits.

## API boundary

Authenticated endpoints:

- `GET /api/v1/settings/sandbox` returns provider, `detected`, `healthy`,
  `enabled`, `imageDigest`, `network`, and bounded capabilities. It never
  returns command-line arguments, host paths, environment values, or secrets.
- `POST /api/v1/settings/sandbox/probe` accepts `{ provider }`, performs a
  bounded capability probe, and returns the same safe status. It does not pull
  images or start a coding task; the image digest is validated by the separate
  configure request.
- `POST /api/v1/settings/sandbox` accepts the validated non-secret settings
  (`provider`, `imageDigest`, `network`, resource selections, and
  `enabled`). Invalid or unavailable requests fail closed with stable error
  codes.

Mutating routes use the existing Origin/CSRF and LAN authentication gate. No
runtime setting is accepted from query parameters.

## Runtime wiring

- Add an explicit daemon-owned runtime factory that constructs
  `ContainerCliRunner`, a provider verifier, `SandboxResolver`, and a
  `ToolExecutorRuntime` containing only `shell.exec` plus the already guarded
  filesystem adapters when their independent toggle is enabled.
- The provider verifier must be injectable in tests and must not run a real
  Docker/Podman command in unit tests. Production probing is bounded by the
  configured timeout and abort signal.
- A shell request converts the validated tool input into a
  `SandboxLaunchRequest` with the selected digest, workspace root, restricted
  network default, allowlisted environment keys, bounded writable roots, and
  the run signal. The adapter returns only capped stdout/stderr and exit
  metadata.
- The daemon captures the complete tool/runtime snapshot when a run starts.
  Settings changes never mutate an existing run's provider, image, network, or
  limits.

## Acceptance tests

- Default daemon status shows external shell disabled and no shell descriptor.
- Web/API probe and enable flows validate digest pinning, provider choice,
  resource ceilings, CSRF/auth, and secret-free status responses.
- A fake provider verifies shell execution is impossible without an explicit
  external-sandbox runtime; no host runner is called.
- Shell argv, cwd, environment, mount, network, timeout, output, cancellation,
  and approval metadata are bounded and forwarded to an injected runner.
- Untrusted host fallback, mutable image tags, workspace escape, network
  mismatch, and missing provider all fail closed.
- Disable-after-start leaves an in-flight run on its captured snapshot while
  later runs see shell disabled.
- Full workspace typecheck, unit tests, `diff:check`, and secret scan pass;
  no real Docker/Podman process, image pull, network request, or model key is
  used by tests.

## Explicitly deferred

- Git/patch-specific tools, MCP/Skill transport activation, VM providers,
  image pulling or signing, multi-user policy, persistent credential/keyring
  storage, public access/Tailscale/SSH adapters, and a full diff/log explorer.

## Implementation evidence (2026-08-03)

- `InMemorySandboxSettingsManager` keeps external shell disabled until an
  authenticated Web probe succeeds and the user enables a digest-pinned
  provider. Runtime settings remain process-memory only.
- `GET/POST /api/v1/settings/sandbox` and
  `POST /api/v1/settings/sandbox/probe` expose only safe status metadata; the
  React Settings panel provides provider, probe, digest, and enable/disable
  controls without asking for config-file edits or host paths.
- `shell.exec` is constructed per run only for the selected healthy provider.
  It uses `ContainerCliRunner`, `SandboxResolver`, `ApprovalPolicy`,
  `ArgvGuard`, `PathGuard`, bounded resources, and a digest-pinned image; host
  process fallback is not registered.
- External sandbox policy now accepts optional bounded `writableRoots`, and
  the container planner maps a guarded working directory to `/workspace`.
- Daemon, Web, policy, sandbox-runtime, API, approval, and secret-free status
  tests cover the new boundary; tests inject fake probes/runners and never
  start Docker/Podman or make model requests.
