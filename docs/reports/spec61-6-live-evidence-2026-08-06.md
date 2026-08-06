# Spec 61-6 DeepSeek live evidence (2026-08-06)

Evidence class: explicitly authorized, bounded live smoke. The credential was
read only from a process environment reference and was not written to the
repository, report, settings, events, logs or browser state. The endpoint and
run identifiers are intentionally omitted.

## Current-commit results

| Path | Status | Bounded evidence |
| --- | --- | --- |
| Direct adapter text | healthy | first token 593 ms; usage 16/6; one completed stream |
| Daemon interactive text | healthy | run completed; usage 19/9; immutable DeepSeek snapshot |
| Daemon interactive tool | healthy | 2 turns; 1 tool requested/completed; usage 713/58 |
| Daemon interactive approval | healthy | 1 approval required and 1 allow decision; 1 tool completed; usage 713/58 |
| Daemon governed text | healthy | Goal validated; Todo done; one quota consumed; usage 19/9 |

The tool and approval scenarios use the intentionally bounded in-memory
Harness echo runtime. They prove provider/tool/approval continuation through
the existing daemon and AgentLoop path, not production filesystem, shell,
container or full-host capability.

## Scope and limits

The successful governed result was collected after the Spec 58-6e terminal
ordering fix; the pre-fix run was retained as a bounded diagnostic showing
`terminal_event_mismatch`, quota release and no Todo completion. The live
evidence does not claim DeepSeek reasoning capability, provider-owned search
compatibility, reviewer automation, public deployment, device coverage,
cross-platform parity or release readiness. Those remain separate
fixture/live/release gates.
