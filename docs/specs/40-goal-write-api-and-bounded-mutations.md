# Spec 40：Goal write API 与 bounded mutation service

- 状态：Implemented（Phase 2A）
- 日期：2026-08-04
- 相关： [Spec 34](34-goal-control-plane-loopx-integration.md)、[ADR 0004](../adr/0004-native-goal-control-and-loopx-interop.md)

## 1. 目的

Phase 0/1 已经提供原生 Goal Control contracts、SQLite `goal_events`、projection/replay
和只读 API，但用户还不能通过受保护界面创建或更新长期目标。本阶段增加一个 daemon
application-service 写边界，让后续 Web editor 可以通过 API 管理 Goal/Todo/Gate/Evidence。

本阶段只写 `goal_events`，不把 Goal 写入 `run_events`，也不把 Goal admission 接入默认
`POST /runs`。明确的 interactive run 继续保持原有行为。

## 2. 范围与非目标

本切片支持：

- 创建 Goal；
- 新增 Todo；
- 打开和 resolve Gate；
- 附加 bounded Evidence；
- 只有存在 validated Evidence 时才允许 Todo completion；
- 通过现有认证、CSRF、Origin 门禁提供 API。

本切片不支持：

- 任意 raw event ingest；
- quota spend、run binding 或 governed scheduler；
- 自动 claim/后台 heartbeat；
- 修改 AgentLoop、RunManager 默认 `start`、Scheduler、Approval、Sandbox 或 WorkspaceRegistry；
- LoopX CLI、Python runtime、`.loopx/`、Markdown/JSONL 或第二套锁/调度器；
- 在浏览器持久化 Goal payload、claim token、secret 或绝对路径。

Web editor 将在后续切片接入同一 API；本阶段先保证 daemon contract 可独立测试。

实现位于 `packages/goal-control/src/write.ts` 与 `apps/daemon/src/server.ts`。服务使用
eventId 派生稳定的 Goal/Todo/Gate/Evidence ID；`POST /api/v1/goals` 返回 `201`，其余
mutation 返回 `200`。响应 schema 为 `ready4vibe_goal_write_api_v0`，只包含 eventId、
controlRevision 和剥离 claim hash 的 safe projection。服务重启后通过 event stream 重放识别
同一 eventId，因而不会依赖进程内缓存完成幂等。

## 3. 写入合约

所有 mutation 都携带客户端生成的 `eventId`。相同 `eventId` 和相同 payload 是幂等
no-op；相同 `eventId` 但内容不同由 `goal_events` 返回 conflict。除 Goal 创建外，mutation
还携带 `expectedRevision`，服务在追加前比较 projection 的 `controlRevision`，陈旧 revision
fail closed。

服务器只接受每类 mutation 的显式 DTO，不接受用户提交的 `schemaVersion`、`producer`、
`recordedAt` 或任意 event type；这些由服务端生成/固定。ID 可省略，daemon 会从 eventId
生成稳定的 bounded ID，便于重试而不要求用户编辑数据库。

响应只返回版本化的 safe projection、eventId 和 controlRevision；`claimTokenHash`、完整
transcript、tool output、workspace 绝对路径、API key、token、环境变量和私钥永远不进入
响应或 Goal event payload。

## 4. API

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/v1/goals` | 创建 Goal |
| `POST` | `/api/v1/goals/:goalId/todos` | 新增 Todo |
| `POST` | `/api/v1/goals/:goalId/gates` | 打开 Gate |
| `POST` | `/api/v1/goals/:goalId/gates/:gateId/resolve` | resolve 已存在 Gate |
| `POST` | `/api/v1/goals/:goalId/evidence` | 附加 Evidence |
| `POST` | `/api/v1/goals/:goalId/todos/:todoId/complete` | 使用 validated Evidence 完成 Todo |

所有 mutation 复用现有 daemon auth/CSRF/Origin。不存在 Goal、未知 Gate/Todo、状态不合法、
stale revision、event conflict 和 validation failure 都返回稳定错误码，不返回原始 SQLite、
Zod 或 upstream 错误。

## 5. 原子性与并发

`GoalWriteService` 按 goalId 串行化 mutation，读取 projection 后执行 optimistic revision
检查，再调用 `GoalEventStore.append`。SQLite adapter 继续使用 `BEGIN IMMEDIATE` 和独立
`goal_events`；任何失败不产生半个事件。重试先识别相同 eventId，避免已成功写入的请求因
旧 revision 被误报为失败。

Todo completion 必须引用当前 projection 中 `status=validated` 的 Evidence，并在同一
goal lock 下追加 `todo.completed`；模型自报完成、失败验证、recovery/retry 都不能绕过这一
门禁。

## 6. 验收

- 合法 create/add/open/resolve/evidence/complete mutation 可重放并产生稳定 projection；
- 相同 eventId 相同内容 no-op，不同内容 conflict；
- 两个并发 mutation 中只有一个能通过相同 revision；stale revision fail closed；
- 未知 Goal/Gate/Todo、secret-shaped 字段、绝对路径和未验证 completion 均拒绝；
- API 认证、CSRF/Origin、bounded body 和 safe error response 有测试；
- `run_events`、AgentLoop、RunManager、Scheduler、Approval、Sandbox、WorkspaceRegistry
  与无绑定 interactive run 回归不变；
- `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 通过后独立提交。

Phase 2A 已完成：GoalWriteService、六个 daemon mutation route、safe error mapping、
Goal projection 对带 evidenceId 的 completion replay，以及内存/HTTP 并发、重试、认证、
隐私和状态错误测试均已落地。SQLite 仍通过原有 `SqliteGoalEventStore` 的 `BEGIN IMMEDIATE`
和独立 `goal_events` 表提供持久化；没有新增 run event 或第二套调度器。

后续 Phase 2B 才讨论 Web Goal editor、claim/release UI 和显式 governed preflight；在其
验收前，Goal quota/shouldRun 不得静默拦截普通 run。
