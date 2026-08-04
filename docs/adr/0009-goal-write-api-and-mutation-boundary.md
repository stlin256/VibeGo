# ADR 0009：Goal write API 与 bounded mutation boundary

- 状态：Accepted / Implemented（Phase 2A）
- 日期：2026-08-04
- 相关：[Spec 40](../specs/40-goal-write-api-and-bounded-mutations.md)、[Spec 34](../specs/34-goal-control-plane-loopx-integration.md)

## 决策

在 daemon application-service 层新增原生 TypeScript `GoalWriteService`，只通过现有
`GoalEventStore` 追加受 DTO 约束的 Goal 事件。服务按 goalId 串行化、按
`controlRevision` 做 optimistic concurrency，并把 eventId 幂等/conflict 交给独立
`goal_events` store。

HTTP API 只暴露有限 mutation（Goal、Todo、Gate、Evidence 和 validated Todo completion），
不提供任意事件写入。服务器生成 producer/time/schema，客户端只提交 bounded input 和
幂等 eventId。现有 auth/CSRF/Origin 仍是唯一入口。

Phase 2A 的实现使用 `GoalWriteService` 和六个受保护 daemon route：创建 Goal、新增 Todo、
打开/resolve Gate、附加 Evidence、使用 validated Evidence 完成 Todo。创建返回 `201`，其余
操作返回 `200`；响应只返回版本化 safe projection。ID 可省略并由 eventId 派生，重试在
SQLite 或内存 event stream 中按 fingerprint 做 no-op/conflict 判定，不依赖进程内缓存。

## 不改变的事实源

Goal Control 仍不能执行模型、工具、shell、filesystem、Git、MCP 或 sandbox；TencentDB
Memory 不能接管 Goal。`run_events`、`goal_events`、RunManager、Scheduler、Approval、
Sandbox、WorkspaceRegistry 和 AgentLoop 的职责不变。Phase 2A 不接入默认 run admission，
明确的 interactive run 不受 Goal quota 静默拦截。

## 为什么不直接开放 event store

直接接受 raw event 会让浏览器可以伪造 producer、时间、状态转换、quota 或 claim hash，
也会把未来 LoopX 互操作变成第二套写协议。按 mutation 类型建立服务层 DTO，能在 projection
之前执行 entity/revision/evidence 检查，同时保留 SQLite event stream 的 append-only、
replay 和审计语义。

## 回滚

关闭 write service/API 即可回到 Phase 1 只读 projection；不需要迁移 `run_events`，也不
需要回滚历史 `goal_events`。新增 API 的失败只能返回 safe error，不得改变已有 run 结果。
