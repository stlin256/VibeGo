# Spec 06：Run API 与 SSE 事件流

**状态：Accepted（loopback MVP 实现约束）**

本阶段把已完成的 `AgentLoop` 接到 daemon HTTP 层，验证“远程创建 → 观察 → 取消”的最小主路径。它仍只绑定 loopback；LAN HTTPS、配对、Bearer token、CSRF 和公网证书不能由本阶段绕过。

## HTTP

- `POST /api/v1/runs`：请求体必须是完整 `RunConfig`，服务端先用 `parseRunConfig` 校验，成功返回 `202 { runId, status: "queued" }`；不接受隐式 defaults；
- `GET /api/v1/runs/:runId`：从 EventStore 投影 snapshot，包含 `status`、`config`、`lastEventSeq`、输出摘要和 scheduler lease 摘要；
- `POST /api/v1/runs/:runId/cancel`：幂等触发 `AbortController`，返回 `202`；终态再次取消仍返回当前 snapshot，不重复执行；
- 当前所有 run API 只允许 loopback 请求，尚未接入认证，因此不应绑定 LAN 地址。

## SSE

- `GET /api/v1/runs/:runId/events?after=<seq>` 使用 `after` 或 `Last-Event-ID` 作为游标；
- 先订阅 live bus，再回放 EventStore，按 seq 去重，保证不会丢失回放窗口内的事件；
- 每条消息发送 `id: <seq>`、`event: <type>`、`data: <JSON>`；heartbeat 不消耗 seq；
- 若 run 已进入终态且回放包含终态事件，连接在补发完后关闭；活动 run 保持连接，客户端断线后可用新游标续传；
- payload 只发送 safe domain event，不发送 provider 原始响应、环境变量或 secret。

## 限制与后续

- body 上限 1 MiB；JSON 解析失败返回 `INVALID_REQUEST`；
- 当前 snapshot 是事件重放投影，尚未加入独立 snapshot 表和分页列表；
- 当前模型由组合根注入，生产默认 provider 尚未实现；
- 下一阶段加入 ContextManager、模型 adapter、认证门禁和更完整的错误 envelope。

## 测试门禁

- 创建 run 返回 202 并最终可查询；
- SSE 首次回放、`after` 游标和 live event 不重复；
- 取消排队/执行中的 run，重复取消幂等；
- 未知 run、非法 JSON、过大 body、非 GET SSE 请求返回安全错误。
