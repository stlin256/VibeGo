# ready4vibe 文档索引

## 目标读者

- 产品/架构：先读 `product-brief.md`、`architecture.md`、`roadmap.md`；
- 后端与 harness：读 `harness-contracts.md`、`api-contract.md`、`adr/0002-security-defaults.md`、`adr/0003-lan-access-and-codex-like-approval.md`、`specs/01-sandbox-approval.md`；
- 运行状态与事件：读 `specs/02-run-event-contract.md`；
- 模型与上下文：读 `specs/03-model-context-contract.md`；
- 长期目标与 LoopX 整合：先读 [`specs/34-goal-control-plane-loopx-integration.md`](specs/34-goal-control-plane-loopx-integration.md)，再读 [`adr/0004-native-goal-control-and-loopx-interop.md`](adr/0004-native-goal-control-and-loopx-interop.md)；
- Web 开发：读 `web-ux.md`、`api-contract.md`；
- 贡献者：读 `testing-strategy.md`、`development-workflow.md`；
- 调研复核：读 `open-source-research.md`。

## 文档状态标记

- `Draft`：提出方案，尚未被实现验证；
- `Accepted`：作为当前实现依据；
- `Implemented`：已有代码与测试；
- `Superseded`：被新的 ADR 或合约替代。

除明确标记为 `Draft` 的规格外，当前文档是 `Accepted` 设计基线；具体实现进度以
[`implementation-status.md`](implementation-status.md) 为准。实现过程中若发现约束
不成立，必须先更新文档并提交，再修改代码。

## 规范

- 所有公共 API、事件、工具和配置均使用版本号；
- 文档中的“必须/不得”是实现门禁，不是建议；
- 性能数字是目标值或测量值，除非有测量记录，不得写成已达成事实；
- 调研资料只提取设计启发，不复制源项目代码、私有协议或品牌界面。

## 当前设计与实施

- [Spec 34：长期目标控制层与 LoopX 思路整合](specs/34-goal-control-plane-loopx-integration.md)：Phase 0 已实现原生 TypeScript contracts、纯 reducer、projection、claim revision 和 shouldRun；Phase 1 已实现独立 SQLite `goal_events` adapter、daemon 可选 wiring、受认证的 goal 列表/详情和 bounded JSON event replay。Goal 写 API、Web 投影操作和 governed admission 仍按门禁推进；文档解释哪些 LoopX 语义可提取、如何与现有 run/scheduler/approval/sandbox 边界协作，以及分阶段实施、验证、互操作和回滚。
- [ADR 0004：原生 Goal Control 与 LoopX 协议互操作](adr/0004-native-goal-control-and-loopx-interop.md)：记录“不 vendor 完整 LoopX、保留单向互操作”的架构决策。
