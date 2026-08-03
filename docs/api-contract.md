# HTTP/SSE API 合约

**状态：Accepted（v1 设计，尚未实现）**

Base path 为 `/api/v1`。所有请求/响应为 UTF-8 JSON；错误使用统一 envelope。生产远程访问必须使用 HTTPS 或可信隧道。

## 认证

```http
Authorization: Bearer <access-token>
X-Request-Id: <client-generated-id>
```

只读查询允许短期 access token；写操作、审批和取消必须认证并检查 run 所属会话。`POST` 写操作支持 `Idempotency-Key`。

## 端点

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/health` | 进程、版本、存储和 sandbox 能力摘要；不返回 secret |
| `GET` | `/workspaces` | 列出允许的 workspace |
| `GET` | `/tools` | 当前策略下可见工具和风险元数据 |
| `POST` | `/runs` | 创建并排队一个 run |
| `GET` | `/runs` | 分页查询 run 摘要 |
| `GET` | `/runs/:runId` | 读取状态、预算、当前审批和最终摘要 |
| `POST` | `/runs/:runId/input` | 追加用户消息/控制指令 |
| `POST` | `/runs/:runId/approve` | 批准或拒绝一个 approval request |
| `POST` | `/runs/:runId/cancel` | 请求取消，幂等 |
| `GET` | `/runs/:runId/events?after=<seq>` | SSE 事件流，可续传 |
| `GET` | `/runs/:runId/diff` | 获取受限 diff 摘要/分页内容 |
| `POST` | `/pairing/start` | 仅本机启动一次性配对流程 |
| `POST` | `/pairing/complete` | 兑换配对码，返回 token（只显示一次） |

## 创建 run 请求

```json
{
  "workspaceId": "ws_01",
  "message": "修复测试失败并解释原因",
  "model": { "provider": "openai-compatible", "name": "configured-default" },
  "limits": { "maxTurns": 12, "maxWallTimeMs": 600000 },
  "sandbox": "host-restricted",
  "clientRequestId": "mobile-uuid"
}
```

服务端会把所有 limit clamp 到策略上限，并在响应中返回实际生效值。`sandbox` 是请求，不是承诺；服务端可能升级等级或拒绝。

## 统一响应和错误

```json
{
  "ok": false,
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "该操作需要确认",
    "retryable": false,
    "correlationId": "req_01",
    "details": { "approvalId": "ap_01" }
  }
}
```

错误 code 至少包括：`AUTH_REQUIRED`、`FORBIDDEN`、`NOT_FOUND`、`INVALID_REQUEST`、`CONFLICT`、`RATE_LIMITED`、`APPROVAL_REQUIRED`、`SANDBOX_UNAVAILABLE`、`RUN_NOT_ACTIVE`、`INTERNAL_ERROR`。`details` 只允许 safe details。

## Run 事件

```json
{
  "version": 1,
  "id": "evt_01",
  "seq": 42,
  "runId": "run_01",
  "type": "approval.required",
  "at": "2026-08-03T12:00:00.000Z",
  "payload": {
    "approvalId": "ap_01",
    "tool": "filesystem.applyPatch",
    "risk": "R2",
    "summary": "写入 2 个 workspace 文件",
    "expiresAt": "2026-08-03T12:02:00.000Z"
  }
}
```

事件类型：`run.created`、`run.started`、`turn.started`、`model.delta`、`model.completed`、`tool.requested`、`approval.required`、`approval.decided`、`tool.started`、`tool.output`、`tool.completed`、`context.compacted`、`diff.updated`、`run.completed`、`run.failed`、`run.cancelled`、`run.needs_recovery`。

## SSE 续传规则

- 响应 `Content-Type: text/event-stream`，每条消息 `id` 为 `seq`，同时发送 `event` 和 JSON `data`。
- 客户端可用 query `after` 或 `Last-Event-ID` 请求从指定序号之后补发；服务端先补发持久化事件，再发送 live 事件。
- 若序号已被保留策略清理，返回 `410 EVENT_WINDOW_EXPIRED`，客户端必须重新获取 run snapshot，再从当前序号继续。
- heartbeat 不改变 `seq`；服务端关闭连接前发送可选 `retry` 建议。

## 兼容性规则

- v1 只新增可选字段；删除/改变字段含义必须提升版本。
- 未知事件类型客户端应保留原始 payload 并显示“未知事件”，不能阻塞整个时间线。
- contracts 包、OpenAPI/JSON Schema、API 文档和 contract tests 必须同一提交更新。

