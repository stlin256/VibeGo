# 分阶段路线图

**状态：Accepted（阶段 1–2、认证门禁、Web/PWA、LAN TLS、Skill/MCP manifest、Sandbox runtime 与 guided workspace registry MVP 已落地；Spec 42 Phase 42a/42b-1/42b-2/42b-3/42c-1/42c-2/42c-3/42d-1/42d-2 已实现；Spec 53 Phase 0/1/2/3/4/5/6 与 Spec 57 Phase 57a 已实现，其余 release-hardening 阶段仍为规划）**

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
| 10 | Host-first 发行 | daemon 同源托管 React Web、跨平台 launcher、内置 Node runtime、LAN 引导、签名更新/回滚 | 一个 Host URL 可完成本机和远程浏览器使用；不要求用户安装 Node/pnpm 或单独部署 Web |
| 11 | Native clients（后置） | 版本化 TypeScript client SDK、Android/iOS/HarmonyOS 客户端、设备会话和移动端恢复 | 只消费 Host REST/SSE；不读取 SQLite、不复制 AgentLoop/Approval/Sandbox |
| 12 | Host 安装与恢复 | 一键 Host bundle、平台签名、candidate/current/previous 升级、SQLite backup/restore、migration 和 safe mode | clean machine 可安装/升级/回滚；备份恢复不泄露 secret，失败不覆盖 current |
| 13 | 模型配置向导 | local/cloud provider preset、secret reference、health/model probe、能力快照和新 run 隔离 | 不编辑配置文件即可完成 provider setup；探测、真实调用和模型下载明确区分 |
| 14 | 公网部署与运维 | ACME staging/renewal/rollback、direct/reverse-proxy/Tailscale/SSH 指引、健康与事故 runbook | 公网显式 opt-in、TLS/pairing/CSRF/Origin/限流门禁通过；无隐式端口暴露 |
| 15 | 多语言与设备质量 | `en-US`/`zh-CN` catalog、WCAG 2.2 AA、Playwright ratio fixtures、真实设备/辅助技术矩阵 | desktop、portrait、phone、foldable、wide/tri-fold、tablet 的 primary action 可达 |
| 16 | Release 发布流水线 | Git tag、可重复构建、多平台 artifact、checksum、签名、SBOM、provenance、draft→stable promotion | stable 只发布不可变且可验证 artifact；安装/升级/模型/ACME/设备证据齐全 |

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

The first slice established the process-memory API boundary. Spec 36 now adds
durable non-secret settings through a separate SQLite adapter; native
remote-browser directory pickers remain deferred, while Git/diff tools are
tracked as separate milestones.

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

## Spec 34：长期目标控制层与 LoopX 思路整合（Phase 0/Phase 1 已实现）

详见 [Spec 34](specs/34-goal-control-plane-loopx-integration.md) 和
[ADR 0004](adr/0004-native-goal-control-and-loopx-interop.md)。该方案在
ready4vibe 内新增原生 TypeScript/SQLite Goal Control bounded context，吸收
LoopX 的 Goal/Todo/Gate/Evidence/Handoff、事件投影和可解释 `shouldRun` 语义，
但保留现有 run 执行平面、Scheduler、Approval、Sandbox、Workspace 和 SSE 合约
为唯一执行事实源。Phase 0 已完成 contracts、纯 reducer、内存 event store、幂等
claim/revision 和只读 projection 核心；默认后端不引入 Python LoopX runtime、CLI、
Markdown/JSONL 状态或 POSIX 文件锁。Phase 1 已实现独立的 `goal_events` SQLite
adapter、daemon 可选 wiring、受认证的 goal 列表/详情/JSON event replay API；这些
接口仍不接入默认 run admission。Goal 的普通配置和操作
继续通过 Web Settings/onboarding 完成，不要求手动编辑 `.env`、YAML 或数据库文件。

## Spec 35：Web Goal 只读投影（已实现）

详见 [Spec 35](specs/35-goal-web-readonly-projection.md)。本阶段只消费已经受认证的
`GET /api/v1/goals` projection：在现有 React/Vite run console 中增加 Goal 卡片，展示
Goal 状态、Todo/Gate/Evidence 摘要、quota spend、control revision 和 projection
checksum。客户端只在内存中保存响应，不把 Goal payload 写入 URL、`localStorage` 或
prompt；不增加 Goal SSE、轮询、scheduler、写操作或 governed admission。run 进入终态
后显式刷新一次 projection，刷新按钮在请求期间禁用。

退出条件已满足：API client、loading/empty/unavailable/ready UI、隐私渲染和
interactive run 回归单测通过；`pnpm typecheck`、`pnpm test`、`pnpm diff:check`
通过并完成独立 Git 提交。Goal 创建、Todo claim、Gate resolve 和 Phase 2 admission
继续后置。

## Spec 36：Durable non-secret workspace settings（已实现）

详见 [Spec 36](specs/36-durable-workspace-settings.md) 和
[ADR 0005](adr/0005-durable-daemon-settings-boundary.md)。本阶段让现有 Web
workspace selector 在 daemon 重启后保留自定义 id/label/path 映射，使用 SQLite
中独立的 `daemon_settings` 表和 `BEGIN IMMEDIATE` 写入。路径只存在于 daemon
本地设置/运行时，不返回 API、不进入浏览器、事件、SSE 或 Goal state；模型 API key
和证书私钥继续排除在持久化之外。

退出条件已满足：settings store、workspace restore/rollback、daemon wiring 和
重启测试通过；`run_events`、`goal_events`、AgentLoop、RunManager、Scheduler、
Approval 和 Sandbox 行为不变。模型 API key、证书私钥和 Goal 状态仍不进入该表。

## Spec 37：Ratio-first responsive Web experience（已实现）

详见 [Spec 37](specs/37-ratio-responsive-ui.md) 和
[ADR 0006](adr/0006-ratio-first-responsive-web.md)。本阶段将现有 React 控制台
从 width-only 断点升级为 width + aspect-ratio 双轴布局策略，分别覆盖横屏/竖屏
桌面、普通手机、折叠屏封面与展开态、阔折叠/三折叠和平板；CSS 不使用
UA/device sniffing，按 width + aspect-ratio 选择保守布局。视觉截图仅作为本地
开发辅助，不纳入仓库验收物。

## Spec 38：Conversation-first Web shell（已实现）

详见 [Spec 38](specs/38-conversation-first-web-shell.md) 和
[ADR 0007](adr/0007-codex-like-conversation-first-web.md)。在不复制 Codex
源码的前提下，将日常操作改为 workspace rail、conversation column、context
rail 三块层次；设置保留为认证抽屉/Sheet，连接、沙箱和 guardrail 摘要归入
context rail，Goal、审批、恢复和 run 事件继续由现有权威 API/SSE 提供。宽屏
网格使用可收缩中央列和有界右栏，避免 Goal 或顶栏在边缘被裁切；前端验收以
React smoke test、CSS contract test 和可用性为准。

当前交互约束：中心区域必须先呈现对话/运行时间线，再呈现底部 composer；
新建任务是一键清空草稿并聚焦输入，不要求用户先进入设置页。

## Spec 39：TencentDB Agent Memory 可切换融合与自动更新（Phase 0–6a 已实现，6b 进行中）

详见 [Spec 39](specs/39-tencentdb-agent-memory-integration.md) 和
[ADR 0008](adr/0008-tencentdb-agent-memory-sidecar-and-live-update.md)。采用
TencentDB Agent Memory 独立 sidecar + ready4vibe 原生 `AgentMemoryProvider` + Web
开关 + GitHub 上游自动构建/切换/回滚。`off` 模式保持现有行为，`memory-core` 是首选
MVP；`proxy` 已完成显式 endpoint adapter，Knowledge 已完成可选 settings/run context，完整
`full-stack` 与 Knowledge 工具化后置。TencentDB 只负责长期记忆和知识派生层，Goal/
Todo/Gate/Evidence、run/approval/sandbox/scheduler 仍由 ready4vibe 作为事实源。

实现顺序为：contract/Noop → MemoryCore adapter → Web Settings/status →
Supervisor current/previous revision 和候选健康检查 → RunManager/ContextManager bounded
integration → Proxy adapter → Knowledge。upstream
更新采用候选 worktree 构建和蓝绿式切换，不做运行中 Node 热替换；构建或 health 失败
保留当前版本，普通 Web 和 run 不因记忆服务不可用而中断。

Phase 0 已冻结 ready4vibe 原生 `AgentMemoryMode`、identity、recall/write/status DTO
和 `NoopAgentMemoryProvider`，并覆盖 bounded/strict/privacy contract 测试。Phase 1
已增加 daemon 原生 `fetch` 的 MemoryCore v3 adapter：健康检查、显式隔离字段、revision
读取、bounded/untrusted recall、身份隔离、降级处理和串行 compact write-back 均已覆盖
测试。该切片不引入 upstream SDK、sidecar、settings API、Web 卡片或 AgentLoop/RunManager
改动；默认 `off` 和现有 unbound interactive run 仍为零网络、零子进程、零 prompt 变化。

Phase 2 已增加 `agent-memory/v1` 的非 secret durable settings snapshot、认证 API
（GET/PATCH/probe/update/rollback/webhook）和 Settings drawer 状态卡片。Phase 2 单独运行时
没有 sidecar Supervisor，update/rollback 会明确返回稳定的 degraded/update 状态，不会
伪造 revision 切换；MemoryCore 未配置或不可用也不会阻塞 Web/run。

Phase 3 已增加可注入依赖的 `TencentMemoryRuntimeSupervisor`：候选 revision 使用独立
worktree、frozen install、build/typecheck、临时端口 health、MemoryCore smoke 后才可
原子切换；构建/health/smoke 失败保留 current，切换后失败可回退 previous。Web 更新、
定时触发和 webhook 通知共用串行队列，Windows 子进程终止与端口释放均有测试。该阶段
仍不把 TencentDB 模块加载进 daemon，也不接入 AgentLoop 默认 run admission。

Phase 4 已在 daemon application service 接入 bounded run integration：新 run 冻结
provider/identity/revision snapshot，recall 结果经 ContextManager 的 retrieval item、
trust 标记和字节预算后才进入 AgentLoop；终态 write-back 仅后台提交 compact summary，
memory 故障不阻塞 run，settings 切换不影响已启动 run。该阶段不修改 AgentLoop 核心状态机、
run/Goal 事件事实源或 Scheduler/Approval/Sandbox。

Phase 5 已增加 daemon-local `TencentMemoryProxyProvider`：Proxy 使用显式
`chatCompletionsPath`（默认 `/proxy/{spaceId}/v1/chat/completions`）和独立 `/health`
探测，发送 bounded identity headers，不复用会隐式追加路径的直连 Provider。Proxy
模式下 provider 与 identity 随 run snapshot 冻结；Proxy 负责注入/写回，ready4vibe
侧 recall/write 保持 validated no-op，避免重复记忆写入。Proxy 在流开始前失败时可按
`fallbackToDirectProvider` 回退到同一 run 的直连 Provider；部分流不会重放，状态只标记
degraded。Proxy credential 仅来自进程运行时，未加入 settings、Web、事件或文档。
Phase 5 同时增加独立的 MemoryKnowledge 只读 adapter：它通过 `/v3/tools/list` 与
`/v3/tools/call` 提供 Wiki/CodeGraph descriptor 和静态只读白名单，执行 bounded、
可取消、privacy-checked 的调用，并转换为 untrusted retrieval `ContextItem`。它不注册
任意 ToolRuntime，不进入默认 run 创建路径，也不改变 Goal/run/Scheduler/Approval/Sandbox
事实源。Phase 6a 已增加独立 `agent-memory-knowledge/v1` 资源 settings、认证 probe、
`autoRetrieve=false` 默认值和新 run snapshot 的可选 bounded context 注入；它仍不注册
任意 ToolRuntime，结果仍受 ContextManager 字节预算和 untrusted trust 标记约束。Proxy
sidecar 自动构建/切换和 Knowledge 工具化仍是后续阶段；运营 history 已在 Phase 6b
首个切片中以独立、bounded 的 diagnostics projection 落地。

### Phase 6b：运营可观测性与 upstream 兼容门禁（进行中）

本阶段只增加独立的只读 operations projection：bounded update history、health latency、
recall hit/miss 和 compact write queue 状态；不把指标写入 `run_events`、`goal_events` 或
memory payload。候选 revision 在切换前必须通过其自身 manifest/lockfile/README 解析、
adapter contract fixtures、frozen install、typecheck、health 和 smoke。失败候选保留
current，`current`/`previous`/candidate 受清理保护。运维可锁定不可变 upstream commit
进行恢复，但锁定不绕过安全检查。sidecar license/NOTICE、构建缓存、revision 保留与
daemon 重启恢复规则将同步记录在 Spec 39/ADR 0008，并为 Web/daemon 增加回归测试。

## Spec 40：Goal write API 与 bounded mutation service（Phase 2A 已实现）

详见 [Spec 40](specs/40-goal-write-api-and-bounded-mutations.md) 与
[ADR 0009](adr/0009-goal-write-api-and-mutation-boundary.md)。`GoalWriteService` 已在
daemon application-service 增加有限、受认证的 Goal/Todo/Gate/Evidence mutation API。
每个请求使用 eventId 幂等键和 controlRevision optimistic concurrency，validated Evidence
是 Todo completion 的硬门禁；服务在 event stream 上完成重启后幂等和 fingerprint conflict。

Phase 2A 不提供 raw event ingest、quota spend、claim UI 或 governed scheduler，也不接入
默认 run admission；AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry、
`run_events` 和 `goal_events` 的事实源边界保持不变。Web editor 与 governed preflight 留到
后续 Phase 2B。Goal write API 已完成，Web editor、claim/release UI 和 governed preflight
仍后置。

## Spec 41：Host-first 发行、同源 Web 与后续客户端边界（设计约束已接受，Spec 51 R1–R4 已实现）

详见 [Spec 41](specs/41-host-first-distribution-and-client-boundary.md) 与
[ADR 0010](adr/0010-host-first-same-origin-web-and-client-boundary.md)。最终发行形态是一个
VibeGo Host：daemon 同时提供 React Web 静态资源、REST API、SSE、SQLite 和执行平面；远程
用户只需在桌面、手机、平板或折叠屏浏览器中打开 Host URL。生产环境不要求用户启动 Vite、
配置 CORS 或单独部署 Web server。

实现顺序为：daemon 同源托管 `apps/web/dist` → launcher 生命周期与版本化 client SDK →
内置 Node runtime 的 Windows/macOS/Linux Host 发行包 → LAN TLS/QR pairing/平台 secret
store/签名更新 → 原生客户端 SDK。当前 Spec 51 R1–R4 已覆盖静态托管、launcher、证书 readiness
和 SDK；R3b ACME/OS-store/renewal 与发行包仍后置。Android、iOS、HarmonyOS 客户端明确后置；它们只消费版本化 REST/SSE、
pairing 和 device session，不读取 SQLite、workspace 或 memory sidecar，也不复制 AgentLoop、
Scheduler、Approval 或 Sandbox。

## Spec 42：shadcn 风格 Web 设计系统与 conversation-first UI（42a–42d-2 已实现，真实设备验收后置）

详见 [Spec 42](specs/42-shadcn-style-web-design-system.md) 与
[ADR 0011](adr/0011-shadcn-style-local-components-and-vibego-web.md)。Web 继续使用 React 19、
Vite 和 TypeScript，迁移为 VibeGo token 驱动的 shadcn 风格 conversation shell。组件选型
遵循组件库优先：shadcn registry/Radix 或经过评估的 headless 库优先，原生 HTML 仅用于
简单语义元素，自定义 primitive 必须记录不采用现有库的原因并有完整无障碍测试。

阶段顺序为：42a token/组件库接入与基础 primitives → 42b 对话 shell → 42c Settings、
Approval、Goal、Memory 和 operation cards → 42d viewport/键盘/无障碍/bundle 验收。上述
自动化阶段已完成，该阶段
不改 daemon、REST/SSE、AgentLoop 或原生客户端边界。

Phase 42a 已建立 semantic VibeGo tokens、轻量 `cn`/variant helper 以及
Button/Input/Textarea/Label/Card/Badge/Separator/Skeleton 基础 primitives；42b/42c
已迁移 conversation shell、Settings、Approval、Goal、Memory 和 operation surfaces，
42d-1/42d-2 已固定键盘语义、viewport CSS contract、typecheck/build 与 bundle gate。
组件只负责 presentational rendering，不访问 API、storage 或 secret。当前 Web focused
gate 为 94 tests，typecheck/build 与 `pnpm check:web` 均通过；真实屏幕阅读器、Playwright
viewport 和物理设备 evidence 仍后置。

Phase 42b-1 已将 conversation stream、composer、RunConsole 和 bounded
tool-output inspector 抽出到 `components/vibego/ConversationShell.tsx`，并改用
Phase 42a Button/Textarea primitives。所有 run/event/approval/cancel callback
仍由 App 注入，不创建第二条 SSE 或事实源；Settings drawer 留在后续
42c 切片。

Phase 42b-2 已将 workspace rail 与 context rail 抽出到
`components/vibego/WorkspaceRail.tsx` 和 `ContextRail.tsx`，使用 Button/Card
primitives，并保持既有 responsive landmarks、Goal/observability read-only
projection 与 health metadata。组件不发请求、不读 storage/secret、不回显
workspace path；Settings drawer 和 operation cards 留给 42c。

42b-3 已将 topbar 抽取为 `components/vibego/ConversationHeader.tsx`，只接收
locale、连接/上下文/设置快照和显式 callback；Settings drawer、operation
cards、API/SSE 与所有安全事实源仍由 `App`/`ApiClient` 持有。该切片覆盖
connected/awaiting-pairing、locale ARIA、快捷键提示和窄比例换行，下一步进入
42c 的 Settings/operation surfaces。

42c-1 已抽取 `ApprovalCard` 与 `RecoveryCard`：它们只接收 bounded run
projection 和显式 allow/deny/retry callback，保留 destructive deny、recovery
new-run 与现有 CSS landmark；不会创建请求、写入事件或接管 Approval/RunManager
事实源。Web focused gate 当前 86 tests、JS/CSS gzip 为 80.60/5.82 KiB。
Goal/Memory/Tool cards 仍按后续 42c 切片推进。

42c-2 已抽取 `SettingsSheet` 对话框壳，保留 `App` 对表单状态、焦点 trap/return、
API callback 和 secret-safe persistence 的所有权；组件只呈现 bounded copy/children
和现有 dialog ARIA/CSS landmark，不新增 settings API 或第二事实源。Web focused gate
当前 88 tests、JS/CSS gzip 为 80.68/5.82 KiB。

42c-3 已增加 `SettingsTabs` 与 `SettingsSection` 本地组合组件，按 Run、Tools、
Access 将现有设置控件分组，并统一 loading/degraded/unavailable/ready 状态的
presentational 语义。Tabs/tabpanel 的 active state 仅由 `App` 管理；未激活面板使用
`hidden` 保持 DOM/SSR 稳定，不新增请求、storage 或安全事实源。该切片保留所有
已有字段、API callback、焦点 trap/return 和 secret-safe persistence，focused tests
覆盖 ARIA、面板隐藏、状态变体和敏感信息排除。Goal/Memory/Tool cards 的更深层抽取
以及 42d viewport/键盘/无障碍/bundle 验收仍后置。当前 Web focused gate 为 94 tests、
typecheck 和 production build；观测到 JS gzip 82.52 KiB、CSS gzip 6.06 KiB。

42d-1 已为 `SettingsTabs` 增加 Arrow/Home/End 键盘导航、单一 roving
`tabIndex=0` 和 bounded focus return；行为由纯 resolver 与组件 contract tests
覆盖，不创建浏览器请求或第二状态源。该切片只证明自动化键盘语义，不替代真实屏幕
阅读器、Playwright viewport、对比度或物理设备验收。

42d-2 已固定 `pnpm check:web`：复用 `check:module -- @ready4vibe/web` 的依赖闭包
build/typecheck/focused tests，再检查 `apps/web/dist/assets` 的 JS/CSS gzip budget 与
`git diff --check`。脚本只接受固定模块流程，不运行全仓测试、不读取 secret 或运行时事实源；
它是可重复的工程门禁，不是 viewport、屏幕阅读器或真实设备通过证据。
最近一次 `check:web` 通过：Web focused 94 tests、typecheck/build、JS 80.41 KiB gzip、
CSS 5.90 KiB gzip；`test:workflow` 的 31 个脚本测试也通过。

## Spec 43：资源、Token、费用与审计可观测性（Phase 43a/43b 已实现）

详见 [Spec 43](specs/43-resource-usage-and-cost-audit.md) 与
[ADR 0012](adr/0012-local-resource-and-cost-audit-ledger.md)。Phase 43a 只建立
`resource-usage/v1`、`audit/v1` contracts，以及不连接运行时的 model usage replay
projection；它按已有 `run_events` 的 `seq` 生成稳定 checksum，明确
reported/estimated/unknown 精度并保持隐私脱敏。Phase 43b 已增加独立 in-memory/SQLite
ledger 与 UTC hour rollup，使用 BEGIN IMMEDIATE、ID 幂等、批量回滚和 hash-chain，但仍不接入采样器、
daemon/API/Web，也不改变 interactive run、Goal、AgentLoop、Scheduler、Approval、Sandbox
或 Workspace 行为。

后续顺序为：43c 低资源 host/tool/sandbox collectors → pricing settings、retention
与实测资源预算；认证 API、Usage/Audit projection 和 Web context panel 已由 Spec 45-R5
落地，终态 run-event usage bridge 已由 Spec 50-R5 落地。

## Spec 44：Provider/Usage 管理与上游源码复用门禁（44-R0/44-R1/44-R2/R3/R4 已完成）

详见 [Spec 44](specs/44-provider-usage-management-and-upstream-reuse.md)、
[ADR 0013](adr/0013-upstream-research-and-provider-management-boundary.md) 和
[实施提示词](prompts/44-provider-usage-management-implementation.md)。本阶段把
CC Switch、AxonHub、LiteLLM、Langfuse 和 OpenTelemetry 的可借鉴语义映射到
VibeGo 原生 Provider registry、usage normalizer、pricing catalog、dedup/reconcile、
resource sample、audit 和 projection；不引入完整 proxy、Tauri、Python runtime、CLI
session 扫描或第二套事实源。

44-R0 已在 [上游调研记录](research/upstream-provider-usage.md) 中固定五个 canonical repository 的
commit、许可证、文件路径、语义摘要和 clean-room 决策；本阶段没有复制上游代码或新增运行时依赖。
44-R1 已完成纯 schema/registry/normalizer 与单元测试；这些实现不接入 AgentLoop 或默认 run。
Spec 43b 已提供唯一独立 ledger/rollup，44-R2 已补齐 provider usage 的 bounded reconciliation、
去重和 conflict port，不创建第二套账本；44-R3 已完成基于同一 `PricingRule`/`cost` contract 的
纯内存 pricing catalog 与 BigInt cost projection；44-R4 已完成 Node/adapter resource collector、
bounded queue、degraded 状态和 audit application adapter。退出顺序为：44-R5 认证 API、Web
Usage/Audit 和显式导入。当前下一步为 Spec 45 的只读 Usage/Audit projection；任何上游
commit、许可证、路径或语义变化都重新触发 R0；当前 Spec 43 的 contracts/ledger 实现状态以其
Spec 和 `implementation-status.md` 为准，现有 interactive run 行为保持不变。

## Spec 45：Observability API 与 Web Usage/Audit projection（45-R5 基础切片已完成）

### Spec 45 R5 implementation update (2026-08-04)

The first API/Web projection slice is complete: authenticated bounded summary,
timeseries, run usage, audit, pricing, rebuild, and verify endpoints now reuse
the existing ledger, while the Web context rail renders a non-blocking Usage/Audit
panel. Automatic sampling settings, export/import, and pricing catalog wiring
remain later work; interactive runs and Goal behavior are unchanged.

详见 [Spec 45](specs/45-observability-api-and-web.md) 与
[ADR 0014](adr/0014-observability-api-and-web-projection.md)。R5 只通过现有 AuthGate 和
Host-first daemon 注入 observability ledger，提供 bounded summary、timeseries、run usage、
audit verify/replay 和只读 pricing projection；Web 以 context panel 消费，不读取 SQLite、不
返回 raw payload，也不改变 interactive run 或 Goal 行为。

## Spec 46：Automated verification workflow（已接受）

详见 [Spec 46](specs/46-automated-verification-workflow.md) 与
[ADR 0015](adr/0015-automated-verification-workflow.md)。`pnpm verify` 固定执行
typecheck → test → diff:check → git diff --check，失败即停，不安装依赖、不改工作区、
不触碰模型凭据；它复用现有 package scripts，作为每次实质性提交前的统一门禁。

## Spec 47：Model/Context/AgentLoop productionization（R1/R2/R3/R4 已实现）

详见 [Spec 47](specs/47-model-context-agent-loop-productionization.md)。本阶段先以
pinned upstream research 为 R0 门禁，再把真实 provider 的显式 endpoint、协议适配、流式
replay、取消/重试、ContextManager 字节/token budget 和 AgentLoop 多轮验证接入现有
application service。真实 LLM smoke 只允许通过独立命令和进程外 secret 触发，`pnpm verify`
绝不联网；任何 provider、usage 或 context 故障都不能覆盖原始 run/tool/approval 结果。
当前先完成无网络的 contract、stream replay、retry/cancellation fixture 和显式
OpenAI-compatible endpoint adapter；该切片已覆盖 provider snapshot、Responses/
Anthropic-shaped fixture replay、token/byte compaction 与 pre-stream retry，daemon
R3 daemon/application bridge is now implemented; live smoke remains the later
opt-in R4 command for ordinary development and is mandatory for the Spec 52
release gate. The R3 slice gate passed with 402 tests; the R1 gate passed
with 412 tests; the current repository gate is `pnpm verify` with 420 tests
after Spec 48-R2. R4 is implemented as the explicit `pnpm smoke:model` command:
complete HTTPS endpoint + model + environment-variable secret reference,
bounded replay, redacted `model-smoke/v1` report and no daemon/event/file
side effects. Its tests are network-free and the command remains outside
`pnpm verify`; one redacted DeepSeek-compatible live smoke completed with
healthy status and reported usage without changing daemon defaults.

## Spec 48：Approval/Sandbox/Shell runtime closure（48-R4 已实现，Spec 49 规划）

详见 [Spec 48](specs/48-approval-sandbox-shell-runtime.md) 与
[ADR 0017](adr/0017-policy-compiler-and-bounded-approval.md)。48-R1 先交付纯
policy compiler：精确参数 fingerprint grant key、短期/限次 session grant、
stale revision fail-closed、effective sandbox/network snapshot 与安全 reason/audit
metadata。它不改变 AgentLoop、RunManager、HTTP、run_events、goal_events、Scheduler、
Sandbox 或 WorkspaceRegistry。后续再完成 Windows/Unix 进程树、外部容器 smoke 和 Web
approval continuation；模型输出永远不是授权，host-restricted 不得显示为强隔离，危险工具
仍需审批/沙箱/调度三重门禁。

48-R1 的 focused policy tests 与全仓 `pnpm verify` 已通过（该切片 412 tests）；
48-R2 现在补齐注入式 host-restricted process runner：argv/shell:false、
workspace realpath、最小环境、超时/输出上限和 Windows tree-termination port；
该切片 focused sandbox-runtime tests 17 个，全仓门禁当前 420 tests；真实进程、
容器和 Web approval continuation 保持后续阶段。

48-R3 已实现 opt-in container smoke contract：`pnpm smoke:container` 只接受
Docker/Podman、immutable image digest 和可解析 workspace，固定执行无害 fixture，
restricted network、`--pull=never`、`--rm`、资源/超时/输出上限和取消均由现有
sandbox-runtime 计划/runner 执行；engine probe 与报告只返回 bounded、redacted 状态。
该命令不进入 `pnpm verify`、daemon 启动或默认 run；focused sandbox-runtime 30 tests
和 CLI workflow 7 tests 已通过，真实 engine/image smoke 仍由用户显式触发。

48-R4 已补齐不可信任务的 approval continuation 集成验证：外部 digest sandbox
和 restricted network 先进入 `approval.required`，Web allow 只恢复同一 run 的一次
显式工具 continuation；deny、cancel、重复决定、runtime 不可用和 recovery 不会执行
旧调用或隐式 host fallback。下一步进入 Spec 49 的 MCP/Skill transport lifecycle。

## Spec 49：MCP/Skill transport and capability lifecycle（R1/R2/R3/R4 已实现）

### Spec 49-R4 implementation update (2026-08-04/2026-08-05)

R4 is deliberately a run-scoped bridge. An immutable, healthy-verified MCP
capability snapshot is captured at run creation; only executable tool
descriptors may be bound. The bridge uses the existing ToolRegistry,
ToolExecutorRuntime, ApprovalPolicy/approval broker, Scheduler lease,
SandboxResolver and WorkspaceRegistry. It does not add a second execution or
event authority, and it does not modify the AgentLoop core state machine.

The bridge exposes a bounded MCP call port with the run AbortSignal and a
per-run idempotency ledger keyed by run/turn/call, descriptor revision and a
canonical input fingerprint. Matching completed or in-flight requests are
shared/no-op; a changed payload or revision is rejected. Recovery creates a
new run and never resumes an unknown in-flight remote call. MCP metadata in
`run_events` is limited to stable ids, revision/risk, attempts, byte counts,
safe error codes and truncated output; URLs, commands, argv, headers,
environment values, absolute paths and raw protocol bodies remain excluded.

The pure package bridge and opt-in daemon/RunManager composition are
implemented and focused-tested. `McpRunBindingManager` captures a verified
snapshot per run; the default daemon remains MCP-off until an application
service explicitly activates a call port. Disabled/degraded status omits the
bridge and never blocks ordinary runs. The public-protocol
`McpSessionActivationProvider` is now implemented behind an injected channel
factory; lifecycle drain is now the gate before real opt-in stdio/Streamable HTTP
smoke. The injected
`McpLiveActivationService` provider gate is now implemented and bounded;
no default provider or network/process side effect is enabled.
The R4 session lifecycle slice is implemented: explicit candidate close
ownership, per-run idempotent release leases, deferred drain on
refresh/deactivate, and bounded daemon shutdown are covered by focused tests.
Real opt-in stdio/Streamable HTTP fixture smoke is implemented and passed. It
is an explicit `pnpm smoke:mcp` command over fixed local fixtures, outside
daemon startup and the offline verification gate; its report is bounded and
secret/path-free. Production remote-server activation remains separately
opt-in and is not part of the default run path.
See [ADR 0023](adr/0023-mcp-r4-run-scoped-execution-bridge.md)
and the detailed acceptance tests in [Spec 49](specs/49-mcp-skill-transport-and-capability-lifecycle.md).

详见 [Spec 49](specs/49-mcp-skill-transport-and-capability-lifecycle.md)。本阶段将现有
manifest/one-shot boundary 扩展为可选 stdio/Streamable HTTP 连接，补齐 auth、session、
progress、cancellation、health（failed/connectivity-only/verified）、能力快照和 ToolRegistry
激活。关闭状态不得发起子进程/网络请求，MCP/Skill 失败只能 degraded，不能绕过 Approval、
Sandbox 或 Scheduler。

49-R1 已交付注入式 transport/session 边界：stdio 使用 argv/env allowlist 与 JSONL
framing，Streamable HTTP 使用精确 manifest URL、bounded headers/response 和可取消 fetch；
initialize、progress、request-id、401/403/429/5xx、timeout、malformed/oversized、disconnect
和 deterministic close 都只返回稳定错误/健康元数据。`@ready4vibe/skill-mcp` focused
20 tests 已通过；该切片不自动启动、不激活工具，也不进入默认 run，后续 R2 再做
capability snapshot/registry。

49-R2 先实现纯 capability projection：校验协议/schema/summary 上限、manifest
声明的 risk/sandbox/network/approval、server/tool allowlist、重复/冲突 revision
和单调 health checkId，生成可重建 fingerprint 的 immutable run snapshot。该切片不
调用 transport、不注册第二套 ToolRegistry、不改变现有 AgentLoop/RunManager/Approval/
Scheduler/Sandbox 或 run/goal 事件事实源；R3 才评估 daemon/Web status，R4 才接入
现有 ToolExecutor。

49-R2 已完成：`McpCapabilityRegistry` 以 27 个 focused tests 固化
allowlist、协议/schema/privacy、manifest-owned risk 与 network/approval/sandbox
门禁、单调 health checkId、重复/冲突 revision、read-only resource/prompt 和
immutable run snapshot/fingerprint。该纯 projection 不调用 MCP transport，也不改变
任何现有执行或事件权威；后续进入 R3 daemon/Web status。

### Spec 49-R3 implementation contract (2026-08-04)

R3 先落地非 secret `daemon_settings` 快照、认证 GET/PATCH settings、显式
probe/status 和 Web 设置卡。快照只包含 server identity、transport、label、
manifest revision 与 capability reference allowlist；URL、command、argv、path、
environment、credential 和原始 protocol response 均被拒绝。关闭时 probe 是零副作用
no-op；启用但没有注入 verifier 时返回 bounded `degraded`，不阻塞普通会话/run。
该切片不启动 MCP 子进程、不发网络请求、不注册 ToolRegistry，也不修改
AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry、
`run_events` 或 `goal_events`。详见 [ADR 0022](adr/0022-mcp-r3-settings-and-status-boundary.md)。

R3 当前实现已落地：`@ready4vibe/contracts` 的 strict settings/status/probe schema、
`McpSettingsManager` 的 SQLite/in-memory settings adapter、认证 daemon routes 和
conversation-first Web 设置卡均已覆盖 focused tests。未提供默认 probe，因此默认启动、
关闭状态和未配置 verifier 时仍不会启动子进程或发网络请求；R4 run-scoped
ToolExecutor bridge、注入式 activation、session drain 与本地 live smoke 均已实现，
默认 MCP 仍关闭。

## Spec 50：Observability lifecycle integration（R1/R2/R3/R4 已完成，R5 进行中）

详见 [Spec 50](specs/50-observability-lifecycle-integration.md)。本阶段在 daemon
application/RunManager 边界接入唯一 usage ledger、pricing/reconciliation、CPU/RSS/disk
采样和 audit hash-chain；`run_events`、`goal_events`、ledger 与 Web projection 保持独立。
采样队列、价格缺失和 writer 故障都 fail-soft，用户看到 `unknown/degraded` 而不是虚假的 0；
任何重试只重试 ledger append，不重试模型/tool/shell。

50-R1 已交付纯 application-port/lifecycle fixture：`packages/observability`
中的 `ObservabilityLifecycleRecorder` 对 create/retry/pause/cancel/recover/
terminal 做 bounded replay，按 logical attempt 生成一次 usage/tool/resource/
audit batch；重复 payload 是 no-op，冲突 fail-closed，关闭采样不写 resource，
writer 失败只返回 degraded。该切片不接入默认 RunManager.start，不修改
AgentLoop、Scheduler、Approval、Sandbox、WorkspaceRegistry、`run_events` 或
`goal_events`；R1 fixture focused gate 为 38 tests passed，fixture 不启动模型、
工具、shell 或网络。

50-R2 实现遵循已冻结门禁：ProviderUsageObservation 先 normalize/reconcile，再按
PricingCatalog revision 生成 ModelUsageRecord；缺失价格保持 unknown，partial/
failure counters、latency、TTFT 不丢失，usageId 重复为 no-op、不同 payload
fail-closed，writer 失败只返回 degraded。该 adapter 仍不接入默认 run 创建或
AgentLoop，network-free provider usage application fixture 已通过 focused tests。

50-R2 已完成：`ProviderUsageLifecycleAdapter` 位于 observability application
边界，47 个 focused tests 通过；它不改变默认 run 创建、AgentLoop、Scheduler、
Approval、Sandbox、WorkspaceRegistry、`run_events` 或 `goal_events`。

50-R3 文档门禁已冻结：ResourceCollector 只在显式 Scheduler lease 后启动，
pause/cancel/terminal stop+flush，recovery/retry 重新 capture snapshot；关闭
采样不创建 collector，unsupported/overflow/writer failure 只产生 bounded
degraded/unknown，不执行 shell/PowerShell/CLI 或 workspace scan。

50-R3 已完成：`ResourceSamplingLifecycleAdapter` 通过 54 个 focused tests，
只在 lease 后启动 collector，支持 pause/cancel/terminal stop+flush 和 recovery
新 snapshot；daemon 默认启动、RunManager、AgentLoop 与现有事件 authority 均未接入。

50-R4 已实现：settings/approval/sandbox/provider/model action 统一走
validated audit application service；显式导出是 bounded、canonical、checksum 与
hash-chain 可验证的本地包，导入只返回事实、不会自动写入或上传。60 个
observability focused tests 已通过；自动 daemon/API/Web wiring 仍后置。

50-R5 已完成终态 run-event usage bridge：只在 daemon application/RunManager
边界异步重放已存在的 bounded `run_events`，通过现有
`ProviderUsageLifecycleAdapter` 写入同一 usage ledger。该切片不启动
`ResourceCollector`，不记录工具/资源样本，不改变 AgentLoop、默认 run、Scheduler、
Approval、Sandbox 或 WorkspaceRegistry；writer 失败只产生 degraded，重复 usage
沿用 ledger 的 no-op/conflict 语义。package/daemon focused fixtures 已通过。

### Spec 47-R3/R4 implementation update (2026-08-04/2026-08-05)

The daemon/application bridge now resolves an explicit provider binding,
freezes a secret-free provider snapshot per run, and verifies a fake-fetch
two-turn/tool-call path through `RunManager` and the existing `AgentLoop`.
Provider switching is isolated to later runs and mismatched configured
providers fail before `run.created`. This slice keeps Goal admission, Approval,
Sandbox, Scheduler, WorkspaceRegistry and the durable usage ledger unchanged;
live provider smoke is now implemented as the later opt-in R4 command for the
offline development gate; Spec 52 still requires a successful redacted smoke
report before release review.

## Spec 51：Host-first release and client boundary（R1-R4 已实现，R3b 后置）

详见 [Spec 51](specs/51-host-first-release-and-client-boundary.md) 与现有 [Spec 41](specs/41-host-first-distribution-and-client-boundary.md)。本规格覆盖 daemon 静态托管 React Web、跨平台 launcher、单 Host URL、LAN/public TLS/certificate adapter 和未来 TypeScript client SDK；当前 R1-R4 已实现，R3b 仍按门禁后置。远程用户只需浏览器 URL 与 pairing；Android/iOS/HarmonyOS UI 后置，不读取 SQLite/sidecar，不复制 AgentLoop/Approval/Sandbox。

51-R1 已实现静态托管边界：daemon 仅从显式 Web dist 目录提供 GET/HEAD、SPA fallback
和安全缓存；`/api`、health、SSE 保留现有 AuthGate/CSRF/Origin；缺失构建、路径穿越、
symlink escape 和目录请求均 fail-closed。daemon static fixture 4 tests、daemon package
152 tests 已通过。

51-R2 已实现依赖零、可注入测试的 Host launcher 生命周期边界：解析受限参数、按平台
解析 per-user data dir、保留 loopback 默认和显式端口、PID lease/stale cleanup、redacted
child log、优雅停止/重启和显式 `--open`。8 个 Node fixture tests 已通过。它不安装
Node、不启用 LAN、不写 workspace/secret、不绕过 TLS/pairing；TLS/ACME、Tailscale/SSH、
签名发行包和升级/回滚仍留在 R3-R4 与 Spec 53/55/57。

51-R3a 已实现证书 readiness projection：复用已加载的非 secret metadata，按
TLS-required、loopback optional、expiry window 和 bounded SAN/hostname 判定 `ready`/
`degraded`/`blocked`，通过现有认证只读 API 提供稳定 reason/next-step；证书包 8 个 focused
tests、daemon focused gate 152 tests 已通过。R3a 不读取浏览器
上传的私钥，不接 ACME/DNS/OS store/自动续期；配置向导、candidate/previous renewal
和 rollback 留在 R3b。

51-R4 已实现版本化 `@ready4vibe/client-sdk`：实例内存 pairing/session、相对或显式
same-origin REST、run create/read/cancel/retry/approval，以及带 `Last-Event-ID`、序列
去重、有限重连、取消和终态停止的 SSE。SDK 不读 SQLite/workspace/secret，不复制任何
执行权威；native UI 仍以后置消费者处理。

## Spec 52：Capability profiles 与 first-run experience（R1 strict contract/resolver 已实现，runtime integration 待实现）

详见 [Spec 52](specs/52-capability-profiles-and-first-run-experience.md) 及其
[前置验证报告](reports/52-prerequisite-verification-2026-08-05.md)。本规格把
配置引导、能力档位、Approval/Sandbox、conversation-first Web 和 Host-first
开箱即用路径串成单一验收流，并把核心 Harness 的完整性作为发布门禁。它定义
`preview`、`workspace-coding`、`advanced-local` 和 `custom` 档位，要求能力按需
渐进开启、profile/run snapshot 隔离、失败无隐式 host fallback，并保留现有 daemon、
RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry、`run_events` 和
`goal_events` 的权威地位。Spec 52 还纳入显式 Goal governed admission、真实
Tailscale/SSH transport adapter、ACME staging/renewal 验证和强制真实 LLM smoke；
原生客户端是后置消费者，不阻塞 Web/Host 发布。R0 前置验证门禁已于
2026-08-05 完成；ADR 0033 已冻结版本化 Capability Profile contract，strict
contract 已在 `packages/contracts` 落地，纯 resolver 已在 `packages/policy` 落地，
下一步才进入 daemon application boundary，
不改变任何默认权限或 run 创建行为。

上述 Spec 47–52 是连续但可独立回滚的 Git 小阶段；每个阶段都必须先更新对应
Spec/ADR/implementation-status，再实现代码、补全单元/集成测试并运行 `pnpm verify`。

## Spec 53–57：面向可发布与更广泛用户的 Release hardening（分阶段）

新增规格均为 Proposed planning gate，除 Spec 53 Phase 0/1/2/3/4/5/6 与 Spec 57 Phase 57a 外，暂不改变当前运行时，也不替换既有
AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry、
`run_events` 或 `goal_events` 的权威地位：

- [Spec 53](specs/53-host-install-upgrade-backup-recovery.md)：Phase 0/1/2/3/4/5/6 已实现严格，包含显式确认后的
  restore apply 与只写
  staging 的 restore candidate adapter；
  host-manifest/v1、update/recovery 状态与 backup/restore/recovery/diagnostic
  contracts，以及 `SqliteBackupSnapshotAdapter` 的一致性、digest 和不可覆盖 snapshot
  写入；备份使用逻辑数据类，restore 要求确认并保留 current，safe mode 操作集合
  bounded 且排除凭据/workspace 文件。后续实现一键安装、平台签名、
  current/previous/candidate 升级、SQLite 一致性备份、restore/migration、safe mode
  runtime 和故障诊断 adapter；Phase 3/4/5/6 不接入 installer、Web 或 daemon route，也不执行
  migration。Snapshot fixture 4 tests、restore preflight fixture 10 tests、storage
  模块 66 tests、typecheck 与 build 已通过。Phase 5 不覆盖 current；Phase 6 仅在
  显式确认、兼容性和完整性复核通过后执行 guarded apply，保留 current 为 previous，
  不执行 migration、不导入 credentials/workspace files、不持久化 RestoreResult，
  失败时 rollback。该 adapter 要求调用方持有独占数据库访问边界，并不接入
  installer、Web 或 daemon route。
- [Spec 54](specs/54-model-provider-onboarding.md)：Phase 0/1/2/3/4 已实现 strict onboarding contracts、
  显式 bounded model probe、authenticated daemon probe route、Web Settings Probe 控件和
  durable non-secret endpoint profile；后续定义 local/cloud 模型向导、Ollama、
  LM Studio、llama.cpp、OpenAI-compatible、Anthropic 和 DeepSeek 显式 endpoint，采用
  secret reference、bounded probe、能力快照和 run snapshot isolation；不自动下载模型。
- [Spec 55](specs/55-public-deployment-certificates-operations.md)：Phase 55a 已实现严格的
  `deployment/v1` profile/readiness contract，覆盖 loopback/LAN/Tailscale/SSH/public
  direct/reverse-proxy 的显式模式、TLS fail-closed 和 bounded operational limits；Phase 55b
  复用现有 AuthGate 提供只读 readiness API/Web status；ACME
  HTTP-01/DNS-01、续期、回滚、trusted proxy adapter 和版本化运维 runbook 后置，不做 UPnP、
  自动防火墙或隐式公网暴露。
- [Spec 56](specs/56-i18n-accessibility-device-matrix.md)：Phase 56a 已落地
  `en-US`/`zh-CN` locale contract、独立非 secret 偏好、核心 shell accessibility 语义和
  ratio-first focused gates；Phase 56b 已落地 drawer focus scope 与 settings/guardrail
  catalog；Phase 56c 已实现八类 fixture、严格 compatibility/performance report
  contract 与 safe-area/fold CSS hook 的纯 Web slice；完整 catalog、WCAG 2.2 AA 人工审阅、Playwright
  device emulation 和真实设备 evidence matrix 仍后置，不以模拟器通过替代真实设备验收。
- [Spec 57](specs/57-release-publishing-pipeline.md)：Phase 57a 已实现严格的
  `release-manifest/v1` 与有序 promotion contract，含 immutable tag/channel、artifact
  checksum/target/evidence refs、stable approval 和 withdrawn 状态；contracts 模块
  通过 57 个 focused tests、typecheck 与 build。后续接入 tag/channel workflow、可重复多平台
  构建、平台签名、GitHub artifact attestation、SBOM、Sigstore、draft→stable promotion、
  release evidence 和 withdrawn/rollback runtime 流程。

推荐实施顺序为 `53 → 54 → 56 → 55 → 57`；Spec 57 的 stable gate 必须汇总前四项的
安装、模型、证书、公网、无障碍、真实设备、性能和恢复证据。实现前应先阅读
[Spec 53–57 调研记录](research/53-57-release-install-model-operations-research.md)，
并在每个独立 Git 提交中同步对应 Spec、测试结果和已知限制。
