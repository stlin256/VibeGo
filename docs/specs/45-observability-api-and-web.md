# Spec 45：Observability API 与 Web Usage/Audit projection

- 状态：Draft for implementation（45-R0）
- 日期：2026-08-04
- 相关：[Spec 43](43-resource-usage-and-cost-audit.md)、[Spec 44](44-provider-usage-management-and-upstream-reuse.md)、[Spec 38](38-conversation-first-web-shell.md)、[API contract](../api-contract.md)

## 目标

在现有 Host-first daemon 和 conversation-first Web 中提供只读、同源、受认证的 Usage/Audit
projection。R5 不创建第二套账本，不让 Web 读取 SQLite，不把 collector 自动接入 run，也不改变
`run_events`、`goal_events`、AgentLoop、RunManager、Scheduler、Approval、Sandbox 或
WorkspaceRegistry 的事实源和行为。

## API

新增 endpoint 均位于 `/api/v1`，经过现有 AuthGate、LAN Origin/CSRF 和 Bearer session 边界：

| 方法 | 路径 | 约束 |
| --- | --- | --- |
| GET | `/usage/summary?range=24h|7d|30d` | bounded summary，默认 24h |
| GET | `/usage/timeseries?metric=cpu|memory|disk|tokens|cost&range=...` | 最多 744 个 UTC bucket |
| GET | `/runs/:runId/usage` | 只返回该 run 的 Model/Tool usage projection |
| GET | `/audit/events?after=&action=&outcome=` | 最多 100 条，按 appendSequence 逆序 |
| GET | `/usage/pricing` | 只读非 secret pricing rules；无 catalog 时返回 degraded |
| POST | `/usage/rebuild` | 显式重建 rollup，不阻塞 run |
| POST | `/audit/verify` | 校验 hash-chain，失败返回 degraded，不伪称完整 |

所有响应带 `schemaVersion=ready4vibe_observability_api_v1`、`generatedAt` 和 bounded
`status=ready|degraded|unknown`。range、metric、cursor、limit 和 response bytes 都有服务端
上限；非法值 fail-closed。ledger 不可用时 API 返回稳定 503 错误码，不能返回 500 原始错误。

## Projection 与隐私

- Summary 重用 `ModelUsageRecord`、`ToolUsageRecord`、`ResourceSample`、`UsageRollup` 和
  `AuditEvent`，token/cost 未知维度保持 `null`/`unknown`，不填零。
- Timeseries 只返回 UTC bucket 的 bounded counters/accuracy；不返回 prompt、transcript、
  raw provider response、tool output、命令、环境变量、workspace 绝对路径或 API key。
- Audit 列表只返回已通过 `AuditEventSchema` 的安全字段，并按 cursor 稳定分页；不允许客户端
  通过 query 读取 SQLite 或绕过 ledger hash-chain。
- Pricing 只返回版本化规则字段；若未来加入 user-configured 规则，仍不得保存或返回 secret。

## Web

### Implementation update (45-R5, 2026-08-04)

The first implementation slice is complete. The daemon injects the existing
`ObservabilityLedger` only at the application/API boundary and exposes the seven
authenticated endpoints listed above. Query parsing is fail-closed, projections
are bounded, and ledger failures return stable `503` degraded responses. The
browser client consumes the same contracts through a collapsible context-rail
Usage/Audit panel; the panel uses the existing details control on small or
portrait viewports and never blocks the conversation composer.

Tests cover summary/timeseries/run usage, audit filtering and cursor pagination,
rebuild/verify, unavailable ledgers, malformed parameters, LAN authentication,
browser request paths, degraded rendering, and secret/raw-payload exclusion.
Automatic sampling settings, export/import, and pricing catalog wiring remain
later work.

Web 只消费上述 projection，加入可折叠的 Usage/Audit context panel：桌面保持 context rail，
竖屏/平板按 ratio 规则折叠，手机使用 sheet/单列；它不进入 run composer 的安全配置，也不在
浏览器存储 token、路径或原始事件。加载失败显示 `degraded`/`unknown`，不覆盖 conversation 或
阻塞新 run。刷新按钮使用显式 GET，默认不建立第二条长连接。

## 测试与退出条件

必须覆盖：未认证/CSRF 拒绝、range/metric/cursor 边界、ledger unavailable、rollup rebuild、
audit verify failure、projection 隐私脱敏、bounded response、Web degraded rendering，以及
run/Goal/AgentLoop 回归。完成后同步 `docs/api-contract.md`、`docs/roadmap.md` 和
`docs/implementation-status.md`，再独立提交并 push。
