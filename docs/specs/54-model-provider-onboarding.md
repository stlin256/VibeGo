# Spec 54：本地模型与云模型配置向导

- Status: Phase 0/1/2/3/4 implemented（strict contracts + bounded probe + authenticated daemon route + Web Settings probe control + durable non-secret endpoint profile；provider/run behavior remains unchanged）
- Date: 2026-08-04
- Related: [Spec 28](28-model-provider-onboarding.md)、[Spec 47](47-model-context-agent-loop-productionization.md)、[Spec 52](52-capability-profiles-and-first-run-experience.md)、[研究记录](../research/53-57-release-install-model-operations-research.md)

## 1. 目标

让用户通过 Web 向导完成本地模型、云模型和 OpenAI-compatible endpoint 的配置，不再手动
编辑 `.env`、YAML 或 JSON。向导必须把“配置已保存”“endpoint 可达”“模型可调用”“模型
支持 tool call/streaming”区分开，任何一项失败都显示可操作的 degraded/blocked 原因。

本规格只定义 provider onboarding 和 run snapshot，不重写 AgentLoop、ContextManager、
Approval、Scheduler、Sandbox 或 `run_events` 的权威地位。

## 2. Provider 分类

### 2.1 Local

首发向导提供以下预置：

- **Ollama**：默认探测 loopback `http://localhost:11434`，可读取 bounded model list；
- **LM Studio**：默认探测 loopback server，支持其 REST/OpenAI-compatible/Anthropic-compatible
  endpoint；
- **llama.cpp server**：作为 OpenAI-compatible local endpoint，必须由用户显式启动和提供地址；
- **Custom local endpoint**：只允许用户显式输入，默认限制为 loopback 或已登记的 LAN 地址。

本地 provider 的探测不得自动下载、加载或卸载模型。模型下载、量化选择、GPU offload、
context size 和并发设置都是显式二次确认动作，并显示预计磁盘/内存开销。

### 2.2 Cloud

首发向导提供：

- OpenAI-compatible endpoint；
- Anthropic Messages endpoint；
- DeepSeek 的 OpenAI-compatible 和 Anthropic-compatible endpoint，路径必须显式配置；
- Generic cloud endpoint 仅作为 advanced path，并受 endpoint、TLS、Origin/SSRF 和 network
  policy 限制。

Provider descriptor 不得把所有 base URL 隐式拼成 `/chat/completions`；协议、路径、认证
header、streaming 和 tool-call 能力必须是显式字段。

## 3. 配置向导

### 3.1 用户旅程

1. **选择模型来源**：Local 或 Cloud，并解释数据是否离开主机。
2. **选择 provider**：预置卡片显示维护状态、默认协议、认证要求和资源提示。
3. **填写 endpoint**：默认值可编辑；UI 不保存 secret，也不回显完整 URL query token。
4. **填写认证引用**：用户在受保护的 secret control 中输入 key/token；浏览器只收到
   `credentialRef` 和状态，不收到明文。
5. **探测**：执行 bounded health/model-list probe，不发送用户 prompt，不产生 run/event。
6. **选择 model**：显示 model id、context limit、stream/tool/vision/embedding 能力；
   未知能力显示 `unknown`，不伪造 `true`。
7. **可选测试请求**：用户明确点击后发送一条固定、无 workspace 内容的短 prompt；输出只
   返回 redacted status/latency/usage，不持久化完整请求和响应。
8. **保存 profile**：生成非 secret profile，下一次新 run 才可使用；当前运行中的 run
   保持原 provider snapshot。

### 3.2 错误与降级

稳定错误码至少包括：

```text
provider_unreachable | tls_invalid | auth_rejected | model_not_found |
protocol_mismatch | streaming_unsupported | tool_call_unsupported |
context_limit_unknown | rate_limited | quota_unknown | local_runtime_missing |
model_download_required | credential_store_unavailable
```

错误响应不得包含 API key、Authorization header、原始 provider response、完整 prompt、
绝对路径或本地环境变量。Provider outage 不得变成 Web 500，也不得覆盖原始 run/model error。

## 4. Versioned contracts

实现阶段在 `packages/contracts` 增加：

- `ModelProviderKind`：`local | cloud | custom`；
- `ModelProviderDescriptor`：协议、endpoint、认证方式、能力上限和维护元数据；
- `ModelEndpointProfile`：用户意图和非 secret 配置；
- `CredentialRef`：OS keychain/secret provider/env reference 的不透明引用；
- `ModelCapabilitySnapshot`：模型 id、context/tool/stream/vision 能力及 `unknown` 语义；
- `ModelProbeResult`：bounded status、latency、revision、error code；
- `ModelSetupSession`：向导步骤、过期时间和 CSRF-bound nonce。

所有 contract 拒绝未知字段、API key/token、private key、完整环境 map、绝对路径、query
secret 和超长值。`ModelProviderSnapshot` 在 `run.created` 前冻结，设置切换只影响新 run。

### Phase 0 implementation boundary (2026-08-05)

`@ready4vibe/contracts` now freezes the descriptor/profile/credential,
capability, probe and setup-session shapes. These contracts describe user
intent and bounded status only; they do not read a keychain, call a provider,
download a model, change `ModelProvider`, or alter `AgentLoop`. Existing Spec
28 Web/provider behavior remains the authority until a later adapter phase
passes its own tests. Four focused contract tests cover secret/query/path
rejection, unknown capability semantics, bounded probe outcomes and hashed
setup nonces.

### Phase 1 implementation update (2026-08-05)

The first adapter is an explicit OpenAI-compatible model-list probe. It accepts
one complete endpoint (for example the user-selected DeepSeek `/models` URL),
uses the in-process credential only for the request header, sends no prompt and
does not append a hidden path. Response bytes, model ids, timeout and status
codes are bounded; raw upstream bodies, headers and credentials are never
returned. A probe result is advisory and does not configure a provider, create
a run, write an event, download a model or change an in-flight snapshot. Three
focused adapter tests cover exact endpoint/header behavior, stable HTTP/schema
mapping, model-not-found and response/option bounds.

### Phase 2 implementation update (2026-08-05)

The daemon exposes the probe only as an authenticated, explicit `POST` action.
The request contains a complete endpoint and bounded timeout; it never accepts
an API key, credential value, prompt, workspace path or arbitrary headers. The
manager reads the already configured in-process credential for one request and
returns the versioned result, while settings status, provider selection,
AgentLoop, RunManager, Scheduler, Approval, Sandbox and event stores remain
unchanged. A missing provider or probe failure is a bounded result, not a Web
500 and not a replacement provider. Daemon/model settings fixtures cover
unknown-field rejection, credential-free request bodies, secret-free results,
missing credentials and provider snapshot preservation.

### Phase 3 implementation update (2026-08-05)

The existing conversation-first Settings drawer adds one model-list endpoint
field and an explicit Probe button. It renders only the versioned status,
stable error code and bounded capability summary; it never renders a key,
Authorization header, raw upstream body or a stored probe response. Probe state
is in Web memory only, is non-blocking for run creation, and remains separate
from provider configuration and in-flight run snapshots.
Focused Web tests cover the API request shape, bounded status rendering and
privacy-safe knowledge-card projection; Web typecheck passes. The control is
advisory and remains outside provider persistence and run admission.

### Phase 4 implementation update (2026-08-05)

`@ready4vibe/contracts` now defines a versioned `ModelSettingsProfile` that
contains only the provider id, HTTPS endpoint, model hint, profile revision and
timestamp. `apps/daemon` persists that profile through the existing
`SettingsStore` under `daemon_settings`; the API key remains process-memory or
environment supplied and is never written to SQLite.

On daemon restart, a saved profile is restored as an explicit
`durable-profile`/`credential-required` status. The endpoint and model hint can
populate the Web setup form, but new runs remain fail-closed until the user
provides a credential again. Configure persists the profile before swapping
the provider, and clear deletes the profile before removing the active key, so
a persistence failure cannot silently change runtime state. Existing runs keep
their provider snapshot; settings changes affect only later runs.

Focused contract, daemon settings-store and restart fixtures cover profile
privacy/URL bounds, missing credentials, persistence failure, clear/reload and
provider snapshot isolation. No model request, run/event, AgentLoop,
Scheduler, Approval, Sandbox or WorkspaceRegistry authority changes in this
phase.

## 5. Credential 与隐私边界

1. 优先使用 Windows Credential Manager、macOS Keychain、Linux Secret Service/libsecret 或
   注入式 secret provider。
2. 没有安全存储时，默认不能保存 credential；只允许本次进程内显式使用，或显示阻塞原因。
3. 浏览器 memory/localStorage、SQLite settings、run/goal events、logs、screenshots、
   backup manifest 和 diagnostic bundle 均不得保存明文 credential。
4. Provider adapter 仅能读取与当前 run/provider snapshot 匹配的 secret reference。
5. Probe、retry、fallback 和 cancellation 都必须清除 header/body 临时缓冲，并保留 bounded
   状态，而非原始响应。

## 6. 本地模型资源指导

向导可显示用户主动提供的机器资源估计和 provider 报告，但不得扫描完整 workspace 或启动
高负载 benchmark。推荐规则：

- 模型大小、context limit、GPU/CPU/内存要求未知时显示 `unknown`；
- 预估不足只显示 warning，不自动修改模型参数；
- 下载模型前显示大小、来源、digest、许可证和可用磁盘估计；
- 下载支持取消、断点和完整性校验，但不得在首次打开 Web 时自动拉取模型；
- local runtime 不可用时可继续使用 preview profile 和云 provider，不得 host fallback。

## 7. 与 AgentLoop 的接入

- provider selection 由 daemon application service 完成，模型协议转换继续使用显式 adapter；
- AgentLoop 核心状态机不修改；每个 run 绑定 provider、model、credentialRef、policy、
  context limit 和 endpoint revision 的 secret-free snapshot；
- provider switching、credential rotation、model download 和 settings refresh 不改变
  已运行 run；
- ordinary interactive run 不受 Goal quota 静默拦截，governed run 仍走 Spec 52 的显式 admission；
- model failure、tool/approval failure、observability failure 保持各自 error identity。

## 8. 测试与验收

- Ollama、LM Studio、llama.cpp 和 cloud mock server 的 health/list/chat/stream/tool-call
  fixtures；
- malformed JSON、错误协议路径、401/403/429/5xx、超时、取消、部分流和 provider fallback；
- secret/path/privacy scanner 拒绝测试，确认 key 不进入浏览器、settings、event、log、backup；
- 运行中切换 provider 不影响已有 snapshot；重启可恢复非 secret profile；
- local runtime 缺失、模型未下载、context/tool capability unknown 的 degraded UI；
- 下载/加载模型必须显式确认、可取消、digest 校验且不修改 workspace；
- `pnpm smoke:model` 仅在 release review 中显式调用，凭据从进程外注入，输出脱敏报告；
- 受影响模块测试、`pnpm typecheck`、`pnpm verify`、`pnpm diff:check` 和 `git diff --check`。

## 9. 明确不做

- 不 vendor Ollama、LM Studio、llama.cpp 或任何云 provider SDK/runtime；
- 不把 provider proxy 变成新的执行权威或第二套 retry/scheduler；
- 不自动注册任意 endpoint、MCP server、network tool 或 host shell；
- 不承诺所有模型均支持 tool call、vision、structured output 或完整 token accounting；
- 不把探测成功误报为模型可用，或把 unknown usage 伪造为 0。
