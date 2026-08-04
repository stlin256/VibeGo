# 开源项目调研与借鉴边界

**状态：Accepted（调研快照，2026-08-03）**

本次调研使用浅克隆仓库进行结构阅读，目录位于本地 `.research/`，已被 `.gitignore` 排除。以下提交哈希是本次阅读的证据锚点；远端项目会变化，后续实现应重新核对上游文档和许可证。

## 快照清单

| 项目 | 快照 | 观察重点 | 可借鉴结论 | 不直接采用 |
| --- | --- | --- | --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | `bb5054fe47abe73ecbbd454751066a28c89f4bb9` | 本地 CLI、TS SDK、thread/stream/resume、工作目录和环境控制 | 将一次运行建模为可恢复 thread；事件流和结构化输出是 UI/自动化的稳定基础 | Codex Rust 实现、提示词、私有协议、品牌 UI |
| [OpenHands](https://github.com/All-Hands-AI/OpenHands) | `e0b115757b085d86ccbb16d1dc9f1b3ca8e9880b` | Agent Canvas、多个 agent backend、REST API、Docker sandbox | 前端控制中心与 agent server 分离；“无 sandbox 直接跑在主机”必须明确警告 | Agent Canvas 页面、后端协议、自动化服务实现 |
| [Aider](https://github.com/Aider-AI/aider) | `5dc9490bb35f9729ef2c95d00a19ccd30c26339c` | repo map、Git、watch、lint/test、云/本地模型 | coding agent 不应只会聊天；仓库摘要、diff、测试和 Git 状态应是一等上下文 | Python 代码、提示词和终端交互细节 |
| [Continue](https://github.com/continuedev/continue) | `5522c6f44ca0ac3528b37244818fbfa39b5af470` | core/context/tools/terminal-security、配置和 MCP 测试清单 | 包边界和“配置 reload、MCP、无遥测、工具模式”的测试项可作为 checklist | 该快照 README 标明仓库只读/不再积极维护，不作为运行时依赖 |
| [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) | `cc4b41617ce3601b1290d67216ea0b194a3cd9ac` | MCP v2、server/client、stdio/Streamable HTTP、Fastify 薄 middleware | 使用官方 SDK 做协议适配；业务策略仍由本项目 Tool Registry 和 Approval Policy 负责 | 不把 MCP server 的任意工具视为可信；不把 middleware 当安全边界 |

## 关键证据摘要

### OpenAI Codex

- `sdk/typescript/README.md` 描述 SDK 通过 stdin/stdout JSONL 驱动 CLI，并提供 `Thread`、`runStreamed()`、结构化输出、恢复已有 thread、工作目录 Git 检查和受控环境变量。
- 这支持本项目的“run + append-only event + resume”模型，但实现会使用自己的 contracts 和 Node API，而非复制 SDK。
- 本次快照还包含 `codex-rs/app-server-protocol/schema/typescript/v2/AskForApproval.ts`、`SandboxPolicy.ts`、`CommandExecutionApprovalDecision.ts` 和 `NetworkApprovalContext.ts`：可见的设计要点是 `untrusted/on-request/granular/never`、`read-only/workspace-write/external-sandbox/danger-full-access`、一次/会话/追加规则/网络规则/拒绝/取消等明确决策。`codex-rs/core/src/tools/sandboxing.rs` 的会话 key 缓存和 denied-read 保留逻辑、`codex-rs/execpolicy/README.md` 的 allow/prompt/forbidden prefix rule 与 match/not_match 自测，已转化为本项目 Spec 01 的独立合约。

### OpenHands

- README 将 Agent Canvas 描述为自托管控制中心，可连接多个 agent backend；同时特别警告无 sandbox 模式会让 agent 直接拥有主机文件权限。
- 本项目因此将沙箱强度作为可见配置，不允许 UI 把 host-restricted 误标成强隔离。

### Aider

- README 将 repo map、Git integration、watch、lint/test 作为核心功能，而不是事后插件。
- 本项目把 Git 状态、diff、测试结果纳入工具和上下文接口；但不会默认执行项目自己的测试命令，仍需策略批准。

### Continue

- 当前 README 明确标记仓库只读/不再积极维护，因此只借鉴模块命名和测试 checklist，不引入它的依赖。
- `TESTING.md` 中“配置加载、配置 reload、MCP 连接、无遥测网络请求、agent tools”这些验收项被转化为本项目的测试策略条目。

### MCP TypeScript SDK

- 当前 README 标明 v2 对应 2026-07-28 规范，提供 Node/Bun/Deno、stdio 和 Streamable HTTP，以及 Fastify 等薄适配包。
- 本项目的 MCP 包只负责协议连接、schema 验证、取消和断连；工具风险、secret 过滤、路径范围和审批仍必须经过本项目统一策略。

## 设计结论

1. **核心不是聊天框**：需要 thread/run 状态、上下文预算、工具事件、diff、测试和恢复。
2. **前后端要可独立演进**：UI 只消费版本化事件，不读取 daemon 内部对象。
3. **安全边界必须显式**：模型输出不等于授权；sandbox 和 approval 是执行前门禁。
4. **协议适配与业务策略分离**：MCP、OpenAI-compatible 等都是 transport/provider，不是可信能力。
5. **借鉴行为而非复制实现**：保留出处、提交哈希和许可证备注；实现代码应由本仓库独立编写。

## 许可证与发布注意

在真正引入任何第三方代码、schema 或依赖前，必须单独做许可证审查并把 NOTICE/许可证文件加入发布物。本次仅阅读代码结构，没有将这些仓库的代码复制到产品源码，也没有把它们作为运行时依赖。

## Provider/Token/费用调研入口（Spec 44）

Spec 43/44 需要对 CC Switch、AxonHub、LiteLLM、Langfuse 和 OpenTelemetry 做一次
固定 commit 的二次核对。可借鉴内容包括 token/cache 语义、稳定 ID 去重、pricing revision、
cost item、TTFT/latency、rollup/prune 和 projection 筛选体验；不引入完整 proxy、Tauri、
Python runtime、CLI session 扫描或外部常驻服务。

本次新增的研究记录模板见
[`research/upstream-provider-usage.md`](research/upstream-provider-usage.md)，实现 Agent
的逐步提示词见
[`prompts/44-provider-usage-management-implementation.md`](prompts/44-provider-usage-management-implementation.md)。
模板要求记录 URL、pinned commit、读取路径、许可证/NOTICE、设计借鉴与复用决定。没有这些
证据时只能 clean-room 重实现，不能复制代码；用户提到的 `axonhub/ccswitch` 也必须先确认
canonical repository。

## Harness 全链路调研入口（Specs 47–51）

Codex、OpenHands、Aider、Goose、MCP TypeScript SDK、LiteLLM、Langfuse、Continue 和
OpenTelemetry 的 pinned checkout、文件级观察、能力矩阵与 clean-room 约束已经独立记录在
[`research/upstream-harness-implementations.md`](research/upstream-harness-implementations.md)。
后续开发 Agent 必须先读取该报告，再按 [ADR 0016](adr/0016-clean-room-harness-productionization.md)
和 Specs 47–51 的 R0 门禁推进。该报告不会把临时 clone、上游 prompt、schema、UI、proxy、
scheduler 或运行时带入 ready4vibe。
