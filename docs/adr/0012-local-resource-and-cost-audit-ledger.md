# ADR 0012：本地资源与费用审计账本

- 状态：Accepted for Phase 43a/43b、44-R4、50-R1 与 50-R2（contracts、projection、ledger/rollup、显式 collector/audit adapter、lifecycle ports 和 provider usage/cost application adapter 已实现；自动 wiring/API/Web 仍后置）
- 日期：2026-08-04
- 相关：[Spec 43：资源、Token、费用与审计可观测性](../specs/43-resource-usage-and-cost-audit.md)
- 相关：[Spec 41：Host-first 发行与客户端边界](../specs/41-host-first-distribution-and-client-boundary.md)、[Spec 42：shadcn 风格 Web 设计系统](../specs/42-shadcn-style-web-design-system.md)

## 背景

VibeGo 需要同时满足开发优化和用户透明度：显示 daemon/host CPU、内存、磁盘，归因并发 run、
工具和 sandbox，记录 provider token、延迟和费用，并对 pairing、设置、审批、导出和降级做可
验证审计。现有 `run_events` 是 run 生命周期事实源，`goal_events` 是 Goal Control 事实源；直接
把所有采样和计费字段塞进这两条流会造成高频日志污染、重放成本和安全边界混淆。

## Phase 43a 决策

先在 `packages/contracts` 固定 `resource-usage/v1`、`audit/v1` 相关 Zod contract，在
`packages/observability` 提供无副作用的 canonical JSON/fingerprint 和 model usage replay
projection。projection 只读取已有 `run_events` 的 bounded metadata，按 `seq` 重放并输出
可验证 checksum；它不是第二个事件事实源，也不向 SQLite、AgentLoop、Scheduler 或 Web 写入。

Phase 43a 不引入采样器、费用价格存储、审计持久化、daemon API 或 UI。后续阶段可以在这些
contract 上增加独立 adapter，但必须保持 interactive run 和现有 run/Goal 事件行为不变。

Phase 43b 决定先实现 `packages/observability` 的 bounded batch/rollup port，再由
`packages/storage` 提供内存和 SQLite adapter。SQLite 只创建 `resource_samples`、
`usage_ledger`、`audit_events`、`usage_rollups` 四张独立表，使用 `BEGIN IMMEDIATE`、
canonical fingerprint、ID 幂等 conflict 和 audit hash chain；任一 batch 失败都回滚。usage/
audit 是 append-only，cleanup 只处理 samples/rollups，rollup 可从原始记录重建。该阶段不把
collector、账本写入 AgentLoop 或 daemon API。

## 决策

建立一个原生 TypeScript/SQLite Observability bounded context，包含：

- 独立 append-only `usage_ledger`、`audit_events` 和 bounded `resource_samples`；
- 从 `run_events`/`model.usage` 和 application-service observer 归一化出 usage；
- 独立 `pricing_rules` 与 `usage_rollups`，费用以 pricing revision 和 accuracy 标记；
- token 维度至少包含 input/output、cache read/write、reasoning，并保留 `fresh`/`cache-inclusive`
  语义、`requestModel`/`pricingModel`、`dataSource`、稳定 usage ID 和 cost item/tier breakdown；
- 参考 AxonHub 的分桶/分层价格和 CC Switch 的 proxy/session 去重与缓存归一化，但不把外部
  session 扫描或 proxy 作为 VibeGo 默认事实源；
- 认证的 REST projection 和现有 run SSE 刷新提示，Web 只消费脱敏 projection；
- 采样自适应、异步批量、可丢样本但不可静默丢计数，采集失败不得阻塞 run；
- audit event 使用 canonical JSON hash chain，完整性验证失败只标记 degraded，不阻断 AgentLoop。

资源、usage、audit、rollup 分表；不修改 `run_events`、`goal_events`、AgentLoop、RunManager、
Scheduler、Approval、Sandbox 或 WorkspaceRegistry 的事实源/核心行为。

## 选择理由

### 相比完整 Prometheus/Grafana/OpenTelemetry 部署

本项目是单用户、低资源、Host-first 本地 daemon。完整遥测栈需要常驻进程、配置、端口和额外
存储，远程 Web 又会产生第二套认证边界。借鉴 OTel 的语义和 Prometheus/node_exporter 的指标
组织方式，但先用 SQLite 和版本化 REST projection，未来通过可选 exporter 接入外部平台。

### 相比把所有内容写入 `run_events`

`run_events` 负责 run/SSE 的顺序和回放；5 秒采样会快速放大事件量，也会让 usage 重建和保留策略
影响 run 事实源。独立 ledger 可以按成本、隐私和 retention 重建，不污染现有 AgentLoop 契约。

### 相比 Langfuse 或 LiteLLM proxy

Langfuse 的 trace/generation/token/cost 经验和 LiteLLM 的 provider/pricing 归一化很有价值，
但把它们作为硬依赖会引入外部服务、Python/runtime 或新的 proxy 故障面。VibeGo 只借鉴公开概念，
不 vendor 源码、不开第二套模型入口；未来若选择可选 adapter，必须重新检查具体版本许可证和数据
边界。

### 相比自定义高频监控服务

自定义 collector 只使用 Node 内建 API 和受控 OS/sandbox adapter，并用 adaptive profile、bounded
queue、raw retention 和 dropped count 控制开销。unsupported platform 明确返回 unknown，避免
用不安全 shell probe 伪造“全面”数据。

## 后果

正面影响：

- 开发者可以按 run/turn/request/tool/sandbox 定位资源和 token 瓶颈；
- 用户可以在同源 Web 看到费用精度、价格版本、历史趋势、并发资源和审计记录；
- usage/audit 可重放、可验证、可脱敏导出，并能在 provider 缺失数据时诚实显示 unknown；
- 未来 Android/iOS/HarmonyOS 只需消费 projection，不复制 daemon 事实源。

代价与风险：

- 需要跨 Windows/macOS/Linux 的采样和子进程归因测试；
- provider token 字段和价格经常变化，adapter/价格规则必须版本化；
- hash chain、retention、rollup 重建会增加 SQLite 复杂度；
- 采样 profile 过高会反过来污染被测资源，因此必须有实测预算和显式 detailed 模式。

## 安全与许可证边界

参考项目仅用于设计研究：OpenTelemetry Specification、Prometheus node_exporter、cAdvisor 为
Apache-2.0；AxonHub 通用部分为 Apache-2.0，但 `llm/` 为 LGPL-3.0 且部分目录有 NOTICE；CC Switch
为 MIT；Langfuse 非 `ee/` 部分为 MIT 但含独立许可区域；LiteLLM 非 `enterprise/` 部分为 MIT 但含
独立许可区域。任何代码、schema、UI 或运行时 vendor 都必须重新检查相应版本 LICENSE/NOTICE、
SBOM 和版权义务；本 ADR 不授权复制上游实现。

## 44-R4 实施补充（2026-08-04）

R4 将采样与审计实现为 `packages/observability` 内的可替换 application adapter：

- collector 只调用 Node 内建资源 API，并接收显式注入的 OS/sandbox probe；禁止通过 shell、
  PowerShell、Docker CLI 或目录扫描补齐数据；
- idle/active/detailed profile、bounded queue 和 dropped count 控制资源开销；队列满、平台
  不支持、采样停止、probe 失败或 ledger writer 失败均返回 `degraded/unknown`，不阻塞 interactive
  run；
- audit adapter 生成 bounded `AuditEventDraft`，继续交给现有 hash-chain/ledger，隐私拒绝
  fail-closed，写入失败只改变 observability 状态；不新增事实源，也不修改 `run_events`、
  `goal_events`、AgentLoop、Scheduler、Approval、Sandbox 或 WorkspaceRegistry；
- collector 没有自动接入 daemon 默认启动路径，R4 只冻结并验证 adapter contract；认证 API、Web
  projection、导出和长期 retention 仍由后续阶段显式接入。

## 暂不决定

默认采样间隔、货币、保留天数、external sandbox 精确归因、价格导入格式和第一版是否包含审计
导出/完整性校验，统一由 Spec 43 第 11 节讨论后冻结；这些选择不阻塞 Phase 43a。

## 50-R1 application lifecycle boundary (2026-08-05)

`packages/observability` owns a pure `ObservabilityLifecycleRecorder` port.
The recorder receives bounded, already-redacted lifecycle facts and sends one
idempotent batch to the existing observability writer for each logical attempt.
It is a fixture/application adapter, not a second event source: no provider,
tool, shell, filesystem, scheduler or run event is executed or persisted by
this layer. Disabled sampling produces no resource record; replay with the
same fingerprint is a no-op and a changed payload is a conflict. Writer errors
are reported as degraded and never alter the source run result. The default
RunManager and AgentLoop wiring remains intentionally unchanged until 50-R2/R3.
The focused package gate covers the recorder and existing observability
adapters with 38 passing tests; no live model, tool, shell or network is used.

## 50-R2 provider usage and cost boundary (2026-08-05)

Provider usage enters the ledger only after the public bounded observation is
normalized and reconciled. The application adapter then applies the selected
immutable pricing revision and appends model usage through the existing writer;
unknown pricing is represented as missing/unknown cost, never a fabricated
zero. Same `usageId` and semantic payload is a no-op, changed content is a
conflict, and writer failure is degraded/fail-soft. Partial stream or provider
failure records retain known counters and latency metadata without re-running a
provider request. No raw response or credential crosses this port, and no
AgentLoop, RunManager default start, `run_events` or `goal_events` behavior is
changed.

The R2 adapter is implemented in
`packages/observability/src/provider-usage-lifecycle.ts` with 47 focused
observability tests. It is transport-free and remains an opt-in application
port; no default run or AgentLoop wiring was changed.
