# ADR 0006: Ratio-first responsive Web layout

- Status: Accepted
- Date: 2026-08-03

## Context

VibeGo is accessed from remote browsers whose physical devices are not known to
the daemon. Width-only media queries make a portrait monitor look like a very
tall phone and make unfolded foldables inherit a cramped desktop rail. Device
sniffing would be brittle, privacy-sensitive, and impossible to maintain for
new form factors.

## Decision

Use CSS media queries combining viewport width with `aspect-ratio`. The UI has
explicit density and information-hierarchy policies for seven ratio buckets,
with conservative fallbacks at overlap boundaries. React components remain
semantic and shared; only layout, ordering, density, and action grouping vary.

## Consequences

- New form factors can be supported by adding a bounded ratio rule without
  changing the daemon or storing device identity.
- Unit and CSS contract tests are the repository gate; screenshots may be used
  locally for design review but are not committed or embedded in README files.
- Exact hinge geometry is not promised; foldable and tri-fold devices receive
  a safe tablet composition based on their current viewport ratio.
