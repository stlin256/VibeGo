# ADR 0013：上游研究与 Provider/Usage 管理边界

- 状态：Accepted for the Spec 43/44 implementation gate
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
