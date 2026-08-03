# 分阶段路线图

**状态：Accepted（文档阶段已完成；阶段 1–2、认证门禁、Web/PWA、LAN TLS、Skill/MCP manifest、Sandbox runtime 与 guided workspace registry MVP 已落地）**

每个阶段都是一个可回滚的 Git 提交或小提交组。完成条件包含：代码、单元测试、文档更新、验证命令和已知限制。

| 阶段 | 目标 | 主要交付物 | 退出条件 |
| --- | --- | --- | --- |
| 0 | 研究与边界 | 本文档集、ADR、调研记录 | 方案评审通过；不再存在未记录的“隐含核心决策” |
| 1 | 工程骨架 | pnpm workspace、TS config、contracts、测试基础 | contracts、testkit、scheduler、storage 可 typecheck/test |
| 2 | 可恢复 loop | fake model、run 状态机、事件日志、取消/超时、并发 scheduler | fake-model 集成测试覆盖正常、失败、取消、重连、并发和 workspace lease |
| 3 | 模型与上下文 | OpenAI-compatible adapter、流式 delta、预算和压缩、上下文来源标签 | provider contract + replay fixture + token budget/injection tests |
| 4 | 工具与审批 | filesystem/patch/git/shell、风险分类、审批 UI API、审计 | 路径穿越、命令注入、超时、拒绝等安全测试通过 |
| 4.5 | LAN TLS | 证书文件解析、HTTPS listener、HTTP/HTTPS health 标识 | LAN 默认无证书 fail-closed；证书/私钥校验与 daemon 测试通过（已完成） |
| 5 | 沙箱 | host-restricted adapter、Docker/Podman 命令计划与受控 CLI runner、资源限制 | plan/resolver/runner 隔离强度测试通过（已完成）；daemon 仅通过认证 Web 设置显式 wiring，默认关闭 |
| 6 | Skill/MCP | 严格 manifest loader、stdio/HTTP transport 边界、工具 allowlist | manifest/allowlist MVP 已完成；真实连接器仍需断连、secret 泄漏与审批集成测试 |
| 7 | Web/PWA | React 多端布局、SSE resume、pairing/run console/cancel MVP | Web typecheck/build、API/SSE 单测和 React smoke test 通过；Playwright desktop/tablet/mobile、diff/log/approval 深化后置 |
| 8 | 低资源与硬化 | 运行时指标、事件保留、速率限制、备份/导出 | 达到 `product-brief.md` 的目标，报告实测数据 |
| 9 | 扩展生态 | plugin/adapter SDK、文档站、示例技能 | 第三方可在不改核心包的情况下增加 provider/tool |

## 推荐第一条实现链

`contracts → fake-model loop → event storage → API/SSE → web read-only view → policy/approval → real tools → sandbox → MCP/Skills`。

当前已完成 `contracts → testkit → in-memory event storage → scheduler → SQLite EventStore → daemon /health → fake-model loop → run API/SSE → ContextManager/provider → agent 接入 → ToolRegistry/ApprovalPolicy → sandbox/execution 安全边界 → tool adapter → auth/transport 门禁 → Web/PWA MVP → LAN TLS MVP → Skill/MCP manifest/allowlist MVP → Sandbox runtime 命令计划/CLI runner MVP → guided workspace registry MVP`；随后接 Git/patch/diff 工具、ACME/certificate manager adapter、MCP/Skill activation 与 UI 深化。

这样早期就能证明“远程观察和可恢复”主路径，同时把危险工具放在经过测试的边界之后。

## Spec 18：AgentLoop/daemon tool wiring（已完成）

把模型 tool-call delta 接入已存在的 ToolRegistry、ApprovalPolicy、SandboxResolver
和 ToolExecutor。ToolRuntime 只允许显式注入；daemon 默认仍不启用主机工具。每次
调用都受 scheduler 的 toolProcesses 资源、run limits、沙箱和审批策略约束，并写入
`tool.requested`、`approval.required`、`tool.started`、`tool.output`、`tool.completed`
审计事件。审批续接 API、MCP/Skill 真实 transport 和默认 shell/container wiring
继续后置。

## Spec 19：MCP transport boundary（已完成）

在 manifest/allowlist 之上增加 one-shot JSON-RPC transport client：连接器必须显式
注入，严格限制 server/tool/version、env key、消息大小、请求超时和 response id。
stdio/HTTP 仅共享 channel contract；本阶段不启动子进程、不发网络请求，后续再接
sandbox、approval 和 scheduler。

## Spec 20：ToolExecutor runtime bridge（已完成）

将 AgentLoop 的通用 ToolRuntime 请求转换为 ToolExecutor 所需的 intent、sandbox
request 和 workspace root。三类解析器都必须显式注入，确保 path/command/network
能够参与 approval cache key；daemon 默认不创建 bridge。

## Spec 21：Approval continuation（已完成）

将 `approval.required` 变成可续接的单用户闭环：内存 broker、120 秒过期、allow/deny
一次性决策、AgentLoop 原地重试工具、`POST /runs/:runId/approve` 和 Web 审批卡片。
无 broker/runtime approval 能力时继续 fail-closed；重启恢复与持久化审批后置。

## Spec 22: Daemon restart recovery guard (已完成)

Durable SQLite events are scanned before the HTTP listener starts. Any run that
does not have a terminal status is marked `needs-recovery` exactly once. The
marker is deliberately metadata-only and never contains tool arguments,
environment values, paths, or secrets. Approval waits are not restored and no
operation is retried automatically; a later spec will add an explicit
user-confirmed retry/new-run flow.

## Spec 23: Explicit retry after recovery (current)

Expose an authenticated `POST /api/v1/runs/:runId/retry` confirmation action.
Only a recovered run can create a fresh run; the server reuses the persisted
user-level configuration and generates a new client request id. No old tool
arguments, approvals, output, or execution state is replayed.

## Spec 24: Certificate manager boundary and status (current)

Expose safe certificate metadata through an authenticated status endpoint while
keeping PEM/private-key bytes in memory only. ACME issuance, renewal, and
platform certificate stores remain explicit future adapters; no daemon startup
path performs implicit network calls.

## Spec 25: Configuration onboarding and settings UI (已完成)

All user-facing setup must be possible from the responsive Web console rather
than manual `.env`/YAML editing. The first slice will make workspace, model,
trust, sandbox, approval, and run-limit choices explicit in a settings panel;
server-side TLS/credential changes remain gated by safe adapters and never echo
secrets.

## Spec 26: Settings certificate guidance (已完成)

Bring the safe certificate status metadata into the guided settings surface.
Users see TLS validity and next-step guidance in the Web UI; no browser flow
uploads, edits, or downloads PEM/private-key material.

## Spec 27: Non-secret profile persistence (implemented)

Persist only the validated run profile in a versioned browser preference key so
refreshes keep user choices. Tokens, model credentials, certificate material,
and event payloads remain excluded and reset is always available. The Web
runtime now loads, saves, and resets this profile through a controlled storage
adapter; storage failures fall back to in-memory defaults.

## Spec 28: Model provider onboarding (implemented)

Add an authenticated, secret-safe Web setup flow for the OpenAI-compatible
provider. The first slice uses a process-memory secret-store boundary and
applies configuration to new runs without writing keys to browser storage,
events, logs, or URLs. OS keyring/Credential Manager persistence remains a
separate adapter milestone. The authenticated GET/POST/DELETE settings API,
runtime provider switch, and Web setup card are now covered by unit tests.

## Spec 29: Explicit filesystem tool wiring (implemented)

Wire the tested filesystem adapters into the daemon behind an authenticated,
process-memory Web toggle. The first slice exposes only bounded read/write
tools for the daemon working directory; shell, Git, MCP/Skill and external
sandbox remain separate fail-closed milestones. Multi-workspace mapping is now
provided by Spec 31.
The authenticated settings API, Web toggle, per-run runtime snapshot, and
guarded adapter tests are now implemented.

## Spec 30: Guided external shell and sandbox runtime (implemented slice)

The design and safety constraints are recorded in
`docs/specs/30-external-shell-sandbox-wiring.md`. The daemon now exposes
authenticated Docker/Podman probe/configure boundaries and the Web Settings
panel guides digest-pinned external shell enablement. `shell.exec` is only
available inside a healthy selected external sandbox, uses bounded resources,
restricted network by default, approval continuation, and a captured per-run
runtime. Host fallback, image pulls, VM providers, and persistence remain
deferred.

## Spec 31: Guided workspace registry (implemented slice)

`docs/specs/31-workspace-registry.md` defines the daemon-owned mapping from a
short workspace id to a guarded daemon-machine directory. The Web Settings
panel replaces the free-form workspace id field with a selector and an explicit
add/remove flow. Status and events never return absolute paths; new runs reject
unknown ids and capture the selected root for the lifetime of the run.

The first slice is process-memory only. Durable settings, native remote-browser
directory pickers, and Git/diff tools remain separate milestones.

## 暂缓决策

- 是否引入 Next.js/SSR：MVP 采用静态 Vite SPA；只有真实需求出现才评估。
- 是否采用 Redis/Postgres：单用户本地场景先不用；并发/协作需求出现时再增加 storage adapter。
- 是否支持浏览器自动化：不属于最小 coding harness，后续作为独立工具包评估。

## Spec 32 milestone note (2026-08-03)

The guided workspace registry milestone is followed by an opt-in Git
read-only slice. The Web console now enables only bounded `git.status`,
`git.diff`, and `git.log` descriptors through an authenticated settings toggle;
the daemon captures a workspace root per run and never exposes host Git to
untrusted or external-sandbox runs. Git write/patch operations, a paginated
diff/log explorer, and remote operations remain later milestones.

Spec 33 adds the first presentation slice for those results: the Web Run
Console shows bounded `tool.output` cards from the existing SSE stream, with
safe text rendering and low-resource display limits. Pagination, highlighting,
search/export, and inline review remain deferred.

## Spec 34：长期目标控制层与 LoopX 思路整合（Phase 0 已实现）

详见 [Spec 34](specs/34-goal-control-plane-loopx-integration.md) 和
[ADR 0004](adr/0004-native-goal-control-and-loopx-interop.md)。该方案在
ready4vibe 内新增原生 TypeScript/SQLite Goal Control bounded context，吸收
LoopX 的 Goal/Todo/Gate/Evidence/Handoff、事件投影和可解释 `shouldRun` 语义，
但保留现有 run 执行平面、Scheduler、Approval、Sandbox、Workspace 和 SSE 合约
为唯一执行事实源。Phase 0 已完成 contracts、纯 reducer、内存 event store、幂等
claim/revision 和只读 projection 核心；默认后端不引入 Python LoopX runtime、CLI、
Markdown/JSONL 状态或 POSIX 文件锁。下一步是独立 `goal_events` SQLite 适配器和
Phase 1 的第一步已实现独立的 `goal_events` SQLite adapter；下一步是受保护的只读
projection API，仍不接入默认 run admission。Goal 的普通配置和操作
继续通过 Web Settings/onboarding 完成，不要求手动编辑 `.env`、YAML 或数据库文件。
