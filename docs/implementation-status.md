# 实施状态与第一条纵切

**状态：Accepted（Phase 1/2 实施基线，Web/PWA、LAN TLS、Skill/MCP manifest、Sandbox runtime、ToolRuntime、approval continuation 与 Goal 只读投影切片已通过）**

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
37. `packages/contracts` 与 `apps/daemon` 已按 `docs/specs/39-tencentdb-agent-memory-integration.md` 实现 Agent Memory Phase 0 与 Phase 1 adapter：版本化 mode/identity/recall/write/status DTO、bounded strict/privacy 校验、`NoopAgentMemoryProvider` 和原生 `fetch` 的 `TencentMemoryCoreProvider`；后者覆盖 health、MemoryCore v3 recall、显式 team/agent/user/session 隔离、revision、untrusted/bounded mapping、timeout/5xx/malformed/schema degradation、身份不匹配 fail-closed 和串行 compact write-back。默认 `off` 不调用 SDK/网络/子进程、不改 prompt、不改 AgentLoop 或 run/Goal 事实源；Web Settings、sidecar supervisor 与 bounded run integration 已在后续 Phase 2–4 落地。
38. `packages/contracts`、`apps/daemon` 与 `apps/web` 已实现 Agent Memory Phase 2：`agent-memory`/`v1` 非 secret durable settings snapshot、GET/PATCH/probe/update/rollback 认证 API 和 Settings drawer 卡片；MemoryCore 未配置或不可用时返回 bounded degraded 状态，不接入 AgentLoop、RunManager 默认 run、Goal、Scheduler、Approval、Sandbox 或第二套 SSE。
39. `apps/daemon` 已实现 Agent Memory Phase 3 `TencentMemoryRuntimeSupervisor`：current/previous/candidate 不可变目录、upstream ref/manifest 兼容检查、frozen install、build/typecheck、临时端口 health、MemoryCore smoke、原子切换、串行 update/rollback/timer/webhook queue、切换后回退、bounded `state/update.json` 重启恢复和 Windows 子进程/端口生命周期测试；supervisor 只在 application-service 边界工作，不动态加载 upstream，不修改既有 run/Goal 事实源。
40. `apps/daemon` 已实现 Agent Memory Phase 4 bounded run integration：RunManager 为新 run 冻结 provider/identity/revision snapshot，bounded recall 转为 `ContextItem(source='retrieval')` 并交给 ContextManager 裁剪；终态只异步提交 compact summary/outcome/evidence refs，recall/write failure 不改变 run 结果，settings toggle 不影响已启动 run。
41. `apps/daemon` 与 `packages/model-openai` 已实现 Agent Memory Phase 5 显式 Proxy adapter：MemoryProxy 使用完整 chat path 和 `/health`，identity headers 经过 bounded 校验，Proxy-owned recall/write 为 validated no-op；新 run 冻结 dual memory/model provider，Proxy 首字节前失败可按策略回退直连，部分流不会重放，4xx/secret/privacy/timeout/并发均有测试。`apps/daemon` 同时提供独立 `MemoryKnowledgeProvider`：只读 Wiki/CodeGraph descriptor 与工具白名单经 `/v3/tools/list`/`/v3/tools/call` 适配，bounded/cancellable/privacy-checked 结果转换为 untrusted retrieval `ContextItem`，不注册任意 ToolRuntime，也不接入默认 run 路径。
42. `packages/contracts`、`apps/daemon` 与 `apps/web` 已实现 Agent Memory Phase 6a：独立 `agent-memory-knowledge/v1` settings、SQLite/InMemory persistence、authenticated GET/PATCH/probe、lazy environment/injected provider creation、bounded `search` retrieval 和 new-run snapshot isolation。默认 disabled/off 不创建 provider、不发 HTTP、不改 prompt；knowledge errors fail-soft，Web 不显示 endpoint、secret、原始响应或绝对路径。
43. 每个包/应用都有单元测试和 typecheck；根目录 `build` 会按 contracts → storage → scheduler → testkit → context → agent → model-openai → tools → policy → sandbox → execution → sandbox-runtime → tool-adapters → workspaces → auth → certificates → skill-mcp → goal-control → daemon → web 顺序构建，避免 workspace package export 在 clean checkout 下缺少 `dist` 类型。

## 验证结果（2026-08-04）

- `pnpm typecheck`：通过（20 个 workspace package）；
- `pnpm test`：通过，297 个测试全部通过（contracts 17、goal-control 11、storage 17、scheduler 5、testkit 2、agent 20、context 5、model-openai 5、tools 4、policy 7、sandbox 6、execution 7、sandbox-runtime 9、tool-adapters 15、workspaces 7、auth 5、certificates 5、skill-mcp 10、daemon 102、web 40；Vitest 按 package 输出）；Spec 36 覆盖 settings store、workspace restore/rollback 和 daemon adapter；Spec 37/38 覆盖 ratio、conversation-first 与 New task focus contract；Spec 39 覆盖 Phase 0 contract privacy/bounds、Noop zero-side-effect、Phase 1 MemoryCore adapter、Phase 2 settings/API/Web degraded behavior、Phase 3 supervisor 生命周期/更新/回滚、Phase 4 bounded run integration、Phase 5 Proxy fallback/privacy/concurrency 与 MemoryKnowledge descriptor/readonly/limit/cancellation/privacy 测试，以及 Phase 6a Knowledge settings/probe/run snapshot/Web 测试；
- `pnpm --filter @ready4vibe/web build`：通过，Vite JS 产物约 234 kB（gzip 约 72 kB），未发起真实模型请求；
- `pnpm diff:check`：通过；
- `pnpm-workspace.yaml` 显式允许 `esbuild` postinstall，安装时需要把 bundled Node 路径加入 `PATH`；这只影响本地依赖安装，不属于运行时资源依赖。
- Node 22 会对 `node:sqlite` 输出 ExperimentalWarning；MVP 选择它是为了避免 native addon 和常驻数据库服务，后续可按 Node LTS 稳定性评估 adapter 替换。

## 本阶段明确不做

- 不在默认路径调用真实模型、网络、MCP、Skill 或 shell；真实模型只在显式 Web/环境配置后使用；
- 不在 daemon 启动时修改用户 workspace、Git、系统设置或证书；filesystem/shell 只有用户从已认证 Web 设置显式开启、并经过路径/审批/sandbox 守卫后才可能产生副作用；
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
and 206 passing tests. The current verification is 20 workspace packages and 297
passing tests (Web 40, daemon 102, storage 17, contracts 17, workspaces 7).
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
ToolRuntime registration, approval/resource expansion and operations history
remain later work.
