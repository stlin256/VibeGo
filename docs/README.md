# ready4vibe 文档索引

## 目标读者

- 产品/架构：先读 `product-brief.md`、`architecture.md`、`roadmap.md`；
- 后端与 harness：读 `harness-contracts.md`、`api-contract.md`、`adr/0002-security-defaults.md`、`adr/0003-lan-access-and-codex-like-approval.md`、`specs/01-sandbox-approval.md`；
- 运行状态与事件：读 `specs/02-run-event-contract.md`；
- 模型与上下文：读 `specs/03-model-context-contract.md`；
- Web 开发：读 `web-ux.md`、`api-contract.md`；
- 贡献者：读 `testing-strategy.md`、`development-workflow.md`；
- 调研复核：读 `open-source-research.md`。

## 文档状态标记

- `Draft`：提出方案，尚未被实现验证；
- `Accepted`：作为当前实现依据；
- `Implemented`：已有代码与测试；
- `Superseded`：被新的 ADR 或合约替代。

除明确标记为 `Draft` 的规格外，当前文档是 `Accepted` 设计基线；代码实现尚未开始。实现过程中若发现约束不成立，必须先更新文档并提交，再修改代码。

## 规范

- 所有公共 API、事件、工具和配置均使用版本号；
- 文档中的“必须/不得”是实现门禁，不是建议；
- 性能数字是目标值或测量值，除非有测量记录，不得写成已达成事实；
- 调研资料只提取设计启发，不复制源项目代码、私有协议或品牌界面。
