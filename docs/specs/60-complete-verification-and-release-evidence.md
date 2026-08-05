# Spec 60：完整测试、真实运行与发布证据主线程验收

- Status: Draft（测试与验收规格；不宣称任何尚未验证的运行时能力）
- Date: 2026-08-05
- Scope: 全部既有 Spec/ADR、核心 Harness、Goal Control、权限与审批、真实 LLM、
  Web、远程接入、证书、性能、恢复和 release evidence
- Related: [Spec 46：Automated verification workflow](46-automated-verification-workflow.md)、
  [Spec 47：Model/Context/AgentLoop productionization](47-model-context-agent-loop-productionization.md)、
  [Spec 48：Approval/Sandbox/Shell runtime closure](48-approval-sandbox-shell-runtime.md)、
  [Spec 49：MCP/Skill lifecycle](49-mcp-skill-transport-and-capability-lifecycle.md)、
  [Spec 52：Capability profiles](52-capability-profiles-and-first-run-experience.md)、
  [Spec 55：Public deployment and certificates](55-public-deployment-certificates-operations.md)、
  [Spec 57：Release publishing](57-release-publishing-pipeline.md)、
  [Spec 58：Goal/Harness completion](58-goal-control-and-harness-completion.md)、
  [Spec 59：Permission profiles](59-permission-profiles-and-low-interruption-approval.md)、
  [Harness contracts](../harness-contracts.md)

## 1. 目的与不可妥协的结论

本规格是 ready4vibe/VibeGo 主线程进行“真正的、完整的测试”时必须遵循的验收剧本。
它解决一个常见误判：contracts、fake provider、mock server 或单个 focused test
通过，并不等于本项目已经具备可发布的 Harness。

主线程只有在本规格的前置复核、模块测试、应用集成、真实 LLM、失败恢复、安全、
远程接入和 release evidence 全部完成后，才可以把项目标记为 `release-candidate`
或向用户宣称“可全面使用”。任何缺少真实运行证据的模块必须继续标记为 `partial`，
不能以设计文档、fixture-only 或 fake-only 结果替代。

本规格不修改 AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry、
`run_events` 或 `goal_events` 的权威边界；它只规定如何验证这些边界。测试不得为了
通过而关闭安全门禁、跳过审批、绕过 Goal、写入真实凭据或改变默认安全配置。

## 2. 前置复核门禁（60-0）

在任何完整测试或 live smoke 前，主线程必须重新核实当前 checkout，而不是相信旧的
状态摘要或其他 Agent 报告：

1. 读取当前 `git status --short --branch`、`git diff`、`git diff --cached`、当前
   commit、remote、Node/pnpm 版本和 workspace graph；保留 dirty worktree，不得
   `reset`、`clean`、覆盖、回滚或替他人提交无关改动。
2. 逐项阅读并映射 Spec 01–59 中仍适用的约束，至少包括 Spec 03、06、08–12、
   14–23、25–27、31–40、41–59，以及对应 ADR、`architecture.md`、
   `harness-contracts.md`、`implementation-status.md` 和 `roadmap.md`。
3. 对每个声明建立 `verified / partially implemented / blocked / not applicable`
   矩阵，证据必须指向真实源码、测试命令、运行日志或脱敏报告；文档与代码冲突时
   先修正文档，再进行测试结论更新。
4. 确认测试使用隔离的临时 workspace、SQLite 数据库、端口、进程和凭据引用；不得
   读取用户真实 workspace、SSH key、浏览器 cookie、环境变量全集或系统服务状态。
5. 确认真实 LLM、网络、MCP/Skill、容器、Tailscale/SSH、ACME 和 full-host 测试均
   是显式 opt-in；缺少依赖时记录 `blocked`，不得静默降级成更宽权限或 fake pass。
6. 将复核报告与同一阶段的测试结果、已知缺口和下一步写入文档，并单独 Git 提交。

前置复核未完成时，不得接入 Goal governed admission，不得把默认 interactive run
改成 governed，也不得将 focused test 结果写成 release evidence。

### 60-0 implementation checkpoint (2026-08-05)

The prerequisite audit is recorded in
[`docs/reports/60-0-prerequisite-audit-2026-08-05.md`](../reports/60-0-prerequisite-audit-2026-08-05.md).
It re-checks the clean `main` checkout, toolchain and workspace graph, then
classifies each verification domain as `verified`, `partial` or `blocked`.
The audit authorizes only the focused/integration evidence slices that follow;
it does not promote fixture-only or opt-in smoke results to release evidence,
change the default interactive run path, or mark Spec 60 implemented.

### 60-1/60-2 implementation boundary (2026-08-05)

The next slice adds the explicit `pnpm verify:evidence` orchestrator in
`scripts/verification-evidence.mjs`. It has only two fixed plans: `focused`
for the documented dependency-closure/module/Web/workflow gates, and `full`
for the existing `pnpm verify` gate. It accepts no arbitrary shell fragment or
test selector. Child output is bounded and redacted before it is written to the
ignored `.ready4vibe/evidence/<date>/<commit>/` bundle.

The first bundle is limited to `verification-evidence/v1` metadata,
`focused-results.json`/`full-verify.txt`, a prerequisite pointer, a bounded
security/privacy note and known gaps. Failed, blocked and not-run steps remain
distinct. This slice does not enable live LLM, remote transport, full-host,
container or release operations, and it does not change AgentLoop, RunManager,
Goal admission, Scheduler, Approval, Sandbox or event authorities.

#### 60-1/60-2 implementation checkpoint (2026-08-05)

`pnpm verify:evidence` and its six-test fixture are now implemented. The
focused plan ran all five fixed gates successfully on Windows and wrote only
bounded/redacted bundle files under `.ready4vibe/evidence/`; `pnpm
test:workflow` reports 47/47 tests passed. The bundle is explicitly labelled
`verification-gate-only`; the full plan and all live/remote/release gates remain
opt-in and are not implied by this result.

The post-commit rerun at `f3843f2` passed all five focused steps again. Its
ignored bundle is `.ready4vibe/evidence/2026-08-05/f3843f2f0fd644a98ec20e5e8b8dbaab653d6329/`;
the manifest contains only bounded status, timing, command descriptors and
digests.

### 60-3/60-7 concurrency and recovery evidence boundary (2026-08-05)

The next opt-in fixture is `pnpm smoke:recovery`. It composes the existing
`RunManager`, `AgentLoop`, `Scheduler` and `run_events` EventStore with a
bounded injected model provider. It checks two independent runs overlapping,
queued-run cancellation, an in-flight cancellation, and metadata-only daemon
restart recovery (one `run.needs_recovery`, no provider/tool replay, and an
idempotent second reconciliation). The report contains counts, statuses and
bounded timings only.

This fixture is application/concurrency evidence, not live-provider or
cross-platform release evidence. It does not add a scheduler, alter restart
semantics, resume old approvals, execute tools during recovery, or change Goal
Control/permission/event authorities.

## 3. 证据等级与结果语义

每项测试结果必须带有 `evidenceLevel` 和 `claim`：

| 等级 | 含义 | 可支持的结论 |
| --- | --- | --- |
| A | contract/schema | 输入输出边界成立，不代表运行时成立 |
| B | pure/reducer/resolver | 确定性状态机成立，不代表持久化成立 |
| C | durable/replay/recovery | 幂等、冲突、重启边界成立 |
| D | daemon/application integration | 真实 application service 组合成立 |
| E | Web/API/UX | 用户可配置、解释、取消、恢复 |
| F | real runtime | 真实 provider、进程、容器、transport 或设备 smoke |
| G | release | 安装、升级、签名、设备、运维和回滚证据 |

缺少 F 的模块不得标记为生产可用；缺少 G 的项目不得标记为正式发布。测试报告必须
区分 `passed`、`passed-with-warning`、`blocked`、`failed` 和 `not-run`，不能把
`blocked` 或 `not-run` 折算为通过。

## 4. 测试矩阵

主线程必须为下列每个域维护一行 evidence matrix；“无适用项”也必须写明理由：

| 域 | 必测内容 | 最低证据 |
| --- | --- | --- |
| Contracts/Storage | strict schema、secret/path/privacy、未知字段、eventId 幂等、冲突、事务、重启 | A–C focused tests |
| Scheduler/RunManager | 并发容量、workspace lease、取消、优先级、资源释放、snapshot isolation | C–D integration |
| Model/Context | provider 能力、stream、上下文预算/压缩、超时、取消、错误不覆盖原始错误 | D；真实链路 F |
| AgentLoop | turn 状态机、tool continuation、approval wait、cancel、retry 不重放旧工具调用 | B–D；真实 provider F |
| Approval/Policy | bounded-auto、explicit、session-auto、deny、expiry、revoke、revision mismatch | A–E；真实权限 F |
| Sandbox/Shell/Tools | workspace boundary、argv/path guard、容器 digest、输出/资源上限、child cleanup | B–F |
| Goal Control | v0/v1 replay、binding、admission、Gate、quota exactly-once、Evidence、recovery | A–D；governed E–F |
| MCP/Skill | manifest、capability snapshot、stdio/HTTP、取消、断连、未知工具和审批 | A–F（显式 opt-in） |
| Memory/Observability | recall/write degradation、usage/cost/audit、队列重试、隐私和 snapshot | C–F |
| Web/UX | 新建对话、设置、审批、Goal、恢复、responsive ratio、键盘/屏幕阅读器语义 | D–E；真实设备 F |
| Auth/Transport | pairing、Bearer/CSRF、LAN TLS、Origin、Tailscale/SSH、断线和重连 | D–F |
| Certificates | PEM 校验、ACME staging、续期、失败保留 current、rollback、私钥不泄露 | C–F |
| Host/Release | 安装、启动、升级、backup/restore、签名、SBOM、attestation、卸载和回滚 | C–G |
| Security/Privacy | secret/path/raw command/log/response 扫描、untrusted prompt、权限升级 | A–F |
| Performance/Operations | CPU、内存、磁盘、并发、超时、队列、日志/事件大小和 bounded degradation | D–G |

## 5. 主线程测试顺序

测试可以在探索阶段按模块并行或分模块运行，但最终必须按以下顺序完成完整门禁：

### 60-1：Focused module gates

先运行受影响模块的 dependency-closure build、typecheck 和 test，例如：

```powershell
pnpm check:module -- @ready4vibe/contracts @ready4vibe/goal-control
pnpm check:module -- @ready4vibe/policy @ready4vibe/sandbox @ready4vibe/execution
pnpm check:module -- @ready4vibe/agent @ready4vibe/daemon
pnpm check:web
```

Focused gate 只用于缩短反馈周期，不得代替最终全量门禁。每次失败必须记录根因、
是否为代码回归、是否为环境阻塞和重新执行命令。

### 60-2：全仓静态与单元门禁

在实现阶段收敛后必须运行 `pnpm verify`，即 typecheck → test → `diff:check` →
`git diff --check`。测试数量、包数量、Node/pnpm 版本和耗时写入报告；警告不得被
吞掉。测试必须在 clean checkout 或明确记录的 dirty fixture 上重复一次。

### 60-3：Daemon application integration

使用临时 SQLite、临时 workspace 和显式注入的 fake provider，验证：

- Web/API → daemon → RunManager → AgentLoop → ContextManager 的事件顺序和 SSE replay；
- settings/profile/provider/permission/workspace 改动只影响新 run；
- interactive run 不被 Goal quota/Gate 静默拦截；governed run 才经过 Goal admission；
- approval、sandbox、scheduler、workspace 和 cancellation 的拒绝/恢复路径；
- daemon 重启后只恢复允许恢复的状态，绝不重复执行旧 tool call 或旧审批。

### 60-4：真实 LLM path（强制）

必须至少有一轮真实 provider 请求，路径必须是：

```text
Web/CLI test client
  -> authenticated daemon API
  -> RunManager snapshot
  -> AgentLoop
  -> ContextManager
  -> real model provider
  -> bounded response/tool continuation
  -> run_events/SSE terminal state
```

要求：

- 真实 provider 由环境注入的 secret reference、base URL 和 model name 配置；API key
  绝不进入仓库、命令行参数、截图、日志、事件、浏览器 storage 或测试报告；
- 使用独立测试 workspace、固定小 prompt、有限 token、超时、取消和总预算；不能
  读取真实凭据、真实项目内容或发送未审查的 prompt；
- 至少验证一次成功文本 run、一次 provider timeout/5xx、一次取消/断线，以及一次
  上下文裁剪或超限行为；错误必须保留原始模型/工具/审批错误；
- 如使用 DeepSeek、Ollama、LM Studio 或其他 provider，记录版本、endpoint/model
  capability、请求时间、状态和 bounded usage，不记录 secret 或完整 transcript；
- 真实 LLM 测试不是默认 `pnpm test` 的一部分，必须由明确环境开关和用户授权触发；
  缺 key 或额度不足只能标记 `blocked`，不能改用 fake provider 冒充 F 级证据。

### 60-5：Goal governed execution

在真实 LLM path 通过后，使用隔离 Goal fixture 验证完整闭环：

```text
Goal/Todo/Gate
  -> shouldRun/admission
  -> GoalRunBinding
  -> Scheduler/Approval/Sandbox/Workspace
  -> RunManager/AgentLoop
  -> independent validation
  -> Evidence writeback
  -> exactly-once quota consume
```

必须覆盖 Gate 阻塞、quota 不足、验证失败、run 失败、retry/recovery、重复 eventId、
stale controlRevision、两个 Agent 竞争同一 Todo 和 interactive run 不受影响。验证
失败时不得完成 Todo 或消耗 quota；recovery 不得重新执行旧工具调用。

### 60-6：权限、安全与远程接入

使用无真实用户数据的 trusted/untrusted fixtures 验证：

- `workspace-coding` 只允许 workspace 内、exact approval key 的低风险 bounded-auto；
- `full-host` 必须显式确认、trusted-only、session-scoped、可过期、可 revoke，不能
  自动开启 network、MCP/Skill、Goal/quota bypass 或 managed-policy bypass；
- sandbox 不可用时不得 fallback 到 host/full-host；不可信内容不得获得 host shell；
- secret、环境变量、绝对路径、原始命令和完整 tool arguments 不出现在 Web/API/log/
  event/memory/Goal evidence；
- LAN TLS、pairing、CSRF、Origin、连接断开/恢复和并发 session；Tailscale/SSH adapter
  若尚未实现则明确 `blocked`，不能用 LAN 模拟通过；
- ACME 必须优先使用 staging，覆盖申请、challenge 失败、续期、切换、旧证书保留和
  rollback；不得触碰用户系统证书库或真实公网域名而没有显式批准。

### 60-7：并发、恢复、性能与跨平台

至少覆盖两个以上并发 run、共享 workspace lease、审批竞争、Goal claim 竞争、memory
队列、SSE subscriber、SQLite writer、端口分配和 child process cleanup。测试必须有
上限和取消，不得无限等待。

Windows 为必测平台；macOS/Linux/container 若作为 release target 也必须运行同一套
最小 smoke。记录 Node/pnpm、OS、CPU/内存、磁盘、Docker/Podman 版本和实测结果，
把目标值、测量值和未测量值分开。

### 60-8：Release evidence

只有在 60-1 至 60-7 收敛后，才可运行安装包/Host launcher、upgrade current→candidate→
previous、backup/restore、签名/checksum/SBOM/attestation、静态 Web、LAN/public
readiness 和真实设备矩阵。发布报告必须能从 commit、manifest、测试命令和 artifact
digest 重现，不得用手工截图或无法验证的口头结果替代。

## 6. Live test 的安全、成本与隐私约束

- live test 使用独立 provider profile 和最小额度；默认关闭，完成后撤销/清理；
- key 只存在当前进程环境或 OS secret reference，测试脚本不得打印环境变量全集；
- prompt、tool output、workspace 内容、URL、路径、headers 和模型响应均需 bounded；
  报告只保留摘要、状态码、耗时、usage bucket、fingerprint 和 evidence reference；
- 任何真实副作用必须在 fixture workspace/container 内；full-host smoke 不修改服务、
  防火墙、注册表、证书库、用户文件或网络设备；
- 并发和性能测试不得把真实 provider 当压力测试目标；需要压力时使用 fake/recorded
  provider，并把结果与 live LLM 证据分开；
- 测试失败必须 fail-closed，清理临时进程、端口、文件和候选 revision；清理失败本身
  是阻断发布的失败。

## 7. Evidence bundle 与报告格式

每次主线程完整验收生成一个不含 secret 的 evidence bundle，至少包括：

```text
evidence/<date>/<commit>/
  manifest.json                 # schemaVersion, commit, platform, tool versions
  prerequisite-matrix.md       # Spec/ADR -> source/test/evidence/status
  focused-results.json         # per-package command, status, test count, duration
  full-verify.txt              # exact command output, redacted
  live-llm-summary.json        # provider/model metadata, status, usage bucket, no key
  goal-governed-summary.json   # binding/admission/quota/evidence/recovery outcomes
  security-privacy-report.md   # secret/path/raw-output scans and negative cases
  transport-certificate.md     # LAN/Tailscale/SSH/ACME status or blocked reasons
  performance-recovery.md      # concurrency, limits, cleanup and restart evidence
  release-manifest.json        # artifact digests and release gate result
  known-gaps.md                # every partial/blocked/not-run item and owner
```

报告必须声明测试是在哪个 branch/commit 执行、哪些文件是 dirty、是否使用了真实
provider、哪些阶段被跳过以及跳过原因。不得把完整 transcript、tool output、绝对路径、
secret 或个人数据放入 bundle。

## 8. Definition of Done

Spec 60 只有在以下条件全部满足后才能标记 `Implemented`：

1. 60-0 的所有前置 Spec/ADR 复核有可追溯矩阵，文档与代码/测试不冲突；
2. 受影响 focused gates 和完整 `pnpm verify` 均通过，失败/警告/阻塞均有解释；
3. 真实 LLM 已通过 daemon→RunManager→AgentLoop→ContextManager 的成功与失败路径；
4. Goal governed run、quota exactly-once、validation/recovery 和普通 interactive run
   隔离均有 application evidence；
5. workspace-coding、full-host、untrusted、sandbox unavailable、revoke/expiry 和
   隐私负例均通过；
6. 远程访问、证书、并发、重启、跨平台和 release 证据已完成或明确阻断，并且阻断项
   不被宣称为发布能力；
7. evidence bundle 可重放、无 secret、无真实用户数据，所有实质性代码/文档变更已在
   对应 Git 提交前同步更新 Spec/ADR/implementation-status；
8. 发布结论只有 `release-candidate`、`internal-preview` 或 `blocked` 三选一，不能
   用模糊的“基本完成”代替。

## 9. 不在本规格内

- 不把完整测试改造成第二套 scheduler、approval、sandbox、memory 或 Goal runtime；
- 不为测试临时关闭安全策略、静默 host fallback、绕过 quota/Gate 或写入真实系统；
- 不把 live LLM key 写入仓库、文档、CI secrets 示例、截图或提交历史；
- 不把一次成功 smoke 扩大解释为容量、稳定性或所有 provider 的保证；
- 不强制把原生 Android/iOS/HarmonyOS 客户端作为 Web 可用性的前置条件，但若作为
  release target，则必须纳入 60-8 的 evidence matrix。
