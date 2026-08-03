# Spec 08：AgentLoop 上下文与模型配置接入

**状态：Accepted（本地组合根配置约束）**

## AgentLoop 接入

- 每个 run 创建独立 ContextManager，`RunConfig.limits.maxContextBytes` 是硬预算；
- 用户消息作为最新 user item，调用方可附加带来源/信任标签的历史、workspace 或 tool items；
- build 结果作为 `ModelRequest.messages`；发生裁剪时先写 `context.compacted`，再写 `model.requested`；
- 受保护上下文超预算时不获取 scheduler lease，run 进入 `failed`，错误码 `CONTEXT_BUDGET_EXCEEDED`；
- context item 原文不写入日志，只有安全的 dropped id/count 可进入事件。

## 本地模型配置

daemon 组合根只从进程环境读取以下配置，不自动落盘：

| 环境变量 | 作用 | 默认 |
| --- | --- | --- |
| `READY4VIBE_MODEL_API_KEY` | OpenAI-compatible API key | 未配置时使用 unconfigured provider |
| `READY4VIBE_MODEL_BASE_URL` | provider base URL | `https://api.deepseek.com` |
| `READY4VIBE_MODEL_NAME` | 模型名 | `deepseek-v4-flash` |

当 API key 存在时使用 `OpenAICompatibleProvider`；否则 run 会得到明确的 `MODEL_PROVIDER_NOT_CONFIGURED` safe error。任何情况下 key 不进入 health、snapshot、EventStore、SSE、Git 或浏览器。

## 验证门禁

- AgentLoop 测试 context compaction、untrusted boundary 和 context budget failure；
- daemon 测试无 key 的安全 fallback；provider 继续使用 mock fetch，不因单测消耗真实额度；
- 真实 provider smoke test 只能显式手动执行，不纳入默认 `pnpm test`。
