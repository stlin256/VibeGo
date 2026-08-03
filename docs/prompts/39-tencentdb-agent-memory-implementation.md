# TencentDB Agent Memory 融合实施提示词

下面的内容可以直接交给另一位开发者或 Agent。实施前请先阅读
[Spec 39](../specs/39-tencentdb-agent-memory-integration.md) 和
[ADR 0008](../adr/0008-tencentdb-agent-memory-sidecar-and-live-update.md)。

```text
你正在 ready4vibe 仓库中实施 TencentDB Agent Memory 融合。目标不是把 TencentDB 源码复制进主进程，而是实现：

TencentDB 独立 sidecar + ready4vibe 原生 Adapter + Web 可切换开关 + GitHub 上游自动构建/切换/回滚。

必须遵守以下边界：

1. 先检查 git status、当前分支、package manager、Node/pnpm 版本和 workspace 结构。工作区已有其他用户/Agent 改动，禁止 git reset --hard、git checkout、git clean、覆盖或回滚无关文件；保留所有 dirty worktree 改动。
2. 先读并遵守 docs/specs/39-tencentdb-agent-memory-integration.md、docs/adr/0008-tencentdb-agent-memory-sidecar-and-live-update.md、docs/specs/03-model-context-contract.md、docs/specs/34-goal-control-plane-loopx-integration.md、docs/specs/36-durable-workspace-settings.md 和 docs/specs/38-conversation-first-web-shell.md。
3. 不让 TencentDB 接管 Goal、Todo、Gate、Evidence、Handoff、quota、shouldRun、run_events、goal_events、RunManager、Scheduler、Approval、Sandbox 或 WorkspaceRegistry；这些仍是 ready4vibe 的事实源。
4. 不修改 AgentLoop 核心状态机。优先使用现有 contextItems/ContextManager 和 modelProviderForRun 等扩展点；运行中的 run 要冻结 memory/provider snapshot。
5. TencentDB 不可用时，Web、普通模型调用和 run 必须继续；记忆失败只能产生 bounded degraded 状态，不能变成 Web 500 或阻塞 run。
6. 不把 API key、secret、完整 transcript、原始 tool output、绝对路径或完整环境变量写入浏览器、settings response、run/goal event、日志或 memory payload。

按以下顺序工作，每一步都先写测试或 fixture，再实现代码：

阶段 A：Contract 和 Noop

- 在合适的 contracts 包定义版本化 AgentMemoryMode：off、memory-core、proxy、full-stack。
- 定义 AgentMemoryIdentity（teamId、agentId、userId、可选 sessionId）、recall/write/status DTO 和 AgentMemoryProvider 接口。
- 实现 NoopAgentMemoryProvider；默认 enabled=false/mode=off。
- 测试 off 模式不会调用 SDK、HTTP、sidecar 子进程或修改 prompt。

阶段 B：MemoryCore Adapter

- 只通过公开的 TencentDB MemoryCore v3 API/TypeScript SDK（@tencentdb-agent-memory/memory-sdk-ts-v2）接入，不依赖 upstream 私有 module path。
- 明确实现 teamId/agentId/userId/sessionId 映射；不要从 prompt 猜 identity。
- 实现 recall -> ContextItem：source=retrieval，明确 trust，经过 ContextManager 字节预算、最大条数和最大字节数。
- 实现 run 终态后的 compact asynchronous write-back，只写摘要、决策、验证结果和 bounded evidence refs；不阻塞 run 终态。
- 为 timeout、HTTP 5xx、malformed JSON、schema mismatch、队列失败和重试写 fake MemoryCore server/SDK tests。
- 不要让 memory error 覆盖原始 model/tool/approval error。

阶段 C：Web Settings 和 daemon API

- 使用现有 daemon_settings persistence 增加 agent-memory/v1；只保存非 secret 配置：enabled、mode、teamId、agentId、userId、upstreamRepo、upstreamRef、autoUpdate、updateIntervalMinutes、fallbackToDirectProvider。
- 增加 GET/PATCH /api/v1/settings/agent-memory、POST probe、POST update、POST rollback；响应包含 status、currentRevision、previousRevision、updateState、lastHealthAt、lastUpdateAt 和稳定错误码，不返回 secret/绝对路径。
- 在 Spec 38 的 Settings drawer/sheet 增加开关、模式、健康状态、revision、立即更新和回退按钮。
- 不增加额外的逐 run 安全确认或 Web 限制；现有 daemon 认证边界照旧，但 sidecar 降级不能影响普通 Web。
- 测试切换只影响新 run，运行中的 run snapshot 不变；刷新/重启后非 secret settings 能恢复。

阶段 D：TencentMemoryRuntimeSupervisor

- 实现独立 supervisor 管理 sidecar 生命周期、端口、current/previous/candidate revision 和 health 状态。
- 使用不可变 revisions/<sha> 与 candidates/<sha> worktree；禁止在 current 目录原地 git pull。
- 更新流程必须是：检查 upstream -> 拉取候选 -> 读取候选 manifest/lockfile/README -> frozen install -> build/typecheck -> 临时端口启动 -> health probe -> MemoryCore SDK smoke test -> 原子切换 -> 旧实例 drain -> previous 指针更新。
- 构建、Node 版本、端口、health、smoke 任一步失败都保留 current；切换后健康失败要能回到 previous。
- 更新请求串行化；定时器、webhook 和 Web “立即更新”共用同一队列；不做运行中 Node 模块热替换。
- 兼顾 Windows：子进程终止、临时目录、路径、端口释放和 daemon 重启都要有测试。

阶段 E：Proxy（后置）

- 不要把 MemoryProxy 根 URL 直接填入现有 OpenAICompatibleProvider，因为它会隐式追加 /chat/completions。
- 新增 TencentMemoryProxyProvider 或显式 endpoint contract，覆盖正确 path、headers、health 和上游配置。
- Proxy 不可用时默认回退 ready4vibe 原始 Provider，并标记 degraded；不要让 Proxy 成为 Web/run 的硬依赖。

阶段 F：Knowledge（后置）

- 通过 MemoryKnowledge /v3/tools/list 和 /v3/tools/call 增加只读、bounded、可取消的 Wiki/CodeGraph retrieval adapter。
- 先转换为 ContextItem，不要直接注册成任意 ToolRuntime；完成 descriptor、审批、资源限制和回归测试后再评估工具化。

验收要求：

- pnpm typecheck、pnpm test、pnpm diff:check 通过；新增 adapter、settings、supervisor、web 和回滚测试。
- git diff --check 通过；所有新增 Markdown code fence 成对；相对 Markdown 链接存在。
- off、sidecar down、recall timeout、write failure、候选 build failure、health failure、切换后 rollback、daemon restart 都有可重复测试。
- Goal Control、run_events/goal_events、AgentLoop、Scheduler、Approval、Sandbox、Workspace 和现有模型直连回归不变。
- 报告修改文件、每个阶段完成情况、测试命令和结果、current/previous revision 行为、未完成项和已知 upstream 假设。若 upstream 当前 revision 与本文假设不符，先记录证据并在 adapter 层兼容，不要静默硬编码。
```
