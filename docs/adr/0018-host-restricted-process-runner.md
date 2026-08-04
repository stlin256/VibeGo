# ADR 0018: Injected host-restricted process runner

- Status: accepted and implemented for 48-R2 contract slice
- Date: 2026-08-04
- Related: [Spec 48](../specs/48-approval-sandbox-shell-runtime.md),
  [Spec 10](../specs/10-sandbox-execution.md),
  [ADR 0017](0017-policy-compiler-and-bounded-approval.md)

## Context

The tool adapters already validate argv, paths and policy, while the external
container runner has bounded output and cancellation. A later host-restricted
profile needs a reusable process boundary for trusted workspaces and Windows
first development. It must not be mistaken for kernel isolation or silently
become a shell fallback for untrusted content.

## Decision

1. Add `HostRestrictedProcessRunner` to `@ready4vibe/sandbox-runtime` as an
   explicit, injected adapter. It accepts only argv, validates the workspace
   and cwd through an injected `realpath` port, uses a minimal environment and
   enforces fixed timeout/output ceilings.
2. Keep process-tree termination behind a platform callback. The production
   Windows callback may invoke `taskkill /T /F`; unit tests inject a fake
   terminator and never start a user process. macOS/Linux use the analogous
   process-group adapter in a later platform-specific implementation.
3. Return bounded result metadata and stable secret-free errors. Raw output,
   command strings, environment values and absolute paths are not durable
   events or browser fields.
4. Do not register the runner in daemon startup, change `AgentLoop`, add a
   scheduler, or weaken `ApprovalPolicy`/`SandboxResolver`. Runtime wiring is a
   later Spec 48 phase after this contract is proven.

## Consequences

- Windows `.cmd` and PowerShell are represented as ordinary argv fixtures and
  cannot smuggle shell metacharacters through a shell string;
- path/symlink, environment leakage, timeout, cancellation and output limits
  can be tested deterministically without Docker or arbitrary host commands;
- host-restricted remains a path/environment restriction, not a security claim
  equivalent to a container or VM;
- a small amount of platform adapter code remains for true descendant-tree
  termination and daemon integration.

## Rejected alternatives

- passing `shell: true` or a model-provided command string;
- inheriting the daemon's complete `process.env`;
- silently falling back from an unavailable external sandbox;
- copying Codex/OpenHands process or sandbox implementations.
