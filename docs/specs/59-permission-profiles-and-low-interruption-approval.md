# Spec 59：Permission Profiles、低打扰自动审批与 Full-host 模式

- Status: Draft（规划规格；不改变当前运行时）
- Date: 2026-08-05
- Scope: permission/capability profile、ApprovalPolicy、SandboxResolver、daemon
  settings、Web onboarding/settings 和 run snapshot
- Related: [Spec 48：Approval/Sandbox/Shell](48-approval-sandbox-shell-runtime.md)、
  [Spec 52：Capability profiles](52-capability-profiles-and-first-run-experience.md)、
  [Spec 58：Goal/Harness completion](58-goal-control-and-harness-completion.md)、
  [ADR 0003：LAN access and Codex-like approval](../adr/0003-lan-access-and-codex-like-approval.md)、
  [Harness contracts](../harness-contracts.md)

## 1. 目的与关系

VibeGo 需要同时满足两种真实使用方式：

1. 推荐的 `workspace-coding`：Agent 只在选定 workspace 内工作，低风险重复操作尽量
   自动通过，用户不需要为每次读取、搜索、测试或确定性编辑反复点击；
2. 高级的 `full-host`：用户明确承担风险后，允许 Agent 使用主机级文件和进程能力，
   并可对当前可信 session 使用低打扰的 session auto-approval。

本规格是独立的权限与审批体验规格，不把内容追加到 Spec 52。Spec 52 的 first-run、
profile snapshot、transport 和发布门禁仍然有效；本规格只定义其后的权限细化、审批
姿态和 full-host 能力。若两者约束冲突，以更严格的服务器安全策略和本规格的 fail-closed
规则为准。

本规格不把“少打扰”实现为模型自我授权，也不把“全主机”实现为默认权限。权限只能由
认证用户在 Web/Host 中显式选择，并在 daemon application boundary 编译为不可变 run
snapshot。

## 2. 强制安全边界

- 默认 profile 仍然是无主机副作用的安全模式；`full-host` 永远不是默认值；
- `full-host` 必须经过一次清晰的风险确认，确认内容包括主机文件、进程、凭据暴露和
  破坏性命令风险；确认不能由模型文本、Goal payload 或远端未经认证请求伪造；
- `full-host` 只允许 `trusted-user`/`trusted-workspace` task；`untrusted-content`
  必须 fail-closed，不得通过 host fallback；
- full-host 不自动开启公网、LAN、Tailscale、SSH、MCP/Skill 或网络访问；transport、
  network 和 tools 仍是独立 capability；
- `workspace-coding` 的 external sandbox 不可用时，必须显示 `degraded/blocked`，
  不得静默切换到 full-host；
- 任何 session auto-approval 都不能突破 managed policy、服务器 deny、操作系统权限、
  Goal governed Gate/quota、Scheduler、WorkspaceRegistry 或 Sandbox 安全边界；
- settings/profile/approval grant 改变只影响新 run；运行中的 run 保留 provider、workspace、
  policy、approval、sandbox 和 permission snapshot；
- 所有 grant 都有 scope、policy revision、expiry、最大使用次数、撤销状态和审计引用；
- secret、private key、完整环境变量、绝对路径、原始命令和完整 tool arguments 不进入
  Web response、浏览器存储、事件或日志；只保存 bounded fingerprint 和安全摘要。

## 3. Permission Profile v1

本规格新增版本化的 `permission-profile/v1` intent/resolution contract。它可以被
Spec 52 的 capability profile 引用，但不改变既有 `run_events`/`goal_events` 事实源。

### 3.1 `workspace-coding`

| 维度 | 默认语义 |
| --- | --- |
| Filesystem | 仅选定 workspace，read/write scope 由 WorkspaceRegistry 决定 |
| Shell | 优先 external digest-pinned sandbox；没有健康 sandbox 就 blocked/degraded |
| Network | off；需要时单独申请 restricted/explicit enabled |
| Approval | `bounded-auto` |
| Task trust | trusted 或受限 untrusted；untrusted 不得获得 host shell |
| Goal | interactive 可直接运行；governed 必须经过 Goal admission |

允许低风险自动审批的默认类别：

- workspace 内的目录/文件读取、搜索、状态查询和 bounded diff；
- 已注册、版本固定、参数 fingerprint 固定的格式化、测试和静态分析；
- external sandbox 内的非特权、受资源/网络/输出上限约束的重复操作；
- 用户已经明确授予且仍处于 TTL/usage 范围内的同一 approval key。

下列操作必须继续 `ask` 或 `deny`，不能因为 bounded-auto 而静默放行：

- 删除、覆盖、批量重命名或破坏性 Git 操作；
- workspace 外路径、符号链接逃逸、系统目录、凭据/环境变量访问；
- host process、提权、服务/防火墙/注册表修改；
- 网络访问、上传、MCP/Skill 未知工具和 manifest/schema 变化；
- 未知工具、参数 fingerprint 变化、policy revision 变化或不可信内容要求升级权限。

### 3.2 `full-host`

`full-host` 是面向明确知情用户的高风险模式，对应内部 sandbox policy
`danger-full-access`，但它不是隐式 bypass：

- Filesystem 可以超出 workspace；host process 可以按服务器允许的 argv/平台 adapter
  执行；
- 默认 network 仍为 off，网络必须单独启用；
- 必须显式确认、绑定当前 user/session/run snapshot，并在 UI 持续显示“Full host access”；
- 禁止 `untrusted-content`、来源不明的 prompt 注入和未经确认的权限升级；
- daemon 重启、session 结束、用户 revoke、policy revision 变化或 scope 变化会使 grant
  失效；
- 不提供自动 fallback：full-host 不可用时显示 blocked，workspace-coding 也不会反向切换；
- high-risk 操作仍可以被服务器 deny、managed policy、OS 权限或 kill switch 阻断。

### 3.3 `custom`

`custom` 允许用户从 workspace-only、full-host、network、MCP/Skill、sandbox 和
approval posture 中逐项选择，但最终 effective profile 只能比 server policy 更窄，
不能由浏览器扩大权限。任何包含 full-host 的 custom profile 都继承 3.2 的确认、trust、
revocation 和审计要求。

## 4. Approval posture

### 4.1 `bounded-auto`（默认推荐）

这是 workspace-coding 的低打扰默认姿态。每次自动批准都必须匹配确定性的 approval key：

```text
tool id/version
+ normalized-argument fingerprint
  + workspace id
  + permission/sandbox/network snapshot
  + policy revision
```

grant 必须有短 TTL、最大使用次数、显示原因、scope 和 revoke。任何 key 变化都重新进入
`ask`/`deny`，不能用“相似命令”扩大授权。

### 4.2 `session-auto`（full-host 可选）

用户在 Web 中完成一次高风险确认后，允许当前可信 session 在固定 permission snapshot
内自动批准符合服务器 policy 的工具调用，从而接近 Codex full-access + no-prompt 的
使用体验：

- 不为每个低风险/已确认操作再次弹卡片；
- 固定 session、workspace/host scope、policy revision、最大时长和最大调用数；
- 任何 untrusted task、secret/credential、提权、未知工具、network amendment、
  policy mismatch 或 destructive deny 仍然阻断；
- 用户可随时 revoke，revoke 立即阻止后续调用，不回溯或重放旧调用；
- run 终态、daemon restart、transport identity 变化或 snapshot 变化自动结束 grant。

`session-auto` 不是模型拥有的永久权限，也不是绕过 Goal、quota、Scheduler、Approval
或 Sandbox 的第二条路径。

### 4.3 `explicit`

每个需要审批的操作都显示 inline approval card。它是高风险、不确定或调试场景的保守
姿态，不影响只读 preview 和无副作用请求。

### 4.4 `none`

`none` 仅表示当前 profile 没有可审批的副作用能力，或服务器已把所有可能的操作固定
为 deny/只读。它不得被解释为“无限制自动允许”，也不得用于给 full-host 隐式授权。

## 5. Application flow

```text
用户选择 profile/posture
  -> daemon 校验 trust、server policy、transport、workspace、sandbox
  -> full-host 需要一次强确认
  -> 编译 permission + approval + sandbox snapshot
  -> 新 run 捕获 snapshot
  -> ToolExecutor 使用 exact approval key / session grant
  -> deny/ask/allow 写入 bounded audit metadata
  -> revoke/expiry/cancel 终止后续调用和相关子进程
```

daemon 必须新增或扩展以下受认证的 settings/application ports：

- `GET/PATCH /api/v1/settings/permissions`：读取/更新非 secret intent；
- `POST /api/v1/settings/permissions/confirm-full-host`：一次性确认当前 revision；
- `POST /api/v1/settings/permissions/revoke`：撤销 session/full-host grant；
- `GET /api/v1/settings/permissions/status`：返回 effective scope、expiry、degraded/
  blocked reason 和下一步，不返回路径、命令、环境或凭据；
- run creation 接受显式 permission snapshot reference；未提供时保持现有安全默认。

Goal governed run 必须先通过 Goal admission，再使用 permission snapshot；full-host
不能让 governed run 跳过 Gate、quota、validated Evidence 或 writeback。普通 unbound
interactive run 不被 Goal admission 静默拦截，但其工具调用仍受当前 permission/approval
policy 约束。

## 6. Web/UX 要求

- first-run 默认展示 `workspace-coding`，用一句话解释“只在当前 workspace 工作”；
- full-host 必须显示红色/高风险状态、覆盖范围、session expiry、可撤销按钮和明确的
  “不适用于不可信任务”提示；
- bounded-auto 显示“哪些操作会自动通过、哪些仍会询问”，不能只显示一个 `Auto approve`
  开关；
- session-auto 必须显示倒计时/剩余调用数和最近一次授权原因；
- approval card 允许用户“本次允许”“本 session 允许”“拒绝”，但服务器可以把请求
  降级为 ask/deny；
- 移动端和折叠屏保持主要操作、当前权限、revoke 和 approval 状态可见；
- permission 变化只影响新 run，当前 run 在 timeline 中显示已冻结的 snapshot；
- UI 永远不显示 host root 的绝对路径、完整命令或 secret-shaped 参数。

## 7. 测试与真实验收

必须覆盖：

- workspace-coding 的低风险重复操作自动通过且 exact key 变化重新 ask；
- 高风险、破坏性、网络、secret、未知工具、workspace 外路径和 untrusted content
  不会被 bounded-auto 放行；
- full-host 没有明确确认时 fail-closed；确认后只在 trusted session 内有效；
- full-host 不自动开启 network，不绕过 Goal Gate/quota/Scheduler/Approval；
- revoke、expiry、daemon restart、transport identity 变化和 policy revision 变化会使
  grant 失效；
- workspace-coding 的 external sandbox 不可用时不 fallback 到 host/full-host；
- 两个并发 run 不能共享一个不属于自己的 session grant；
- permission/settings 修改不影响已运行 run snapshot；
- Web/API/事件/日志不包含 credential、环境变量、绝对路径、raw command 或完整参数；
- Windows/macOS/Linux 的 host process tree、cancel、timeout 和 child cleanup 有测试；
- release smoke 至少分别验证 workspace-coding 和 full-host（trusted fixture）两种模式，
  真实 LLM 请求仍需经过 daemon、RunManager、AgentLoop 和 ContextManager；
- full-host smoke 不使用真实用户 workspace，不读取真实凭据，不修改系统服务/防火墙/注册表。

## 8. 实施阶段

### 59-0：权限边界复核

重新核实 Spec 48、52、58、`packages/sandbox`、`packages/policy`、现有 approval
continuation 和 capability settings；记录哪些现有字段可兼容，哪些需要版本化扩展。

### 59-1：Permission/Approval contracts

The 59-1 contract boundary is frozen as follows:

- `permission-profile/v1` is a strict, secret-free intent/resolution model. It
  separates workspace-only and host scopes, process/sandbox scope, network and
  MCP/Skill capabilities, task trust, approval posture, policy/capability/
  sandbox revisions, and immutable timestamps. `full-host` is never a default
  and requires an explicit confirmation at the application boundary.
- `bounded-auto`, `session-auto`, `explicit`, and `none` are enum values
  only; the contract does not grant execution authority. `session-auto` is
  valid only for a host-capable profile and remains bounded by scope, TTL, usage
  count and policy revision.
- Session grants contain only opaque IDs, bounded scope metadata, revisions,
  expiry/usage/revocation state and an audit reference. They never contain a
  bearer token, credential, path, command, environment, transcript or raw tool
  argument.
- Confirmation and revoke requests are explicit, idempotency-friendly DTOs;
  status projections expose effective scope, bounded reason codes and the next
  safe step without returning host paths or secrets. Unknown fields, absolute
  paths, control text and secret-shaped strings fail closed.
- The pure contract package exposes a safe `workspace-coding` default factory
  for legacy settings migration. It does not silently accept malformed or
  unsafe legacy values; application code must record the migration and persist
  the resulting non-secret revision through the later 59-3 settings slice.

Acceptance evidence for this slice is contract-only: strict Zod parsing,
cross-field safety invariants, safe-default migration fixtures and focused
contract tests. No AgentLoop, Scheduler, ApprovalBroker, SandboxResolver,
daemon route, Web setting or run snapshot is changed by 59-1.


新增 versioned permission profile、approval posture、session grant、confirmation、
revoke/status DTO；拒绝 secret/path/未知字段；为旧 profile 提供安全默认迁移。

### 59-1 implementation note (2026-08-05)

The pure contracts slice is implemented in
`packages/contracts/src/permission-profile.ts` and exported from the contracts
barrel. It provides strict schemas and parsers for permission profile intent and
resolution, settings projections, exact approval keys, bounded session grants,
full-host confirmation, revoke requests/results and status projections. Cross
field checks enforce trusted explicit host confirmation, sandbox references,
exact-key bounded-auto, expiry/usage/revoke invariants and no effective profile
on blocked/revoked/expired status. `createSafeDefaultPermissionProfile()`
is the only legacy migration target and never enables host, network or MCP/Skill.

The focused contracts gate passes with 21 test files and 92 tests. No daemon,
AgentLoop, Scheduler, ApprovalBroker, SandboxResolver, Web route, run snapshot,
`run_events` or `goal_events` behavior changes in 59-1.

### 59-2：Policy/Sandbox application wiring

把 workspace-coding、full-host 和 session-auto 接入现有 compiler、SandboxResolver、
ToolExecutor、Scheduler 和 approval broker；不修改 AgentLoop 核心循环，不添加第二套
审批或执行器。

#### 59-2 implementation boundary (2026-08-05)

The first 59-2 slice is an optional application adapter, not a new authority:

- `@ready4vibe/policy` resolves a validated permission profile against the
  run workspace, trust, policy revision and requested sandbox. It may narrow a
  request, but it can never widen `RunConfig`, managed policy, capability
  profile or server-owned approval rules.
- `@ready4vibe/sandbox` projects the corresponding sandbox request and delegates
  the final decision to the existing `SandboxResolver`. Missing or unhealthy
  external sandboxes, missing host confirmation, stale revisions and untrusted
  host requests fail closed; there is no host fallback.
- The daemon runtime adapter only narrows an already-created `ToolRuntime` to
  the captured permission families. It does not create tools, invoke a model,
  acquire a scheduler lease, approve a request or execute a process.
- `RunManager` exposes an optional pre-resolved permission binding seam. When
  present, it validates the effective profile before binding the runtime and
  fails before `run.created` for blocked/invalid bindings; when absent, the
  historical interactive path is unchanged. The binding is not persisted until
  59-3.
- The adapter is opt-in at this stage. Existing interactive runs without an
  explicit permission binding retain their historical path; daemon settings,
  confirmation/revoke application services and the persisted run permission
  snapshot remain Spec 59-3 work.

The focused acceptance gate covers workspace-only filtering, external-sandbox
requirements, full-host confirmation/trust checks, network/MCP narrowing,
session-auto grant scope/revision/expiry checks and the invariant that a
profile change cannot mutate an already captured runtime.

### 59-3：Daemon settings 与 snapshot

提供受认证 settings/confirm/revoke/status API，持久化非 secret intent，grant 只保存在
daemon 内存或受保护的 bounded state；新 run 捕获 immutable snapshot，旧 run 不变。

### 59-4：Web 低打扰体验

在现有 conversation-first Settings Sheet 和 approval card 中加入两个 profile、三种
approval posture、清晰的风险说明、session status、revoke、degraded/block guidance。

### 59-5：真实运行与发布证据

为 workspace-coding/full-host trusted fixture 分别运行 focused、daemon integration、
Windows process lifecycle、container/host smoke 和真实 LLM path；更新 Spec 48、52、58
的实现状态前，不得标记 Spec 59 为 Implemented。

## 9. Definition of Done

Spec 59 只有在以下条件全部满足后才能标记 `Implemented`：

1. workspace-coding 和 full-host 都有版本化 contract、policy、sandbox、settings、Web
   和 run snapshot 实现；
2. workspace-coding 的低风险重复操作明显减少审批打扰，同时高风险和不可信操作仍
   fail-closed；
3. full-host 必须明确确认、trusted-only、可撤销、有限时效，不默认启用且不隐式开启网络；
4. session-auto 不绕过 Goal、quota、Scheduler、Approval、Sandbox 或 managed policy；
5. 真实 smoke、失败/恢复、跨平台进程树和隐私测试全部通过；
6. 文档、`pnpm verify`、受影响 focused gates、`pnpm diff:check` 和 `git diff --check`
   在同一实现提交中同步完成。

## 10. 不在本规格内

- 不默认授予 full-host；
- 不为不可信任务提供 host fallback；
- 不通过模型提示词、Goal payload 或客户端字段授予权限；
- 不允许 session-auto 成为永久全局授权；
- 不把 full-host、network、public transport、MCP/Skill 自动捆绑开启；
- 不复制 Codex 源码或私有协议；只借鉴低打扰 approval 的可验证交互原则。
