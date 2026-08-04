# 上游 Provider/Usage 调研记录

状态：44-R0 已完成（pinned source、许可证和路径证据已核对）；44-R1 仍需先更新 Spec/ADR/实施状态再开始。

本文档只保存可复核的元数据、文件路径和语义摘要，不保存上游源码。源码只在被
`.gitignore` 排除的 `.research/upstream/` 临时目录中读取。所有结论都限定在下方
固定 commit；上游分支继续变化时必须重新执行本门禁。

## 研究范围与方法

- `checkedAt`：2026-08-04T17:03:56+08:00；每个 checkout 均为 detached HEAD；
- 先读取根目录 README、LICENSE、NOTICE（若存在）和构建 manifest，再读取与目标能力直接相关的文件；
- 只记录“设计借鉴”和“代码复用”两个不同结论；默认 `reuseDecision=clean-room`；
- 用户提到的 `axonhub/ccswitch` 已核对为两个 canonical repository：AxonHub 为
  `looplj/axonhub`，CC Switch 为 `farion1231/cc-switch`，没有把名称相似的仓库当作来源；
- 本轮没有复制源码、schema、UI、品牌资源、CLI session 或运行时；没有新增 VibeGo 依赖。

## 固定来源总览

| 项目 | canonical repository | 默认分支 | pinned commit | 许可证观察 | 研究结论 |
| --- | --- | --- | --- | --- | --- |
| CC Switch | https://github.com/farion1231/cc-switch | `main` | `59a2bd10407707282dcefe85b290f0ddaf4d0a74` | 根目录 MIT；未发现根目录 NOTICE | 可借鉴 usage 分桶、cache 语义、稳定 ID、去重和 rollup；不引入 Tauri/proxy/session 扫描 |
| AxonHub | https://github.com/looplj/axonhub | `unstable` | `31f898188cc05f13c0971d7ec9762997d9ff6c41` | 根目录 Apache-2.0；`llm/` 为 LGPL-3.0；`llm/bedrock/NOTICE` 和 `frontend/NOTICE` 有额外声明 | 可借鉴 token taxonomy、cost item 和 flat/per-unit/tiered/volume 定价；不复制 Go、LGPL 或 Bedrock 代码 |
| LiteLLM | https://github.com/BerriAI/litellm | `litellm_internal_staging` | `956d5177d1d915adc8084c142d9d2babad1ff7af` | MIT；`enterprise/` 使用独立许可证 | 可借鉴 provider normalization、pricing lookup、重试和 tier 语义；不引入 Python proxy/runtime |
| Langfuse | https://github.com/langfuse/langfuse | `main` | `3bca62fb0db137f0a778af1ecdc8c7c1c3c5ea5d` | MIT Expat；`ee/`、`web/src/ee/`、`worker/src/ee/` 和第三方组件有独立许可边界 | 可借鉴 generation/latency/token/cost projection 与 bounded tier matching；不引入 SaaS/server/ClickHouse |
| OpenTelemetry Specification | https://github.com/open-telemetry/opentelemetry-specification | `main` | `2b7a5617c0043ea0ac897a1452022eb04c72e89f` | Apache-2.0；未发现根目录 NOTICE | 可借鉴 resource identity、属性限制、时间序列聚合和降级信号；不引入 Collector/exporter |

## 逐项目证据

### CC Switch @ `59a2bd10407707282dcefe85b290f0ddaf4d0a74`

- repository: https://github.com/farion1231/cc-switch
- default branch: `main`
- checkedAt: 2026-08-04T17:03:56+08:00
- license / notice: `LICENSE` 为 MIT；根目录没有 NOTICE 文件。
- manifest / overview:
  - `README.md`：Tauri 桌面应用、provider 管理、proxy、session/usage dashboard 的产品边界；
  - `package.json`、`pnpm-workspace.yaml`：Node/pnpm workspace 与 Tauri 前端构建边界。
- filesRead:
  - `src/types/usage.ts`：`RequestLog` 同时保存 provider/model、`requestModel`/`pricingModel`、input/output/cache read/cache creation、cost、latency、TTFT、status 和 `dataSource`；`CACHE_INCLUSIVE_APP_TYPES` 与 `getFreshInputTokens` 明确区分 cache-inclusive 和 fresh input。
  - `src-tauri/src/proxy/usage/parser.rs`：从不同协议提取 cache read/write、model、message id；按 app/provider 形成去重作用域，空 usage 不写入。
  - `src-tauri/src/proxy/usage/logger.rs`：以稳定 request id + canonical usage semantic 去重；相同语义 no-op，冲突使用 bounded SHA-256 collision key；写入时记录 input-token 语义和计价模型来源。
  - `src-tauri/src/proxy/usage/calculator.rs`：cache-inclusive 请求先扣除 cache read/write，再分别计算输入、输出、cache 成本；测试覆盖倍率和不重复计费。
  - `src-tauri/src/database/dao/usage_rollup.rs`：按本地日边界 rollup/prune，保留 request/pricing model 维度，聚合前做缺价回填并使用 savepoint 保证原子性。
  - `src-tauri/src/services/usage_cache.rs`：托盘使用的进程内 bounded cache，重启后清空，不作为持久事实源。
  - `src/components/usage/UsageDashboard.tsx`、`src/components/usage/RequestLogTable.tsx`：按时间、provider、model 的 bounded usage projection 与详情呈现。
- designIdeas: 显式记录 token 语义、来源、稳定 ID、TTFT/latency、request/pricing model 分离和 rollup/prune 生命周期。
- codeReuseCandidate: 无；Rust proxy、parser、SQL 和 Tauri UI 与 VibeGo 运行时边界不兼容。
- reuseDecision: `clean-room`
- licenseNotes: MIT 只允许在满足版权/许可条件下复用小型独立代码；本阶段不复制任何代码。
- VibeGo divergence: VibeGo 使用 TypeScript/SQLite bounded context；不扫描用户目录、不接入第二套 proxy、不把 CLI/session 作为默认输入，`run_events` 仍是 run 事实源。
- tests or fixtures added: 未新增 VibeGo 测试；上游语义由 VibeGo Spec 43 contracts/ledger 测试重新实现。

### AxonHub @ `31f898188cc05f13c0971d7ec9762997d9ff6c41`

- repository: https://github.com/looplj/axonhub
- default branch: `unstable`
- checkedAt: 2026-08-04T17:03:56+08:00
- license / notice: 根目录 `LICENSE` 声明一般目录 Apache-2.0；`llm/LICENSE` 将 `llm/` 定义为 LGPL-3.0；`llm/bedrock/NOTICE` 来自 anthropic-sdk-go；`frontend/NOTICE` 也需随该目录边界处理。
- manifest / overview:
  - `README.md`、`README.en-US.md`：Go AI gateway、请求追踪、成本追踪和 provider 路由产品范围；
  - `go.mod`、`Makefile`：Go 服务构建与运行时边界。
- filesRead:
  - `internal/ent/schema/usage_log.go`：usage log 分开保存 prompt/completion/audio/cache read/cache write/reasoning/prediction token，cost item JSON 和 price reference id。
  - `internal/objects/price.go`：flat fee、usage-per-unit、graduated tiered、volume tiered；cache write 支持 5 分钟/1 小时 TTL variant；price item code 明确区分 prompt、completion、cache read/write。
  - `internal/objects/cost.go`：成本项包含 quantity、tier breakdown、variant code 和 subtotal。
  - `internal/server/biz/cost_calc.go`：输入 token 先扣除 cache read/write，tiered 按区间切分，volume 按总量选一个价格；schedule 可按时区、日期和优先级选择价格。
  - `internal/server/biz/cost_calc_test.go`、`internal/server/biz/usage_cost_test.go`：覆盖缓存扣除、分段 tier、volume、TTL variant 和 cost item 明细。
  - `internal/ent/schema/request.go`、`internal/server/biz/channel_metrics.go`：请求/执行与延迟、性能窗口的持久化/聚合边界。
- designIdeas: token taxonomy 不能压扁成 input/output；成本应保留可解释 cost items、pricing revision/reference、TTL 和 tier breakdown。
- codeReuseCandidate: 无；Go/Ent/GraphQL gateway 和 `llm/` LGPL 边界不进入 VibeGo。
- reuseDecision: `clean-room`
- licenseNotes: Apache-2.0 仍要求保留版权/NOTICE；LGPL 和 Bedrock 第三方目录默认不复制，后续若需复用必须单独做法律与 SBOM 评审。
- VibeGo divergence: VibeGo 只实现本地 TypeScript/SQLite pricing/usage projection，不引入 gateway、GraphQL、RBAC、Redis 或第二个执行平面。
- tests or fixtures added: 未新增 VibeGo 测试；flat/per-unit/tiered/volume 语义进入后续 Spec 44-R3 测试计划。

### LiteLLM @ `956d5177d1d915adc8084c142d9d2babad1ff7af`

- repository: https://github.com/BerriAI/litellm
- default branch: `litellm_internal_staging`
- checkedAt: 2026-08-04T17:03:56+08:00
- license / notice: 根目录 `LICENSE` 为 MIT，但明确 `enterprise/` 使用独立许可证；未发现根目录 NOTICE。
- manifest / overview:
  - `README.md`、`pyproject.toml`：Python SDK、可选 proxy extra、CLI 和 Python runtime 依赖边界；
  - `uv.lock`：可复现 Python 依赖锁定文件，证明 proxy/runtime 不是 VibeGo 的轻量 Node 依赖。
- filesRead:
  - `litellm/types/utils.py`：`CostPerToken`、`ModelInfoBase` 和 `Usage` 统一 provider usage 字段，包含 cache read/write、reasoning、audio、service tier 和 threshold cost。
  - `litellm/litellm_core_utils/llm_cost_calc/utils.py`：按 service tier、模型阈值、cache 成本字段计算 token cost，并允许缺少价格时返回不可计算结果。
  - `litellm/litellm_core_utils/llm_cost_calc/tiered_pricing.py`：区分 graduated tier 与按总输入选择单一 tier 的 volume 语义；对字符串/数值价格做 bounded coercion。
  - `litellm/litellm_core_utils/get_model_cost_map.py`：远程 model cost map 的 JSON/schema/模型数量校验、5xx/429/transport retry、Retry-After 和本地 fallback。
  - `model_prices_and_context_window.json`：模型 provider、capability、输入/输出/cache/reasoning 价格和 context metadata 的数据形状。
- designIdeas: provider capability/usage/pricing normalization、版本化价格数据、显式 retry/fallback 和 provider 不可用时的降级。
- codeReuseCandidate: 无；Python proxy、CLI、依赖树和动态 cost map loader 不应进入 VibeGo daemon。
- reuseDecision: `clean-room`
- licenseNotes: MIT 之外必须尊重 `enterprise/` 许可证；不复制 model price 数据文件或其生成内容。
- VibeGo divergence: VibeGo 不引入 Python runtime、隐式重试或常驻 proxy；provider adapter 必须保持显式 endpoint、snapshot 和 fail-soft ledger。
- tests or fixtures added: 未新增 VibeGo 测试；retry/fallback 语义只作为后续 TypeScript adapter fixture 输入。

### Langfuse @ `3bca62fb0db137f0a778af1ecdc8c7c1c3c5ea5d`

- repository: https://github.com/langfuse/langfuse
- default branch: `main`
- checkedAt: 2026-08-04T17:03:56+08:00
- license / notice: 根目录 `LICENSE` 为 MIT Expat；`ee/`、`web/src/ee/`、`worker/src/ee/` 使用 `ee/LICENSE`；第三方组件保留原许可证；未发现根目录 NOTICE。
- manifest / overview:
  - `README.md`、`package.json`、`pnpm-workspace.yaml`、`turbo.json`：多包 TypeScript/Next.js、worker、ClickHouse/Postgres 的常驻平台边界。
- filesRead:
  - `packages/shared/src/domain/observations.ts`：generation/agent/tool 等 observation 记录 start/end、latency、TTFT、provided/normalized usage、provided/normalized cost 和 pricing tier projection。
  - `packages/shared/src/server/ingestion/types.ts`：使用 Zod 对 usage、cost、日期和 generation ingestion 做兼容转换/边界校验，缺省字段保持 nullable/unknown 语义。
  - `packages/shared/src/features/model-pricing/validation.ts`：pricing tier 条件、正则安全、priority/default/usage keys 和价格输入校验。
  - `packages/shared/src/server/pricing-tiers/types.ts`、`matcher.ts`：按 bounded usage details、优先级和 default tier 选择价格，异常条件 fail-safe。
  - `packages/shared/clickhouse/migrations/clustered/0031_add_usage_pricing_tier_columns.up.sql`、`packages/shared/src/server/queries/clickhouse-sql/event-query-builder.ts`：pricing tier 与 usage/cost projection 的持久化/查询字段。
- designIdeas: generation 与 trace 分离、原始 usage 与归一化 usage 并存、latency/TTFT projection、bounded pricing tier matching。
- codeReuseCandidate: 无；SaaS/server、ClickHouse schema、web/worker 和 enterprise 目录不进入 VibeGo。
- reuseDecision: `clean-room`
- licenseNotes: MIT 不能覆盖 `ee/` 或第三方依赖；不复制 schema、UI 或数据库迁移。
- VibeGo divergence: VibeGo 使用本地 SQLite/REST projection，默认不采集完整 transcript、不运行 ClickHouse/Redis/worker，usage failure 不阻塞 interactive run。
- tests or fixtures added: 未新增 VibeGo 测试；tier matching 和 projection 语义由 Spec 43/44 contracts 重新实现。

### OpenTelemetry Specification @ `2b7a5617c0043ea0ac897a1452022eb04c72e89f`

- repository: https://github.com/open-telemetry/opentelemetry-specification
- default branch: `main`
- checkedAt: 2026-08-04T17:03:56+08:00
- license / notice: `LICENSE` 为 Apache-2.0；未发现根目录 NOTICE。
- manifest / overview:
  - `README.md`、`package.json`：跨语言规范仓库，不是需要运行的 collector；
  - `specification/document-status.md`：规范状态和稳定性边界。
- filesRead:
  - `specification/resource/README.md`、`specification/resource/data-model.md`、`specification/resource/sdk.md`：Resource identity、navigation/telescoping、属性不可变性和 merge/conflict 规则。
  - `specification/common/README.md`：AnyValue、属性唯一性和 count/value length limits；无界属性会耗尽内存，SDK 应 bounded 并暴露 dropped signal。
  - `specification/metrics/README.md`、`specification/metrics/data-model.md`、`specification/metrics/sdk.md`：delta/cumulative、temporal/spatial reaggregation、cardinality/memory trade-off、timestamp 和 aggregation 语义。
- designIdeas: resource identity 与样本关联、显式 timestamp/accuracy、bounded attribute/sample queue、聚合和 dropped/degraded 信号。
- codeReuseCandidate: 无；这是规范文本，不复制实现，不引入 OTel SDK、Collector 或 exporter。
- reuseDecision: `clean-room`
- licenseNotes: Apache-2.0 只在真正复制文本/代码时触发 notice 义务；本阶段只记录语义和链接。
- VibeGo divergence: VibeGo 只实现本地 `ResourceSample`/rollup projection，不承诺完整 OTel API/OTLP compatibility，不让 collector 成为运行依赖。
- tests or fixtures added: 未新增 VibeGo 测试；bounded queue、UTC rollup、resource identity 语义已映射到 Spec 43 测试计划。

## 44-R0 结论、未确认项与进入 44-R1 的门禁

已确认：canonical URL、默认分支、固定 commit、根/子目录许可证边界、相关文件路径和上述语义摘要均可在本地 checkout 重复读取；所有拟复用点均选择 clean-room，未向仓库复制上游源码或数据文件。

仍未确认、因此不能在 44-R1 中静默假设：

- 各 provider 的实时价格更新源、服务条款和数据许可证；
- 上游未来 commit 是否改变字段语义、cache-inclusive/fresh 口径、retry 或 tier 边界；
- 任何未列入 `filesRead` 的内部协议、生成文件、品牌资源或 enterprise/ee 目录授权；
- VibeGo 是否需要显式 session import、跨 provider reconciliation 或外部 exporter；这些必须由后续 Spec/ADR 明确授权。

进入 44-R1 前必须再次确认本文件与当前 pinned commit 一致，并先更新
`docs/specs/44-provider-usage-management-and-upstream-reuse.md`、
`docs/adr/0013-upstream-research-and-provider-management-boundary.md` 和
`docs/implementation-status.md`。44-R1 只能定义 VibeGo 原生 `ProviderDescriptor`、
usage normalizer 和 capability snapshot contract；不能把上述上游项目作为运行时依赖。
