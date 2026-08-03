# 实施状态与第一条纵切

**状态：Accepted（Phase 1/2 实施基线，代码纵切已通过）**

## 当前实施范围

本阶段只实现可测试的核心数据和调度基础，不连接真实模型或执行任何主机命令：

1. `packages/contracts`：Run、Event、Scheduler、ModelProvider 的最小 TypeScript contracts、Zod schema 和状态机校验；
2. `packages/storage`：内存 EventStore（UUIDv7 event id、单 run seq、批量追加），用于确定性测试；SQLite adapter 在下一小步实现；
3. `packages/scheduler`：并发准入、workspace read/write lease、交互任务优先级、FIFO tie-break、取消和幂等资源释放；
4. `packages/testkit`：可中断、可延迟的 fake model provider 与事件类型投影断言；fake tool/clock 在后续 agent-loop 纵切补齐；
5. 每个包都有单元测试和 typecheck；根目录 `build` 会按 contracts → storage → scheduler → testkit 顺序构建，避免 workspace package export 在 clean checkout 下缺少 `dist` 类型。

## 验证结果（2026-08-03）

- `pnpm typecheck`：通过（4 个 package）；
- `pnpm test`：通过，13 个测试全部通过（contracts 3、storage 3、scheduler 5、testkit 2；Vitest 按 package 输出）；
- `pnpm diff:check`：通过；
- `pnpm-workspace.yaml` 显式允许 `esbuild` postinstall，安装时需要把 bundled Node 路径加入 `PATH`；这只影响本地依赖安装，不属于运行时资源依赖。

## 本阶段明确不做

- 不调用真实模型、网络、MCP、Skill 或 shell；
- 不修改用户 workspace、Git、系统设置或证书；
- 不实现 LAN/API/UI；
- 不把 `InMemoryEventStore` 当作生产持久化；
- 不把 fake model 的行为当作真实 provider 能力。
- 不把 `pnpm-workspace.yaml` 的 build-script allowlist 当作业务安全策略；生产 sandbox/approval 仍按安全 spec 实现。

## 进入下一步的门禁

- `pnpm typecheck` 通过；
- `pnpm test` 通过，覆盖合法/非法状态转移、并发排队、workspace lease、事件 seq、取消和资源释放；
- `pnpm diff:check` 或等价检查无 whitespace 错误；
- 文档中的实现状态、限制和命令与代码一致；
- 完成后单独 Git 提交，再讨论 SQLite adapter 与 daemon `/health`。
