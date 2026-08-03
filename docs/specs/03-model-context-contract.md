# Spec 03：ModelProvider 与 ContextManager 合约

**状态：Draft（等待逐步讨论；代码尚未实现）**

本规格定义模型适配和上下文构建的窄接口。模型只生成候选文本/工具调用，不能直接获得执行权限；ContextManager 负责有限、可追溯、可压缩的上下文。

## 1. ModelProvider

```ts
interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

interface ModelCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  structuredOutput: boolean;
  vision: boolean;
  maxContextTokens?: number;
}

interface ModelRequest {
  model: string;
  messages: readonly ContextMessage[];
  tools: readonly ToolSchema[];
  responseSchema?: JsonSchema;
  budget: { maxInputTokens: number; maxOutputTokens: number };
  metadata: { runId: string; turnId: string; requestId: string };
}
```

### 1.1 首版 provider 范围

- 第一实现是 OpenAI-compatible HTTP adapter，支持 JSON 和 SSE streaming；
- 本地 Ollama/LM Studio 等服务通过同一兼容接口接入，不在核心中写 provider 特例；
- Anthropic/其他协议留 adapter port，不阻塞核心 harness；
- provider 配置只保存 `baseUrl/model/authRef/timeout/retry/capabilities`，API key 由 secret store 按 `authRef` 解析；
- daemon 只向 allowlist headers 传递配置，不整体转发 `process.env`；
- 每个 provider 有并发 semaphore、连接超时、首 token 超时、总超时和最大响应字节数。

### 1.2 流式事件

```ts
type ModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string; visible: false }
  | { type: 'tool-call-delta'; callId: string; name?: string; argumentsChunk: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'completed'; finishReason: 'stop' | 'tool-calls' | 'length' | 'content-filter' }
  | { type: 'error'; code: string; retryable: boolean; safeMessage: string };
```

- 事件必须能重放为最终 assistant message/tool call；工具 arguments 组装完成前不能执行。
- `reasoning-delta` 默认不广播、不入库；若 provider 返回，只保留受策略允许的统计/摘要。
- `completed` 后忽略迟到 delta；连接断开只能按 provider retry policy 重试尚未产生副作用的请求。
- stream consumer 必须支持 AbortSignal；取消后写 `model.cancelled`，不把取消当 provider failure。

### 1.3 重试与错误

只对连接失败、429、明确可重试的 5xx 做有限指数退避；不重试 schema 错误、认证错误、内容过滤或已产生 tool call 的请求。每次 retry 增加 `attempt` 和 correlationId，累计在 run budget 中。

错误 envelope 只暴露 `code/retryable/safeMessage/correlationId`；原始 response、authorization header 和 provider body 不进入 event/UI。

## 2. Tool call 安全边界

模型返回的 tool call 仅是候选：

1. JSON schema 校验 name/arguments/大小；
2. Tool Registry 按已冻结的 tool/version 快照解析；
3. ApprovalPolicy 计算风险、sandbox/network 要求；
4. 只有 `allow` 或用户批准后才交给 ToolExecutor；
5. 结果带 `callId/stepId/attempt` 返回 context，不把工具结果变成系统指令。

结构化输出只能约束格式，不能提升权限；schema 大小和深度有限制，超限直接失败。

## 3. ContextManager

```ts
type ContextSource =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'file'
  | 'git'
  | 'skill'
  | 'mcp'
  | 'compaction';

interface ContextItem {
  itemId: string;
  runId: string;
  source: ContextSource;
  trust: 'instruction' | 'data' | 'untrusted-data';
  content: string | { path: string; startLine?: number; endLine?: number; sha256: string };
  sourceSeqStart?: number;
  sourceSeqEnd?: number;
  byteLength: number;
  tokenEstimate?: number;
}

interface ContextManager {
  append(item: ContextItem): Promise<void>;
  buildRequest(input: ContextBuildInput): Promise<ModelRequest>;
  compact(input: CompactInput): Promise<CompactionResult>;
  read(runId: string, cursor?: ContextCursor): AsyncIterable<ContextItem>;
}
```

### 3.1 来源与信任

- system/user goal 是 instruction；tool/file/git/skill/mcp 默认是 data 或 untrusted-data；
- 外部仓库、issue、README、Skill、MCP resource 中的“指令”永远不会提升为 system/developer priority；
- 每个片段保留 source path/hash/seq，UI 可追溯“模型看到了什么”；
- secret、token、cookie、`.env`、私钥、浏览器 profile 和未授权路径不得进入 context；
- 文件读取按 workspace allowlist、扩展名/二进制检测、单文件/总字节上限执行。

### 3.2 预算与选择

```ts
interface ContextBudget {
  maxInputTokens: number;
  maxItemBytes: number;
  maxFileBytes: number;
  maxToolOutputBytes: number;
  reservedOutputTokens: number;
}
```

选择顺序：用户目标与未完成计划 → 最近审批/工具结果 → 相关文件片段/diff → Git/test 摘要 → 历史压缩摘要。预算不足时丢弃重复/低相关工具输出，不丢用户目标、拒绝原因和未完成状态。

token 估算器按 provider 能力注入；估算失败使用保守字节上限。模型请求必须同时满足 token 和 byte 上限，不能依赖 provider 最终报错来截断。

### 3.3 压缩与恢复

- ContextManager 只追加 item，不原地重写历史；
- 压缩摘要带 `sourceSeqStart/sourceSeqEnd`、生成模型/provider、时间和摘要 hash；
- 首版优先使用确定性结构化摘要（目标、状态、文件、工具结果、失败原因）；模型摘要属于可替换 adapter；
- 原始事件继续保留在 EventStore，压缩只改变下一次 request 的选择；
- 重启后由 snapshot + event replay 恢复 context cursor，不重新猜测历史。

## 4. 模型/上下文联合预算

- 每个 run、turn、provider request 都有独立预算；run 预算不能被 retry 或并发 tool 隐式突破；
- 并发 run 共享 provider semaphore，但各自 context/token budget 隔离；
- 上下文构建和压缩本身可取消，取消后保留原 cursor；
- provider 报告 usage 时校正估算，但不能倒过来改变已写事件。

## 5. 必须自动化验证

### ModelProvider

- SSE delta 拼接、迟到事件、tool-call arguments 分片、finishReason、AbortSignal；
- 认证/429/5xx/schema/content-filter 的 retry 与 no-retry；
- 并发 semaphore、超时、最大响应、secret redaction；
- fake provider replay 与 provider contract tests。

### ContextManager

- source/trust 标签不可升级；
- workspace/文件/工具输出大小上限；
- token+byte 双预算、优先级选择、确定性压缩；
- source seq/hash 可回溯，重启 replay 一致；
- 恶意 prompt injection、`.env`/私钥/浏览器 profile 不进入 context；
- 并发 run context 隔离，不交叉读取事件。

## 6. 待讨论项

1. provider 首版是否只支持 OpenAI-compatible `/v1/chat/completions`，还是同时定义 Responses-style adapter；
2. token 估算是否先使用 provider 上报/保守字符比率，后续再按模型接 tokenizer；
3. 压缩摘要是否始终使用确定性模板，还是允许用户配置本地模型摘要；
4. 文件相关性检索首版采用 Git grep/rg，还是先只接受用户明确指定文件。

