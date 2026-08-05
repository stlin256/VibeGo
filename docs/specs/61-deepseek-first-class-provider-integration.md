# Spec 61：DeepSeek 一等 Provider、思考模式与低打扰 Agent Loop

- Status: Draft（61-0/61-1/61-2/61-3/61-4 adapter checkpoint 与 61-5 首个 application/Web settings slice 已完成；61-6/61-7 仍后置；本文件不把规划写成已完成能力）
- Date: 2026-08-05
- Scope: DeepSeek provider adapter、流式协议、tool calling、thinking/reasoning
  模式、可选 provider-owned web search、bounded reviewer、Web 配置、真实 LLM
  smoke 和与现有 AgentLoop/Approval/Sandbox/Goal 的集成
- Related: [Spec 03：Model/context contract](03-model-context-contract.md)、
  [Spec 07：Model/context](07-model-context.md)、
  [Spec 08：Agent/model integration](08-agent-model-integration.md)、
  [Spec 44：Provider/usage management](44-provider-usage-management-and-upstream-reuse.md)、
  [Spec 47：Model/context/AgentLoop productionization](47-model-context-agent-loop-productionization.md)、
  [Spec 48：Approval/Sandbox/Shell runtime](48-approval-sandbox-shell-runtime.md)、
  [Spec 54：Model provider onboarding](54-model-provider-onboarding.md)、
  [Spec 58：Goal/Harness completion](58-goal-control-and-harness-completion.md)、
  [Spec 59：Permission profiles](59-permission-profiles-and-low-interruption-approval.md)、
  [Spec 60：Complete verification](60-complete-verification-and-release-evidence.md)、
  [Spec 62：User-facing documentation](62-user-facing-documentation-quality.md)、
  [Spec 63：LLM-assisted approval and review](63-llm-assisted-approval-and-review.md)

## 1. 目标

VibeGo 需要把 DeepSeek 从“可填写一个 OpenAI-compatible URL 的 provider”提升为
一等、可观察、可配置、可测试的 provider，同时吸收
[MinimumAgentLoop](https://github.com/Here-Tim2354/MinimumAgentLoop) 中对 AgentLoop
的有效实践：

1. 外层 run loop 与内层 multi-turn/tool loop 分离；
2. 一个模型响应中的多个 tool call 先完成受控执行，再继续请求模型；
3. thinking/reasoning 档位、sandbox 开关和审批姿态可被用户理解和切换；
4. provider reviewer 可以减少低风险操作的打扰，但不能成为安全策略的权威；
5. DeepSeek 的 streaming、tool calling、usage、错误和取消行为有真实证据。

本规格不是复制上游代码，也不是把 Python runtime 引入 VibeGo。它把上游项目作为
教学参考和行为 fixture，最终实现必须使用 VibeGo 原生 TypeScript contracts、
RunManager、AgentLoop、ContextManager、Scheduler、Approval、Sandbox 和 Web。

## 2. 强制边界

以下约束不可因“DeepSeek 兼容”或“减少点击”而放宽：

- 不 vendor、复制或改写 MinimumAgentLoop 源码；实施前记录上游 commit、目录、
  `Unlicense`/NOTICE 证据，并遵守 Spec 44 的 clean-room/provenance 规则；
- 不引入 Python runtime、OpenAI Python SDK、`srt` 或第二套 AgentLoop；
- DeepSeek provider 只负责协议、流式事件、能力和错误映射，不决定工具是否允许、
  不直接执行 shell/filesystem/Git/MCP/Skill，不修改 Goal/quota/Gate；
- `run_events`、`goal_events`、RunManager、Scheduler、Approval、Sandbox、
  WorkspaceRegistry 仍是唯一事实源；provider 只能在 daemon application boundary
  被组合；
- 每个 run 在第一次模型请求前冻结 provider、endpoint profile、model、thinking
  mode、tool snapshot、permission/sandbox/network snapshot 和 retry policy；设置
  改变只影响新 run；
- API key、完整 Authorization header、cookie、环境变量值、绝对路径、完整 prompt、
  raw transcript、private reasoning 和未截断 tool output 不得进入仓库、浏览器存储、
  settings response、事件、日志或 evidence；
- 网络、provider-owned web search、MCP/Skill 和 full-host 都是独立 capability，
  默认关闭，不能因选择 DeepSeek 或 reviewer 自动打开；
- provider、reviewer、web search 任一不可用时必须返回 bounded `degraded`/`blocked`，
  不能静默切换到 host、yolo 或另一个未经用户选择的 provider；
- recovery/retry 只能创建新的 run/attempt，不能重新执行旧 tool call、旧 web search
  或旧 reviewer 决策。

## 3. DeepSeek capability contract（`deepseek-provider/v1`）

### 3.1 非 secret 配置

实现一个严格、版本化、拒绝未知字段的配置 contract，至少包括：

| 字段 | 约束 |
| --- | --- |
| `providerId` | 固定为 `deepseek` |
| `endpointProfile` | `openai-chat-completions`、`openai-responses` 或 `anthropic-messages`；必须经过对应 probe |
| `endpoint` | 完整 HTTPS endpoint；不允许在 provider 内隐式拼接未知 path |
| `model` | bounded model id；允许 `deepseek-v4-flash` 等用户选择的模型，不把未知模型伪装成已验证能力 |
| `thinkingMode` | `off`、`auto`、`high`、`max`；最终 effective mode 写入 run snapshot |
| `toolCalling` | `disabled` 或 `enabled`，受 provider capability 和 run tool snapshot 共同约束 |
| `webSearch` | `off` 或 `provider-owned`，默认 `off`，需要 network capability |
| `reviewer` | `off` 或 `advisory`，默认 `off`；不能表示授权 |
| `timeoutMs`/`maxRetries` | 服务端 bounded，上限不可由浏览器扩大 |
| `contextLimit`/`maxOutputTokens` | 来自 probe 或受服务器上限约束，不接受任意超限值 |

API key 只能使用 daemon 进程内 secret reference 或未来 OS keychain adapter。Web 只
发送一次性输入，不返回、存储或回显 key。

### 3.2 capability snapshot

Probe 必须输出不含 secret/path 的 `DeepSeekCapabilitySnapshot`，至少包含：

- protocol、model id、streaming、tool calling、structured output、thinking 支持；
- 最大输入/输出预算（若 provider 没有可靠值则为 `unknown`，不能猜测）；
- usage 字段可用性、server-side web search 可用性、retry-after 语义；
- `descriptorRevision`、probe 时间和稳定的 `status/degradedReason`。

snapshot 是 immutable run input。provider 返回未声明的 capability 时 fail-closed，
不能在模型响应中临时注册工具或提升 thinking/network 权限。

## 4. 协议与适配器设计

### 4.1 适配器边界

优先新增 `packages/model-deepseek`，通过 `@ready4vibe/contracts` 暴露
`DeepSeekProvider`、`DeepSeekProbe` 和 protocol translators；可以复用
`packages/model-openai` 的通用 SSE/错误 primitives，但不得在 AgentLoop 中加入
DeepSeek 分支。若实现评审证明不需要新 package，也必须保留独立的 DeepSeek public
adapter 和测试边界。

内部 canonical request/event 仍使用 VibeGo `ModelRequest`/`ModelEvent`：

```text
VibeGo ModelRequest
  -> DeepSeek protocol adapter
  -> explicit endpoint/profile
  -> bounded streaming ModelEvent
  -> AgentLoop / ContextManager / run_events
```

### 4.2 OpenAI-compatible Chat Completions

这是第一阶段必须支持的协议：

- SSE text delta、tool-call delta、finish reason、usage 和 `[DONE]`；
- 多个 tool call 使用稳定 `callId` 聚合完整 JSON arguments；
- `tool_calls` 与 `tool` result 必须按 call id 成对回填；
- 只接受完整 endpoint，默认 HTTPS，HTTP 仅在显式本地 fixture 中允许；
- provider 的 `base_url`、`/chat/completions` 和 `/models` probe 路径必须由 endpoint
  profile 明确声明，禁止重复拼接或“猜 path”。

### 4.3 Responses-style 与 Anthropic-compatible 适配

MinimumAgentLoop 使用 Responses-style 的 output item 和
`function_call_output` 回填，这个行为应作为 VibeGo 的参考 fixture。VibeGo 必须：

- 支持一个显式 `openai-responses` translator，或在 probe 发现 endpoint 不支持时
  明确返回 `PROVIDER_CAPABILITY_UNSUPPORTED`；不得把 Chat Completions 的 JSON
  静默伪装成 Responses；
- 将 output item、function call、function call output、reasoning metadata 转换为
  bounded canonical events；private reasoning 不写入事件或 Web；
- 将 `anthropic-messages` 作为独立 endpoint/profile，不复用错误的
  `/chat/completions` path；该 profile 只有在 probe、schema 和错误映射完成后才能标记
  enabled；
- 三种协议都必须共享同一套 timeout、AbortSignal、output cap、privacy scan、
  retry/replay ledger 和 provider snapshot。

### 4.4 Thinking/reasoning

`thinkingMode` 是 provider capability 的映射，不是把模型内部思维写进 prompt 或
transcript：

- `off`：请求关闭或不启用 reasoning；
- `auto`：按 model capability 选择安全默认；
- `high`/`max`：仅在 probe 声明支持时发送对应 provider 参数；
- 不支持时返回明确的 `THINKING_MODE_UNSUPPORTED`，不能静默降级为另一档并声称成功；
- run/event/Web 只显示 mode、latency、usage 和 bounded summary，不显示 chain-of-thought；
- thinking token 计费/usage 若无法可靠区分，标记 `unknown`，不伪造成本数据。

## 5. AgentLoop 与工具调用行为

### 5.1 两层循环

VibeGo 保留自己的 run state machine，内部 turn 行为采用以下结构：

```text
authenticated run
  -> immutable provider/permission/tool snapshot
  -> outer run lifecycle (RunManager/Scheduler)
  -> inner model turn loop (maxTurns)
       -> stream text/tool-call deltas
       -> aggregate one or more calls
       -> ApprovalPolicy + Sandbox + ToolExecutor
       -> append assistant/tool results by callId
       -> next model turn or terminal answer
```

一次响应中的多个调用可以作为一个 turn 的 batch 收集，但每个调用仍必须单独经过
approval key、sandbox resolution、workspace lease、output cap 和 audit event。默认按
声明顺序执行，避免两个写操作并发破坏 workspace；只有 Scheduler/ToolRuntime 明确
声明 read-only 且可并发时，才允许受限并发。

### 5.2 ContextManager 回填

- 不把进程内 `inputs` 无限增长地全量回传；每轮结果先转换为带 source/trust/size 的
  `ContextItem`，再由 ContextManager 预算和压缩；
- assistant tool call 与 tool result 必须保持 call id、turn id 和 bounded references；
- provider response 只追加新上下文，不能原地改写历史事件；
- context limit 错误必须成为稳定 `CONTEXT_LIMIT_EXCEEDED`，并给出用户可操作的缩减
  建议，而不是自动上传整个 workspace 或无限重试。

### 5.3 取消、重试与恢复

- AbortSignal 必须传播到 fetch、SSE reader、reviewer、web search 和 ToolExecutor；
- 在首个可见 token 前的网络/429/5xx 可以按 provider retry policy 重试，必须使用
  request id/replay ledger 防止重复计费；
- 已产生部分输出后不得透明重放整个请求；返回 bounded partial/degraded 或让用户
  显式 retry；
- daemon 重启后不恢复 in-flight provider/reviewer/web-search request，不重放旧 tool；
- 每一次 provider attempt 的 safe status、retry count 和 usage 都能从事件/observability
  projection 重建，但不写原始响应。

## 6. 低打扰审批与 MinimumAgentLoop 模式映射

MinimumAgentLoop 的命令式模式必须转换为 VibeGo 的受约束 profile，不得照搬 bypass
语义：

| 上游概念 | VibeGo 映射 | 强制限制 |
| --- | --- | --- |
| `/permission-auto` | `workspace-coding` + `bounded-auto` + 可选 reviewer advisory | 只匹配 exact approval key；reviewer 只能收紧或转为 ask |
| `/permission-ask` | `explicit` | 每次高风险操作由现有 ApprovalBroker 处理 |
| `/permission-deny` | `none`/server deny | 不注册或拒绝副作用工具 |
| `/permission-yolo` | 不提供无条件等价物 | full-host 仍需 trusted、显式确认、session TTL、revoke、managed policy |
| `/sandbox-on` | `external-sandbox`/受限 workspace profile | sandbox 不可用时 blocked/degraded，禁止 host fallback |
| `/sandbox-off` | 仅可映射为已确认的 `danger-full-access` | 不适用于 untrusted task，不自动开 network，不绕过 Goal/quota |
| `/think-off`、`high`、`max` | `thinkingMode` snapshot | 只在 probe 宣称支持时生效 |

### 6.1 DeepSeek reviewer（advisory）

通用 reviewer 的生命周期、settings、ApprovalBroker 接入和 audit 由
[Spec 63](63-llm-assisted-approval-and-review.md) 负责；本规格只定义 DeepSeek 作为
reviewer provider 时的协议、输入边界和 capability 映射。若 Spec 63 与本规格冲突，
更严格的隐私、权限和 fail-closed 规则优先。

可实现一个独立的 `DeepSeekReviewProvider`，使用同一 DeepSeek credential 但不能复用
用户 run 的完整 transcript。review input 只能包含：

- 用户意图的 bounded summary；
- 工具 id/version、风险级别、workspace id、sandbox/network profile；
- 参数 fingerprint 和安全摘要；
- 不包含 key、环境变量、绝对路径、raw command、完整参数或工具输出。

reviewer 只能返回 `allow-advisory`、`ask`、`deny`、`unavailable` 和 bounded reason。
`allow-advisory` 不能放行 server deny、未知工具、untrusted host、network amendment、
full-host 未确认、Goal Gate/quota 阻塞或 Sandbox 不可用；reviewer 超时、模型错误或
结果不合法时默认 `ask` 或 `deny`，不能默认 allow。

## 7. Provider-owned Web Search

如果 DeepSeek endpoint 宣称提供 server-side `web_search`，它必须作为独立 capability
适配，而不是把远程搜索伪装成普通 shell/network：

- 默认关闭；启用前必须有 probe capability、network policy、approval 和 run snapshot；
- query、结果数量、响应字节、总耗时、redirect 和引用数量均有服务端上限；
- 搜索结果进入 ContextManager 时标记 `source='retrieval'`、`trust='untrusted'`，不
  能覆盖系统/开发者指令；
- raw page、cookie、Authorization、完整 provider response 不写入事件或 Web；
- 超时、429、5xx、取消、恶意内容和 provider 不可用都映射为 bounded degraded/error；
- web search 不改变 Goal admission，也不绕过 Scheduler、Approval、Sandbox 或 quota；
- 首期只支持 provider-owned retrieval；通用 `network.*`、浏览器自动化和任意 URL
  抓取另行遵循工具/MCP/Skill 规格。

## 8. Web 配置与用户体验

在现有 Settings drawer 中增加 DeepSeek provider card，不要求普通用户编辑 `.env`、
YAML 或 JSON：

1. 选择 `DeepSeek`、endpoint profile、model 和 thinking mode；
2. 输入一次性 API key 或选择 daemon secret reference；
3. 点击 Probe，展示 capability、revision、latency 和 safe error code；
4. 分别切换 tool calling、provider-owned web search 和 reviewer advisory；
5. 选择 `workspace-coding`/`full-host` 等既有 permission profile，页面明确显示
   哪些动作仍需 Approval、哪些能力被 blocked；
6. 运行中显示 immutable provider/thinking/tool/network snapshot；设置变化不影响进行中 run；
7. 提供“发送一条最小测试消息”入口，结果只显示状态、耗时、usage 和模型名，不显示
   key、raw response、完整 prompt 或绝对路径。

移动端、折叠屏和平板只改变布局，不改变 provider、权限或安全语义。

## 9. 错误与稳定映射

至少定义以下 stable error codes，并保证错误响应 safeDetails 不含 secret/path/raw body：

| 场景 | 错误码示例 | retryable |
| --- | --- | --- |
| missing credential | `DEEPSEEK_CREDENTIAL_REQUIRED` | false |
| endpoint/protocol mismatch | `DEEPSEEK_PROTOCOL_UNSUPPORTED` | false |
| model unavailable | `DEEPSEEK_MODEL_UNAVAILABLE` | false |
| auth/billing | `DEEPSEEK_HTTP_401` / `DEEPSEEK_HTTP_402` | false |
| invalid request/tool schema | `DEEPSEEK_HTTP_400` / `DEEPSEEK_TOOL_SCHEMA_UNSUPPORTED` | false |
| rate limit | `DEEPSEEK_HTTP_429` | bounded retry with Retry-After |
| provider 5xx | `DEEPSEEK_HTTP_5XX` | bounded retry before visible output |
| timeout/cancel | `DEEPSEEK_TIMEOUT` / `DEEPSEEK_CANCELLED` | caller controlled |
| disconnect/partial stream | `DEEPSEEK_STREAM_DISCONNECTED` | no transparent replay after output |
| malformed event | `DEEPSEEK_MALFORMED_EVENT` | false |
| context limit | `DEEPSEEK_CONTEXT_LIMIT` | false; user action required |
| thinking unsupported | `DEEPSEEK_THINKING_UNSUPPORTED` | false |
| reviewer unavailable | `DEEPSEEK_REVIEW_DEGRADED` | ask/deny fallback |
| web search unavailable | `DEEPSEEK_SEARCH_DEGRADED` | bounded fail-soft |

## 10. 测试与真实验收

### 10.1 Focused tests

先写 fixture，再写实现；至少覆盖：

- strict `deepseek-provider/v1` parsing、unknown field、secret-shaped/path/control text
  rejection and cross-field invariants；
- endpoint normalization：完整 path、OpenAI Chat、Responses、Anthropic profile 不串路由；
- SSE text/tool-call/usage/finish parsing、多个 call 聚合、duplicate call id 和 malformed JSON；
- thinking `off/auto/high/max` capability gating，private reasoning 不进入 event/Web；
- 429/5xx/401/402、Retry-After、timeout、AbortSignal、disconnect、partial output、
  context-limit 和 bounded error mapping；
- provider snapshot isolation、settings change only affects new runs、retry ledger no-op/conflict；
- multi-tool turn 的 approval/sandbox/workspace/scheduler boundaries；
- reviewer advisory 的 unavailable/invalid/allow/ask/deny 以及“不能扩大权限”测试；
- provider-owned web search 的 opt-in、bounded retrieval、untrusted ContextItem、取消和 fail-soft；
- recovery/retry 不重复执行旧 tool/reviewer/search call；
- Web settings 的 secret/path/raw-response-free render、probe、status、degraded 和 mobile layout。

### 10.2 Real DeepSeek smoke

增加独立的 `pnpm smoke:deepseek`（或扩展现有 `smoke:harness` 的显式 provider 模式），
只接受 `--endpoint`、`--model`、`--secret-env` 等 bounded 参数。它不能进入默认
`pnpm verify`，也不能把 key 写到命令行、仓库、事件或报告。

首个实现 slice 采用独立 `scripts/smoke-deepseek.mjs`：它直接调用已经构造好的
`DeepSeekProvider`，只负责 bounded text stream、首个可见 token/终态/usage、显式
AbortSignal 和 timeout 的 adapter evidence；不会创建第二个 daemon、scheduler 或
事件事实源。`--secret-env` 只传环境变量名，key 在进程内读取一次。fixture tests
通过注入 provider/fetch 覆盖 missing secret、HTTP/auth、partial stream、cancel、
timeout 和 malformed terminal；live 命令仍需用户显式提供 endpoint/model/secret-env，
报告不写 endpoint、prompt、headers、raw output、key 或绝对路径。完整 daemon →
RunManager → AgentLoop、tool/Approval/Sandbox、reviewer/search 和 governed evidence
仍需后续 61-6/Spec 60 evidence gate，不得用此 adapter smoke 冒充 harness 完成。

至少收集以下可重现证据：

1. DeepSeek text streaming：首 token、终态、usage、model snapshot；
2. `deepseek-v4-flash`（或当前用户选择模型）的 thinking `off` 与一个已 probe 的
   reasoning mode；
3. 经过 daemon → RunManager → AgentLoop → ContextManager 的 tool-call run，工具仍
   经过现有 Approval/Sandbox/Workspace 事实源；
4. provider reviewer advisory 的 allow/ask/degraded 路径；
5. provider-owned web search 仅在用户显式启用 network/search 时运行；
6. 显式取消、超时、部分输出断线和上下文过长的失败证据。真实负向测试必须使用
   bounded endpoint/额度，不能反复消耗用户额度；无法安全执行时保留 `blocked`，不以
   fake result 冒充 live evidence。

报告只能包含 `schemaVersion`、provider/model id、capability revision、status、稳定
错误码、bounded latency、token usage 和 event type counts。每个 live report 与 commit、
endpoint profile、配置 revision 和测试命令关联，但不保存 prompt、key、header、raw
response、完整参数或绝对路径。

## 11. 低资源与可扩展性约束

- 不常驻 Python、reviewer、search 或第二 scheduler 进程；所有 provider 请求使用 daemon
  已有 fetch/AbortSignal 和 bounded concurrency；
- SSE parser 使用流式 backpressure，不能先把整个 response 读入内存；
- reviewer 默认关闭，启用时共享现有模型并发/预算上限，不能产生无限递归 reviewer；
- tool/search/reasoning 输出受统一字节、token、turn、wall-time 和 cost 上限；
- provider-specific 字段只保留在 versioned adapter/config/snapshot，AgentLoop 不出现
  DeepSeek 分支；
- 新增依赖必须说明体积、许可证、Node 版本和退出原因；优先使用现有 Web Fetch/Node
  primitives，不引入完整 Python SDK。

## 12. 实施阶段

### 61-0：上游与现有实现复核

阅读 MinimumAgentLoop 的 README、`examples/minimal_agent.py`、
`examples/minimal_runtime.py`、依赖和许可证；建立“上游行为 → VibeGo contract →
不复用边界”矩阵。同步复核 Spec 03、07、08、44、47、48、54、58、59、60 和当前
`packages/model-openai`/`apps/daemon`，记录 endpoint、snapshot、secret 和 authority
差异。不得在 dirty worktree 中 reset/checkout/clean。该门禁的 pinned checkout、
许可证、读取文件、行为限制和 clean-room 映射已记录在
[`research/upstream-harness-implementations.md`](../research/upstream-harness-implementations.md)
与 [`ADR 0045`](../adr/0045-deepseek-provider-clean-room-boundary.md)；未复制源码、
prompt、依赖或运行时。

### 61-1：Contract 与 capability snapshot

实现 `deepseek-provider/v1` 配置、probe、capability、thinking、reviewer、search 和
stable error contracts；为 unknown model/protocol/secret/path/unknown field 编写拒绝测试。
当前先落地 Zod contract 和纯解析/隐私测试，不接入默认 run、AgentLoop、Web 或 provider
网络请求；contract 验收后再进入 61-2 protocol adapter。当前 checkpoint 已完成：
`packages/contracts/src/deepseek-provider.ts` 提供严格 config、capability、probe、
review、search、retry 和 stable error schemas，并由 `index.ts` 导出；focused
`deepseek-provider.test.ts` 覆盖 endpoint profile、unknown/secret/path 拒绝、
web-search gating、degraded 状态、review fingerprint 和 untrusted retrieval。该
checkpoint 不改变 AgentLoop、RunManager、Web、run_events/goal_events 或默认 provider。

### 61-2：Protocol adapter 与 streaming

实现 DeepSeek OpenAI Chat Completions adapter，随后实现有证据支撑的 Responses translator；
补齐 Anthropic profile 的显式边界、usage、tool-call aggregation、timeout、cancel、
retry/replay 和 error mapping。当前实现范围是独立 `packages/model-deepseek`：请求只接受
已校验的 complete endpoint 和运行时 credential，SSE 仅输出 canonical `ModelEvent`，
并在首个可见 delta 后禁止透明重试；不改 AgentLoop 或默认 provider binding。当前
checkpoint 已完成三种 profile 的请求/header 组装、Chat/Responses/Anthropic SSE
translator、稳定 tool-call ID、usage/finish/error 映射、取消和 partial-stream
no-replay；`packages/model-deepseek` focused tests 7/7、typecheck/build 通过，
`model-openai` 回归 19/19，仍未接入 daemon/AgentLoop。

### 61-3：AgentLoop/tool/context integration（checkpoint complete）

将 provider snapshot 接入现有 daemon application service；保持 AgentLoop 核心状态机、
Scheduler、Approval、Sandbox、WorkspaceRegistry 和 event authorities 不变。完成多调用
turn、ContextManager 回填、tool-call ledger、recovery no-replay 和 immutable snapshot。
当前先通过已有 `modelBindingForRun` seam 接入显式 DeepSeek env/provider 选择：binding
必须一次性捕获运行时 provider、generic `ModelProviderSnapshot` 和 secret-free
`DeepSeekRunSnapshot`，并由 AgentLoop 在 `run.created` 保存；设置切换只影响新 run，
interactive 默认 provider、Goal admission、Scheduler、Approval、Sandbox、Workspace
和 `run_events`/`goal_events` 权威保持不变。该 checkpoint 已通过 contracts、
adapter、AgentLoop 和 daemon model/run focused gates；不宣称已完成 Web、probe
或真实 provider evidence。

### 61-4：Thinking、reviewer 与 provider-owned search

先实现独立 `packages/model-deepseek` capability adapter 与 fixture：thinking
`high/max` 只有在 ready capability snapshot 明确声明 reasoning 时才允许；
`DeepSeekReviewProvider` 只接收严格、bounded、fingerprint 化的低风险请求，
返回 advisory `allow`/`ask`/`deny`/`unavailable`，并把 timeout、取消、4xx/5xx、
malformed JSON 和 fingerprint mismatch 映射为 fail-closed unavailable；它不
能放宽 deterministic policy。provider-owned search 只接受显式 Responses
capability、network-enabled 和 approval-ready gate，解析为 bounded
`source='retrieval'`、`trust='untrusted'` context item；不保存 raw page 或
完整 provider response。该阶段不改 AgentLoop 核心状态机、ApprovalBroker、
Scheduler、Sandbox、Goal 或 Web 设置，后续由 61-5/63 负责应用/UI wiring。

### 61-5：Web 设置与 onboarding

把 DeepSeek endpoint/model/thinking/tool/search/reviewer/probe/smoke 配置接入现有 Web
Settings；key 仍 write-only/daemon-owned，运行中显示 snapshot，移动端保持可操作。

本阶段的第一步采用独立的 `/api/v1/settings/deepseek` adapter，不改变既有
`/api/v1/settings/model` 的 OpenAI-compatible 输入 contract。daemon 只持久化
`deepseek/profile` 下的非 secret metadata；API key 只在 PATCH/POST 请求中接收，
保留在 daemon 进程内并在重启后回到 `credential-required`。GET、probe、run snapshot、
日志和事件都不得回显 key、Authorization、完整请求或绝对路径。配置写入使用严格的
versioned Zod contract 与 optimistic `expectedRevision`，配置变更只影响后续 run。

Probe 必须使用用户提供的完整 endpoint/profile，不在 adapter 内拼接隐藏路径；它是显式
用户动作，返回 bounded capability/status/error metadata。`high`/`max` thinking 仅在
ready capability 明确声明 reasoning 时可保存；provider-owned search 仍需 Responses
profile、network-enabled 和既有 Approval gate，reviewer 只保留 advisory 开关，不直接
接入 ApprovalBroker（该接入属于 Spec 63）。本阶段不新增 scheduler、权限 authority、
Goal admission 或 AgentLoop 分支。

61-5 的首个验收 slice 包括：contracts/manager/server/web focused tests、重启后的
非 secret settings 恢复、stale revision fail-closed、probe degraded 状态和现有
interactive run/provider 回归。真实 DeepSeek 消耗、reviewer/ApprovalBroker wiring
和 provider-owned live search 继续留在 61-6/Spec 63。

当前 checkpoint 已实现上述首个 slice：`DeepSeekSettingsProfile`/status contract、
daemon `InMemoryModelSettingsManager` 的 DeepSeek adapter、`GET/PATCH/DELETE
/api/v1/settings/deepseek` 与显式 `POST .../probe`、以及 Web Settings card。probe
只 POST 到用户提供的完整 endpoint，不自动补 `/models`；未声明 capability 时
`high`/`max` thinking 和 provider-owned search fail-closed。当前仅有 fixture
evidence，未宣称真实 DeepSeek/live search 或 Spec 63 reviewer authority 已完成。

### 61-6：真实 provider 与 Harness evidence

先落地 `smoke:deepseek` 的 adapter evidence 和红线测试；随后再把显式 DeepSeek
provider mode 接入现有 harness smoke，按本规格 10.2 执行真实 text、thinking、tool、
reviewer、search、cancel/timeout/context-limit evidence，并与 Spec 60 的 full
evidence bundle 关联。每一层必须单独标记 `fixture`/`live`/`blocked`，不能把 direct
adapter smoke 晋级为 daemon/harness readiness。

### 61-7：文档与 Spec 62 handoff

在实现/测试提交前更新 `README.md`、`README-zh.md`、`docs/implementation-status.md`、
`docs/roadmap.md` 的 DeepSeek 状态；只有当前代码和 evidence 允许的能力才能写成
Implemented。Spec 62 的 `62-0` 必须重新复核 Spec 01–61，不能使用旧的 Spec 61 audit
报告替代。

## 13. Definition of Done

Spec 61 只有在以下条件全部满足后才能标记 `Implemented`：

1. DeepSeek contracts、capability snapshot、OpenAI-compatible streaming、tool calls、
   thinking、错误、取消、重试和 usage 均有 focused tests；
2. Responses/Anthropic profile 的支持范围由 probe 和真实/fixture evidence 明确，未知
   协议 fail-closed；
3. DeepSeek run 经过现有 daemon → RunManager → AgentLoop → ContextManager，工具、
   approval、sandbox、workspace、scheduler 和 Goal authority 未被绕过；
4. reviewer 只能减少低风险重复打扰或转为 ask/deny，不能授权 host、network、untrusted、
   Gate、quota 或未知工具；
5. Web 能完成 provider 配置、probe、thinking/tool/search/reviewer 切换、最小 live smoke，
   不要求普通用户编辑配置文件且不泄露 secret；
6. 真实 DeepSeek text、reasoning、tool-call 和明确的失败/取消/上下文限制证据与当前
   commit 绑定；blocked/not-run 保持诚实，不用 fake provider 冒充；
7. `pnpm typecheck`、相关 focused module gates、`pnpm test`、`pnpm diff:check` 和
   `git diff --check` 通过；新增命令和报告均完成 privacy/path/link/fence 扫描；
8. 所有实质性代码修改前先同步本规格、implementation status、roadmap 和用户文档，
   每个阶段使用独立 Git commit；
9. Spec 62 的文档质量门禁已能引用 DeepSeek 的真实状态，但 Spec 61 完成不等于整个
   VibeGo 已完成公网发布，最终发布仍由 Spec 60/62 的整体门禁决定。

## 14. 不在本规格内

- 不复制 MinimumAgentLoop、Codex、LoopX、TencentDB 或任何上游完整实现；
- 不引入 Python runtime、`srt`、OpenAI Python SDK、第二 scheduler、第二 approval store
  或第二事件事实源；
- 不提供无需确认的 `/permission-yolo`、全主机永久机器人或绕过 Goal/quota/Gate/
  Approval/Sandbox 的 provider shortcut；
- 不把 DeepSeek web search 变成默认通用网络工具，不自动浏览网页、上传 workspace 或
  读取凭据；
- 不实现原生 Android/iOS/HarmonyOS client、Tailscale/SSH/ACME、安装包签名或完整
  release pipeline；这些仍由对应 Spec 管理；
- 不把 chain-of-thought、完整 transcript 或 raw provider response 作为产品数据保存。
