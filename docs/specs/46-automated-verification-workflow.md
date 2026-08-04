# Spec 46: Automated verification workflow

- Status: accepted for implementation
- Date: 2026-08-04
- Scope: repository-local, non-secret validation orchestration

## Goal

Provide one repeatable command for contributors and CI to run the fixed
verification sequence. The command must fail fast, preserve each child
process's output and exit code, and never print environment variables or
credentials.

## Required sequence

The canonical command is `pnpm verify`. It runs, in order:

1. `pnpm typecheck`
2. `pnpm test`
3. `pnpm diff:check`
4. `git diff --check`

The script sets `CI=true` only when the caller has not already set it. It does
not install dependencies, alter the working tree, commit, push, or contact a
model provider. Dependency installation remains an explicit contributor step.

## Focused package validation

The full gate is intentionally not the inner development loop. When a change
is scoped to one or more workspace packages, contributors should run:

```text
pnpm check:module -- @ready4vibe/contracts
pnpm check:module -- @ready4vibe/model-openai @ready4vibe/context
```

`check:module` builds the selected packages and their workspace dependencies,
then runs `typecheck` and `test` only for the selected packages. It fails fast
and never starts a model provider. Add a directly changed dependency to the
selector list when its public contract or generated `dist` output is part of
the change. This keeps feedback fast without weakening the pre-commit
`pnpm verify` gate.

## Portability and failure behavior

- Resolve `pnpm` as `pnpm.cmd` on Windows and `pnpm` elsewhere.
- Run from the repository root regardless of the caller's current directory.
- Stop at the first non-zero exit code and return that code to the caller.
- Print only step labels and child output; do not dump `process.env`.
- Keep the existing package-level commands authoritative so the workflow cannot
  become a second build/test implementation.

## Exit criteria

The workflow is complete when `pnpm verify` passes on a clean checkout and when
its script is included in the repository README/developer documentation. The
workflow does not replace focused package tests; it provides the fixed gate used
before each substantive commit.
