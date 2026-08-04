# ready4vibe 文档索引

## 目标读者

- 产品/架构：先读 `product-brief.md`、`architecture.md`、`roadmap.md`；
- 后端与 harness：读 `harness-contracts.md`、`api-contract.md`、`adr/0002-security-defaults.md`、`adr/0003-lan-access-and-codex-like-approval.md`、`specs/01-sandbox-approval.md`；
- 运行状态与事件：读 `specs/02-run-event-contract.md`；
- 模型与上下文：读 `specs/03-model-context-contract.md`；
- 长期目标与 LoopX 整合：先读 [`specs/34-goal-control-plane-loopx-integration.md`](specs/34-goal-control-plane-loopx-integration.md)，再读 [`specs/35-goal-web-readonly-projection.md`](specs/35-goal-web-readonly-projection.md) 和 [`adr/0004-native-goal-control-and-loopx-interop.md`](adr/0004-native-goal-control-and-loopx-interop.md)；
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

- [Spec 34：长期目标控制层与 LoopX 思路整合](specs/34-goal-control-plane-loopx-integration.md)：Phase 0 已实现原生 TypeScript contracts、纯 reducer、projection、claim revision 和 shouldRun；Phase 1 已实现独立 SQLite `goal_events` adapter、daemon 可选 wiring、受认证的 goal 列表/详情和 bounded JSON event replay。Goal 写 API、Goal 操作和 governed admission 仍按门禁推进；Web 只读投影由 Spec 35 单独定义。
- [ADR 0004：原生 Goal Control 与 LoopX 协议互操作](adr/0004-native-goal-control-and-loopx-interop.md)：记录“不 vendor 完整 LoopX、保留单向互操作”的架构决策。
- [Spec 35：Web Goal 只读投影](specs/35-goal-web-readonly-projection.md)：把 Phase 1 的安全 projection 接入现有 React/Vite 控制台；只读、内存态、无第二条 SSE/轮询/调度路径，并为桌面、平板和手机保留 bounded、可降级的展示边界。
- [Spec 36：Durable non-secret workspace settings](specs/36-durable-workspace-settings.md)：在独立 `daemon_settings` 表中持久化 workspace id/label/root 映射；不修改 `run_events`/`goal_events`，不持久化模型 key，公共 API 仍不返回绝对路径。
- [Spec 37：Ratio-first responsive Web experience](specs/37-ratio-responsive-ui.md)：以视口宽度与宽高比适配桌面、竖屏显示器、手机、折叠屏、阔折叠、三折叠和平板；视觉截图不作为仓库验收物。
- [Spec 38：Conversation-first Web shell](specs/38-conversation-first-web-shell.md) 与 [ADR 0007](adr/0007-codex-like-conversation-first-web.md)：将日常使用改为 Codex-like 的工作区导航、任务会话、Goal/安全上下文三块结构；设置保留为抽屉/Sheet，不再占据首屏。
- [Spec 39：TencentDB Agent Memory 可切换融合与自动更新](specs/39-tencentdb-agent-memory-integration.md) 与 [ADR 0008](adr/0008-tencentdb-agent-memory-sidecar-and-live-update.md)：Phase 0–6a 已实现 contract、MemoryCore、settings、supervisor、bounded run integration、显式 MemoryProxy adapter、只读 MemoryKnowledge adapter、独立 Knowledge settings 和 Web 状态卡片；Phase 6b 已增加 operations projection、compatibility fixtures、immutable ref lock 与 bounded history。Knowledge 工具化、Proxy sidecar 自动构建/切换仍后置，记忆不可用不阻塞 Web/run。
- [TencentDB 融合实施提示词](prompts/39-tencentdb-agent-memory-implementation.md)：可直接交给另一位开发者或 Agent，按 Contract → MemoryCore → Web Settings → Supervisor → Proxy/Knowledge 顺序实施，并保留 dirty worktree。
