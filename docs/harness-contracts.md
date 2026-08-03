# Harness 模块合约

**状态：Accepted（文档阶段）**

本文件描述实现必须满足的最小接口。代码可以使用不同库，但不能绕过这些边界直接互相调用。示例为 TypeScript 伪代码，实际类型放在 `packages/contracts`。

## 运行状态机

```text
created → queued → planning → waiting_approval
                     ↓             ↓
                 executing ← approved
                     ↓
             completed / failed / cancelled / timed_out
```

不允许从终态恢复写入；恢复只创建新的 `RunAttempt` 并引用原 run。每个状态变化必须写入持久化事件后再广播。

### Run 约束

- `maxTurns`、`maxWallTimeMs`、`maxOutputBytes`、`maxToolCalls` 必须有服务端上限；客户端只能请求更小值。
- 每一步都接收 `AbortSignal`；取消应在模型请求、子进程、MCP 请求和 SSE 订阅中传播。
- agent loop 不得在没有模型/工具事件的情况下自旋；每轮必须产生 bounded progress 或失败原因。
- 对同一 run 的输入、审批和取消使用版本号或幂等键，避免移动端重试产生重复动作。

## ModelProvider

```ts
interface ModelProvider {
  readonly id: string;
  readonly capabilities: {
    streaming: boolean;
    toolCalls: boolean;
    structuredOutput: boolean;
  };
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

interface ModelRequest {
  model: string;
  messages: readonly ContextMessage[];
  tools: readonly ToolSchema[];
  responseSchema?: JsonSchema;
  budget: { maxInputTokens: number; maxOutputTokens: number };
}
```

Provider 只负责协议和重试，不负责审批、执行工具或决定是否信任模型输出。流式事件必须可重放为最终 assistant message/tool call。

## ContextManager

```ts
interface ContextManager {
  append(item: ContextItem): Promise<ContextCursor>;
  buildRequest(input: ContextBuildInput): Promise<ModelRequest>;
  compact(input: CompactInput): Promise<CompactionResult>;
  read(cursor?: ContextCursor): AsyncIterable<ContextItem>;
}
```

- 所有注入项有字节/token 上限、来源和敏感级别；
- 历史事件不可原地修改，压缩摘要必须带 `sourceSeqStart/End`；
- 用户输入、工具输出、Skill/MCP 描述互相标注来源，不能把工具输出当作系统指令；
- 文件上下文默认使用摘要/片段，不自动上传整个 workspace；
- 发生预算不足时优先丢弃重复的工具输出，保留用户目标、审批决策和失败原因。

## ToolRegistry 与 ToolExecutor

```ts
interface ToolRegistry {
  list(scope: ToolScope): readonly RegisteredTool[];
  resolve(name: string, version: string): RegisteredTool | undefined;
}

interface ToolExecutor {
  execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}

interface RegisteredTool {
  name: string;
  version: string;
  schema: ToolSchema;
  risk: RiskClass;
  capabilities: readonly Capability[];
  execute: ToolExecutor;
}
```

工具名称、版本、schema、风险等级和 capability 在调用前固定快照；执行中不允许 Skill/MCP 动态替换同名工具。结果必须包含截断信息、退出码/错误码和审计引用。

## ApprovalPolicy

```ts
interface ApprovalPolicy {
  decide(input: ApprovalInput): ApprovalDecision;
  grant(input: ApprovalGrantInput): Promise<ApprovalGrant>;
  revoke(grantId: string): Promise<void>;
}
```

决策必须是 `allow | deny | ask`，并返回 `reasonCode`、匹配规则、sandbox/network 影响、过期时间和审计数据。服务端永远可以把客户端请求升级为 `ask` 或 `deny`，不能降级安全级别。实现细节遵循 [Spec 01](specs/01-sandbox-approval.md)：规则 allow/prompt/forbidden、精确 ApprovalKey、会话 grant、network amendment 和自动审查 fail-closed。

## SandboxAdapter

```ts
interface SandboxAdapter {
  readonly strength: 'host-restricted' | 'os-isolated' | 'container' | 'vm';
  prepare(spec: SandboxSpec): Promise<SandboxHandle>;
  run(handle: SandboxHandle, command: CommandSpec, signal: AbortSignal): Promise<ProcessResult>;
  dispose(handle: SandboxHandle): Promise<void>;
}
```

`host-restricted` 只能表示路径/环境限制，不得在 UI 中显示为强隔离。每个 handle 绑定 workspace、网络策略、资源上限和创建者 runId。

## Shell 与 Filesystem

- 默认使用 `spawn/execFile` 的 argv 数组，不接受未经解析的 shell 字符串；如确需 shell，必须经过平台适配器和风险分类。
- `cwd`、读写路径、环境变量、stdin、stdout/stderr 字节数和超时均由服务端设置上限。
- 所有路径先规范化，再验证真实路径是否位于 workspace allowlist；跟随符号链接时必须重新校验。
- 文件写入优先使用临时文件 + 原子 rename；patch 需记录前后 hash 和 diff。
- 终止进程要递归处理子进程树；Windows、macOS、Linux 分别实现 adapter 并有平台测试。

## Skill Loader

Skill 是声明式能力包，不是任意脚本执行入口：

```text
skill/
  skill.json       # name, version, description, allowedTools, inputSchema
  instructions.md  # bounded prompt fragment
  tests/            # optional fixture tests
```

加载时校验 manifest schema、大小、哈希、来源和 allowlist；markdown 只作为带来源标签的上下文片段，不提升权限、不覆盖系统策略。需要代码时必须显式注册 Tool/MCP provider。

## MCP Client

- 支持 stdio 和 Streamable HTTP 两类 transport；transport 断连、超时、取消和 schema 错误必须映射为统一 `ToolError`。
- 启动 MCP server 使用精确 argv/env allowlist；默认不继承 daemon 全部 secrets。
- server 返回的工具只进入临时 registry，先经过名称冲突、schema 大小、risk/capability 标注和用户配置 allowlist。
- MCP 资源和 prompt 必须保留来源；不能把远程内容当系统指令。

## RemoteTransport

```ts
interface RemoteTransport {
  readonly kind: 'lan-http' | 'tailscale' | 'ssh-stdio' | 'public-https';
  start(handler: ApiHandler, signal: AbortSignal): Promise<void>;
  peerIdentity(request: IncomingRequest): Promise<PeerIdentity>;
  close(): Promise<void>;
}
```

MVP 只实现 LAN HTTPS/HTTP（HTTP 需要显式关闭 TLS）；Tailscale/SSH 适配器之后复用 API、事件、认证和审批合约。`public-https` 作为后续 transport，永远要求有效证书和完整认证，不允许通过 transport 绕过 sandbox 或 policy。

## Storage 与 EventLog

```ts
interface EventStore {
  append(event: DomainEvent): Promise<StoredEvent>; // seq 单调递增
  read(runId: string, afterSeq?: number): AsyncIterable<StoredEvent>;
  snapshot(runId: string): Promise<RunSnapshot | undefined>;
}
```

事件 payload 需通过 `contracts` schema 验证；事务顺序是“写事件/快照 → 提交 → 广播”。事件保留和敏感字段脱敏策略见安全 ADR。

## Goal Control（Phase 0/1）

Goal Control 是 daemon application service 层的可选控制平面，不是第二个
AgentLoop、Scheduler 或执行器。它必须满足以下边界：

- Goal/Todo/Gate/Evidence/Handoff 使用独立版本化 schema；Goal 事件进入独立的
  `goal_events` 流，不能伪装成或污染 run-local `run_events`；
- `GoalProjection` 可从事件重放并带 `lastEventId`、goal-local `appendSequence`、
  `sourceChecksum` 和 `controlRevision`；相同 `eventId` + 相同内容是 no-op，内容
  不同必须冲突；
- governed/heartbeat 路径的顺序是 Goal `shouldRun` → Todo claim/revision →
  `RunManager` → Scheduler/Approval/Sandbox/Workspace。Goal quota 不能绕过任何
  执行安全门禁；明确的 interactive run 不得被 quota 静默拦截；
- claim 使用乐观 `controlRevision` 和一次性 token。事件只保存 token hash，陈旧
  revision、重复 claim 或未知 Todo 必须 fail closed；
- 只有独立验证成功的 compact evidence 才能允许 Todo completion/quota spend。
  模型自报完成、失败验证、recovery 和 retry 不能自动完成旧 Todo 或重放旧工具；
- Goal payload 只允许 bounded text、稳定 ID、状态、hash、数量和引用；不得包含
  transcript、tool output、workspace 绝对路径、API key、token、环境变量或私钥；
- Phase 0/1 的只读门禁已经验收，但在 Phase 2 governed preflight 验收前，Goal
  Control 不进入默认 run admission；普通配置和操作由
  React Web Settings/onboarding 与受保护 API 提供，不要求用户编辑 `.env`、YAML、
  JSON、PEM 或 SQLite 文件。

当前 Phase 1 daemon 只提供受认证的 `GET /api/v1/goals`、
`GET /api/v1/goals/:goalId` 和 bounded JSON event replay；API 使用
`GoalProjectionBuilder` 从独立 `goal_events` 重放，并剥离 `claimTokenHash`。Goal
写 API、Web 首屏操作和 governed admission 仍以后续阶段实现。

Goal Control 不执行模型、工具、shell、文件系统、Git、MCP 或 sandbox；这些事实
仍归现有执行平面所有。

## 错误模型

跨包错误至少包含：`code`、`message`（用户可读）、`retryable`、`safeDetails`、`correlationId`。原始 provider 响应、命令行 secret、环境变量值不得进入 `safeDetails`。

## 依赖方向

```text
contracts ← context/policy/model/tools/sandbox/mcp/storage
             ↑             ↑
          harness ────────┘
             ↑
       daemon/api
contracts → web/ui
```

`contracts` 不依赖应用；`harness` 不依赖 React/Fastify；`web` 不依赖 Node fs/child_process；测试使用 `testkit` 的 fake provider，而不是线上模型。
