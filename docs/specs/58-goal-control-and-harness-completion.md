# Spec 58：Goal Control 完整执行闭环与核心 Harness 完成门禁

- Status: Draft（58-0 已完成；58-1 contract/reducer slice 已实现，58-2 尚未接入默认运行时）
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

### 58-3：终态验证、写回与恢复

- Run 终态后异步调用独立 verifier，写回不阻塞 run 终态；
- 只有 validated evidence 才能在同一 Goal lock 下完成 Todo 并 consume quota；
- run 成功/验证失败、run 失败、取消、超时、needs-recovery、重复 webhook 和 daemon
  restart 都有确定的 Goal projection 结果；
- 重试创建新 run/attempt，绝不重复执行旧工具调用、旧 approval 或旧 quota spend；
- reconciliation 只能读取既有 `run_events`，不得执行模型、工具或 shell。

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
