# 实施状态与第一条纵切

**状态：Accepted（Phase 1/2 实施基线，sandbox/execution 纵切已通过）**

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
12. 每个包都有单元测试和 typecheck；根目录 `build` 会按 contracts → storage → scheduler → testkit → context → agent → model-openai → tools → policy → sandbox → execution → daemon 顺序构建，避免 workspace package export 在 clean checkout 下缺少 `dist` 类型。

## 验证结果（2026-08-03）

- `pnpm typecheck`：通过（12 个 workspace package）；
- `pnpm test`：通过，66 个测试全部通过（contracts 3、storage 6、scheduler 5、testkit 2、agent 9、context 5、model-openai 4、tools 4、policy 7、sandbox 6、execution 7、daemon 8；Vitest 按 package 输出）；
- `pnpm diff:check`：通过；
- `pnpm-workspace.yaml` 显式允许 `esbuild` postinstall，安装时需要把 bundled Node 路径加入 `PATH`；这只影响本地依赖安装，不属于运行时资源依赖。
- Node 22 会对 `node:sqlite` 输出 ExperimentalWarning；MVP 选择它是为了避免 native addon 和常驻数据库服务，后续可按 Node LTS 稳定性评估 adapter 替换。

## 本阶段明确不做

- 不调用真实模型、网络、MCP、Skill 或 shell；
- 不修改用户 workspace、Git、系统设置或证书；
- 不实现 LAN/API/UI；
- 不把 `InMemoryEventStore` 当作生产持久化；
- 不把 `/health` 当作认证、LAN、模型或 sandbox 可用性证明；
- 不把 fake model 的行为当作真实 provider 能力。
- fake loop 目前只执行单 turn 且 `tools` 为空；不会执行 shell/filesystem/Git，也没有上下文压缩或审批等待态。
- run API/SSE 当前只绑定 loopback，未接入认证、LAN HTTPS、ContextManager 或真实 model provider。
- 默认仍不发起真实请求；只有显式设置 `READY4VIBE_MODEL_API_KEY` 才启用外部 provider。key 只在进程内存中使用，不能进入仓库或 API 响应。
- ToolRegistry/ApprovalPolicy 目前只做元数据和判定，不执行任何真实 tool；sandbox provider 已实现 verifier/resolver，真实 Docker/Podman/VM 执行器后置。
- 不把 `pnpm-workspace.yaml` 的 build-script allowlist 当作业务安全策略；生产 sandbox/approval 仍按安全 spec 实现。

## 进入下一步的门禁

- `pnpm typecheck` 通过；
- `pnpm test` 通过，覆盖合法/非法状态转移、并发排队、workspace lease、事件 seq、取消和资源释放；
- `pnpm diff:check` 或等价检查无 whitespace 错误；
- 文档中的实现状态、限制和命令与代码一致；
- 完成后单独 Git 提交，再进入 shell/filesystem adapter、external sandbox runtime 与认证门禁。
