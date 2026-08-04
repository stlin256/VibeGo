# ADR 0019: Opt-in digest-pinned container smoke runner

- Status: accepted for Spec 48-R3 implementation
- Date: 2026-08-04
- Related: [Spec 48](../specs/48-approval-sandbox-shell-runtime.md),
  [ADR 0018](0018-host-restricted-process-runner.md)

## Context

The sandbox runtime already produces a bounded Docker/Podman argv plan and has
an injected CLI runner, but there is no repeatable way to verify a locally
installed engine. A smoke command must provide useful evidence without turning
the normal unit/test path into a Docker dependency or allowing a model/user
command to become an implicit execution endpoint.

## Decision

1. Add a separately named `pnpm smoke:container` command. It is opt-in, runs
   outside daemon startup and `pnpm verify`, and accepts only the runtime,
   immutable image digest and an optional resolved workspace root.
2. Probe the selected local engine with argv-only `<runtime> version` before
   starting a container. Use `--pull=never` so a missing local image cannot
   trigger a registry request. The fixed fixture is a bounded, restricted-
   network `sh -c "printf ready4vibe-smoke"`; arbitrary commands are not part
   of this command.
3. Reuse the existing `ExternalSandboxExecutor`/`ContainerCliRunner` boundary,
   preserving `--rm`, `--init`, read-only mounts, dropped capabilities,
   no-new-privileges, resource limits, output caps and cancellation. Return a
   versioned redacted status report, never raw output, env, secrets or paths.
4. Inject probe/spawn/executor ports in tests. The default test suite never
   starts Docker, Podman or an arbitrary host command; a user-invoked smoke may
   fail closed when the engine/image is unavailable.

## Consequences

- Developers get a short, deterministic integration check when Docker/Podman
  is installed, while clean CI remains engine-free and low-resource.
- `--pull=never` and immutable digests make network and image provenance
  explicit; a missing image is a safe failure rather than an implicit pull.
- The smoke report is suitable for terminal/UI status but cannot be used as a
  general shell endpoint or as proof that host-restricted execution is
  isolated.
- A later approval-continuation slice may consume this existing contract, but
  it must not add a second scheduler or bypass Approval/Sandbox authorities.

## Rejected alternatives

- Running a mutable public image or silently pulling it during a smoke;
- accepting a model-provided command or shell string;
- putting the smoke in `pnpm verify`, daemon boot, or Web page load;
- copying an upstream sandbox/CLI implementation or adding a new runtime
  authority.
