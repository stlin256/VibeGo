# ready4vibe 文档索引

## 目标读者

- 产品/架构：先读 `product-brief.md`、`architecture.md`、`roadmap.md`；
- 后端与 harness：读 `harness-contracts.md`、`api-contract.md`、`adr/0002-security-defaults.md`、`adr/0003-lan-access-and-codex-like-approval.md`、`specs/01-sandbox-approval.md`；
- 运行状态与事件：读 `specs/02-run-event-contract.md`；
- 模型与上下文：读 `specs/03-model-context-contract.md`；
- 长期目标与 LoopX 整合：先读 [`specs/34-goal-control-plane-loopx-integration.md`](specs/34-goal-control-plane-loopx-integration.md)，再读 [`specs/35-goal-web-readonly-projection.md`](specs/35-goal-web-readonly-projection.md) 和 [`adr/0004-native-goal-control-and-loopx-interop.md`](adr/0004-native-goal-control-and-loopx-interop.md)；
- Web 开发：读 `web-ux.md`、`api-contract.md`；
- 贡献者：读 `testing-strategy.md`、`development-workflow.md`；
- 调研复核：先读 `open-source-research.md`、[`research/upstream-provider-usage.md`](research/upstream-provider-usage.md) 和 [`research/upstream-harness-implementations.md`](research/upstream-harness-implementations.md)。

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
- [Spec 40：Goal write API 与 bounded mutation service](specs/40-goal-write-api-and-bounded-mutations.md) 与 [ADR 0009](adr/0009-goal-write-api-and-mutation-boundary.md)：Phase 2A 已实现受认证、eventId 幂等、controlRevision optimistic concurrency 和 validated Evidence 门禁的有限 Goal/Todo/Gate/Evidence 写 API；不提供 raw event、quota 或默认 run admission。
- [Spec 41：Host-first 发行、同源 Web 与后续客户端边界](specs/41-host-first-distribution-and-client-boundary.md) 与 [ADR 0010](adr/0010-host-first-same-origin-web-and-client-boundary.md)：生产 Host 同时提供 daemon、React Web、REST API 和 SSE；远程浏览器只打开 URL。Android/iOS/HarmonyOS 原生客户端明确后置，只消费同一套版本化 API，不复制 AgentLoop 或本地状态。
- [Spec 42：shadcn 风格 Web 设计系统与 conversation-first UI](specs/42-shadcn-style-web-design-system.md) 与 [ADR 0011](adr/0011-shadcn-style-local-components-and-vibego-web.md)：保留 VibeGo 品牌和 ratio/conversation-first 布局，组件库优先采用 shadcn registry/Radix 等成熟实现；仅在有记录的理由下自定义 primitive，原生客户端仍后置。
- [Spec 43：资源、Token、费用与审计可观测性](specs/43-resource-usage-and-cost-audit.md) 与 [ADR 0012](adr/0012-local-resource-and-cost-audit-ledger.md)：独立记录 CPU/内存/磁盘、run/tool/sandbox 资源、token 分桶、缓存语义、版本化价格、费用精度和 hash-chain 审计；参考 AxonHub/CC Switch，但不引入其 proxy、Tauri、Python 或完整服务。
- [Spec 44：Provider、Token、费用管理与上游源码复用](specs/44-provider-usage-management-and-upstream-reuse.md) 与 [ADR 0013](adr/0013-upstream-research-and-provider-management-boundary.md)：定义上游源码读取、许可证/NOTICE、provenance、clean-room 复用与 provider/usage 扩展门禁；开发 Agent 提示词在 [prompts/44-provider-usage-management-implementation.md](prompts/44-provider-usage-management-implementation.md)，证据模板在 [research/upstream-provider-usage.md](research/upstream-provider-usage.md)。
- [Spec 45：Observability API 与 Web Usage/Audit projection](specs/45-observability-api-and-web.md) 与 [ADR 0014](adr/0014-observability-api-and-web-projection.md)：把现有 ledger 以认证、bounded、可降级 projection 暴露给 conversation-first Web；不改变 run/Goal/AgentLoop/Scheduler/Approval/Sandbox 事实源。
- [Spec 46：Automated verification workflow](specs/46-automated-verification-workflow.md) 与 [ADR 0015](adr/0015-automated-verification-workflow.md)：固定 `pnpm verify` 的 typecheck → test → diff-check → Git diff-check 顺序，并提供 `pnpm check:module -- <package>` 的依赖闭包构建与包级 typecheck/test，不安装依赖、不访问模型、不输出环境 secret。
- [Harness 上游实现研究](research/upstream-harness-implementations.md) 与 [ADR 0016](adr/0016-clean-room-harness-productionization.md)：基于 Codex、OpenHands、Aider、Goose、MCP TypeScript SDK、LiteLLM、Langfuse、Continue 和 OpenTelemetry 的 pinned checkout，冻结 clean-room、单一执行事实源、run snapshot、degraded 和 host-first 边界。
- [Spec 47：Model/Context/AgentLoop productionization](specs/47-model-context-agent-loop-productionization.md)：真实 provider/context/streaming loop、可选 live smoke 和无 secret 验证。
- [Spec 48：Approval/Sandbox/Shell runtime closure](specs/48-approval-sandbox-shell-runtime.md)：Codex-like compiled policy、低风险自动审批边界、Windows/容器运行时和恢复门禁。
- [Spec 49：MCP/Skill transport and capability lifecycle](specs/49-mcp-skill-transport-and-capability-lifecycle.md)：R1 注入式 stdio/Streamable HTTP session 边界已进入实施；健康分级、能力快照与 ToolRegistry 激活按后续阶段推进。
- [Spec 50：Observability lifecycle integration](specs/50-observability-lifecycle-integration.md)：将 usage/cost/resource/audit ledger 在 application/RunManager 边界接入，保持 fail-soft 与隐私约束。
- [Spec 51：Host-first release and client boundary](specs/51-host-first-release-and-client-boundary.md)：daemon 静态托管 Web、跨平台 launcher、LAN/public TLS 适配与后置 Android/iOS/HarmonyOS client SDK 边界。
- [Spec 52：Capability profiles 与 first-run experience](specs/52-capability-profiles-and-first-run-experience.md)：把配置引导、能力档位、Goal governed admission、Tailscale/SSH、ACME 和真实 LLM smoke 串为 Web/Host 发布门禁。
- [Spec 53：Host 安装、升级、备份与故障恢复](specs/53-host-install-upgrade-backup-recovery.md)：一键 Host bundle、平台签名、current/previous/candidate 回滚、SQLite 一致性备份、迁移和 safe mode。
- [Spec 54：本地与云模型配置向导](specs/54-model-provider-onboarding.md)：Ollama、LM Studio、llama.cpp、OpenAI-compatible、Anthropic/DeepSeek 显式 endpoint、secret reference 和 provider/run snapshot isolation。
- [Spec 55：公网部署、证书自动化与运维文档](specs/55-public-deployment-certificates-operations.md)：ACME staging/renewal/rollback、reverse proxy、Tailscale/SSH、public HTTPS 和版本化 operations runbook。
- [Spec 56：多语言、无障碍与真实设备兼容矩阵](specs/56-i18n-accessibility-device-matrix.md)：`en-US`/`zh-CN`、WCAG 2.2 AA、辅助技术、Playwright ratio fixtures 和真实 desktop/mobile/foldable/tablet evidence。
- [Spec 57：Release 发布流水线](specs/57-release-publishing-pipeline.md)：protected tag/channel、可重复多平台构建、checksum、平台签名、SBOM、provenance、attestation 和 stable promotion。
- [Spec 58：Goal Control 完整执行闭环与核心 Harness 完成门禁](specs/58-goal-control-and-harness-completion.md)：把 Goal 从 contracts/replay/mutation 基础推进到 governed admission、验证写回、quota exactly-once、恢复和真实 LLM Harness 证据，并为其他 design-only/fake-only 核心模块定义统一完成标准。
- [Spec 59：Permission Profiles、低打扰自动审批与 Full-host 模式](specs/59-permission-profiles-and-low-interruption-approval.md)：定义 workspace-coding、显式 full-host、bounded-auto/session-auto 审批姿态、可信任务边界、session grant、撤销和跨平台真实验收。
- [Spec 60：完整测试、真实运行与发布证据主线程验收](specs/60-complete-verification-and-release-evidence.md)：规定重新核实全部既有 Spec、分模块 focused gate、全仓 verify、真实 LLM、Goal governed run、权限/远程/证书、并发恢复和 release evidence 的最终验收顺序。
- [Spec 61：DeepSeek 一等 Provider、思考模式与低打扰 Agent Loop](specs/61-deepseek-first-class-provider-integration.md)：吸收 MinimumAgentLoop 的两层循环、多工具调用、thinking、advisory reviewer 和 provider-owned search 思路，但保留 VibeGo 的 ModelProvider、Approval、Sandbox、Goal、Scheduler 和事件事实源。
- [Spec 62：用户可见文档质量、README 与开箱即用说明](specs/62-user-facing-documentation-quality.md)：规定先复核 Spec 01–61，再完成英文优先 README、中文同步、品牌横幅、Web 配置向导、权限/安全边界、Quickstart、状态真实性和文档质量门禁。
- [Spec 53–57 调研记录](research/53-57-release-install-model-operations-research.md)：Node SEA、GitHub Releases/Attestations、Sigstore、Let's Encrypt、SQLite、WCAG、Playwright、Ollama 和 LM Studio 的公开资料与 clean-room 设计判断。
- [TencentDB 融合实施提示词](prompts/39-tencentdb-agent-memory-implementation.md)：可直接交给另一位开发者或 Agent，按 Contract → MemoryCore → Web Settings → Supervisor → Proxy/Knowledge 顺序实施，并保留 dirty worktree。
