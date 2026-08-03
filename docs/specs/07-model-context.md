# Spec 07：ModelProvider 与 ContextManager

**状态：Accepted（OpenAI-compatible/上下文 MVP 约束）**

## OpenAI-compatible provider

- provider 只接收 `baseUrl`、model name 和内存中的 API key；key 不进入 `ModelRequest`、事件、错误、日志或浏览器；
- 默认要求 HTTPS；允许 loopback HTTP 时必须显式 `allowInsecureHttp`，公网/局域网路径不允许关闭 TLS；
- 使用 Node 原生 `fetch`，不引入 SDK 或常驻连接池；请求超时由上层 `AbortSignal` 控制；
- 请求发送 OpenAI Chat Completions 兼容 JSON，流式响应解析 `data:` SSE；支持 text delta、tool-call delta、usage、`[DONE]`；
- 非 2xx、畸形 JSON、断流只产生 safe `model.error`，不转发响应 body；
- provider ID、base URL、模型名可进入诊断摘要，但 API key 只能在组合根注入。

## ContextManager

- 每条 context item 带 `source`、`trust`、`role` 和内容；`untrusted` 内容在发送给模型前使用明确边界标记；
- `maxContextBytes` 是硬上限，保留 system/developer 约束和最新 user 输入，优先丢弃最早的历史项；
- 裁剪结果返回 `droppedCount`、`bytes` 和 `compacted`，由 agent loop 后续写 `context.compacted` 事件；
- ContextManager 不读取文件系统、不自行调用模型、不持久化 secret；原始事件仍由 EventStore 保存。

## 测试门禁

- provider：请求 headers/body、SSE 分片解析、tool-call/usage、非 2xx 脱敏、AbortSignal；
- context：来源标记、untrusted 边界、字节预算、system/user 保留和确定性裁剪；
- 运行 `pnpm typecheck`、`pnpm test`、`pnpm diff:check` 后再提交。
