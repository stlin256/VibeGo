# 实施状态与第一条纵切

**状态：Accepted（Phase 1/2 实施基线，Web/PWA、LAN TLS、Skill/MCP manifest、Sandbox runtime plan 与 CLI runner MVP 已通过）**

## 当前实施范围

本阶段只实现可测试的核心数据和调度基础，不连接真实模型或执行任何主机命令：

1. `packages/contracts`：Run、Event、Scheduler、ModelProvider 的最小 TypeScript contracts、Zod schema 和状态机校验；
2. `packages/storage`：内存 EventStore 与基于 Node `node:sqlite` 的 SQLite EventStore（UUIDv7 event id、单 run seq、批量追加/事务回滚、close/reopen）；
3. `packages/scheduler`：并发准入、workspace read/write lease、交互任务优先级、FIFO tie-break、取消和幂等资源释放；
4. `packages/testkit`：可中断、可延迟的 fake model provider 与事件类型投影断言；fake tool/clock 在后续 agent-loop 纵切补齐；
5. `apps/daemon`：只绑定 loopback 的最小 Node HTTP server，提供 `/health` 和 `/api/v1/health`，组合根启动时使用 SQLite EventStore；
6. `packages/agent`：fake-model 单 turn orchestrator（生命周期事件、scheduler lease、取消、失败和输出上限），不执行真实工具；
7. `apps/daemon`：run manager、`POST/GET/cancel` API 和按 seq 回放/订阅的 SSE 已按 `docs/specs/06-run-api-sse.md` 实现；
8. `packages/context` 与 `packages/model-openai`：ContextManager 和 OpenAI-compatible provider 已按 `docs/specs/07-model-context.md` 实现并使用 mock fetch 测试；
9. AgentLoop 上下文接入和 daemon 环境模型配置已按 `docs/specs/08-agent-model-integration.md` 实现；
10. `packages/policy` 与 `packages/tools`：ToolRegistry、风险元数据和确定性 ApprovalPolicy 已按 `docs/specs/09-tool-policy.md` 实现；
11. `packages/sandbox` 与 `packages/execution`：external sandbox resolver、PathGuard、ArgvGuard 已按 `docs/specs/10-sandbox-execution.md` 实现；MVP 只做 verifier/输入校验，不启动真实容器或进程；
12. `packages/tool-adapters`：filesystem/shell handler 与统一 ToolExecutor 已按 `docs/specs/11-tool-adapters.md` 实现；默认不启动主机进程；
13. `packages/auth` 与 daemon transport gate：已按 `docs/specs/12-auth-transport.md` 实现单用户 pairing/token 和 LAN/TLS 门禁；证书/ACME adapter 后置；
14. `apps/web`：已按 `docs/specs/13-web-pwa.md` 完成 React/TypeScript responsive run console MVP，包含 pairing、Bearer/CSRF、run composer、run console、cancel 和 fetch-based SSE resume；
15. `packages/certificates` 与 daemon HTTPS listener 已按 `docs/specs/14-certificates-tls.md` 实现环境变量解析、PEM 读取/校验、LAN 默认 TLS fail-closed 和 HTTP/HTTPS health 标识；
16. `packages/skill-mcp` 已按 `docs/specs/15-skill-mcp-manifests.md` 实现严格 Skill/MCP manifest 解析、stdio/HTTP transport 边界、secret-safe 检查和默认 deny 工具投影；不启动子进程或网络；
17. `packages/sandbox-runtime` 已按 `docs/specs/16-sandbox-runtime.md` 实现 Docker/Podman argv 计划、digest 镜像策略、网络/资源/挂载限制和无 runner fail-closed；不启动主机进程；
18. `packages/sandbox-runtime` 已按 `docs/specs/17-sandbox-cli-runner.md` 实现显式注入的 Docker/Podman CLI runner：shell:false、最小 env、timeout/abort、output cap 和稳定启动错误；daemon 默认不 wiring；
19. `packages/skill-mcp` 已按 `docs/specs/19-mcp-transport-boundary.md` 实现注入式 one-shot JSON-RPC channel：allowlist、env key、消息大小、timeout、取消、response id 和 close-on-error 均 fail-closed；不启动子进程或网络；
20. `packages/tool-adapters` 正在实现 `ToolExecutorRuntime` bridge：workspace root、ToolIntent 和 SandboxResolveRequest 均为显式回调，实际执行仍统一经过 ToolExecutor；daemon 默认不创建 bridge；
21. 每个包/应用都有单元测试和 typecheck；根目录 `build` 会按 contracts → storage → scheduler → testkit → context → agent → model-openai → tools → policy → sandbox → execution → sandbox-runtime → tool-adapters → auth → certificates → skill-mcp → daemon → web 顺序构建，避免 workspace package export 在 clean checkout 下缺少 `dist` 类型。

## 验证结果（2026-08-03）

- `pnpm typecheck`：通过（18 个 workspace package）；
- `pnpm test`：通过，121 个测试全部通过（contracts 3、storage 6、scheduler 5、testkit 2、agent 13、context 5、model-openai 4、tools 4、policy 7、sandbox 6、execution 7、sandbox-runtime 9、tool-adapters 12、auth 5、certificates 3、skill-mcp 10、daemon 15、web 5；Vitest 按 package 输出）；
- `pnpm --filter @ready4vibe/web build`：通过，Vite 产物约 203 kB（gzip JS/CSS 约 65 kB），未发起真实模型请求；
- `pnpm diff:check`：通过；
- `pnpm-workspace.yaml` 显式允许 `esbuild` postinstall，安装时需要把 bundled Node 路径加入 `PATH`；这只影响本地依赖安装，不属于运行时资源依赖。
- Node 22 会对 `node:sqlite` 输出 ExperimentalWarning；MVP 选择它是为了避免 native addon 和常驻数据库服务，后续可按 Node LTS 稳定性评估 adapter 替换。

## 本阶段明确不做

- 不调用真实模型、网络、MCP、Skill 或 shell；
- 不修改用户 workspace、Git、系统设置或证书；
- 不实现 ACME 自动签发、Windows 证书存储、VM runtime、MCP/Skill 外部连接或完整审批/diff UI；Sandbox runtime 已提供显式注入的 CLI runner，但 daemon 默认不 wiring、不自动启动容器；Web/PWA MVP 已提供 API/SSE 控制台，但仍不替代 daemon 安全边界；
- 不把 `InMemoryEventStore` 当作生产持久化；
- 不把 `/health` 当作认证、LAN、模型或 sandbox 可用性证明；
- 不把 fake model 的行为当作真实 provider 能力。
- fake loop 目前只执行单 turn 且 `tools` 为空；不会执行 shell/filesystem/Git，也没有上下文压缩或审批等待态。
- run API/SSE 已接入单用户 pairing/token、CSRF 和 LAN/TLS transport gate；HTTPS listener 与证书文件校验已 wiring，默认仍为 loopback，ACME/公网部署尚未 wiring。
- 默认仍不发起真实请求；只有显式设置 `READY4VIBE_MODEL_API_KEY` 才启用外部 provider。key 只在进程内存中使用，不能进入仓库或 API 响应。
- ToolRegistry/ApprovalPolicy 目前只做元数据和判定，不执行任何真实 tool；sandbox provider 已实现 verifier/resolver，真实 Docker/Podman/VM 执行器后置；tool-adapters 只在显式注入 runner/filesystem 时执行。AgentLoop/RunManager 现在接受显式 ToolRuntime，但 daemon 默认仍不注入 runtime；auth gate 与 TLS certificate loader 已接入 daemon，ACME adapter 和公网部署后置。
- Spec 18 已落地：默认无工具；显式 runtime 的 tool-call 会经过 runtime 的 ToolExecutor 边界，并写入请求、审批、执行和输出事件；参数、轮次、工具调用数和 scheduler toolProcesses 均受限。真实 ToolExecutor runtime 的 workspace/intent 工厂和审批续接 API 后续实现。
- Spec 19 已定义 MCP transport boundary，下一步实现注入式 one-shot JSON-RPC channel；本阶段不启动子进程、不访问网络，生产 channel 仍必须后置接入 sandbox、approval 和 scheduler。
- 不把 `pnpm-workspace.yaml` 的 build-script allowlist 当作业务安全策略；生产 sandbox/approval 仍按安全 spec 实现。

## 进入下一步的门禁

- `pnpm typecheck` 通过；
- `pnpm test` 通过，覆盖合法/非法状态转移、并发排队、workspace lease、事件 seq、取消和资源释放；
- `pnpm diff:check` 或等价检查无 whitespace 错误；
- 文档中的实现状态、限制和命令与代码一致；
- 完成后单独 Git 提交，再进入 ACME/certificate manager adapter、external sandbox runtime 与 Web UI 的 diff/log/approval 深化。
