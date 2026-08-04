# Spec 51: Host-first release and future client boundary

- Status: 51-R3a implemented (R1-R2 complete; R3b-R4 remain planned)
- Date: 2026-08-04
- Related: [Spec 41](41-host-first-distribution-and-client-boundary.md), [Spec 24](24-certificate-status.md), [Spec 25](25-configuration-onboarding.md), [Spec 52](52-capability-profiles-and-first-run-experience.md), [ADR 0010](../adr/0010-host-first-same-origin-web-and-client-boundary.md), [upstream harness research](../research/upstream-harness-implementations.md)

## Goal

Make the normal deployment experience host-first and cross-platform: one host
machine runs the daemon and serves the React Web app; a remote user opens the
displayed URL in a browser. The user should not install Node.js, pnpm, a second
Web server or a native client on the remote device. Android, iOS and HarmonyOS
clients remain a later consumer of the same versioned API/SSE boundary.

This Spec is about packaging and transport, not a new execution plane.

The actual Tailscale/SSH adapters, ACME issuance/renewal evidence and the
cross-component first-run/release gate are specified in Spec 52. Native mobile
clients remain post-release consumers and are not required for the Web Host
release.

## Current baseline and gap

- The daemon and Vite Web app run independently in development.
- Same-origin API/SSE, pairing, CSRF and LAN/TLS contracts are documented and
  tested; the optional production daemon path now serves a built Web dist.
- Certificate metadata/status is available; ACME issuance/renewal and a
  cross-platform launcher remain explicit adapters.
- Native mobile clients do not exist and must not be pulled into the Web MVP.

## Research and packaging gate (51-R0)

Read the host/local/remote backend sections of the pinned OpenHands study and
the existing host-first ADR. Confirm the license and packaging terms of every
bundled runtime or asset. Do not vendor Codex/OpenHands UI, a Tauri shell,
Python/Rust runtime or a cloud proxy. Record target OS/CPU artifacts and their
reproducible build inputs.

## Host-first contract

### Single origin

The release daemon serves:

```text
GET /                  -> hashed React/Vite index and assets
GET /health            -> bounded daemon/storage/auth/transport status
/api/v1/*              -> authenticated versioned REST APIs
run SSE                -> authenticated seq/Last-Event-ID replay
```

The Web uses relative API paths and does not require CORS, a Vite port or a
second server in production. Development may use Vite with an explicit proxy,
but the dev server is not a deployment requirement.

### Launcher and runtime

Provide a signed or checksum-verifiable launcher for Windows, macOS and Linux
that:

- starts one daemon process with a per-install data directory;
- discovers a free local port or honors a bounded explicit port;
- prints a loopback/LAN URL and pairing instructions without credentials;
- opens the local browser only when explicitly requested;
- forwards signals, records safe exit status and cleans child processes;
- supports daemon restart/recovery without changing SQLite authorities.

The packaging strategy may use a bundled Node runtime or a platform-native
single executable, but the choice must be measured for memory/upgrade/support
cost and documented. The browser device never executes the harness.

### LAN and public HTTPS

Loopback remains the default. LAN exposure requires explicit opt-in, pairing
and a valid certificate or a clearly labelled development HTTP mode. Public
HTTPS requires a valid certificate, authentication, CSRF/origin checks,
rate/connection limits and a safe certificate renewal adapter. Private keys are
read into protected process memory only and never returned to Web/settings,
events, logs or backups.

Tailscale and SSH are reserved transport adapters. They must reuse REST/SSE,
pairing/session identity, Approval and run contracts rather than create a
second protocol or bypass the daemon security gate.

### Remote browser UX

The host URL opens the conversation-first shell immediately. Settings,
provider/sandbox configuration and certificate guidance are authenticated
drawers/sheets, not manual file editing. Desktop, portrait desktop, phone,
foldable and tablet layouts are CSS ratio variants of the same API client; no
device sniffing or device-specific backend behavior is allowed.

## Future native-client boundary

Android, iOS and HarmonyOS are post-MVP adapters. Their first release may
consume only:

- versioned REST/SSE projections and explicit mutation APIs;
- device pairing/session refresh and bounded push/notification metadata;
- conversation/run/approval/usage projections;
- capability and transport health status.

Native clients must not read SQLite, memory sidecars, workspace roots, secrets
or raw event stores, and must not reimplement AgentLoop, ContextManager,
Scheduler, Approval, Sandbox or Goal Control. A TypeScript client SDK may be
published before native UI work to freeze the API boundary.

## Implementation phases

### 51-R1: static Web serving and origin tests

Write fixture tests for asset lookup, cache headers, SPA fallback, API/SSE
origin, missing build output and path traversal. Add a production daemon mode
that serves a built Web directory without changing the development server.

Exit: a clean build can be opened through one host URL; API and SSE remain
authenticated and relative.

#### 51-R1 implementation update (2026-08-05)

The daemon accepts an optional absolute `webDistDir` and serves only built
static files from that directory. `GET` and `HEAD` are supported; `/` and
extensionless client routes fall back to `index.html`, while missing files with
an extension return a bounded 404. `index.html` is `no-store`; hashed
`/assets/*` files receive immutable cache headers. Percent-decoded traversal,
NUL/control characters, symlink escapes and directories fail closed without
revealing host paths. `/api/*`, `/health` and run SSE never enter the static
resolver and retain their existing authentication, CSRF and origin behavior.

The default source checkout keeps the Vite development server unchanged. The
production `main` composition points to `apps/web/dist` (or an explicit
`READY4VIBE_WEB_DIST_DIR`), and a missing build reports a safe
`WEB_ASSETS_UNAVAILABLE` response rather than serving source files.

The daemon static-serving fixture suite passes 4 tests (within the current
152-test daemon package gate), covering index/assets/HEAD, SPA fallback, API and health
isolation, extension asset misses, traversal, method and missing-build guards.
The source checkout remains Vite-compatible; static serving is enabled only
when `webDistDir` is supplied by the production composition.

### 51-R2 launcher boundary

R2 is a small, dependency-free Node launcher module, not an installer or a
second execution plane. It owns only process lifecycle and host presentation:

- parse a bounded argv contract (`--daemon`, `--data-dir`, `--host`, `--port`,
  `--open`, `--ready-timeout-ms`), rejecting shell fragments, relative daemon
  paths and unsafe ports;
- resolve a per-user data directory for Windows, macOS and Linux, create it
  with owner-only permissions where the platform exposes them, and keep only a
  non-secret PID lease there;
- reserve a free loopback port (or honor an explicit bounded port), spawn the
  daemon with an argv array and minimal inherited environment, report a
  same-origin URL, and optionally open it only after `--open` is supplied;
- forward only redacted child output, reject an active PID lease, clean stale
  leases, and terminate the tracked process tree on stop/restart or launcher
  signals.

R2 does not install Node, modify workspaces, write credentials, enable LAN,
bypass TLS/pairing, perform updates, or inspect SQLite. Platform installers,
bundled runtime, signed artifacts and upgrade/rollback remain Spec 53/57
work. `scripts/host-launcher.mjs` and its eight Node test fixtures implement
this boundary. The implementation is kept injectable so Windows process-tree
and Unix process-group behavior can be tested without pretending that one host
fixture is a field-device result.

### 51-R2: cross-platform launcher exit contract

The exit contract is now implemented by `scripts/host-launcher.mjs` and its
Node fixtures for Windows/macOS/Linux behavior. It covers argument parsing,
port discovery, process-tree shutdown, restart, log redaction, data directory
permissions and stale process cleanup. No installer may write user secrets or
modify workspace files; installer and signed artifact work remain outside R2.

Exit: a disposable package starts/stops the daemon and reports a usable URL on
each supported platform fixture.

### 51-R3a: certificate readiness projection

Connect the existing certificate metadata/settings UI to a safe, read-only
readiness adapter. The adapter evaluates the already loaded certificate
metadata against transport requirements and an optional bounded hostname:
`ready` for a usable certificate, `degraded` for loopback HTTP or an
approaching expiry window, and `blocked` for a required-but-missing,
expired or hostname-mismatched certificate. It returns only a versioned reason
code, bounded next-step guidance, transport impact and the existing metadata;
it never returns PEM, private-key bytes or filesystem paths.

The daemon exposes this projection only through the existing authenticated
read-only API boundary. LAN default remains fail-closed without valid TLS.
ACME, OS certificate stores, public reverse proxies and renewal/rollback are
R3b adapters and are not invoked by R3a.

Exit: missing/optional TLS, expiry, hostname mismatch and invalid certificate
fixtures produce stable safe guidance and never print key material. The
certificate package has eight focused tests and the daemon focused gate now
passes 152 tests, including authenticated readiness route isolation.

### 51-R3b: guided LAN/public certificate flow

Add explicit certificate configuration/probe UI and optional ACME/OS-store/
reverse-proxy adapters only after R3a readiness contracts are stable. Any
renewal or rollback must use candidate/previous material and retain the
existing daemon transport/auth authority.

### 51-R4: client SDK contract (post-Web)

Generate or hand-maintain a small versioned TypeScript client over REST/SSE,
with replay, cancellation, pairing and degraded projection tests. Do not add
Android/iOS/HarmonyOS UI until this contract and host release have stabilized.

Exit: a client can reconnect/resume and display conversation/approval/usage
projections without direct database or filesystem access.

## Acceptance matrix

- remote browser needs only a URL and user pairing; no Node/pnpm installation;
- one daemon process serves Web, REST and SSE on one origin;
- loopback remains default; LAN/public exposure is explicit and authenticated;
- TLS/private-key errors are fail-closed and secret-free;
- launcher restart preserves run/settings/Goal event authorities;
- static asset/API path traversal and origin/CSRF tests pass;
- future client API never exposes SQLite, secrets, absolute paths or raw events;
- `pnpm typecheck`, `pnpm test`, `pnpm diff:check` and `git diff --check` pass.

## Non-goals and boundaries

- no native mobile UI, desktop Tauri shell or second Web backend in this phase;
- no implicit public exposure, UPnP port forwarding or certificate download;
- no Tailscale/SSH implementation before the shared API/client contract;
- no cloud-hosted execution, multi-user tenancy or server-side proxy;
- no copy of OpenHands/Codex frontend or launcher code.

## Implementation-agent handoff prompt

> Read this Spec, Spec 41, ADR 0010 and the pinned host/backend research.
> Preserve dirty worktree changes and write static-serving/launcher fixtures
> first. Keep the daemon as the only execution authority, use relative
> same-origin REST/SSE paths, and make LAN/public TLS explicit and fail-closed.
> Do not build mobile clients, vendor a Tauri/Python/Rust runtime, expose
> secrets/paths, or create a second scheduler/protocol. Update the Spec, ADR,
> roadmap and implementation status before committing, then run the full
> verification gate.
