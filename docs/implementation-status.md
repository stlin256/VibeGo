# 实施状态与第一条纵切

**状态：Accepted（Agent Memory Phase 6b、Goal Control Phase 2A 与 Spec 42 Phase 42a/42b-1/42b-2/42b-3/42c-1/42c-2/42c-3/42d-1/42d-2 已实现；Web/PWA、LAN TLS、Skill/MCP manifest、Sandbox runtime、ToolRuntime、approval continuation 与 Goal 只读投影切片已通过；Spec 53 Phase 0/1/2/3/4/5/6 与 Spec 57 Phase 57a 已实现，其余 release-hardening 阶段仍为规划）**

## 当前实施范围

当前基线覆盖可测试的核心数据、调度、Web 设置和显式工具 runtime；真实模型、外部 MCP/Skill 连接和未经过用户确认的主机副作用仍保持关闭：

1. `packages/contracts`：Run、Event、Scheduler、ModelProvider 的最小 TypeScript contracts、Zod schema 和状态机校验；
2. `packages/storage`：内存 EventStore 与基于 Node `node:sqlite` 的 SQLite EventStore（UUIDv7 event id、单 run seq、批量追加/事务回滚、close/reopen）；
3. `packages/scheduler`：并发准入、workspace read/write lease、交互任务优先级、FIFO tie-break、取消和幂等资源释放；
4. `packages/testkit`：可中断、可延迟的 fake model provider 与事件类型投影断言；fake tool/clock 在后续 agent-loop 纵切补齐；
5. `apps/daemon`：最小 Node HTTP(S) server，默认 loopback，提供 health、认证 Web 设置 API 和 SQLite EventStore；LAN 仍受显式 TLS/配对门禁；
6. `packages/agent`：fake-model 单 turn orchestrator（生命周期事件、scheduler lease、取消、失败和输出上限），不执行真实工具；
7. `apps/daemon`：run manager、`POST/GET/cancel` API 和按 seq 回放/订阅的 SSE 已按 `docs/specs/06-run-api-sse.md` 实现；
8. `packages/context` 与 `packages/model-openai`：ContextManager 和 OpenAI-compatible provider 已按 `docs/specs/07-model-context.md` 实现并使用 mock fetch 测试；
9. AgentLoop 上下文接入和 daemon 环境模型配置已按 `docs/specs/08-agent-model-integration.md` 实现；
10. `packages/policy` 与 `packages/tools`：ToolRegistry、风险元数据和确定性 ApprovalPolicy 已按 `docs/specs/09-tool-policy.md` 实现；
11. `packages/sandbox` 与 `packages/execution`：external sandbox resolver、PathGuard、ArgvGuard 已按 `docs/specs/10-sandbox-execution.md` 实现；执行器仍必须显式注入并受审批/调度边界；
12. `packages/tool-adapters`：filesystem/shell handler 与统一 ToolExecutor 已按 `docs/specs/11-tool-adapters.md` 实现；默认不启动主机进程；
13. `packages/auth` 与 daemon transport gate：已按 `docs/specs/12-auth-transport.md` 实现单用户 pairing/token 和 LAN/TLS 门禁；证书/ACME adapter 后置；
14. `apps/web`：已按 `docs/specs/13-web-pwa.md` 完成 React/TypeScript responsive run console MVP，包含 pairing、Bearer/CSRF、run composer、run console、cancel 和 fetch-based SSE resume；
15. `packages/certificates` 与 daemon HTTPS listener 已按 `docs/specs/14-certificates-tls.md` 实现环境变量解析、PEM 读取/校验、LAN 默认 TLS fail-closed 和 HTTP/HTTPS health 标识；
16. `packages/skill-mcp` 已按 `docs/specs/15-skill-mcp-manifests.md` 实现严格 Skill/MCP manifest 解析、stdio/HTTP transport 边界、secret-safe 检查和默认 deny 工具投影；不启动子进程或网络；
17. `packages/sandbox-runtime` 已按 `docs/specs/16-sandbox-runtime.md` 实现 Docker/Podman argv 计划、digest 镜像策略、网络/资源/挂载限制和无 runner fail-closed；不启动主机进程；
18. `packages/sandbox-runtime` 已按 `docs/specs/17-sandbox-cli-runner.md` 实现显式注入的 Docker/Podman CLI runner：shell:false、最小 env、timeout/abort、output cap 和稳定启动错误；daemon 已在 Spec 30 通过受认证 Web 设置显式 wiring；
19. `packages/skill-mcp` 已按 `docs/specs/19-mcp-transport-boundary.md` 实现注入式 one-shot JSON-RPC channel：allowlist、env key、消息大小、timeout、取消、response id 和 close-on-error 均 fail-closed；不启动子进程或网络；
20. `packages/tool-adapters` 已按 `docs/specs/20-tool-executor-runtime.md` 实现 `ToolExecutorRuntime` bridge：workspace root、ToolIntent 和 SandboxResolveRequest 均为显式回调，实际执行仍统一经过 ToolExecutor；daemon 按独立工具设置和 workspace registry 为每个 run 显式创建 bridge；
21. `packages/agent`、`apps/daemon` 与 `apps/web` 已按 `docs/specs/21-approval-continuation.md` 实现单用户内存审批 broker、allow/deny/expiry/cancel 续接、`POST /runs/:runId/approve` 和审批卡片；无 runtime approval 能力时仍 fail-closed；
22. `packages/contracts`、`packages/storage` 与 `apps/daemon` 已按 `docs/specs/22-restart-recovery.md` 实现启动前扫描持久化 run、幂等写入 `needs-recovery`，不恢复审批或自动重试；
23. `apps/daemon` 与 `apps/web` 已按 `docs/specs/23-recovered-run-retry.md` 实现受认证的显式 retry API 和 recovery 卡片：仅允许用户确认后从 `needs-recovery` 创建新 run，不重放旧工具或审批状态；
24. `packages/certificates` 与 `apps/daemon` 已按 `docs/specs/24-certificate-status.md` 实现显式注入安全证书元数据和受保护状态查询，不启动 ACME 或返回私钥；
25. `apps/web` 已按 `docs/specs/25-configuration-onboarding.md` 实现首个非 secret 运行 profile 与响应式设置面板，替代硬编码的 run 配置；
26. `apps/web` 已按 `docs/specs/26-settings-certificate-guidance.md` 在设置/引导界面展示安全 TLS 元数据和缺失证书提示，不上传或回显私钥；
27. `apps/web` 已按 `docs/specs/27-profile-persistence.md` 实现版本化非 secret 运行 profile 持久化：启动加载、编辑自动保存、显式重置和存储失败安全回退；pairing/token、模型凭据、证书材料与事件 payload 均不写入浏览器存储；
28. `packages/workspaces` 与 `apps/daemon` 已按 `docs/specs/31-workspace-registry.md` 实现单用户 workspace 映射；Web 设置提供安全列表、添加和删除向导；运行时不回退到 default，filesystem/shell 均按 run 捕获 workspace root；Spec 36 通过独立 `daemon_settings` 表提供非 secret 重启恢复；
29. `packages/tool-adapters` 与 `apps/daemon` 已按 `docs/specs/32-guided-git-readonly-tools.md` 实现独立 Git 只读开关：仅注册 status/diff/log，固定 argv、最小环境、超时/输出上限、取消与路径脱敏均受测试覆盖；不可信或 external-sandbox run 不获得主机 Git runtime；
30. `apps/web` 已按 `docs/specs/33-guided-tool-output-inspector.md` 实现受限 tool-output inspector：仅消费现有 SSE tool.output 事件，最多显示 24 个卡片、每卡片最多 128 KiB，安全渲染 Git 文本，不新增执行权限或持久化；
31. `packages/contracts` 与 `packages/goal-control` 已按 `docs/specs/34-goal-control-plane-loopx-integration.md` 实现 Phase 0：版本化 Goal/Todo/Gate/Evidence/Handoff/Event/Projection/Decision/Binding schema、privacy scan、内存 goal event store、canonical fingerprint、projection replay、最小 `shouldRun`、并发 claim/stale revision 门禁和 validated-writeback guard；不接入 daemon 默认 run admission，也不执行模型/工具/shell/filesystem/Git/MCP/sandbox；
32. `packages/storage` 已实现 Phase 1 `SqliteGoalEventStore`：独立 `goal_events` 表、goal-local `appendSequence`、`BEGIN IMMEDIATE`、eventId no-op/conflict、批量原子回滚、重启恢复、cursor/list 和并发 writer 测试；不修改现有 `run_events` 表；
33. `apps/daemon` 已接入可选 Goal event store 的只读投影组合：受现有 auth/CSRF/Origin 门禁保护的 `GET /api/v1/goals`、`GET /api/v1/goals/:goalId` 和 bounded JSON replay；投影由 `GoalProjectionBuilder` 重放，API 剥离 `claimTokenHash`，不提供 Goal 写 API 或默认 run admission；
34. `apps/web` 的 Goal 只读投影切片按 `docs/specs/35-goal-web-readonly-projection.md` 接入现有 `ApiClient` 和 React 控制台：只消费一次 `GET /api/v1/goals`，支持 loading/unavailable/empty/ready、显式 refresh 和终态刷新；不写 Goal、不增加第二条 SSE/轮询、不把响应写入浏览器存储，也不改变 interactive run composer；
35. `packages/storage`、`packages/workspaces` 与 `apps/daemon` 按 `docs/specs/36-durable-workspace-settings.md` 增加独立、版本化的 `daemon_settings` adapter：workspace id/label/root 可安全恢复，写失败回滚，公共状态不暴露路径；不持久化 API key，不修改 `run_events`/`goal_events` 或默认 run admission；
36. `apps/web` 已按 `docs/specs/37-ratio-responsive-ui.md` 与 `docs/specs/38-conversation-first-web-shell.md` 实现 ratio-first、Codex-like conversation-first 壳层：对话/运行时间线优先，composer 在底部；New task 一键清空草稿并聚焦输入；设置为认证抽屉，Goal/连接/guardrail 为可收起上下文；CSS 不使用 UA/device sniffing，视觉截图不纳入仓库。
37. `packages/contracts` 与 `apps/daemon` 已按 `docs/specs/39-tencentdb-agent-memory-integration.md` 实现 Agent Memory Phase 0 与 Phase 1 adapter：版本化 mode/identity/recall/write/status DTO、bounded strict/privacy 校验、`NoopAgentMemoryProvider` 和原生 `fetch` 的 `TencentMemoryCoreProvider`；后者覆盖 health、MemoryCore v3 recall、显式 team/agent/user/session 隔离、revision、untrusted/bounded mapping、timeout/5xx/malformed/schema degradation、身份不匹配 fail-closed 和串行 compact write-back。持久化默认 `enabled=false/mode=off`，不调用 SDK/网络/子进程、不改 prompt、不改 AgentLoop 或 run/Goal 事实源；Web Settings、sidecar supervisor 与 bounded run integration 已在后续 Phase 2–4 落地。
38. `packages/contracts`、`apps/daemon` 与 `apps/web` 已实现 Agent Memory Phase 2：`agent-memory`/`v1` 非 secret durable settings snapshot、GET/PATCH/probe/update/rollback 认证 API 和 Settings drawer 卡片；MemoryCore 未配置或不可用时返回 bounded degraded 状态，不接入 AgentLoop、RunManager 默认 run、Goal、Scheduler、Approval、Sandbox 或第二套 SSE。
39. `apps/daemon` 已实现 Agent Memory Phase 3 `TencentMemoryRuntimeSupervisor`：current/previous/candidate 不可变目录、upstream ref/manifest 兼容检查、frozen install、build/typecheck、临时端口 health、MemoryCore smoke、原子切换、串行 update/rollback/timer/webhook queue、切换后回退、bounded `state/update.json` 重启恢复和 Windows 子进程/端口生命周期测试；supervisor 只在 application-service 边界工作，不动态加载 upstream，不修改既有 run/Goal 事实源。
40. `apps/daemon` 已实现 Agent Memory Phase 4 bounded run integration：RunManager 为新 run 冻结 provider/identity/revision snapshot，bounded recall 转为 `ContextItem(source='retrieval')` 并交给 ContextManager 裁剪；终态只异步提交 compact summary/outcome/evidence refs，recall/write failure 不改变 run 结果，settings toggle 不影响已启动 run。
41. `apps/daemon` 与 `packages/model-openai` 已实现 Agent Memory Phase 5 显式 Proxy adapter：MemoryProxy 使用完整 chat path 和 `/health`，identity headers 经过 bounded 校验，Proxy-owned recall/write 为 validated no-op；新 run 冻结 dual memory/model provider，Proxy 首字节前失败可按策略回退直连，部分流不会重放，4xx/secret/privacy/timeout/并发均有测试。`apps/daemon` 同时提供独立 `MemoryKnowledgeProvider`：只读 Wiki/CodeGraph descriptor 与工具白名单经 `/v3/tools/list`/`/v3/tools/call` 适配，bounded/cancellable/privacy-checked 结果转换为 untrusted retrieval `ContextItem`，不注册任意 ToolRuntime，也不接入默认 run 路径。
42. `packages/contracts`、`apps/daemon` 与 `apps/web` 已实现 Agent Memory Phase 6a：独立 `agent-memory-knowledge/v1` settings、SQLite/InMemory persistence、authenticated GET/PATCH/probe、lazy environment/injected provider creation、bounded `search` retrieval 和 new-run snapshot isolation。默认 disabled/off 不创建 provider、不发 HTTP、不改 prompt；knowledge errors fail-soft，Web 不显示 endpoint、secret、原始响应或绝对路径。
43. `packages/contracts`、`apps/daemon` 与 `apps/web` 已实现 Agent Memory Phase 6b 首个切片：版本化 `agent-memory-operations/v1` 只读 projection、bounded update history、health latency、recall hit/miss、write queue counters、`GET /api/v1/settings/agent-memory/updates` 和 Web 状态摘要；运行时状态独立持久化，不进入 `run_events`、`goal_events` 或 memory payload。settings 支持显式 immutable upstream commit ref lock；候选兼容 fixture 覆盖 health/search/conversation v3 envelope 与 privacy/schema fail-closed。当前/previous/candidate 清理保护和 daemon restart recovery 规则保持不变。
44. `packages/goal-control` 与 `apps/daemon` 已实现 Spec 40 Phase 2A：`GoalWriteService` 和六个受认证 mutation route 覆盖 Goal 创建、Todo、Gate open/resolve、Evidence 和 validated Todo completion；eventId fingerprint 提供重试 no-op/conflict，controlRevision 提供 stale fail-closed，响应剥离 claim hash，输入拒绝 secret/path/未知字段。该切片不接入默认 run admission，也不改变 `run_events`、AgentLoop、RunManager、Scheduler、Approval、Sandbox 或 WorkspaceRegistry。
45. `docs/specs/41-host-first-distribution-and-client-boundary.md` 与 `docs/adr/0010-host-first-same-origin-web-and-client-boundary.md` 已冻结 Host-first 边界；Spec 51-R1 静态托管、R2 launcher 生命周期、R3a certificate readiness projection 和 R4 versioned client SDK 均已实现。R2 launcher 是依赖零、可注入的参数/端口/PID lease/日志脱敏/进程树停止边界，8 个 Node fixture tests 已通过；certificate package 8 个 focused tests、daemon focused gate 152 tests、client SDK 5 个 focused tests 已通过。发行包/签名、R3b ACME/OS-store/renewal、R4 native UI 和 Android/iOS/HarmonyOS 原生客户端仍明确后置。
46. `docs/specs/42-shadcn-style-web-design-system.md` 与 `docs/adr/0011-shadcn-style-local-components-and-vibego-web.md` 已接受；Phase 42a/42b/42c/42d-1/42d-2 已按切片落地，42d-2 固定了 `pnpm check:web` 的 focused test/typecheck/build 与 gzip/diff 门禁；组件选型遵循 shadcn registry/Radix 等成熟组件库优先，只有记录理由后才允许自定义 primitive。
47. `docs/specs/43-resource-usage-and-cost-audit.md` 与 `docs/adr/0012-local-resource-and-cost-audit-ledger.md` 的 Phase 43a contracts/纯 model-usage replay projection、Phase 43b 独立 in-memory/SQLite ledger 与 UTC hour rollup 已实现；Spec 45-R5 已接入认证 Usage/Audit projection 与 Web context panel，Spec 50-R5 已接入终态 run-event usage bridge。运行时资源采样、自动 pricing settings、retention 与显式导入仍后置。AxonHub/CC Switch 的 token 分桶、缓存语义、稳定去重、价格明细和 rollup 经验已写入参考边界。
48. `docs/specs/53-host-install-upgrade-backup-recovery.md` 已实现 Phase 0/1/2/3/4/5/6：`host-manifest/v1`、`host_update_state_v1`、`backup-manifest/v1`/restore/recovery/diagnostic strict contracts、`RestoreApplyConfirmation`、`SqliteBackupSnapshotAdapter`、只读 `SqliteRestorePreflightAdapter`、`SqliteRestoreStagingAdapter` 与 `SqliteRestoreApplyAdapter` 均有 bounded/privacy/path/integrity 校验；未知字段、credential/query token、绝对路径、无效时间、跳过验证、无 previous 回滚、credential/workspace-file import、越权 safe-mode operation、损坏数据库、schema mismatch、超限输出、digest/size/integrity/preflight/staging/apply 失败、未确认/错配 plan、既有 snapshot/candidate/previous 和 swap rollback 均 fail-closed。contracts focused suite 65 tests、storage focused suite 66 tests（含 snapshot fixture 4 tests、restore preflight fixture 10 tests、restore staging fixture 12 tests 与 restore apply fixture 9 tests）、storage typecheck/build 通过。该切片不下载、验证、安装、迁移、restore result 持久化、Web/daemon route 或第二锁/调度器，也不改变 daemon、workspace、run/Goal 事实源。
49. `docs/specs/54-model-provider-onboarding.md` 已实现 Phase 0/1/2/3/4：`ModelProviderDescriptor`、`ModelEndpointProfile`、`ModelCredentialRef`、`ModelSettingsProfile`、capability/probe/setup-session contracts、显式 OpenAI-compatible `/models` probe、authenticated daemon probe route、Web Settings Probe 控件和 durable non-secret endpoint profile 均有版本、bounded、privacy/path 校验；profile 只保存 provider/endpoint/model metadata，API key 仍仅在进程内或环境注入，重启后返回 `durable-profile`/`credential-required` 并 fail-closed 直到重新输入 key；route 不接受 key/prompt/path/arbitrary headers，probe 不创建 run/event、不改变 provider 或 in-flight snapshot，当前仍不改 Spec 28 的默认 runtime/secret 边界。
50a. `docs/specs/42-shadcn-style-web-design-system.md` 已实现 Phase 42a：`apps/web` 增加 semantic VibeGo token、无运行时依赖的 `cn`/variant helper 与 Button/Input/Textarea/Label/Card/Badge/Separator/Skeleton 基础 primitives；组件只做 presentational rendering，不访问 API、storage、secret 或事件事实源，保持 44px touch target、focus-visible、disabled/loading/destructive 和 reduced-motion 约束。现有 conversation shell 未在本阶段迁移，42b/42c/42d 仍后置。Web focused suite 76 tests、typecheck 和 production build 通过，JS/CSS gzip 分别为 79.42/5.82 KiB。
50b. Spec 42 Phase 42b-1 已将 `conversation stream`、composer、`RunConsole` 与 bounded `ToolOutputInspector` 抽出为 `apps/web/src/components/vibego/ConversationShell.tsx`；组件只消费 App 注入的 run/event snapshot 与 callback，并使用 Phase 42a Button/Textarea primitives，不创建 API/SSE/storage/secret 访问或第二事实源。24-card/128 KiB tool-output cap、approval/retry/cancel 与 recovery 语义保持不变；Settings drawer 仍待 42c。Web focused suite 当前 78 tests、typecheck 和 production build 通过，JS/CSS gzip 为 79.87/5.82 KiB。
50c. Spec 42 Phase 42b-2 已将 `WorkspaceRail` 与 `ContextRail` 抽出到 `apps/web/src/components/vibego/`；两者只接收 typed metadata/projection 与 callback，使用 Button/Card primitives，保留 `workspace-rail`、`context-rail`、Goal/observability read-only projection、responsive grid 和安全摘要语义，不创建 API/SSE/storage/secret 访问或第二事实源。Settings drawer 和 operation cards 仍待 42c。Web focused suite 当前 81 tests、typecheck 和 production build 通过，JS/CSS gzip 为 80.40/5.82 KiB。
50d. Spec 42 Phase 42b-3 已将 topbar 抽出为 `apps/web/src/components/vibego/ConversationHeader.tsx`；组件只接收 locale、连接/上下文/设置快照与显式 callback，使用 Button primitive，保留 `topbar`/`topbar-actions`、`Control+N`/`Meta+N`、Settings focus-return、locale ARIA 和 ratio-first 换行，不创建 API/SSE/storage/secret 访问或第二事实源。connected/awaiting-pairing、secret/path-free focused tests、typecheck/build 通过；Web focused suite 当前 83 tests，JS/CSS gzip 为 80.54/5.82 KiB。Settings drawer 与 operation cards 仍待 42c。
50e. Spec 42 Phase 42c-1 已将 `ApprovalCard` 与 `RecoveryCard` 抽出到 `apps/web/src/components/vibego/`；组件只消费 bounded approval/recovery projection 和显式 callback，保留 deny destructive variant、recovery new-run 语义与现有 CSS landmark，不创建 API/SSE/storage、Approval/RunManager 请求或第二事实源。details/no-details、retry、secret/path/raw-argument-free focused tests、typecheck/build 通过；Web focused suite 当前 86 tests，JS/CSS gzip 为 80.60/5.82 KiB。Goal/Memory/Tool cards 仍待后续 42c。
50f. Spec 42 Phase 42c-2 已将 `SettingsSheet` 对话框壳抽出到 `apps/web/src/components/vibego/`；组件只消费 open/ref/bounded copy/children 与 close callback，保留 `settings-drawer`、dialog ARIA、响应式 CSS 和 App 的 focus trap/return、表单/API/secret-safe persistence 所有权，不创建 settings API、storage 或第二事实源。open/closed、ARIA、children-slot、Button primitive、secret/path-free focused tests、typecheck/build 通过；Web focused suite 当前 88 tests，JS/CSS gzip 为 80.68/5.82 KiB。Tabs、表单分组、Goal/Memory/Tool cards 仍待后续 42c。
50g. Spec 42 Phase 42c-3 已增加 `SettingsTabs` 与 `SettingsSection` 本地组合组件：
`App` 持有 Run/Tools/Access active-tab、字段状态、API callback、focus trap/return
和 secret-safe persistence；组件仅负责 tablist/tabpanel ARIA、`hidden` inactive panel、
重复表单组标题/描述及 ready/loading/degraded/unavailable 状态视觉语义。现有 workspace、
model、memory、knowledge、MCP、tool、sandbox、run-default、TLS 与 deployment 字段和
daemon authority 未改变；组件不访问 API/storage/secret、不创建第二 SSE 或事件事实源。
新增 focused tests 覆盖 tab semantics、panel hiding、status variants、bounded copy 和
secret/path-free markup；下一步仍是更深层 Goal/Memory/Tool card 抽取与 42d device/
accessibility/bundle 验收。Web focused suite 当前 94 tests，typecheck 和 production
build 通过，JS/CSS gzip 为 82.52/6.06 KiB。
50h. Spec 42 Phase 42d-1 已为 `SettingsTabs` 增加 ArrowLeft/Right、ArrowUp/Down、Home、End
键盘导航与单一 roving `tabIndex=0`；纯 resolver 和组件 contract tests 通过。该切片不宣称
屏幕阅读器人工、Playwright、对比度或真实设备证据，也不改变 API、settings、run、SSE 或
事件事实源。
50i. Spec 42 Phase 42d-2 已增加固定 `check:web` 门禁：复用 Web 依赖闭包
build/typecheck/focused tests，检查生成资产 JS/CSS gzip budget，并运行 `git diff --check`。
脚本不运行全仓测试、不读取 secret、workspace、browser storage 或 daemon/run/Goal 事实源；
bundle 报告只包含 bounded asset size metadata。Playwright、屏幕阅读器和真实设备证据仍后置。
最近一次 `pnpm check:web` 通过 Web focused 94 tests、typecheck/build、JS/CSS gzip
80.41/5.90 KiB；`pnpm test:workflow` 通过 31 个脚本 tests。
50. `docs/specs/56-i18n-accessibility-device-matrix.md` 已实现 Phase 56a，并由 `docs/adr/0024-web-locale-and-accessibility-shell.md` 冻结边界：`apps/web` 提供 Web-only `en-US`/`zh-CN` locale preference、英文 fallback、根节点 `lang`、语言选择器、核心 shell 的 bounded accessibility 语义和 ratio-first focused gates；完整 catalog、真实设备和屏幕阅读器人工 evidence 尚未声称完成。
51. Spec 56 Phase 56b 已实现：Settings drawer 的 dialog/focus scope、Escape/Tab/focus-return 和 settings/guardrail typed catalog 均有 Web focused tests；尚未声称完成屏幕阅读器人工验收、完整 catalog 或真实设备 evidence。
52. Spec 56 Phase 56c 已实现纯 Web slice：`apps/web/src/device-matrix.ts` 提供八类 ratio/device fixture、严格 `WebCompatibilityReport` parser 和默认 `unverified` factory；`apps/web/src/performance-report.ts` 提供 bounded timing report；CSS 提供可选 safe-area/fold hooks。Web focused suite 66 tests、typecheck 和 production build 均通过；不启动 Playwright、不宣称真实设备通过，也不改变 daemon/run/event authority。
53. Spec 55 Phase 55a 已实现：`packages/contracts/src/deployment-operations.ts` 提供 `deployment/v1` profile/readiness，将 loopback、LAN、Tailscale、SSH、public-direct、public-proxy 作为显式模式，LAN/public TLS 与 insecure override fail-closed，且不携带 private key、ACME/DNS credential、绝对路径或 raw adapter error；contracts focused suite 52 tests 与 typecheck 通过。本阶段不打开 listener、不接 ACME/forwarder，也不改变 AuthGate/daemon runtime。
54. Spec 55 Phase 55b 已实现：复用现有 AuthGate 暴露只读 `GET /api/v1/deployment/readiness`，Web Settings drawer 显示 bounded mode/status/reason/next-step；缺失 projection 返回稳定 `DEPLOYMENT_READINESS_UNAVAILABLE` 并 fail-soft，不改变 pairing、interactive run、AgentLoop、run_events 或 transport listener，也不接受任何 deployment mutation。daemon focused suite 156 tests、Web focused suite 68 tests、daemon/Web typecheck 与 Web build 通过。
55. Spec 57 Phase 57a 纯合约已实现：`packages/contracts/src/release-publishing.ts` 提供严格的 `release-manifest/v1` 与 ordered promotion state，校验 immutable tag/channel、source commit、artifact digest、target、signature/attestation/SBOM refs、compatibility range 和 rollback target；`artifactId=latest`、tag/version 不一致、secret/query/path reference 和未知字段均 fail-closed。stable 需要显式 approval，published 只能 withdraw。contracts focused suite 57 tests、typecheck 和 build 通过。本阶段不创建 GitHub workflow/release、不上传/签名 artifact，也不读取 credential、workspace 或运行时事实源。

47a. `docs/specs/44-provider-usage-management-and-upstream-reuse.md`、`docs/adr/0013-upstream-research-and-provider-management-boundary.md`、`docs/prompts/44-provider-usage-management-implementation.md` 和 `docs/research/upstream-provider-usage.md` 已完成 Spec 44-R0：CC Switch、AxonHub、LiteLLM、Langfuse、OpenTelemetry 的 canonical URL、默认分支、pinned commit、LICENSE/NOTICE 边界、相关文件路径和语义摘要均已记录，所有复用决定均为 clean-room。没有复制上游源码、schema、UI、session 或 runtime，也未新增依赖；R1/R2/R3 的实现状态见下列条目。
47b. Spec 44-R1 provider/usage contract slice 已完成：`packages/contracts/src/provider-usage.ts` 提供严格版本化 `ProviderDescriptor`、`ProviderCapabilitySnapshot`、`ProviderUsageObservation`、secret/path fail-closed 校验和 token 维度向后兼容扩展；`packages/observability/src/provider-usage.ts` 提供 immutable in-memory `ProviderRegistry`、capability snapshot 与纯 `normalizeProviderUsageObservation`，现有 run-event replay projection 显式保留 `dataSource`/input token semantics。测试覆盖 strictness、privacy、快照隔离、cache-inclusive/fresh、unknown counters 和幂等输入；仍不接入 AgentLoop、RunManager、daemon API 或默认 run。
47c. Spec 44-R2 reconciliation slice 已完成：复用 Spec 43b 唯一 `usage_ledger`/UTC rollup，`packages/observability/src/provider-usage.ts` 新增纯内存按 usage ID 与 bounded semantic key 的去重、跨来源合并和 fail-closed conflict port；每个 retry attempt 独立保留，reconciled record 限定来源 IDs 和 token/status/identity 冲突，仍不接入默认 run。
47d. Spec 44-R3 pricing slice 已完成：复用 `PricingRule`/`ModelUsageRecord.cost`，`packages/contracts/src/observability.ts` 增加 bounded `CostItem`/tier/price mode contract，`packages/observability/src/pricing.ts` 以纯内存 `PricingCatalog` 和 BigInt cost projection 支持 per-unit、flat-fee、tiered、历史 revision 与 unknown cost；不接入默认 run。
48. 每个包/应用都有单元测试和 typecheck；根目录 `build` 会按 contracts → storage → scheduler → testkit → context → agent → model-openai → tools → policy → sandbox → execution → sandbox-runtime → tool-adapters → workspaces → auth → certificates → skill-mcp → goal-control → observability → daemon → web 顺序构建，避免 workspace package export 在 clean checkout 下缺少 `dist` 类型。

49. `packages/sandbox-runtime` 与根脚本已实现 Spec 48-R3：`ContainerSmokeRunner`/`ContainerCliRuntimeProbe` 和显式 `pnpm smoke:container` 只接受 Docker/Podman、immutable digest 与解析后的 workspace，固定 restricted-network `sh -c "printf ready4vibe-smoke"` fixture，强制 `--pull=never`、`--rm`、`--init`、资源/超时/输出上限和取消；report 仅返回 versioned、redacted 状态，默认不进入 `pnpm verify`、daemon 启动或 run 创建路径。sandbox-runtime focused 30 tests 与 CLI workflow 7 tests 已通过；真实 engine smoke 仍需用户显式执行。

50. Spec 48-R4 的不可信任务审批续接集成 fixture 已补齐：`untrusted-content` + `external-sandbox` + digest image 先产生 `approval.required`，经认证 approve 后只在同一 run 的显式 continuation 点执行一次注入式 container runner；duplicate/deny/cancel/runtime unavailable 均 fail-closed，Web approval card 只展示 bounded provider/digest/network 元数据，不改变 AgentLoop 核心状态机或现有事件事实源。

51. Spec 49-R1 transport slice 已实现：`packages/skill-mcp` 提供注入式 `McpStdioChannelFactory`、`McpStreamableHttpChannelFactory` 与 bounded `McpProtocolSession`，覆盖 initialize、progress、request id、timeout/cancel、401/403/429/5xx、malformed/oversized/disconnect 和 deterministic close；20 个 skill-mcp focused tests 已通过。transport 不创建 ToolRegistry、Approval、Scheduler、Sandbox 或 daemon startup side effect。

52. Spec 49-R2 capability snapshot/registry 已实现：纯 `@ready4vibe/skill-mcp` 提供 descriptor 校验、manifest/allowlist/health/schema/risk/network/approval 门禁、重复/冲突 revision、read-only resource/prompt projection 和 immutable run snapshot/fingerprint；27 个 focused tests 已通过。不调用 MCP channel、不注册现有 ToolRegistry、不修改 AgentLoop、RunManager、Approval、Scheduler、Sandbox 或 `run_events`/`goal_events`。

53. Spec 49-R3 settings/status slice 已实现：`packages/contracts/src/mcp-settings.ts`
提供严格版本化、非 secret MCP settings/status/probe contracts；`apps/daemon/src/mcp-settings.ts`
使用现有 `daemon_settings` 持久化并提供显式注入 probe、revision 匹配、degraded
fail-soft 和 disabled zero-side-effect 行为；daemon 增加认证
`GET/PATCH /api/v1/settings/mcp` 与 `POST /api/v1/settings/mcp/probe`，Web 设置抽屉增加
MCP/SKILL 卡。contracts 37 tests、daemon 130 tests、web 46 tests 的 focused gates 已通过；
该切片不启动 MCP 子进程、不发网络请求、不注册 ToolRegistry，也不改变 AgentLoop、
RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry 或 `run_events`/`goal_events`。

## 验证结果（2026-08-04）

- `pnpm typecheck`：通过（20 个 workspace package）；
- `pnpm test`：通过，379 个测试全部通过（contracts 30、goal-control 17、storage 31、scheduler 5、testkit 2、agent 20、context 5、model-openai 5、observability 29、tools 4、policy 7、sandbox 6、execution 7、sandbox-runtime 9、tool-adapters 15、workspaces 7、auth 5、certificates 5、skill-mcp 10、daemon 116、web 44）；Spec 36 覆盖 settings store、workspace restore/rollback 和 daemon adapter；Spec 37/38 覆盖 ratio、conversation-first 与 New task focus contract；Spec 39 覆盖 Phase 0 contract privacy/bounds、Noop zero-side-effect、Phase 1 MemoryCore adapter、Phase 2 settings/API/Web degraded behavior、Phase 3 supervisor 生命周期/更新/回滚、Phase 4 bounded run integration、Phase 5 Proxy fallback/privacy/concurrency 与 MemoryKnowledge descriptor/readonly/limit/cancellation/privacy 测试、Phase 6a Knowledge settings/probe/run snapshot/Web/SQLite recovery，以及 Phase 6b operations/fixture/lock/recovery 测试；Spec 40 覆盖 mutation replay、重试 no-op/conflict、stale revision、validated completion、safe error、LAN auth、方法门禁和 SQLite 重启幂等；Spec 44-R1/R2/R3 覆盖 provider descriptor strictness、privacy、capability snapshot isolation、usage normalizer、token semantics、usage ID dedup、cross-source reconciliation、retry isolation、conflict fail-closed、pricing mode/revision、BigInt cost items 和 unknown cost；
- `pnpm --filter @ready4vibe/web build`：通过，Vite JS 产物约 234 kB（gzip 约 72 kB），未发起真实模型请求；
- `pnpm diff:check`：通过；
- `pnpm-workspace.yaml` 显式允许 `esbuild` postinstall，安装时需要把 bundled Node 路径加入 `PATH`；这只影响本地依赖安装，不属于运行时资源依赖。
- Node 22 会对 `node:sqlite` 输出 ExperimentalWarning；MVP 选择它是为了避免 native addon 和常驻数据库服务，后续可按 Node LTS 稳定性评估 adapter 替换。

## 本阶段明确不做

- 不在默认路径调用真实模型、网络、MCP、Skill 或 shell；真实模型只在显式 Web/环境配置后使用；
- 不在 daemon 启动时修改用户 workspace、Git、系统设置或证书；filesystem/shell 只有用户从已认证 Web 设置显式开启、并经过路径/审批/sandbox 守卫后才可能产生副作用；
- Spec 51-R1 已把 React Web 静态资源以可选 dist 目录内置到 daemon；R2 launcher 只负责受限生命周期、URL 展示和显式浏览器打开，R3a 提供只读 certificate readiness projection；发行包/签名/更新与 R3b ACME/OS-store/renewal 仍未实现，源码开发仍可使用独立 Vite，Host-first 同源发行和远程只开 URL 的完整打包是下一阶段目标。Android/iOS/HarmonyOS 客户端不在当前实现范围内；
- 不实现 ACME 自动签发、Windows 证书存储、VM runtime、MCP/Skill 外部连接或完整审批/diff UI；external sandbox CLI runner 已由 daemon 的显式设置 wiring，但默认关闭且不会自动拉取镜像或启动容器；Web/PWA 仍不替代 daemon 安全边界；
- 不把 `InMemoryEventStore` 当作生产持久化；
- 不把 `/health` 当作认证、LAN、模型或 sandbox 可用性证明；
- 不把 fake model 的行为当作真实 provider 能力。
- fake loop 仍以单 turn 测试路径为主；生产 daemon 只有显式注入 runtime 才会看到 filesystem/shell descriptors，Git、patch、MCP/Skill 和网络工具仍未注册；审批等待、取消和运行时快照已覆盖，真实 provider 的上下文压缩策略仍后置。
- run API/SSE 已接入单用户 pairing/token、CSRF 和 LAN/TLS transport gate；HTTPS listener 与证书文件校验已 wiring，默认仍为 loopback，ACME/公网部署尚未 wiring。
- 默认仍不发起真实请求；只有显式设置 `READY4VIBE_MODEL_API_KEY` 才启用外部 provider。key 只在进程内存中使用，不能进入仓库或 API 响应。
- ToolRegistry/ApprovalPolicy 已通过显式 runtime 执行受限 filesystem 与 external `shell.exec`；Git、patch、MCP/Skill、网络和 VM provider 仍未注册。所有 runtime 都按 workspace registry 解析根目录，未知 workspace fail-closed；auth gate 与 TLS certificate loader 已接入 daemon，ACME adapter 和公网部署后置。
- Spec 18 已落地：默认无工具；显式 runtime 的 tool-call 会经过 runtime 的 ToolExecutor 边界，并写入请求、审批、执行和输出事件；参数（含单次 256 KiB arguments 上限）、轮次、工具调用数和 scheduler toolProcesses 均受限。审批续接 API 已在 Spec 21 实现。
- Spec 19 已落地 MCP transport boundary 的注入式 one-shot JSON-RPC channel；当前仍不由 daemon 自动启动子进程或访问网络，生产 channel 必须后置接入 sandbox、approval 和 scheduler。
- 不把 `pnpm-workspace.yaml` 的 build-script allowlist 当作业务安全策略；生产 sandbox/approval 仍按安全 spec 实现。

## 进入下一步的门禁

- `pnpm typecheck` 通过；
- `pnpm test` 通过，覆盖合法/非法状态转移、并发排队、workspace lease、事件 seq、取消和资源释放；
- `pnpm diff:check` 或等价检查无 whitespace 错误；
- 文档中的实现状态、限制和命令与代码一致；
- 完成后单独 Git 提交，再进入 ACME/certificate manager adapter、external sandbox runtime 与 Web UI 的 diff/log/approval 深化。
## Spec 27 implementation note (2026-08-03)

The Web runtime now loads the validated non-secret run profile from a
versioned browser preference key, saves edits through a controlled adapter,
and clears the key before restoring conservative defaults. Web coverage is
now 15 tests; storage failures never block the UI.

## Spec 28 design note (2026-08-03)

The next module is documented in `docs/specs/28-model-provider-onboarding.md`.
It moves provider setup into the authenticated Web settings flow while keeping
the MVP secret store process-memory only; OS keyring persistence is a future
adapter and no API key will enter browser storage or durable events.

Spec 28 is now implemented: the daemon exposes secret-free model status plus
authenticated configure/clear actions, new runs use an atomically switched
provider, and the Web Model Access card never persists the key. Verification
adds 4 daemon tests, 1 Web API test, 1 Web render test, and 1 model-provider
URL safety test.

## Spec 29 design note (2026-08-03)

The next implementation is documented in
`docs/specs/29-filesystem-tool-wiring.md`. It will make the existing guarded
filesystem adapters explicitly enableable from the authenticated Web settings
surface while keeping shell, external sandbox, and non-default workspaces
fail-closed.

Spec 29 is now implemented: the daemon starts with filesystem tools disabled,
the authenticated Web toggle enables only bounded read/write adapters, and
new runs capture a stable runtime snapshot. Shell and external sandbox wiring
are implemented in Spec 30; non-default workspace mapping is provided by Spec
31 and is captured per run.

## Spec 30 implementation note (2026-08-03)

Spec 30 is now implemented as a first external-runtime slice. The daemon
exposes authenticated probe/configure endpoints and the Web Settings panel
guides Docker/Podman selection, digest validation, and explicit shell enablement
without manual config-file editing. A healthy, digest-pinned runtime is required
before `shell.exec` is registered; requests use the existing approval/policy
boundary, bounded container runner, restricted-network default, and per-run
runtime snapshot. Host shell fallback, image pulls, VM providers, and persistent
runtime settings remain deferred.

## Spec 31 implementation note (2026-08-03)

The daemon now exposes a secret-free authenticated workspace registry. The Web
Settings panel uses a selector plus explicit add/remove guidance; users never
need to edit a config file. A submitted daemon-machine path is retained only in
daemon-local runtime/settings and is never returned in status, events, SSE, logs,
or browser storage. Filesystem and external-shell runtimes resolve the selected
workspace at run start, and unknown ids fail closed without falling back to
`default`. Spec 36 adds a bounded, versioned SQLite settings adapter for the
non-secret registration snapshot; it does not persist model credentials or
change run/Goal event authorities.

## Spec 32 implementation note (2026-08-03)

The daemon now exposes a separately gated Git read-only settings adapter. The
Web Settings panel can enable only `git.status`, `git.diff`, and `git.log`; the
process-memory toggle is disabled by default and never returns a host path.
Each run captures its selected workspace root and a fixed Git runtime. The
child-process boundary uses `shell:false`, a minimal environment, bounded
timeout/output, cancellation, and workspace-path redaction. Host Git is not
available to untrusted or external-sandbox runs, and no commit, patch, remote,
checkout, reset, or arbitrary Git command is registered. API, runtime, adapter,
and Web tests cover the gate and fail-closed behavior.

The pre-Goal-Control verification baseline was 19 workspace packages and 185
passing tests (including 15 tool-adapter, 40 daemon, and 26 Web tests).

Spec 33 adds a presentation-only Web tool-output inspector. It consumes the
existing SSE `tool.output` events, safely renders Git status/diff/log text, and
caps the browser projection at 24 cards and 128 KiB per card without changing
daemon capabilities or browser persistence. The verification baseline before
Spec 34 was 187 passing tests, including 28 Web tests.

## Spec 34 Phase 0 implementation note (2026-08-03)

The native TypeScript Goal Control core now provides versioned contracts,
privacy-safe goal events, deterministic in-memory replay, `shouldRun`, and
optimistic Todo claim/release helpers. Concurrent claimants cannot silently
overwrite one another: the second caller receives a stale-revision or active-
claim conflict. Claim tokens are returned only to the caller and persisted as
hashes. A failed or non-validated outcome cannot pass the pure completion guard,
so it cannot create a Todo completion or quota-spend event.

The verification baseline before the Web projection slice was 20 workspace packages
and 206 passing tests. The current verification is 20 workspace packages and 298
passing tests (Web 40, daemon 103, storage 17, contracts 17, workspaces 7).
Specs 36–39 add
durable non-secret workspace settings, ratio-first layout contracts, and the
conversation-first composer/focus contract plus the Agent Memory Phase 0
contract/Noop boundary, Phase 1 MemoryCore adapter boundary, Phase 2
durable settings/API/Web boundary, Phase 3 supervisor boundary, and Phase 4
bounded run integration boundary, with focused
client/component and regression tests; screenshot files are not part of the repository. It keeps SQLite `goal_events` and the daemon
list/detail/replay API as the authority. Goal write APIs, Web Goal actions, LoopX
import/export, and governed admission remain later phases. Existing unbound
interactive runs and the `run_events` contract are unchanged.

Spec 39 Phase 5 adds the daemon-local `TencentMemoryProxyProvider`. It uses an
explicit MemoryProxy chat path and health endpoint, bounded identity headers,
run-scoped model/provider snapshots, pre-stream direct-provider fallback, and
fail-closed partial-stream handling. Proxy-owned injection and write-back are
validated no-ops on the ready4vibe memory port, so the proxy cannot duplicate
MemoryCore writes. Proxy credentials remain process-local and are never stored
in durable settings, Web responses, events, or revision state. The same Phase 5
slice adds a daemon-local `MemoryKnowledgeProvider`: it only calls the public
`/v3/tools/list` and `/v3/tools/call` read-only Wiki/CodeGraph allowlist, applies
bounded/cancellable/privacy-checked HTTP decoding, and converts accepted output
to untrusted retrieval `ContextItem` candidates. It is not an arbitrary
`ToolRuntime`, is not on the default run creation path, and does not change
Goal/run/Scheduler/Approval/Sandbox authorities. Knowledge application-service
settings and optional run injection are implemented as Phase 6a. Knowledge
remains a retrieval-only adapter: automatic Proxy sidecar build/switch, arbitrary
ToolRuntime registration, approval/resource expansion and automatic sidecar
switching remain later work; Phase 6b now supplies bounded operations history
and compatibility fixtures without promoting Knowledge to a ToolRuntime.

## Spec 44-R4 implementation note (2026-08-04)

The observability package now has an explicit low-resource `ResourceCollector` and
`AuditApplicationAdapter`. The collector uses Node CPU/memory APIs plus injected
OS/sandbox probes, supports idle/active/detailed profiles, bounded queue capacity,
dropped-sample accounting, and fail-soft degraded status. It never executes shell,
PowerShell, CLI probes, or filesystem scans. The audit adapter validates bounded
`AuditEventDraft` values, delegates append/hash-chain work to the existing ledger,
and reports writer failures without changing the originating action result.

R4 tests cover queue overflow, unsupported probes, stop/restart, privacy rejection,
writer failure, and audit-chain integrity. No default daemon/run path, AgentLoop,
RunManager, Scheduler, Approval, Sandbox, WorkspaceRegistry, `run_events`, or
`goal_events` behavior changed; authenticated API, Web Usage/Audit, export/import,
and automatic sampling settings remain R5 work.

## Spec 45 R0 implementation note (2026-08-04)

R5 API/Web projection work is now scoped in `docs/specs/45-observability-api-and-web.md` and
`docs/adr/0014-observability-api-and-web-projection.md`. The planned boundary injects the existing
observability ledger into the daemon, exposes authenticated bounded Usage/Audit reads and explicit
rebuild/verify operations, and keeps browser output free of raw payloads, secrets, commands and
absolute paths. The R5 implementation and tests are recorded in the section below.

## Spec 45 R5 implementation note (2026-08-04)

The documentation gate is now followed by a bounded implementation slice:

- `apps/daemon/src/main.ts` injects the existing observability ledger into the
  daemon server and closes it on initialization, recovery, and shutdown paths;
  `RunManager`, AgentLoop, Scheduler, Approval, Sandbox, WorkspaceRegistry,
  `run_events`, and `goal_events` remain unchanged.
- `apps/daemon/src/server.ts` exposes authenticated summary, timeseries, run
  usage, audit page, pricing, rebuild, and verify endpoints with bounded parsing
  and stable degraded error codes.
- `packages/contracts/src/observability-api.ts` and
  `packages/observability/src/api.ts` provide versioned DTOs and pure projections;
  `apps/web/src/ObservabilityPanel.tsx` consumes them in the existing responsive
  conversation context rail.
- Tests cover daemon/API, contract, projection, browser client, and degraded UI
  behavior. Automatic sampling settings, export/import, and pricing catalog
wiring remain out of this slice.

## Spec 46 implementation note (2026-08-04)

The fixed verification gate is documented in Spec 46/ADR 0015. The repository
script exposed as `pnpm verify` runs the existing typecheck, test,
diff-check, and Git diff-check commands in a deterministic fail-fast order; it
does not install dependencies, mutate the worktree, or expose environment
secrets.

## Harness research and planned productionization (2026-08-04)

`docs/research/upstream-harness-implementations.md` records a clean-room study
of pinned Codex, OpenHands, Aider, Goose, MCP TypeScript SDK, LiteLLM,
Langfuse, Continue and OpenTelemetry checkouts. The checkouts are outside the
product tree or under ignored `.research/`; no upstream source, prompt, schema,
UI, proxy, scheduler or runtime was copied. [ADR 0016](adr/0016-clean-room-harness-productionization.md)
freezes the single-authority, run-snapshot, fail-soft and host-first decisions.

The following work is documented but not fully implemented yet:

- **Spec 48** (`specs/48-approval-sandbox-shell-runtime.md`): R1–R4 are
  implemented bounded slices: policy compiler, host-restricted runner, opt-in
  digest-pinned container smoke and untrusted-task Web approval continuation.
  Existing daemon shell wiring remains explicit and default-off; VM/remote
  execution and broader release closure remain later work.
- **Spec 49** (`specs/49-mcp-skill-transport-and-capability-lifecycle.md`): R1–R4
  are implemented as opt-in injected stdio/Streamable HTTP transport,
  immutable capability snapshots, authenticated settings/status and a
  run-scoped ToolRegistry bridge with lifecycle drain. The daemon remains
  MCP-off by default and never auto-starts a server.
- **Spec 50** (`specs/50-observability-lifecycle-integration.md`): 50-R1 now
  provides a pure application lifecycle recorder/fixture with bounded
  idempotency, conflict detection, disabled-sampling no-op and fail-soft writer
  errors. It is not wired into the default RunManager path; provider usage,

  cost, automatic sampling and complete lifecycle attachment remain 50-R2/R3.
  The focused observability package gate is 38 tests passed; no live runtime is
  started.
  Spec 50-R2 provider usage/cost application adapter is implemented with 47
  focused tests; no default run wiring or network behavior is enabled.
  Spec 50-R3 sampling lifecycle adapter is implemented with 54 focused tests;
  automatic collector start/stop remains opt-in without default daemon wiring.
  Spec 50-R4 audit action and explicit export/import is implemented with 60
  focused observability tests. The adapter is bounded, deterministic and
  privacy-checked; no upload, second event source or automatic daemon/API/Web
  wiring is enabled. 50-R5 now adds an optional asynchronous terminal
  run-event usage bridge: `RunUsageObserver` replays existing bounded run
  events through the existing provider usage adapter without changing run
  behavior. Resource/tool sampling and pricing settings remain outside this
  slice; focused observability and daemon gates pass.
- **Spec 51** (`specs/51-host-first-release-and-client-boundary.md`): R1–R4 are
  implemented: static Web serving, cross-platform launcher boundary,
  certificate readiness projection and the versioned TypeScript client SDK.
  R3b ACME/OS-store/renewal, signed release artifacts and native
  Android/iOS/HarmonyOS clients remain post-MVP.
- **Spec 52** (`specs/52-capability-profiles-and-first-run-experience.md`): the
  cross-cutting capability-profile and first-run UX gate is now specified;
  ADR 0033 freezes the R1 contract boundary and ADR 0034 freezes the durable
  settings/projection boundary. The strict
  `ready4vibe_capability_profile_v1` contract is implemented in
  `packages/contracts` with 5 focused tests (71 contract tests total).
  `@ready4vibe/policy` provides the pure resolver with 7 focused tests (24
  policy tests total). The R2/R3a application slice now adds a versioned,
  secret-free daemon settings snapshot, optimistic revision checks, stale
  policy recovery to `preview`, and an authenticated resolver projection with
  LAN auth coverage. The contracts/daemon focused gate is 74/24/35 tests
  respectively at this slice. It does not change default run creation or
  start any runtime. The R3 profile/run snapshot binding now captures the
  resolver decision at RunManager start and the later Goal/transport/ACME/release gates remain independently planned. The R2 Web
  card slice is now implemented in the existing Settings Sheet with four
  profile cards, Advanced Local acknowledgement and bounded effective-mode
  guidance; Web focused tests total 96. It consumes the projection without
  moving authority into the browser. The
  plan defines preview, workspace-coding, advanced-local and custom profiles,
  progressive capability unlock, contextual blocked-capability guidance,
  profile/run snapshot isolation and Host-first acceptance. Native clients
  remain post-release and do not block the Web/Host release.

These six specs are design/planning gates only. They do not change the
current statement that untrusted network/model/MCP/Skill/shell side effects
are disabled unless explicitly configured through the authenticated boundary,
and they do not modify `run_events`, `goal_events`, AgentLoop, RunManager,
Scheduler, Approval, Sandbox or WorkspaceRegistry in this documentation pass.

## Spec 47 R1/R2 implementation note (2026-08-04)

The documentation gate is now followed by a network-free model/context slice:

- `packages/contracts/src/model-runtime.ts` adds bounded provider snapshot,
  canonical request/event, replay result and retry-plan schemas with secret/path
  rejection and strict versions.
- `packages/model-openai/src/runtime.ts` adds deterministic stream replay,
  request idempotency conflict detection, abort-aware retry planning and a
  no-partial-stream-replay provider wrapper.
- `packages/model-openai/src/protocol.ts` adds pure OpenAI Responses and
  Anthropic-shaped fixture translators; no provider SDK or upstream source is
  vendored.
- `packages/context/src/index.ts` adds independent byte/token/item budgets,
  protected context categories and append-only compaction references. The
  existing AgentLoop supplies the model input-token limit and records bounded
  token metadata without changing its state machine or event authority.

`pnpm verify` previously passed with 396 tests for R1/R2. R3 now adds the
daemon/application provider binding and application fixture; R4 adds the
explicit redacted live smoke command and seven network-free workflow tests.
Credentials remain out-of-band and the normal fake-provider path remains
available.

## Spec 47 R3 implementation note (2026-08-04)

The daemon application bridge is now implemented without changing the
AgentLoop state machine or introducing a second authority:

- `InMemoryModelSettingsManager.bindRun()` returns an in-memory provider and a
  validated secret-free `ModelProviderSnapshot`;
- `RunManager` captures the binding before `run.created`, rejects a configured
  provider mismatch at the authenticated boundary, and keeps the binding for
  the lifetime of the run;
- `AgentLoop` records the snapshot in `run.created` and bounded provider,
  request and descriptor-revision metadata in `model.requested`;
- daemon tests cover a fake-fetch OpenAI-compatible two-turn/tool-call run,
  provider-switch isolation, safe mismatch response and event privacy. No
  network request or durable observability-ledger write occurs in this slice.

R4 live smoke is implemented outside the ordinary offline verification gate as
`pnpm smoke:model` with an out-of-band environment secret reference and
redacted report. A successful redacted live smoke is mandatory before the Spec
52 release gate; one such DeepSeek-compatible evidence run passed without
exposing endpoint, credential, prompt or raw response. Goal admission,
`goal_events`, Approval, Sandbox, Scheduler and WorkspaceRegistry behavior
remain unchanged until their separately specified integration phases.

## Spec 48 R1 implementation note (2026-08-04)

Documentation now records the first policy compiler slice before runtime
changes. The compiler is implemented and tested in `@ready4vibe/policy`; it
returns `allow | ask | deny`, validates the server-side tool/schema and policy
revision, computes a deterministic exact approval key from bounded metadata,
and supports short-lived, limited-use grants only for low-risk work. It never
stores raw arguments, commands, paths, environment values, or secrets. Existing
`ApprovalPolicy` callers and all execution/event authorities remain unchanged;
R2 process execution, R3 container smoke and R4 Web continuation are deferred.
The focused policy suite has 17 tests and the repository gate now passes with
412 tests for the R1 slice; no live process, container, network or model
credential is used.

## Spec 48 R2 implementation note (2026-08-04)

The host runner is documented before runtime code changes. It remains an
opt-in `@ready4vibe/sandbox-runtime` adapter with injected spawn, realpath and
tree-termination ports. Tests cover workspace/cwd containment, symlink escape,
argv and environment rejection, `.cmd`/PowerShell argv fixtures, output
truncation, timeout, cancellation, startup failure and minimal environment;
they do not start arbitrary host commands. Daemon, AgentLoop, Scheduler,
Approval, SandboxResolver, WorkspaceRegistry and event authorities are
unchanged in this slice.
The focused host-runner suite has 17 tests and the current repository gate
passes with 420 tests; no arbitrary host command is started by the test suite.

## Spec 53–57 planning status (2026-08-05)

The following release-hardening specifications remain planning gates unless
explicitly noted below. Spec 53 Phase 0/1/2/3/4/5/6 and Spec 57 Phase 57a are
implemented; the Phase 5 staging adapter remains a storage-only candidate step,
while Phase 6 apply remains an explicit caller-confirmed storage/application
adapter;
this change does not modify the existing AgentLoop, RunManager, Scheduler,
Approval, Sandbox, WorkspaceRegistry, `run_events` or `goal_events` authorities:

- **Spec 53** (`specs/53-host-install-upgrade-backup-recovery.md`) has implemented
  Phase 0/1/2/3/4/5/6 contracts, `SqliteBackupSnapshotAdapter`, read-only
  `SqliteRestorePreflightAdapter`, `SqliteRestoreStagingAdapter` and
  `SqliteRestoreApplyAdapter` for integrity-checked, digest-bound, immutable
  local snapshots and reviewable restore plans/candidates. Phase 5 remains
  storage-only and does not switch current; Phase 6 requires explicit caller
  confirmation, preserves current as previous, returns only an in-memory
  bounded `RestoreResult`, and does not migrate or import credentials/files,
  persist a result, expose a route or change daemon/run/Goal authorities.
  Storage currently has 66 passing tests (including 12 staging and 9 apply
  fixtures), and the apply adapter requires the caller's exclusive database
  access boundary.
- **Spec 54** (`specs/54-model-provider-onboarding.md`) has implemented
  Phase 0/1/2/3/4 contracts, bounded model-list probe, authenticated daemon/Web
  probe surface and a durable non-secret endpoint profile. Restart recovery
  restores only provider/endpoint/model metadata and marks the credential as
  required; API keys remain process-memory/environment-only. It does not add a
  provider SDK, model download path, automatic provider switch or new network
  behavior.
- **Spec 55** (`specs/55-public-deployment-certificates-operations.md`) has an
  implemented Phase 55a `deployment/v1` profile/readiness contract for explicit
  loopback/LAN/Tailscale/SSH/public modes, TLS fail-closed and bounded
  operational limits, plus a Phase 55b read-only readiness projection through
  the existing AuthGate. It does not expose a public listener, install a proxy,
  change firewall rules or perform ACME calls; later adapter/runbook phases
  remain planned.
- **Spec 56** (`specs/56-i18n-accessibility-device-matrix.md`) has implemented
  Phase 56a/56b and an implemented Phase 56c pure Web slice. The current slice covers
  `en-US`/`zh-CN`, bounded accessibility semantics, the settings focus scope,
  typed settings/guardrail labels, eight ratio/device fixtures and strict
  compatibility/performance report projections. It does not start Playwright,
  claim emulation as real-device proof, or assert WCAG/manual evidence.
- **Spec 57** (`specs/57-release-publishing-pipeline.md`) has an implemented
  Phase 57a `release-manifest/v1` and ordered promotion contract for immutable
  tag/channel, artifact checksum/target/evidence refs, stable approval and
  withdrawn state. The contracts module has 57 focused tests plus typecheck and
  build coverage. It does not create GitHub Actions, publish a release or upload
  artifacts; later workflow and packaging phases remain planned.

The research basis is recorded in
`docs/research/53-57-release-install-model-operations-research.md`. Before any
implementation commit, the relevant prerequisite matrix must be re-verified on
the current checkout. New runtime behavior remains opt-in and disabled until its
focused contracts, failure fixtures and release evidence are accepted.

## Spec 58 planning note (2026-08-05)

`docs/specs/58-goal-control-and-harness-completion.md` is a Draft planning gate.
It records the known maturity gap: Goal contracts, replay, SQLite persistence,
bounded mutation and read-only Web projection exist, while governed admission,
GoalRunBinding application composition, validation writeback, quota reservation /
exactly-once spend, Goal operation UX and daemon-path real LLM evidence remain
unimplemented. The same A–G maturity ladder is required for other core modules
that currently have only contracts, fixtures or fake runtime evidence.

Spec 58 does not change current runtime behavior. Until its explicit phases and
release evidence are accepted, unbound interactive runs remain outside Goal
admission and `run_events`, `goal_events`, AgentLoop, RunManager, Scheduler,
Approval, Sandbox and WorkspaceRegistry retain their existing authority.

## Spec 59 planning note (2026-08-05)

`docs/specs/59-permission-profiles-and-low-interruption-approval.md` is a Draft
follow-up specification. It adds the requested permission ergonomics without
changing Spec 52: `workspace-coding` is workspace-scoped with bounded automatic
approval for exact low-risk keys, while `full-host` is an explicit trusted-session
mode with optional session-auto approval. Full-host is never the default, never a
fallback for untrusted content or an unhealthy external sandbox, and never widens
network, Goal, quota, Scheduler, Approval, Sandbox or managed-policy authority.
No runtime behavior is claimed by this planning note.

## Spec 52-R3 run-snapshot implementation note (2026-08-05)

The R3 application boundary is implemented under
`docs/adr/0035-capability-profile-run-snapshot.md`. The strict, secret-free
run snapshot is captured before model binding or runtime selection; blocked or
config-incompatible results fail closed, while degraded results use only the
resolver's narrowed profile and never host fallback. The snapshot is immutable
for the run, visible as bounded `run.created` metadata and replayed through
`RunSnapshot`; settings changes affect later runs only. Recovery creates a
fresh snapshot. The main daemon narrows filesystem, shell and MCP descriptors
to the effective profile, while the existing AgentLoop state machine,
Scheduler, Approval, Sandbox, WorkspaceRegistry and event authorities remain
unchanged. Focused contract/AgentLoop/daemon tests cover the slice; Goal
  governed admission remains Spec 52-R4. The R3 addition has 4 focused
  capability-snapshot contract tests, AgentLoop metadata coverage, daemon
  runtime-constraint fixtures and RunManager/server blocked, isolation and
  recovery tests. The affected package gates currently pass with contracts 78,
  AgentLoop 21, daemon 180 and Web 96 tests, plus typecheck/build coverage.

## Spec 49-R4 implementation note (2026-08-04)

The R4 contract is implemented under [ADR 0023](adr/0023-mcp-r4-run-scoped-execution-bridge.md).
Implementation is intentionally limited to a run-scoped adapter: an
immutable healthy-verified MCP tool snapshot can be bound to the existing
ToolRegistry/ToolExecutorRuntime, while Approval, Scheduler, Sandbox,
WorkspaceRegistry, AgentLoop and `run_events` remain authoritative. Resources
and prompts are not executable. A bounded per-run idempotency ledger prevents
same-call replay and rejects changed input/revision; recovery creates a new
run and cannot restore an unknown in-flight remote request. Disabled or
degraded MCP settings remain a no-op for normal runs. The pure package slice
is now implemented: `McpExecutionLedger`/`McpProtocolToolCallPort` in
`@ready4vibe/skill-mcp` and `McpToolExecutorRuntime` in
`@ready4vibe/tool-adapters`, with 36 and 19 focused tests respectively.
`apps/daemon` now adds the opt-in `McpRunBindingManager` and includes its
undefined runtime in the existing `composeToolRuntimes` run snapshot path;
three binding tests cover disabled/unverified, snapshot isolation and unknown
workspace behavior. No live MCP process/network smoke is claimed by this note;
activation from a verified transport is available through the injected service.

The R4 application activation slice is now implemented: bounded
`McpLiveActivationService` accepts only a matching server/manifest revision,
allowlisted healthy-verified snapshot and injected call port; provider
failures and ignored-signal timeouts remain degraded and do not start default
transport. `@ready4vibe/skill-mcp` also provides the injected
`McpSessionActivationProvider` for public initialize/tools-list/tools-call
protocol flow; fake-channel tests and the explicit real opt-in stdio/Streamable
HTTP fixture smoke both pass. No default provider or remote endpoint is enabled.

The R4 lifecycle slice now freezes session ownership: activation candidates
need an explicit close port, run-captured MCP runtimes hold an idempotent lease,
and refresh/deactivate retires old bindings until their last run releases them.
This keeps protocol sessions from leaking or being closed under an in-flight
run; shutdown remains best-effort and does not alter AgentLoop, RunManager's
default start behavior, Scheduler, Approval, Sandbox, WorkspaceRegistry or
event authorities.

The smoke is implemented as an explicit `pnpm smoke:mcp` command over fixed
local fixtures, outside daemon startup and the offline verification gate; its
bounded report is secret/path-free. Both stdio and loopback Streamable HTTP
runs passed on 2026-08-05.
