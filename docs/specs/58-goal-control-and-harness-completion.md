# Spec 58：Goal Control 完整执行闭环与核心 Harness 完成门禁

> Current implementation checkpoint (2026-08-05): 58-0 through 58-3 and 58-4a
> are implemented and merged; the minimum 58-5 Harness runner and one
> user-authorized live provider path are also implemented. The umbrella spec
> remains Draft until the remaining Web workflow, failure/recovery, module
> closure and release evidence gates are complete.

- Status: Draft（58-0～58-5 的已实现切片已记录；58-2 仍不接入默认 interactive run，58-6/58-7 及完整发布证据后置）
- Date: 2026-08-05
- Scope: Goal Control、daemon application service、Web workflow，以及核心 Harness
  的完成度审计和真实运行验收
- Related: [Spec 34](34-goal-control-plane-loopx-integration.md)、
  [Spec 35](35-goal-web-readonly-projection.md)、
  [Spec 40](40-goal-write-api-and-bounded-mutations.md)、
  [Spec 47](47-model-context-agent-loop-productionization.md)、
  [Spec 48](48-approval-sandbox-shell-runtime.md)、
  [Spec 49](49-mcp-skill-transport-and-capability-lifecycle.md)、
  [Spec 50](50-observability-lifecycle-integration.md)、
  [Spec 52](52-capability-profiles-and-first-run-experience.md)、
  [Spec 55](55-public-deployment-certificates-operations.md)、
  [Spec 57](57-release-publishing-pipeline.md)、
  [ADR 0004](../adr/0004-native-goal-control-and-loopx-interop.md)、
  [Harness contracts](../harness-contracts.md)；[ADR 0036](../adr/0036-goal-control-v1-domain-and-replay-boundary.md)

## 1. 目的

当前 Goal Control 已具备 contracts、replay、SQLite event store、有限 mutation API
和只读 Web projection，但还没有成为真正驱动 Agent 运行的闭环。本规格把 Goal 从
“基础概念和状态投影”推进到可审计、可恢复、可验证的 governed execution，并把同一
完成标准推广到仍停留在 design-only、fixture-only 或 fake-only 的核心 Harness 模块。

本规格不复制 LoopX，也不新增第二套 AgentLoop、Scheduler、Approval 或执行 runtime。
它只定义 ready4vibe 原生 application service 如何组合现有事实源，同时保留用户直接
开始普通对话的低摩擦体验。

目标用户流为：

```text
创建 Goal -> 添加 Todo/Gate -> 选择 governed run
  -> Goal preflight -> Scheduler/Approval/Sandbox 正常准入
  -> RunManager/AgentLoop 执行 -> 独立验证
  -> Evidence writeback -> 完成 Todo -> exactly-once quota spend
```

## 2. 强制前置复核门禁

58-0 的当前 checkout 复核已记录在
[prerequisite verification report](../reports/58-0-prerequisite-verification-2026-08-05.md)。
报告只确认现有 contracts、replay、SQLite、bounded mutation/read-only API
和既有 Harness 边界；它没有把 governed admission、quota reservation、validation
writeback 或真实 E2E smoke 标记为完成。

在实现本规格任何 runtime 代码前，必须重新核实此前所有相关 Spec 是否真的已经完成，
不能依据旧的 `implementation-status.md`、旧测试数量或其他 Agent 报告直接判定完成。
复核结果必须先记录在同一提交中的文档中。

复核至少包括：

1. 阅读当前 `implementation-status.md`、`roadmap.md`、`architecture.md`、
   `harness-contracts.md` 和本规格列出的全部 Spec/ADR；
2. 执行 `git status --short --branch`、`git diff`、`git diff --cached`，保留所有
   用户或其他 Agent 的 dirty worktree 改动，不得 reset、clean、checkout 或覆盖；
3. 确认当前 branch、Node/pnpm 版本、workspace graph、lockfile 和实际运行时路径；
4. 将每个前置要求映射到源码、测试和 focused command，状态只能写为
   `verified`、`partially implemented`、`blocked` 或 `not applicable`；
5. 首个实现提交前重新运行受影响模块和完整 `pnpm verify`；探索阶段可使用
   `pnpm check:module -- <package>`，但不能用 focused gate 代替最终 full gate；
6. 检查 Markdown 链接、code fence、实现状态和测试计数，发现矛盾必须先修正文档；
7. 确认 `run_events`、`goal_events`、AgentLoop、RunManager、Scheduler、Approval、
   Sandbox 和 WorkspaceRegistry 的唯一权威边界仍然成立。

前置复核未完成时，不得实现 Goal admission，也不得把 `shouldRun` 接入默认
`POST /api/v1/runs` 路径。

## 3. 不可改变的架构边界

- 不 vendor 完整 LoopX，不引入 Python runtime、LoopX CLI、Markdown/JSONL 状态、
  POSIX 文件锁、LoopX scheduler 或 host bridge；
- Goal Control 只在 daemon application service 层与 RunManager 协作；
  `packages/agent` 的核心循环不直接依赖 Goal；
- `run_events` 是运行事实源，`goal_events` 是 Goal 事实源，两者必须独立；不把
  Goal 状态写入 prompt，也不把 run event 表改造成 Goal 表；
- Goal admission 不执行模型、工具、shell、文件系统、Git、MCP、Skill 或 sandbox；
  这些仍由各自的 provider/runtime/approval/scheduler 负责；
- Goal quota、Gate 或 `shouldRun` 不得授予 capability、放宽 approval、绕过 sandbox、
  改变 workspace 或绕过 Scheduler；
- 用户明确发起的无绑定 `interactive` run 不得被 Goal quota、Gate 或 `shouldRun`
  静默拦截；只有显式 `governed` run 才进入 Goal admission；
- provider、capability、approval、sandbox、workspace 和 Goal revision 必须在 run
  创建时冻结；运行中的 settings/profile 改变不得影响已启动 run；
- Goal event 不得包含完整 transcript、原始 tool output、模型密钥、环境变量、私钥、
  绝对路径或不可控的大对象；Evidence 只能保存 bounded 摘要和引用；
- 所有外部调用、子进程和真实 LLM smoke 都必须显式 opt-in，并具有 timeout、取消、
  输出上限和 degraded/fail-closed 行为。

## 4. 核心模块成熟度标准

从本规格开始，“模块已完成”不再等同于“有一个 schema 或 fake fixture”。支持发布
profile 的每个核心模块必须通过以下阶梯：

| Level | 必须具备 | 最低证据 |
| --- | --- | --- |
| A Contract | 版本化输入/输出、严格字段、privacy/path/secret 边界 | contract tests |
| B Pure core | reducer/resolver/状态机无副作用且确定性 | pure/property fixtures |
| C Durable | 持久化、幂等、冲突、重启恢复 | storage/recovery tests |
| D Application | 接入唯一 application service 和现有事实源 | daemon integration tests |
| E UX | Web 中可配置、可解释、可取消、可恢复 | Web/API/accessibility tests |
| F Real runtime | 真实 provider/runner/transport 的显式 smoke | redacted live evidence |
| G Release | 安装、升级、回滚、设备、供应链和运维证据 | release evidence bundle |

缺少 F/G 的模块必须标记为 `partial`，不能用 fake-only 测试冒充生产能力。

### 4.1 当前已知缺口（必须在 58-0 复核中重新确认）

| 模块 | 已有基础 | 需要补齐 |
| --- | --- | --- |
| Goal Control | A/B/C，有限 D，E 只读 projection | governed admission、验证写回、quota exactly-once、完整 UX、真实 E2E |
| Model/Context/AgentLoop | contracts、fixture loop、直接 provider smoke | daemon→RunManager→AgentLoop→ContextManager 的真实链路和失败恢复 |
| Approval/Sandbox/Shell | policy、显式 runner、container fixture | profile 到实际执行的完整 acceptance 和跨平台证据 |
| MCP/Skill | transport、snapshot、opt-in activation | 支持 profile 的真实 session、退出/取消/恢复证据 |
| Memory/Observability | bounded adapter、projection、ledger | 默认生命周期、资源/费用/写回故障的生产 evidence |
| Transport/Certificate | LAN/readiness contract | Tailscale/SSH adapter、ACME staging/renewal/rollback |
| Host/Release | host/recovery/release contracts | 安装包、升级器、签名、SBOM、GitHub promotion 和真实设备 |

该表不是完成声明；实现前必须以当前 checkout 的源码和测试重新校准。

## 5. Goal Control 目标状态

### 5.1 GoalRunBinding v1

在不破坏现有 v0 replay 的前提下新增版本化 binding contract，至少包含：

- `bindingId`、`runId`、`goalId`、可选 `todoId`；
- `mode: interactive | governed`，governed 必须显式由用户或受信 application
  service 请求；
- `goalControlRevision`、`policyRevision`、`capabilityProfileRevision`、
  `approvalPolicyRevision`、`sandboxSnapshotRevision` 和 `workspaceId`；
- `admissionId`、`createdAt`、`expiresAt`、`attempt` 和幂等 `requestId`；
- 不包含 credential、prompt、raw tool arguments、绝对路径或完整模型输出。

Binding 是 run 与 Goal 之间的只读快照，不是 capability grant。它必须在
`run.created` 前完成并持久化；快照过期或 revision 不匹配时，governed run 必须
fail-closed。

### 5.2 Goal admission decision v1

新增内部/受认证 API contract，至少包含 `eligible | blocked | waiting | throttled |
degraded` 和稳定 reason codes：`GATE_OPEN`、`GOAL_PAUSED`、`STALE_REVISION`、
`TODO_ALREADY_CLAIMED`、`QUOTA_EXHAUSTED`、`SCHEDULER_UNAVAILABLE`、
`CAPABILITY_MISMATCH`、`APPROVAL_REQUIRED`、`SANDBOX_UNAVAILABLE`、
`WORKSPACE_UNAVAILABLE`。

decision 必须包含 Goal projection checksum、control revision、scheduler decision
reference 和 bounded next step；它不直接启动模型、工具或 run。

### 5.3 Quota reservation v1

quota 必须拆成 `reserved → consumed | released | expired`，而不是在 preflight 阶段
直接增加 `quota.spent`：

- reservation 绑定 `bindingId + attempt + turnKey`，同一幂等键只能消费一次；
- scheduler、approval、sandbox 或 provider 失败必须释放 reservation；
- run 成功但 validation 失败不得消费 delivery quota；
- recovery/retry 创建新 attempt，不得重放旧工具调用或重复消费旧 turnKey；
- quota 是 Goal delivery policy，不替代 Scheduler 的资源容量。

### 5.4 Validation evidence v1

验证器是 application layer 注入的独立 port，不是模型自报结果，也不是 Goal Control
自己启动工具。结果至少包含 verifier id/revision、binding/attempt、status、checkedAt、
bounded summary、run/event/artifact references 和 checksum，并使用
`validated | failed | inconclusive | stale`。验证失败时写入 blocker/recovery
evidence，不完成 Todo、不消费 quota；相同 evidence id 相同内容是 no-op，不同内容是
conflict。

## 6. 实现阶段

### 58-0：全量前置复核（已完成文档门禁）

- 已生成当前 checkout 的 prerequisite matrix，见审计报告；
- 已识别每个核心模块的 A–G level、partial 和 design/fake-only 行；
- 已重跑 Goal/daemon/Web 受影响 focused gate 和一次完整 `pnpm verify`；
- 已记录未完成项、环境前提和不纳入本阶段的 optional capability。

58-0 通过后，后续代码实现仍必须先更新本规格、roadmap 和
`implementation-status.md`，再按 `58-1 → 58-7` 独立提交。任何 runtime 改动
必须继续保持交互式无绑定 run、`run_events`、`goal_events`、AgentLoop、RunManager、
Scheduler、Approval、Sandbox 和 WorkspaceRegistry 的现有权威边界。

### 58-1：Goal domain completion（contract/reducer slice，已实现）

- 依据 [ADR 0036](../adr/0036-goal-control-v1-domain-and-replay-boundary.md) 落地
  `GoalRunBindingV1`、admission decision v1、quota reservation v1、validation
  evidence v1 和 recovery record contracts；
- 为 v0 event replay 提供向后兼容 projection，不覆盖现有 SQLite 数据，也不改变
  `run_events`；
- 扩展纯 reducer/Goal write service，支持 reservation/release/consume、binding、
  validation、recovery 和 handoff 的幂等事件；
- 增加 bounded event migration/replay fixtures、stale revision/duplicate
  transition tests，禁止 raw event ingest；
- 本阶段不新增 `GoalAdmissionService`，不调用 `RunManager`，不接入默认
  `POST /api/v1/runs`，不执行任何模型、工具、shell、Git、MCP、Skill 或 sandbox。

本切片的实现证据如下：

- `packages/contracts/src/goal-control-v1.ts` 提供严格的 binding、admission、
  quota reservation、validation evidence、recovery、v1 event envelope 和 projection
  contracts；v0 schema/API 保持兼容；
- `packages/goal-control/src/v1.ts` 提供混合 v0/v1 replay、确定性 checksum、内存
  event store、reservation 状态 reducer 和纯 `GoalControlV1WriteService`；
- `packages/storage/src/goal-control-v1.ts` 复用独立 `goal_events` 表，使用
  `BEGIN IMMEDIATE`、goal-local append sequence、event-id no-op/conflict 和旧表列迁移；
- contracts/goal-control/storage focused tests 分别通过 82/22/69 个测试。该证据不包含
  governed admission、终态 verifier、Goal Web 工作流或真实 LLM smoke。

### 58-2：Governed admission application service

- daemon 新增 `GoalAdmissionService`，只允许显式 `runMode=governed` 调用；
- preflight 顺序固定为：读取 Goal projection → 校验 Gate/revision/claim/quota →
  解析 capability snapshot → 调用现有 Scheduler/Workspace/Approval/Sandbox
  readiness ports → 创建 binding → 再调用现有 `RunManager.start`；
- 任一 preflight 失败都不能发起模型请求或写 `run.created`；
- Scheduler 资源仍由 Scheduler 决定，Goal service 不新增队列或锁；
- unbound interactive run 保持现有 `RunManager.start` 行为和事件序列不变；
- `run_events` 与 `goal_events` 不做跨表假事务，使用 binding、attempt、eventId
  和可重放 reconciliation 保证 crash/retry 安全。

本切片的 SQLite 组合约束：v0 `SqliteGoalEventStore` 与 v1
`SqliteGoalControlV1EventStore` 可以安全地打开同一 `goal_events` 表。v0
projection/read API 只消费 `ready4vibe_goal_event_v0` 行，因而不会把 v1
admission/binding 事件误交给 v0 reducer；v0 的可见 cursor 也只统计 v0 行。
一旦某个 Goal 已有 v1 行，v0 writer 拒绝继续追加 legacy event，避免破坏
“legacy events precede additive v1 events”的 replay 顺序。v1 reader 仍负责
混合 replay；`run_events` 不受影响。

### 58-3：终态验证、写回与恢复

- daemon application layer 新增 `GoalRunWritebackService`，通过现有
  `RunManager.subscribe/readEvents` 观察绑定 run 的终态；不修改 AgentLoop 核心循环；
- 终态后异步调用注入的独立 `GoalRunVerifier`。verifier 只返回 bounded status、summary、
  verifier revision 和 safe event refs；默认实现 fail-closed 为 `inconclusive`，不能把
  模型自报完成直接变成 Todo 完成；写回不阻塞 run 终态；
- governed admission 在 binding 后、`RunManager.start` 前创建 `quota.reserved`（单位、
  turnKey、attempt 和过期时间均受 contract 限制）。run 启动失败会释放 reservation；
  binding/reservation 已持久化但进程崩溃时，重试可恢复同一 request 的未启动 saga；
- 只有 `validated` evidence 才能在 Goal Control 的单 Goal lock 和一个原子 batch 内同时
  `todo.completed` 与 `quota.consumed`。重复终态通知、重复 evidence、已完成 Todo 或已消费
  reservation 都是 no-op；状态不一致或 stale revision fail-closed；
- `failed`、`cancelled`、`timed-out`、`needs-recovery` 或验证非 validated 只写 bounded
  validation/recovery evidence，不完成 Todo、不消费 quota；
- restart reconciliation 只读取已有 `run_events` 和 `goal_events`，发现 terminal run 后
  重放 verifier/writeback；不执行模型、工具、shell、Git、MCP、Skill 或旧 tool call；
- governed retry 由 daemon application service 显式创建新 request、runId、attempt、
  turnKey 和 binding，旧 run 的 tool/approval/quota 不会重放。无 Goal binding 的 interactive
  retry 继续使用现有 `RunManager` 行为。

58-3 的失败/恢复边界冻结在 [ADR 0038](../adr/0038-governed-terminal-writeback-and-recovery.md)。
本阶段不宣称真实 task-specific verifier 或真实 LLM governed smoke；verifier adapter 和
live evidence 仍属于 58-5。

### 58-4：Goal Web 工作流

- conversation-first Web 增加显式 Goal 选择和 `interactive/governed` 模式选择；
- 提供 Goal/Todo 创建编辑、claim/release、Gate open/resolve、Evidence 查看和
  governed preflight；所有 mutation 走受认证 API、CSRF/Origin、revision 和幂等键；
- preflight 卡片解释 Gate、quota、capability、workspace、approval 和 sandbox
  阻塞原因，不用 toast 或静默失败隐藏决策；
- run 终态显示 validation/writeback 状态，允许安全 retry/recovery；
- 桌面、竖屏、手机、折叠屏、阔折叠、三折叠和平板保持 composer、approval 和 primary
  action 可见，遵守 reduced motion、键盘导航、focus return 和 WCAG 语义；
- Web 不保存 claim token、credential、raw transcript 或绝对路径。

### 58-5：核心 Harness 完成与真实运行证据

每个支持发布的 profile 必须有 focused unit、application integration、failure/recovery
fixture 和显式 live smoke。至少包括：

- `pnpm smoke:model`：provider 协议 smoke；
- `pnpm smoke:harness -- --mode interactive`：真实 provider 经过 daemon、RunManager、
  AgentLoop、ContextManager 的无工具 interactive run；
- `pnpm smoke:harness -- --mode governed`：同一路径加 Goal preflight、binding、
  approval/sandbox readiness、独立 validation 和 quota exactly-once；
- `pnpm smoke:container`、`pnpm smoke:mcp`、`pnpm smoke:tailscale`、
  `pnpm smoke:ssh`、`pnpm smoke:acme -- --staging`：按 release profile 显式选择；
- 所有 smoke 从进程外读取 secret，报告只保存 provider/model revision、status、latency、
  bounded usage、reason/error code、evidence refs；不保存 key、完整 prompt、raw response、
  headers、路径或环境变量。

真实 LLM 最低验收必须证明：

1. 请求经过 daemon application boundary、RunManager、AgentLoop 和 ContextManager；
2. run snapshot 在运行期间不随 settings 改变；
3. stream、usage、终态、cancel、timeout、provider error 和 privacy redaction 正确；
4. governed run 的 Gate/quota/validation 行为正确；
5. interactive run 不被 Goal admission 静默改变；
6. 真实 smoke 不执行未批准的 host tool、MCP/Skill、网络工具或 shell。

### 58-6：模块成熟度闭环

按第 4 节为 Model、Context、AgentLoop、Approval、Sandbox、Scheduler、MCP/Skill、
Memory、Observability、Transport/Certificate、Host/Release 逐项补齐 A–G 证据。任何
模块若只完成 contract 或 fake fixture，必须继续标记为 `partial`，不能进入 stable
release manifest。

#### 58-6a：Goal verifier bounded runtime gate

任务特定 verifier 的执行必须有 daemon 控制的超时和 `AbortSignal` 边界，不能让
失控实现无限期持有 governed quota reservation。实现默认超时为 10 秒，服务端范围为
100 ms–30 秒；Web/Goal payload 不能扩大该范围。超时、取消、拒绝或非法结果只能写
bounded `inconclusive` evidence、释放 reservation，并保持 Todo 未完成；不能重试
verifier、重放旧 tool call 或改变 interactive run。当前实现和决策见
[ADR 0051](../adr/0051-bounded-goal-verifier-timeout-and-cancellation.md)。

当前验收覆盖 cooperative abort、忽略 signal 的 non-cooperative timeout、late result
丢弃、超时范围校验，以及同一 run 多个终态通知只调用一次 verifier。该切片不注册
semantic verifier，也不把 run completed 当作 Todo 证明。

#### 58-6b：Goal verifier snapshot fence

registry resolution 必须在 governed run 注册时捕获，并在终态写回时只使用该 descriptor/
implementation；不能因为 registry 热更新让 in-flight run 改用新 revision。捕获失败、
缺失或 non-ready lane 必须保持 bounded `inconclusive`，不得 fallback 到另一个 verifier。
重复终态通知复用现有 validation evidence，不重复调用 verifier。详细边界见
[ADR 0052](../adr/0052-goal-verifier-run-snapshot.md)。

### 58-7：发布验收

- Host 安装后无需 Node/pnpm 或手工编辑配置文件即可 pairing、选择 profile、配置模型、
  添加 workspace、创建 Goal 并完成一次 governed run；
- 重启、升级、回滚、失联、证书续期失败、模型失败、sandbox 不可用和 Goal recovery
  都有可解释 UI 和可恢复路径；
- stable release 汇总 Goal、真实 LLM、transport/certificate、sandbox、设备、无障碍、
  backup/restore、签名/SBOM/attestation 证据；
- `pnpm typecheck`、受影响模块测试、`pnpm verify`、`pnpm diff:check`、`git diff --check`
  和 Markdown link/fence check 全部通过。

## 7. 测试矩阵

至少覆盖：closed Gate、paused/blocked Goal、stale revision、重复 claim、并发 claim、
quota exhausted、reservation conflict/release/expiry、duplicate consume、Scheduler 无
容量、workspace 缺失、capability narrowed、Approval deny/expiry、sandbox unavailable、
provider timeout/5xx/cancel、部分流失败、Context budget overflow、run completed 但
validation failed、run failed/cancelled/needs-recovery、daemon restart，以及 recovery/retry
不重复旧工具调用/approval/evidence/quota spend。

还必须验证：Goal API/Web 不泄露 secret、claim token/hash、环境变量、绝对路径或 raw output；
governed run 被阻塞时不发模型请求；Goal store 不可用时 unbound interactive run 仍可运行；
settings/profile/provider/memory/sandbox 切换不改变已启动 run snapshot；`goal_events` 与
`run_events` 可独立重放，任一投影损坏不会静默改变另一事实源。

## 8. 不在本规格内

- 不复制 LoopX 源码或实现完整 LoopX `quota.py`；
- 不创建第二套 scheduler、approval broker、sandbox runtime 或 event store；
- 不把 Goal 自动应用到所有用户 run；
- 不将 Goal payload 注入系统 prompt，也不以 Goal 替代用户明确指令；
- 不实现原生 Android/iOS/HarmonyOS 客户端；它们仍是后置 API 消费者；
- 不把 optional TencentDB、MCP、Tailscale、SSH 或 ACME 在缺少环境时伪装成 healthy；
- 不用模拟器、fake provider 或设计文档替代 release 所需的真实证据。

## 9. Definition of Done

本规格只有在以下条件全部满足后才能标记 `Implemented`：

1. 58-0 前置复核已记录且没有未说明的前置矛盾；
2. Goal governed admission、binding、validation writeback、quota exactly-once 和
   recovery/retry 已通过 application integration 与 failure fixtures；
3. `interactive` 与 `governed` 两条路径均有回归测试，前者行为保持不变；
4. Goal Web 工作流可以完成创建、选择、preflight、执行、验证、恢复和解释阻塞；
5. 支持 release profile 的核心 Harness 没有 design-only/fake-only 核心行；
6. 至少一轮真实 LLM 经过 daemon→RunManager→AgentLoop→ContextManager，且有脱敏报告；
7. Host、transport/certificate、sandbox、设备、无障碍和供应链证据满足对应 Spec；
8. 每个实现阶段先更新本 Spec、roadmap、implementation-status，再提交独立 Git commit；
9. 最终 full gate、diff gate 和文档检查全部通过。

推荐提交顺序：

```text
58-0 prerequisite audit
  -> 58-1 contracts/reducer
  -> 58-2 governed admission
  -> 58-3 validation/quota/recovery
  -> 58-4 Web workflow
  -> 58-5 real Harness smoke
  -> 58-6 module closure
  -> 58-7 release evidence
```

## 10. Spec 58-2 design freeze (implementation slice)

This slice adds one daemon application boundary, `GoalAdmissionService`. It
accepts only an explicit `runMode: governed` envelope. A request without that
field continues to use the existing interactive `RunManager.start` path and
is not inspected by Goal Control.

The governed preflight order is intentionally observable and fail-closed:

1. Parse the governed envelope and the existing `RunConfig`.
2. Replay the Goal projection and verify the requested control revision,
   active blocking gates, selected Todo, claim owner/lease, and turn/quota
   identity. A missing, expired, or foreign claim is not silently acquired.
3. Resolve the server-owned capability run snapshot and reject blocked or
   narrowed requests that cannot satisfy the Todo requirements.
4. Ask the existing Workspace, Scheduler, Approval, and Sandbox readiness
   ports for a read-only decision. These checks do not enqueue, acquire a
   lease, grant approval, start a process, or mutate a second scheduler.
5. Persist an eligible admission decision and a versioned `GoalRunBinding`
   before calling `RunManager.start` with the same immutable run id and
   capability snapshot.

No preflight failure may call the model provider or create `run.created`.
The binding records only bounded ids, revision tokens, timestamps and safe
references. `run_events` and `goal_events` remain independent; if the process
fails between binding persistence and `RunManager.start`, reconciliation is a
later Spec 58-3 responsibility and must never replay an old tool call.

The application service does not reserve or spend delivery quota in this
slice. It only rejects an already-spent turn key or an exhausted caller quota;
reservation/consume/release exactly-once behavior remains the 58-3 boundary.

Implementation evidence for the current slice includes the explicit governed
HTTP route, request-id idempotency, run-id/capability snapshot injection,
read-only scheduler inspection, and the SQLite v0/v1 mixed-table compatibility
fixture described above. The default `/api/v1/runs` route rejects a governed
envelope and ordinary interactive runs remain unchanged. The subsequent 58-3
implementation now supplies the opt-in production quota reservation,
terminal-writeback and recovery coordinator; this section intentionally does
not fold those application concerns back into the 58-2 admission contract.

The service is exposed as an injectable daemon port for focused tests. The
default HTTP route is unchanged; an explicit governed route may be wired by a
composition root without changing the semantics of ordinary interactive
requests. Production composition must use the existing Scheduler,
WorkspaceRegistry, ApprovalBroker, Sandbox settings and capability snapshot
authority rather than duplicating their state.

## Spec 58-4a design freeze: authenticated Goal mutation and read-only preflight

This implementation slice is the first Web workflow increment. It connects the
conversation-first Web shell to the already protected Goal mutation API and
adds an explicit, non-mutating governed preflight endpoint.

### In scope

- Web API client methods for Goal creation, Todo creation, Gate open/resolve and
  bounded evidence attachment. Every request uses the existing daemon pairing,
  Bearer, CSRF and Origin boundary, a fresh client event id and the projection
  revision supplied by the server response.
- A Goal editor surface that lets the user select a Goal, create a Todo or
  blocking Gate, resolve an open Gate, and attach bounded evidence. The UI
  refreshes the projection after every successful mutation and presents stale
  revision/conflict errors as actionable inline status instead of silently
  dropping them.
- `POST /api/v1/goals/:goalId/preflight`, a read-only application-service call
  that evaluates Goal, Todo, Gate, quota, capability, workspace, Scheduler,
  Approval and Sandbox checks for an explicit governed request. It returns
  bounded check records, the projection checksum/revision and the existing
  admission decision shape. It never appends a Goal event, reserves quota,
  creates a binding, starts a run, invokes a model, or launches a tool.
- A Web preflight card that explains each check and exposes the next safe step.
  The card is advisory only; the governed run route remains the sole place that
  can persist admission/binding state and start a run.

### Explicitly deferred

Todo claim/release token UX, governed run submission from the composer,
terminal validation/writeback status, recovery/retry controls, responsive device
evidence, and real-provider Harness smoke remain later 58-4/58-5 slices. This
slice must not add a second scheduler, change the default interactive route, or
persist claim tokens, credentials, paths, transcripts or raw tool output in the
browser.

### Acceptance evidence

- Daemon tests prove preflight is side-effect free for both eligible and blocked
  requests and that no `run.created` or quota event is produced.
- Web/API tests prove mutation bodies contain only bounded DTOs, include CSRF
  headers after pairing, refresh on success, and render stale/conflict errors
  without leaking secret-shaped values.
- Focused commands are `pnpm check:module -- @ready4vibe/daemon`,
  `pnpm check:web`, and `pnpm diff:check`; the full `pnpm verify` gate remains
  required before merge.

## Spec 58-4a implementation note (2026-08-05)

The daemon now exposes `POST /api/v1/goals/:goalId/preflight` through
`GoalAdmissionService.preview()`. The response is a bounded
`ready4vibe_goal_preflight_v1` projection with ten ordered checks and the
existing admission decision shape. Both eligible and blocked fixtures prove
that preview does not append `goal_events`, create `run_events`, reserve quota,
create a binding, call the model or start a run. Governed request parsing also
rejects secret-shaped keys before configuration parsing.

The Web API client now covers Goal create, Todo add, Gate open/resolve, bounded
Evidence attachment and preflight. The context rail offers these mutations and
an explainable preflight card only when authenticated callbacks are present;
successful mutations refresh the projection and stale/conflict errors stay
inline. Claim/release, governed submit, recovery UI and live provider smoke are
intentionally still deferred.

## Spec 58-5 audit and minimum smoke contract (2026-08-05)

The current checkout already has a provider-only `smoke:model` command, but it
does not yet have `smoke:harness`. The first 58-5 implementation is therefore
limited to a redacted, explicit smoke runner over the existing daemon
application boundary. It must not become a second composition root or a second
runtime state machine.

The runner accepts `interactive` or `governed` mode and uses an explicit
provider endpoint, model id and environment-variable secret reference. It
builds the existing `createDaemonServer` with an in-memory EventStore and the
real OpenAI-compatible provider, then sends an HTTP request to the existing
run route. The model request consequently passes through `RunManager`,
`AgentLoop` and its `ContextManager` construction. No tool runtime, MCP/Skill,
shell, host process, or networked tool is enabled by the smoke fixture.

Governed mode additionally seeds an isolated Goal/Todo/claim fixture, uses the
existing `GoalAdmissionService` and `GoalRunWritebackService`, and waits for a
validated terminal writeback before reporting quota consumption. The verifier
used by this first smoke is an explicit bounded fixture verifier; it is not a
claim of task-specific semantic validation. Interactive mode never constructs
or calls Goal admission and remains available when Goal state is absent.

The report is `harness-smoke/v1` and contains only mode, provider/model labels,
bounded status/error code, elapsed time, event-type counts, run id and (for
governed mode) bounded Goal outcome references. It must not contain the secret,
secret environment variable name, prompt, model output, headers, raw response,
tool arguments, absolute paths or a full event payload. Missing credentials,
provider failure, timeout and governed validation failure are explicit
`blocked`/`failed` outcomes; they never fall back to a fake provider.

This slice adds focused script tests and a module-level build/test gate. The
initial implementation did not claim live evidence; the live evidence note
below records the later user-authorized run. Container, MCP, Tailscale, SSH and
ACME smoke commands remain separate release-profile gates.

## Spec 58-5 minimum runner implementation note (2026-08-05)

`scripts/smoke-harness.mjs` and `pnpm smoke:harness` now implement the scoped
runner. The command builds the daemon dependency closure, accepts
`--mode interactive|governed`, reads only an explicit secret environment
reference, and emits a `harness-smoke/v1` JSON report. Its HTTP client checks
daemon health, submits the selected route, replays SSE until a terminal event,
and reads only bounded run/Goal projections. SSE parsing drops prompt, output,
headers and arbitrary event payloads before the report is constructed.

The default composition uses the existing in-memory EventStore, Scheduler,
RunManager, GoalAdmissionService and GoalRunWritebackService. Governed smoke
seeds a temporary Goal/Todo/claim fixture and uses the named
`harness_fixture_verifier`; it does not claim task-specific semantic proof.
The smoke never enables a ToolRuntime, MCP/Skill, shell, host process or
networked tool. Missing configuration is `blocked`; no fake provider fallback
exists.

Focused evidence: `node --test scripts/smoke-harness.test.mjs` passes 6 tests;
`pnpm check:module -- @ready4vibe/daemon` passes the daemon dependency-closure
build/typecheck and 220 daemon tests. An injected-provider run also completed
both interactive and governed paths locally. No live DeepSeek/provider result
is claimed until an explicit user-authorized command is run.

## Spec 58-5 live smoke evidence (2026-08-05)

An explicit user-authorized run against the configured DeepSeek OpenAI-compatible
endpoint completed both modes through the new daemon harness. The redacted
reports were `healthy` for interactive and governed; both reached
`run.completed`, replayed terminal SSE, and reported bounded usage. Governed
mode also reached `validated`, `todoStatus=done`, `totalSpent=1` with one each
of `quota.reserved` and `quota.consumed`. The evidence contains no credential,
secret reference, prompt, raw response, headers or path. This is live provider
path evidence, not the final Spec 60 release bundle or task-specific verifier
acceptance.

## Spec 58-6 task-specific verifier registry design freeze (2026-08-06)

The next bounded module-closure slice adds an explicit daemon-owned registry for
task-specific Goal validation. A registry entry is a versioned
`GoalVerifierDescriptorV1` keyed by the authoritative Todo `taskClass`. Only
`advancement`, `monitor` and `blocker` may select an automatic verifier;
`user_action` and `user_gate` always remain fail-closed and require an explicit
user action or gate resolution.

The descriptor is strict and privacy checked. It contains only a bounded
verifier id, task class, opaque verifier revision, readiness status, privacy
classification and ISO update time. Secret-shaped fields, credentials,
environment names/values, absolute paths, unknown fields and non-ready
descriptors are rejected. A task class has at most one registered descriptor;
duplicate, malformed, stale or missing entries resolve to the existing
`FailClosedGoalRunVerifier` behavior.

`GoalRunWritebackService` derives `taskClass` from the replayed authoritative
Goal projection and passes only that bounded class plus run/event digests to the
selected verifier. Prompts, transcript, model output, tool arguments, commands,
paths, environment and secrets never cross the registry port. The returned
verifier id and revision must exactly match the selected descriptor; mismatch or
runtime failure produces bounded `inconclusive` evidence and cannot complete a
Todo or consume quota.

The registry is a pure application port. It does not execute a model, tool,
shell, Git, MCP, Skill, filesystem operation or sandbox, and it does not add a
second scheduler or alter the AgentLoop, RunManager default start, Approval,
Sandbox, WorkspaceRegistry, `run_events` or `goal_events` authorities. The
default daemon registers no semantic verifier, so existing unbound interactive
runs and governed fail-closed behavior remain unchanged until a later explicit
profile supplies a verifier.

## Spec 58-6 task-specific verifier registry implementation checkpoint (2026-08-06)

The bounded registry slice is implemented in `packages/contracts` and
`apps/daemon`. `GoalVerifierDescriptorV1` is strict, revisioned and
privacy/path checked; the daemon registry allows one lane per task class and
only replaces it with a newer revision. `GoalRunWritebackService` derives the
task class from the replayed Goal projection, selects the registry lane when an
explicit registry is injected, and requires exact verifier id/revision
matching. Missing, non-ready, user-owned (`user_action`/`user_gate`) and
mismatched selections produce `inconclusive` evidence and release any
reservation. The default daemon still injects no semantic registry, so
ordinary interactive runs and the existing governed fail-closed path are
unchanged.

Focused evidence for this checkpoint is recorded in
[`spec58-6-task-verifier-registry-2026-08-06.md`](../reports/spec58-6-task-verifier-registry-2026-08-06.md).
