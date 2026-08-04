# ADR 0014：Observability API 与 Web projection 边界

- 状态：Accepted for 45-R0
- 日期：2026-08-04

## 决策

由 daemon application service 注入现有 `ObservabilityLedger`，通过纯 projection 生成
versioned Usage/Audit DTO，再由同源 Web 消费。API 不直接依赖 SQLite schema，也不允许客户端
读取 raw ledger payload。

认证继续复用 AuthGate、Bearer session、LAN Origin/CSRF 和现有 HTTP/SSE 边界；Usage/Audit
只读查询不新增 transport、scheduler、approval 或数据事实源。重建 rollup 和 audit verify
是显式 application operation，失败返回 bounded degraded 状态，不改变 run 结果。

## 后果

- 移动端、折叠屏和未来 Tailscale/SSH client 只需消费同一 projection contract；
- ledger、hash-chain、usage normalization 和 pricing catalog 仍可独立替换；
- projection 需要严格分页、时间范围和响应上限，避免低资源 daemon 被历史数据拖垮；
- R5 不实现自动采样配置、export/import 或任意 audit mutation；这些继续由后续 spec 冻结。
