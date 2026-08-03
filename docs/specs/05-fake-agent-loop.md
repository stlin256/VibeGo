# Spec 05：Fake-model agent loop

**状态：Accepted（MVP 单 turn 实现约束）**

本阶段实现一个可测试的 orchestrator loop，用 fake `ModelProvider` 验证 run 生命周期和事件事实源。它不执行 shell/filesystem/Git，不访问网络，不触发 MCP/Skill，也不把失败时的原始 provider 错误写入事件。

## 生命周期

1. 校验 `RunConfig`，写入 `run.created`；
2. 进入 `queued`，通过 scheduler 获取 workspace/resource lease；
3. 进入 `planning`，创建一个 `turn.started`；
4. 进入 `executing`，调用一次 model provider；
5. 将 text/tool-call/usage/completed/error 映射为版本化 domain events；
6. 正常 completed 写 `run.completed`，模型安全错误写 `run.failed`；所有路径释放 lease。

MVP 只执行一个 turn；`maxTurns` 仍由 `RunConfig` 保留并在后续多 turn loop 使用。当前 fake loop 的 `tools` 为空，因此不会生成真实 tool approval。

## 取消与限制

- 外部 `AbortSignal` 在排队阶段取消 queued request，在模型阶段中止 provider stream；
- 取消顺序为 `cancelling → cancelled`，并保证 lease 释放；
- 输出超过 `maxOutputBytes` 立即中止并进入 `failed`，错误码为 `OUTPUT_LIMIT_EXCEEDED`；
- provider stream 未产生 `completed` 且未取消时进入 `MODEL_STREAM_ENDED`；
- 原始异常只保留在 `cause`，事件/API 只写 safe code/message/retryable。

## 事件最小集合

`run.created`、`run.status`、`turn.started`、`model.requested`、`model.delta`、`model.usage`、`model.completed`、`model.error`、`run.completed`、`run.failed`、`run.cancelled`。

## 测试门禁

- 正常文本流：状态、事件顺序、摘要和 lease 释放；
- provider error、stream premature end、输出上限；
- 排队取消与模型中途取消；
- 两个不同 workspace 的 fake run 可按 scheduler 并发策略运行。
