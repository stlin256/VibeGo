# ADR 0013：上游研究与 Provider/Usage 管理边界

- 状态：Accepted；44-R0 research gate verified for the pinned commits below
- 日期：2026-08-04
- 相关：
  - [Spec 43：资源、Token、费用与审计可观测性](../specs/43-resource-usage-and-cost-audit.md)
  - [Spec 44：Provider、Token、费用管理与上游源码复用](../specs/44-provider-usage-management-and-upstream-reuse.md)
  - [ADR 0012：本地资源与费用审计账本](0012-local-resource-and-cost-audit-ledger.md)

## 背景

CC Switch、AxonHub、LiteLLM、Langfuse 和 OpenTelemetry 对 token 分桶、缓存语义、去重、价格明细、延迟和 rollup 有可借鉴经验。直接复制这些项目会引入不同的事实源、proxy、runtime、许可证义务和资源开销，与 VibeGo 的单用户、本地 daemon、TypeScript/SQLite 和 fail-closed 边界冲突。

## 决策

1. 以 VibeGo 原生 `ModelProvider`、`run_events`、`usage_ledger`、`audit_events` 和 versioned REST projection 为事实边界；
2. 只借鉴公开的语义、数据模型、测试思想和用户筛选体验；实现使用 VibeGo TypeScript/SQLite bounded context；
3. provider adapter、usage normalizer、pricing catalog、dedup/reconcile 和 Web projection 必须是可替换端口，不得把具体上游项目写死在 AgentLoop；
4. 上游源码只允许在 `.research/` 临时读取。任何代码复制都要通过许可证、版权、依赖、SBOM 和 ADR 评审；默认采用 clean-room 重实现；
5. 不 vendor 完整 CC Switch/AxonHub/LiteLLM/Langfuse/OpenTelemetry，不引入其 proxy、Tauri、Python runtime、CLI session 扫描或外部常驻服务；
6. 未知许可证、私有协议、品牌资源和未经固定 commit 的实现禁止复制；
7. usage、resource、audit 的降级只能显示 `degraded/unknown`，不能阻塞 interactive run、静默改变 quota 或绕过现有安全门禁；
8. future native clients 只消费稳定 projection，不读取 SQLite 或上游目录。

R1 的具体落点是 `packages/contracts` 中的严格 `ProviderDescriptor`、
`ProviderCapabilitySnapshot`、`ProviderUsageObservation` schema，以及独立纯内存 registry/normalizer
端口；这些合约只传递 bounded metadata 和已提取的 counters，不接触 raw provider response、secret
或运行时 AgentLoop。现有 `ModelUsageRecord` 是唯一 usage record，新增字段必须保持向后兼容并由
normalizer 显式填充。

44-R1 已完成该 contract slice：schema、privacy/fail-closed 校验、immutable capability snapshot
和纯内存 normalizer 均位于 `packages/contracts`/`packages/observability`，没有接入默认 run、
AgentLoop、RunManager、daemon API 或第二套事实源；R2 才允许进入独立 ledger/dedup/reconcile。

44-R2 已复用 Spec 43b 已实现的独立 `usage_ledger`/UTC rollup 作为唯一账本，新增能力只允许是
`packages/observability` 的纯 reconciliation port。该 port 以 usage ID 和 bounded semantic key
做去重/合并，遇到不同事实直接 conflict，不能静默覆盖或创建第二套 scheduler/事实源；reconciled
record 必须显式保留来源 IDs，且不改变 run、Goal、AgentLoop、Scheduler、Approval、Sandbox 或
WorkspaceRegistry 的权威地位。

## 44-R0 证据结果

以下 pinned source 已完成 README、LICENSE/NOTICE、manifest 和相关实现路径的核对，详细文件清单与
语义摘要见 [tracked research](../research/upstream-provider-usage.md)：

| 项目 | 默认分支 | pinned commit | 许可证边界 | 复用决定 |
| --- | --- | --- | --- | --- |
| CC Switch | `main` | `59a2bd10407707282dcefe85b290f0ddaf4d0a74` | MIT | clean-room |
| AxonHub | `unstable` | `31f898188cc05f13c0971d7ec9762997d9ff6c41` | Apache-2.0；`llm/` LGPL-3.0；Bedrock/frontend NOTICE | clean-room |
| LiteLLM | `litellm_internal_staging` | `956d5177d1d915adc8084c142d9d2babad1ff7af` | MIT；`enterprise/` 独立许可 | clean-room |
| Langfuse | `main` | `3bca62fb0db137f0a778af1ecdc8c7c1c3c5ea5d` | MIT Expat；`ee/`、部分 web/worker 和第三方组件独立许可 | clean-room |
| OpenTelemetry Specification | `main` | `2b7a5617c0043ea0ac897a1452022eb04c72e89f` | Apache-2.0 | clean-room |

R0 没有授权复制上游源码、schema、UI、品牌资源、session 文件或运行时。价格数据授权、未列出的
内部协议、未来 commit 语义和外部 exporter 需求仍是未确认项；它们必须在实现前重新审核。

## 许可证处理

- MIT/BSD/ISC/Apache-2.0：仍需锁定 commit、保留版权/NOTICE、核对依赖和记录 provenance；
- LGPL/GPL/AGPL：默认不复制到核心包；如确有必要，必须先完成法律评审并采用隔离边界；
- 未知/不清楚的许可证：只读设计，不复制代码、schema、UI 或资源；
- 上游依赖升级必须重新检查 LICENSE/NOTICE，不允许以旧的研究记录代替当前版本检查。

## 影响

正面影响：provider 能力、token/cost 语义和审计投影可以演进，且不会污染已有 run/Goal 事件；未来移动端可以复用同一套 projection。

代价：需要保存上游 commit 证据和 provenance，实施速度慢于直接 vendor；价格、缓存和跨 provider 语义需要显式 adapter 测试，不能依赖“兼容看起来正确”。

## 复审触发条件

- canonical upstream repository、许可证或目录发生变化；
- 需要复制超过一个独立小工具文件，或新增 copyleft 依赖；
- 需要引入 proxy、session importer、外部 collector 或新的事实源；
- provider usage 语义无法映射到 Spec 43 的 `ModelUsageRecord`；
- usage/audit 降级可能影响 run、Goal、Scheduler、Approval 或 Sandbox。
- pinned commit、LICENSE/NOTICE 或 tracked research 的 `filesRead` 发生变化。
