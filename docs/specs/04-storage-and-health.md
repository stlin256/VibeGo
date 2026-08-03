# Spec 04：SQLite EventStore 与最小 daemon health

**状态：Accepted（第一版实现约束）**

本阶段把事件从纯内存实现推进到可重启恢复的 SQLite adapter，并提供一个仅绑定 loopback 的最小 HTTP daemon。它不创建 run、不执行工具，也不实现认证或 LAN 入口；这些能力必须在后续切片中按既有安全 spec 加入。

## SQLite EventStore

- 运行时使用 Node 22 的 `node:sqlite` `DatabaseSync`，不引入 native addon、数据库服务或 ORM；
- 默认数据库路径由组合根传入，测试使用 `:memory:`；
- 表 `run_events` 以 `(run_id, seq)` 唯一约束保证单 run 顺序，以 `id` 主键保存 UUIDv7 event id；
- payload 只保存 JSON，序列化失败时整个 append/appendBatch 事务回滚；
- `appendBatch` 要求非空且属于同一个 run，在一个 SQLite transaction 中提交；
- 初始化启用 `foreign_keys`、WAL（文件库）和受控 busy timeout；不记录 secret，不把数据库路径或 SQL 放进模型上下文；
- `read(runId, afterSeq)` 必须按 `seq ASC` 返回，未知 run 返回空数组；
- adapter 暴露显式 `close()`，daemon 退出时调用；`EventStore` 接口仍保持 storage-agnostic。

## `/health`

- 当前只允许 `127.0.0.1`/`::1`，不允许通过环境变量把第一版直接暴露到 LAN；
- 同时支持 `/health` 和预留的 `/api/v1/health` 别名，响应 JSON 且不设置宽泛 CORS；
- 响应必须包含 API 合约要求的 `transport`、`auth`、`sandbox`、`approval` 摘要，并明确 `storage.kind/status`；
- 不返回 access token、配对码、证书私钥、完整网卡枚举、策略文件原文或用户 workspace 路径；
- 该端点只代表 daemon 进程和 storage 已初始化，不代表模型 provider、sandbox runtime 或外部 MCP 可用。

## 测试门禁

- SQLite：单条追加、批量原子性、seq 游标、重开后可读、非法 payload 回滚；
- daemon：loopback 绑定、`/health` 200/JSON、health 字段不含 secret、未知路径 404；
- 运行 `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 后再提交。
