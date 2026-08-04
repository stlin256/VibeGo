# Provider、Token、费用与上游复用实施提示词

你正在 ready4vibe 仓库中实施 Spec 44。目标是完善模型 provider、token、费用、资源和审计管理，同时保留 VibeGo 原生 TypeScript/SQLite 架构的可扩展性。

开始前必须阅读：

1. `docs/specs/44-provider-usage-management-and-upstream-reuse.md`
2. `docs/specs/43-resource-usage-and-cost-audit.md`
3. `docs/adr/0012-local-resource-and-cost-audit-ledger.md`
4. `docs/adr/0013-upstream-research-and-provider-management-boundary.md`
5. `docs/specs/03-model-context-contract.md`
6. `docs/architecture.md`、`docs/harness-contracts.md`、`docs/implementation-status.md`

## 一、工作区与证据

- 先执行 `git status --short --branch`、`git diff --stat`、`git diff --check`，保留已有 dirty worktree；禁止 `git reset --hard`、`git checkout`、`git clean` 或覆盖无关文件。
- 确认 Node、pnpm、workspace package、测试和 build 脚本。
- 所有实质性代码修改前，先更新对应 Spec/ADR/implementation-status；每个 phase 独立提交。
- 研究源码只能放在 `.research/upstream/`，不能提交源码、编译产物、用户 session 或 API key。

## 二、读取上游项目

至少核对以下候选项目：

- CC Switch：`https://github.com/farion1231/cc-switch`
- AxonHub：`https://github.com/looplj/axonhub`
- LiteLLM：`https://github.com/BerriAI/litellm`
- Langfuse：`https://github.com/langfuse/langfuse`
- OpenTelemetry Specification：`https://github.com/open-telemetry/opentelemetry-specification`

用户可能提到 `axonhub/ccswitch`。如果它与上述 URL 不同，先通过 GitHub 确认 canonical repository；404、重定向、同名项目或许可证不清楚时，停止实现并记录证据，不要猜测。

对每个项目：

1. 固定 commit，并记录 URL、commit、时间、默认分支、LICENSE、NOTICE 和构建 manifest；
2. 先读 README、LICENSE、NOTICE，再读与 `token|usage|cache|pricing|dedup|session|rollup|prune|ttft|latency` 相关的文件；
3. 在 `docs/research/upstream-provider-usage.md` 记录文件路径、语义、许可证和 VibeGo 差异；
4. 默认 clean-room 重写。只有 MIT/BSD/ISC/Apache-2.0 的小型独立工具在完成 provenance/NOTICE/SBOM 记录后才可考虑复制；LGPL/GPL/AGPL、未知许可证、完整 proxy/CLI/Tauri/Python/runtime 一律不复制。

## 三、不可改变的架构边界

- 不修改 AgentLoop 核心状态机；
- 不修改 `run_events` 或 `goal_events` 的事实源语义；
- 不让 usage、采样、价格、审计或 quota 静默拦截用户发起的 interactive run；
- 不让 provider、usage ledger 或 pricing catalog 绕过 Scheduler、Approval、Sandbox、WorkspaceRegistry；
- 不扫描用户目录寻找 CLI/session 日志；显式导入是后置能力，默认关闭；
- 不把 API key、Authorization、环境变量、完整 prompt/transcript、原始 provider response、完整 tool output、命令行参数、cwd 或绝对路径写入 settings、event、ledger、projection、日志或 Web；
- 不引入第二套 scheduler、proxy、Python runtime、Tauri 应用或常驻外部 collector；
- 运行中的 run 必须冻结 provider/model/capability/pricing snapshot，配置改变只影响新 run。

## 四、实施顺序

### Phase 44-R0：研究门禁

只完成上游读取和 `docs/research/upstream-provider-usage.md`，不写运行时代码。明确 canonical repository、commit、许可证、可借鉴语义、不可复制项和未确认项。

### Phase 44-R1：Provider/usage contracts

在现有 contracts 基础上定义或完善 `ProviderDescriptor`、usage observation、normalizer 和 reconciliation port。复用 Spec 43 的 `ModelUsageRecord`、`PricingRule` 和 accuracy 语义，不创建第二套 token 类型。

先写测试：未知协议拒绝、secret/path 拒绝、capability snapshot 隔离、cache-inclusive/fresh 语义和未知字段保持 unknown。

### Phase 44-R2：Ledger、去重和 rollup

先实现 InMemory，再实现独立 SQLite `usage_ledger`/rollup。要求 `usageId` idempotency、same-content no-op、different-content conflict、每个 retry attempt 留痕、`BEGIN IMMEDIATE`、原子 batch 和重启 replay。

### Phase 44-R3：Pricing

实现 flat/per-unit/tiered pricing、pricing revision、cost item、历史重算和 unknown cost。价格更新不能改写历史 record；报告必须区分“按当时 revision”和“按当前价格重算”。

### Phase 44-R4：Resource/Audit

以 Node/OS/sandbox adapter 采集 bounded CPU、RSS、disk、latency 和 dropped samples。采样队列满或平台不支持时 fail soft，记录 `degraded/unknown`。Audit 使用 canonical JSON hash chain，校验失败只影响审计状态。

### Phase 44-R5：API/Web/export

增加认证 projection API 和 Web Usage/Audit surfaces；列表默认分页和时间范围 bounded，响应不包含 raw provider payload。导入必须是用户显式选择的文件/会话，展示 source、dedup 和 reconciliation 结果。

## 五、验收

- `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 通过；
- 相同 usage ID 重放不重复计费，内容冲突 fail closed；
- cache/reasoning/TTL 等字段的缺失不会被静默填 0；
- 取消、超时、5xx、部分流和 retry 的已报告 token 可重建；
- provider/ledger/pricing/audit 失败不会改变原始 run 结果；
- retention、export、rebuild、audit verify 和 daemon restart 均有可重复测试；
- 任何复制代码都有 commit、文件路径、许可证、NOTICE、依赖和 provenance 记录；
- 最终报告列出修改文件、研究证据、各 phase 状态、测试结果、未实现项和是否改变 run/Goal/AgentLoop/Scheduler/Approval/Sandbox 行为。

若研究结果与 Spec 44 的假设不一致，先更新 Spec/ADR 并停在当前 phase，不要静默扩大实现范围。
