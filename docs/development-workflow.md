# 分步开发、文档同步与 Git 提交流程

**状态：Accepted（文档阶段）**

用户要求“每次实质性修改，在 Git 提交之前更新对应文档”。本流程把它变成强制门禁。

## 一个模块的标准循环

1. **讨论**：确认目标、非目标、信任边界、依赖、资源目标和验收例子。
2. **写文档**：更新对应 ADR/模块合约/API/测试策略，标注状态和未决项。
3. **写失败测试**：先加入最小 failing unit/contract test 或 fixture。
4. **实现**：只在该模块和必要的 adapter 内修改；不要顺手重构其他包。
5. **验证**：内循环使用 `pnpm check:module -- <package>` 运行选中包的依赖闭包构建、typecheck 和 tests；跨包接口变更补充受影响包；提交前再运行完整 `pnpm verify`，需要时跑集成/E2E/benchmark。
6. **更新文档**：把实际行为、限制、测量值和命令写回文档；若设计变化，新增/更新 ADR。
7. **审查 diff**：检查 secret、越权、依赖膨胀、事件兼容性和文档链接。
8. **提交**：一个逻辑变更一个小提交，提交信息说明模块和行为。

## 提交前清单

- [ ] 对应文档已先于代码修改并与最终行为一致；
- [ ] 公共 schema/API/event 变更已更新 `packages/contracts` 计划和 contract tests；
- [ ] 新增工具已有风险等级、最小 capability、审计字段和安全测试；
- [ ] 单元测试包含至少一个失败路径、取消/超时或边界路径；
- [ ] 未把测试 key、源码、事件 payload 或 `.env` 加入提交；
- [ ] 低资源目标有测量或明确标注为未测量；
- [ ] `git diff --check`、typecheck、lint、相关测试均通过；
- [ ] 变更未越过当前路线图阶段的非目标。

## 提交粒度与示例

推荐顺序：

```text
docs: define run/event contracts
feat(contracts): add versioned run and event schemas
test(harness): cover cancellation and approval wait
feat(harness): implement deterministic run loop
docs(api): document SSE resume behavior
feat(api): expose run creation and event stream
```

提交之间必须可构建或明确标注“文档/测试先行”。禁止把“重构、换库、增加功能、修格式”混成一个不可回滚的大提交。

## 版本与发布

- 早期使用 `0.x`，API/event 仍可能通过显式 v1→v2 迁移变化；
- 每个 release 生成变更日志、依赖清单、测试矩阵、sandbox 限制和性能报告；
- 发布前重新核对开源依赖许可证与上游安全公告；
- 不因“模型能跑”跳过安全测试、文档同步或远程认证验收。
