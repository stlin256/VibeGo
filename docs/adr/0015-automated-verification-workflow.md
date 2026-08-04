# ADR 0015: One fixed repository verification command

- Status: Accepted
- Date: 2026-08-04

## Decision

Keep package build and test scripts as the source of truth, and add a small
Node orchestration script exposed as `pnpm verify`. The script invokes the
existing `typecheck`, `test`, `diff:check`, and `git diff --check` commands in a
fixed order and returns the first failure.

## Rationale

This makes the documented pre-commit gate repeatable on Windows, Linux, and CI
without adding another test runner, scheduler, dependency installer, or runtime
secret path. It is deliberately separate from the daemon and cannot affect a
run or its sandbox.

## Consequences

Contributors get a single command and stable failure boundaries. The workflow
adds a small amount of process startup overhead because `typecheck` and `test`
retain their existing build steps; that duplication is preferred to silently
changing package-level semantics.
