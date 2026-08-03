# 实施状态与第一条纵切

**状态：Accepted（Phase 1/2 实施基线）**

## 当前实施范围

本阶段只实现可测试的核心数据和调度基础，不连接真实模型或执行任何主机命令：

1. `packages/contracts`：Run、Event、Scheduler、ModelProvider 的最小 TypeScript contracts 和 Zod schema；
2. `packages/storage`：内存 EventStore，用于确定性测试；SQLite adapter 在下一小步实现；
3. `packages/scheduler`：并发准入、workspace read/write lease、FIFO 队列、取消和资源释放；
4. `packages/testkit`：fake model、fake tool、fake clock、event assertions；
5. 每个包有单元测试和 typecheck，根目录有统一命令。

## 本阶段明确不做

- 不调用真实模型、网络、MCP、Skill 或 shell；
- 不修改用户 workspace、Git、系统设置或证书；
- 不实现 LAN/API/UI；
- 不把 `InMemoryEventStore` 当作生产持久化；
- 不把 fake model 的行为当作真实 provider 能力。

## 进入下一步的门禁

- `pnpm typecheck` 通过；
- `pnpm test` 通过，覆盖合法/非法状态转移、并发排队、workspace lease、事件 seq、取消和资源释放；
- `pnpm diff:check` 或等价检查无 whitespace 错误；
- 文档中的实现状态、限制和命令与代码一致；
- 完成后单独 Git 提交，再讨论 SQLite adapter 与 daemon `/health`。

