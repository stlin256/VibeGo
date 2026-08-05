# Spec 61-6 tool and approval fixture evidence

Date: 2026-08-05  
Code under test: `a52b85e`  
Evidence class: `fixture` (local default daemon runtime, deterministic provider)

The provider was injected as a deterministic fixture; no network request or
credential was used. The runtime still used the normal daemon HTTP surface,
RunManager, Scheduler, AgentLoop, ContextManager and event stream.

## Tool scenario

- scenario: `tool`
- run status: `healthy` / `completed`
- elapsed: `249 ms`
- tool evidence: requested `1`, started `1`, output `1`, completed `1`
- approval events: none
- provider snapshot: `deepseek`, config revision `harness-deepseek-config`,
  capability revision `deepseek-provider-capability-unprobed`

## Approval scenario

- scenario: `approval`
- run status: `healthy` / `completed`
- elapsed: `259 ms`
- tool evidence: requested `1`, started `2`, output `1`, completed `1`
- approval evidence: `approval.required=1`, `approval.decided=1` with one
  bounded `allow` submitted through the daemon `/approve` route
- provider snapshot: same secret-free DeepSeek snapshot shape as the tool case

The fixture ToolRuntime is an in-memory echo only. It rejects secret-shaped or
oversized input and is not production filesystem, shell, MCP, external-sandbox,
reviewer or search integration. The evidence therefore closes only the bounded
tool/Approval harness fixture gate.

