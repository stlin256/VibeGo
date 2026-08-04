# Spec 44：Provider、Token、费用管理与上游源码复用

- 状态：Accepted；44-R0、44-R1 provider/usage contract slice、44-R2 reconciliation slice 与 44-R3 pricing slice 已完成，后续运行时实现仍受下方阶段门禁约束
- 日期：2026-08-04
- 范围：model provider registry、usage/cost normalization、pricing management、audit projections 和开源项目复用
- 相关：
  - [Spec 03：ModelProvider 与 ContextManager 合约](03-model-context-contract.md)
  - [Spec 43：资源、Token、费用与审计可观测性](43-resource-usage-and-cost-audit.md)
  - [ADR 0012：本地资源与费用审计账本](../adr/0012-local-resource-and-cost-audit-ledger.md)
  - [ADR 0013：上游研究与复用边界](../adr/0013-upstream-research-and-provider-management-boundary.md)
  - [开发 Agent 提示词](../prompts/44-provider-usage-management-implementation.md)

## 1. 目标

VibeGo 需要同时解决两个问题：

1. 让模型 provider、token、缓存、延迟、费用和重试可以被统一管理、审计和扩展；
2. 可以学习 CCSwitch、AxonHub、LiteLLM、Langfuse 和 OpenTelemetry 等项目，但不把它们的 proxy、CLI、Tauri、Python runtime 或完整后端带入 VibeGo。

本 Spec 是 Spec 43 的 provider/usage 管理补充，不改变 `run_events`、`goal_events`、AgentLoop、RunManager、Scheduler、Approval、Sandbox 或 WorkspaceRegistry 的事实源地位。

## 2. 上游项目的借鉴点

以下结论是设计输入，不是对当前上游版本的永久承诺。实现前必须按照第 6 节重新读取指定 commit、LICENSE 和 NOTICE。

| 项目 | 借鉴内容 | VibeGo 的原生落点 | 不引入的部分 |
| --- | --- | --- | --- |
| [CC Switch](https://github.com/farion1231/cc-switch) | proxy 与 CLI/session 双来源、稳定 request/message ID、去重冲突、cache-inclusive/fresh 语义、Provider/Model/时间范围汇总、TTFT/latency | `dataSource`、`usageId`、`reconciledFrom`、`inputTokenSemantics`、rollup query | Tauri 应用、用户目录扫描、第二套 proxy、原始 session 文件格式 |
| [AxonHub](https://github.com/looplj/axonhub) | input/output/cache/reasoning/TTL token 分桶、flat/per-unit/tiered 定价、cost item 明细和 pricing revision | `ModelUsageRecord.tokens`、`CostItem`、`PricingRule`、`pricingRevision` | 网关、GraphQL、其后端运行时和未核验的内部协议 |
| [LiteLLM](https://github.com/BerriAI/litellm) | 多 provider 的 capability/usage/pricing 归一化思路 | `ProviderDescriptor`、独立 normalizer 和 pricing adapter | Python proxy、隐式重试、替换 `ModelProvider` |
| [Langfuse](https://github.com/langfuse/langfuse) | generation、latency、token、cost 的投影和筛选体验 | daemon 本地 projection、同源 REST、Web Usage/Audit | 常驻 SaaS/server、完整 transcript 采集 |
| [OpenTelemetry Specification](https://github.com/open-telemetry/opentelemetry-specification) | resource、metric、timestamp、attribute 和聚合语义 | bounded resource sample 和 accuracy 标签 | 强制 OTel Collector、外部 exporter 和高频 trace |

如果用户所说的 `axonhub/ccswitch` 与上表 URL 不一致，开发 agent 必须先确认 canonical repository；不能静默把一个未经确认的仓库当作事实来源。

## 3. 目标架构

```mermaid
flowchart LR
  P[Provider adapters] --> N[Usage normalizer]
  N --> D[Idempotency and reconciliation]
  D --> L[usage_ledger]
  R[Host/tool/sandbox probes] --> S[resource_samples]
  L --> C[Pricing catalog]
  C --> U[Rollups and projections]
  S --> U
  U --> A[Authenticated API]
  A --> W[Web and future native clients]
  E[run_events] --> N
```

### 3.1 Provider registry

后续实现应增加可扩展的 `ProviderDescriptor`/registry，但不让 AgentLoop 识别具体 provider：

- `id`、显示名、协议类型、endpoint policy 和 capability 都是 bounded metadata；
- `ModelProvider` 仍是运行时注入接口，adapter 负责协议转换；
- auth 使用 `authRef`/secret store，descriptor、settings response、event 和 usage ledger 不保存 API key；
- provider 切换只影响新 run；运行中的 run 冻结 provider、model、pricing revision 和 capability snapshot；
- provider 不能绕过 Scheduler、Approval、Sandbox 或 Workspace；
- provider-specific headers、路径和 usage 字段由 adapter 显式声明，不能依赖字符串拼接或隐式 `/chat/completions`。

### 3.2 Usage normalizer

所有来源必须先转换为 Spec 43 的 `ModelUsageRecord`，再进入 ledger：

- 直接 provider usage：`dataSource=provider-usage`；
- `run_events` replay：`dataSource=run-event`；
- 用户显式导入：`dataSource=session-import`；
- 双来源核对：`dataSource=reconciled`，保留 `reconciledFrom`；
- 缺失字段必须保留 `unknown`，不能填 0；
- 每个 retry attempt 单独计数，逻辑请求必须展示 `attemptCount`；
- 同一 `usageId` 和相同 canonical 内容是 no-op；相同 ID 内容不同必须返回 conflict；
- 无稳定 ID 时才允许使用 bounded semantic fingerprint，并记录 collision/降级原因。

### 3.3 Token 和费用

最小 token taxonomy 为：

`input`、`output`、`cachedInput`、`cacheCreation`、`reasoning`；多模态 provider 可扩展 `audioInput`、`audioOutput`、`acceptedPrediction`、`rejectedPrediction`。

必须显式保存：

- `inputTokenSemantics`：`fresh`、`cache-inclusive` 或 `unknown`；
- `tokenAccuracy`：`reported`、`estimated` 或 `unknown`；
- `pricingModel` 与 `requestModel` 的区别；
- `pricingRevision`、货币和每个 `CostItem`；
- flat、per-unit、tiered 三种定价模式；
- 价格缺失时 cost 为 `unknown`，绝不能伪造为 0。

### 3.4 资源和审计

- `resource_samples`、`usage_ledger`、`audit_events` 和 rollup 必须是独立 bounded context；
- 采样队列满、probe 不可用或 projection 失败只能产生 degraded/unknown，不能阻塞 interactive run；
- audit 只记录 actor、transport、action、target、outcome、reasonCode 和 hash chain，不记录 prompt、transcript、command、cwd、绝对路径或 secret；
- raw sample、ledger、rollup 和 audit 的 retention 可分别配置，清理前允许导出和完整性验证；
- Web 和后续 Android/iOS/HarmonyOS 只消费版本化 projection，不直接读取 SQLite。

## 4. 源码学习与复用门禁

### 4.1 研究步骤

开发 agent 必须按以下顺序做，并把结果写入 tracked 文档 `docs/research/upstream-provider-usage.md`：

1. 在 `.research/upstream/<slug>` 中 clone，`.research/` 已被 `.gitignore` 排除；
2. 固定 commit、记录 clone 时间、仓库 URL、默认分支和许可证；
3. 先读根目录 README、LICENSE、NOTICE、贡献指南和构建 manifest；
4. 用 `rg` 定位 token、usage、cache、pricing、dedup、session、rollup、prune、TTFT、latency；
5. 只读取与目标能力直接相关的文件，记录“文件路径 + commit + 观察到的语义”，不复制源码到仓库；
6. 对每个拟复用片段写明许可证、版权声明、依赖和是否需要 NOTICE；
7. 如果仓库、路径、许可证或语义无法确认，停止实现并在研究文档标记 `blocked`。

Windows PowerShell 示例：

```powershell
$researchRoot = Join-Path $PWD '.research/upstream'
New-Item -ItemType Directory -Force $researchRoot | Out-Null
git clone --filter=blob:none --no-checkout https://github.com/farion1231/cc-switch (Join-Path $researchRoot 'cc-switch')
git -C (Join-Path $researchRoot 'cc-switch') log -1 --format='%H%n%ad%n%s' --date=iso
git -C (Join-Path $researchRoot 'cc-switch') sparse-checkout init --cone
git -C (Join-Path $researchRoot 'cc-switch') sparse-checkout set README.md LICENSE NOTICE src docs
rg -n -i 'token|usage|cache|pricing|dedup|session|rollup|prune|ttft|latency' (Join-Path $researchRoot 'cc-switch')
```

命令中的仓库 URL、目录和分支只是示例；agent 必须用实际 canonical repository 和实际存在的路径替换，并记录证据。

### 4.2 复用决策矩阵

| 输入 | 默认决定 | 必须满足的额外条件 |
| --- | --- | --- |
| 设计思想、数据语义、测试场景 | 允许重新实现 | 记录出处和差异，不复制表达性文字或 UI |
| MIT/BSD/ISC/Apache-2.0 的小型独立工具代码 | 有条件允许 | 核对当前 commit、保留版权/NOTICE、依赖兼容、增加 provenance 注释和测试 |
| LGPL/GPL/AGPL 代码 | 默认不复制 | 先做许可证评审；优先 clean-room 重写或隔离为独立进程/包 |
| 未知许可证、生成文件、私有协议、品牌资源 | 禁止复制 | 只能借鉴公开语义，不能 vendor |
| 完整 proxy、CLI、Tauri、Python runtime、server | 禁止引入 | 只实现 VibeGo 原生 TypeScript/SQLite adapter |

即使许可证允许复制，也不得把上游模块直接接入 AgentLoop 的核心循环、默认 run 创建路径或第二套事实源。小段代码复用必须在 ADR 中列出来源、commit、许可证、文件路径和删除/替换计划。

### 4.3 44-R0 研究证据

截至 2026-08-04，五个候选项目已经在固定 commit 上完成 README、LICENSE/NOTICE、构建 manifest
和目标文件核对。完整路径、语义摘要、许可证例外和 `reuseDecision=clean-room` 记录在
[上游调研记录](../research/upstream-provider-usage.md)。本轮没有复制源码、schema、UI、品牌资源、
CLI session 或运行时，也没有新增上游依赖。

| 项目 | pinned commit | 已确认的设计输入 | 许可证/复用约束 |
| --- | --- | --- | --- |
| CC Switch | `59a2bd10407707282dcefe85b290f0ddaf4d0a74` | cache-inclusive/fresh、稳定 request/message ID、dedup、TTFT/latency、rollup | MIT；不引入 Tauri、proxy 或 session 扫描 |
| AxonHub | `31f898188cc05f13c0971d7ec9762997d9ff6c41` | cache/reasoning/TTL token 分桶、cost item、flat/per-unit/tiered/volume pricing | 根目录 Apache-2.0；`llm/` LGPL-3.0；Bedrock/NOTICE 单独处理；不复制 |
| LiteLLM | `956d5177d1d915adc8084c142d9d2babad1ff7af` | provider normalization、pricing map 校验、retry/fallback、tier | MIT；`enterprise/` 另有许可证；不引入 Python proxy/runtime |
| Langfuse | `3bca62fb0db137f0a778af1ecdc8c7c1c3c5ea5d` | generation、usage/cost projection、latency/TTFT、bounded tier matching | MIT Expat；`ee/` 和第三方组件另有边界；不引入常驻平台 |
| OpenTelemetry Specification | `2b7a5617c0043ea0ac897a1452022eb04c72e89f` | resource identity、属性限制、时间序列聚合和 cardinality/memory trade-off | Apache-2.0；只借鉴规范语义，不引入 Collector/exporter |

未确认项（价格数据授权、未列路径的内部协议、未来 commit 的字段语义和是否需要 session import/
外部 exporter）不得在 44-R1 中静默假设；任何变化都要重新触发研究门禁。

## 5. 分阶段实施

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| 44-R0 | 上游源码、许可证和路径证据 | 五个 pinned checkout 的 URL/分支/commit/LICENSE/NOTICE/filesRead、clean-room 决策和未知项已记录 |
| 44-R1 | `ProviderDescriptor`、registry、usage normalizer contract | provider contract tests、secret/path redaction、capability snapshot tests |
| 44-R2 | 独立 `usage_ledger`、dedup/reconcile、UTC rollup | SQLite/InMemory 一致、idempotency conflict、retry attempt 和重启测试 |
| 44-R3 | pricing catalog 与 cost engine | flat/per-unit/tiered、pricing revision、unknown cost 和历史重算测试 |
| 44-R4 | host/tool/sandbox resource collector 与 audit hash chain | Windows/macOS/Linux adapter fixture、队列降级、完整性验证和 retention 测试 |
| 44-R5 | authenticated API、Web Usage/Audit、export/import | UI 只消费 projection；显式导入；不扫描用户目录；移动端契约稳定 |

44-R1 至 44-R5 应复用 Spec 43 的 contracts，不得另造一套 token 或 cost 类型。任何 phase 都必须先更新 Spec、ADR、implementation-status，再修改代码。

### 5.1 44-R1 contract slice

44-R1 只定义可测试的 provider/usage 端口，不接入 AgentLoop、RunManager、默认 run 创建路径或
daemon API：

- `ProviderDescriptor` 是严格、版本化的 bounded metadata：provider id/display name、协议类别、
  endpoint policy、`authRef`（只允许 secret-store 引用）和 capability flags；descriptor 不保存
  API key、Authorization、环境变量、完整 URL 查询 secret 或绝对路径；
- `ProviderCapabilitySnapshot` 在 run 创建时复制并冻结 descriptor 的 capability；注册表后续更新不能
  改变已有 snapshot，provider 切换只影响新 run；
- `ProviderUsageObservation` 只接受已经从 provider response 提取的 bounded counters 和稳定 identity，
  不接受或持久化 raw response。normalizer 输出现有 `ModelUsageRecord`，并显式填写
  `inputTokenSemantics`（`fresh`/`cache-inclusive`/`unknown`）、`dataSource`、`requestModel`/
  `pricingModel` 和可选 `reconciledFrom`；token taxonomy 复用 Spec 43 的 `ModelUsageRecord.tokens`，
  可扩展 cache creation、audio 和 prediction 维度但不创建第二套 cost 类型；
- registry、normalizer 和 snapshot 都是纯内存/纯函数能力；未知 provider、未知协议、超长字段、secret、
  绝对路径和不一致 identity 必须 fail-closed；价格未配置时保持无 `cost`/unknown，不填 0；
- R1 测试必须覆盖 descriptor strictness、secret/path redaction、capability snapshot isolation、
  cache-inclusive/fresh 语义、unknown counter 保留和 normalizer 幂等输入。R1 完成后再进入 R2 ledger。

44-R1 已实现：`packages/contracts/src/provider-usage.ts` 提供上述严格 schema 与 privacy 校验，
`packages/observability/src/provider-usage.ts` 提供 immutable in-memory registry、capability
snapshot 和 `ProviderUsageObservation` → `ModelUsageRecord` normalizer；`ModelUsageRecord.tokens`
向后兼容扩展 cache creation、audio 和 prediction 维度，并支持 request/pricing model、来源和
reconciliation metadata；现有 `run_events` replay projection 也显式标记 `dataSource=run-event`
与未知 input token semantics。该切片没有新增运行时依赖，也没有改变 interactive run 行为。

### 5.2 44-R2 reconciliation slice

Spec 43b 已提供独立的 InMemory/SQLite `usage_ledger`、`BEGIN IMMEDIATE`、same-content no-op、
different-content conflict、批量原子性、重启 replay 和 UTC rollup；44-R2 不再创建第二张账本。
本切片补齐 provider usage 在进入账本前的纯 reconciliation port：

- 先按 `usageId` 做严格去重；相同 canonical record 是 no-op，不同内容是 fail-closed conflict；
- 再按 `runId/turnId/requestId/attempt` 形成 bounded semantic key，对 `provider-usage`、
  `session-import`、`run-event` 记录按明确优先级合并；不同 token/status/identity 事实不猜测，直接
  返回 conflict；
- 合并结果只保留一条 logical `ModelUsageRecord`，`dataSource=reconciled`，并保留 bounded
  `reconciledFrom` usage IDs；缺失 token 维度保持 unknown，不填零；每个 retry attempt 仍是独立 key；
- reconciliation 是纯内存、纯函数，不读取 prompt/transcript/tool output，不调用模型、工具、文件系统、
  Git、MCP、sandbox，也不改变 `run_events`、`goal_events`、AgentLoop 或默认 run 创建路径；失败只能
  影响 ledger 输入并返回 bounded conflict。

R2 测试覆盖同 ID 幂等/冲突、跨来源合并、token 冲突 fail-closed、retry 隔离、稳定排序和 privacy
redaction；该 port 仍只作为显式 observability application service 能力，尚未接入默认 run。

### 5.3 44-R3 pricing slice

44-R3 复用现有 `PricingRule` 与 `ModelUsageRecord.cost`，不创建第二套费用事实源。价格目录和
cost engine 保持纯内存/纯函数：

- `PricingRule` 支持 `per-unit`、`flat-fee`、`tiered` 三种 bounded mode；规则按 provider、
  `pricingModel` glob、`effectiveFrom` 和 immutable `pricingRevision` 选择，选择结果稳定且可显式
  指定历史 revision；不调用 provider 账单 API，也不保存 secret；
- `CostItem` 按 input/output/cache-read/cache-write/reasoning/audio/prediction/flat-fee 等维度保留
  quantity、单价、subtotal 和 bounded tier breakdown；金额全部使用十进制 micros 字符串与 BigInt
  计算，避免浮点误差；
- 缺少规则或某个 token 维度没有价格时不填零：projection 返回 bounded `unknown`/未知维度信息，
  已知 item 可以展示但总成本精度不能冒充 exact；原始 usage record 不被改写，按当前规则重算得到新
  projection，并保留 record 当时的 `pricingRevision`；
- 价格规则注册同 revision/identity/内容是 no-op，不同内容 conflict；规则和 cost projection
  拒绝 secret、绝对路径、负数、超大 decimal、无序 tier 和未知字段；不接入 AgentLoop、RunManager、
  Scheduler、Approval、Sandbox、WorkspaceRegistry 或默认 run 创建路径。

R3 测试已覆盖规则选择和历史 revision、per-unit/flat/tiered、cache/reasoning/audio 维度、BigInt
舍入、未知价格、规则冲突与 restart-independent deterministic projection；下一阶段进入 R4
resource/audit collector。

### 5.4 44-R4 resource/audit collector slice

44-R4 只增加显式的 observability application adapter，不把采样器接入
`AgentLoop`、`RunManager`、默认 run 创建路径或第二套 scheduler。collector 的事实写入仍由
现有 `ObservabilityLedger`（或结构兼容的 writer）完成；`run_events`、`goal_events`、usage
ledger 和 audit ledger 的权威地位不变。

- `ResourceCollector` 使用 Node 内建 `process.cpuUsage(previous)`、`process.memoryUsage()`、
  `os.totalmem()`/`os.freemem()` 和注入的 OS/sandbox adapter。它不执行 shell、PowerShell、
  `ps`、Docker CLI 或文件系统扫描；adapter 只返回 bounded CPU/disk/sandbox counters，不能
  携带命令、环境变量、原始输出或绝对路径；不支持的平台显式标记 `unknown/degraded`。
- 采样 profile 固定为 `idle`（60s）、`active`（5s）和 `detailed`（1s），队列容量、单批数量、
  dropped 计数和 adapter 输出均有上限。队列满时丢弃样本并把计数带入下一条成功样本；写入、
  probe、停止或恢复失败只产生 bounded degraded 状态，不改变 model/tool/approval 结果。
- collector 支持 `start`、`stop`、`sampleOnce` 和状态查询；停止后不再调度新 timer，恢复只影响
  后续样本。运行中的 interactive run 不因 observability 写入失败而阻塞或回滚。
- `AuditApplicationAdapter` 只生成经过 `AuditEventSchema`/`sealAuditEvent` 校验的 bounded
  `AuditEventDraft`，复用现有 canonical JSON hash chain 和 ledger append。privacy/secret/path
  拒绝是 fail-closed；ledger writer 失败返回 `degraded`，不吞掉或改写原始 action 结果。

44-R4 实现覆盖 queue full、unsupported adapter、stop/restart、writer failure、privacy rejection
和 audit chain replay。该切片仍不提供 Usage/Audit HTTP API、Web 页面、export/import 或自动
采样配置；这些保持 44-R5/43c 之后的显式 application service 工作。

## 6. 测试与验收

- 同一 provider/message/request 的重复上报不重复计费；不同语义返回 conflict；
- cache-inclusive、fresh、cache read/write、reasoning 缺失字段不会被静默归零；
- retry 的每个 attempt 保留，取消、超时、HTTP 错误和部分流的已报告 token 不丢失；
- 价格未配置、provider 不支持、平台无法测量时显示 `unknown/not-applicable`；
- usage/采样/rollup/audit 失败不阻塞 interactive run，也不改变 Goal admission；
- 不允许 API key、Authorization、环境变量、完整 prompt/transcript、tool output、命令和绝对路径进入 ledger、projection、日志、Web 或导出；
- 研究目录不进入 Git；tracked research 只含 commit、路径、许可证、语义摘要和 provenance；
- `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 和 Markdown 链接/code fence 检查通过。

## 7. 当前状态

截至 2026-08-04，Spec 43 的 contracts/纯 projection 与 Phase 43b ledger/rollup 已完成，
Spec 44-R0、R1 provider/usage contract slice、R2 reconciliation port、R3 pricing slice 和
R4 resource/audit collector slice 已完成。R4 仍是显式、可替换的 application adapter，不提供
认证 API/Web/export，也不把研究结论或上游仓库作为 VibeGo 运行时依赖；现有 interactive run
行为保持不变。
