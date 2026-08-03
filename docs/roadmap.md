# 分阶段路线图

**状态：Accepted（文档阶段已完成；阶段 1–2、认证门禁与 Web/PWA MVP 已落地）**

每个阶段都是一个可回滚的 Git 提交或小提交组。完成条件包含：代码、单元测试、文档更新、验证命令和已知限制。

| 阶段 | 目标 | 主要交付物 | 退出条件 |
| --- | --- | --- | --- |
| 0 | 研究与边界 | 本文档集、ADR、调研记录 | 方案评审通过；不再存在未记录的“隐含核心决策” |
| 1 | 工程骨架 | pnpm workspace、TS config、contracts、测试基础 | contracts、testkit、scheduler、storage 可 typecheck/test |
| 2 | 可恢复 loop | fake model、run 状态机、事件日志、取消/超时、并发 scheduler | fake-model 集成测试覆盖正常、失败、取消、重连、并发和 workspace lease |
| 3 | 模型与上下文 | OpenAI-compatible adapter、流式 delta、预算和压缩、上下文来源标签 | provider contract + replay fixture + token budget/injection tests |
| 4 | 工具与审批 | filesystem/patch/git/shell、风险分类、审批 UI API、审计 | 路径穿越、命令注入、超时、拒绝等安全测试通过 |
| 5 | 沙箱 | host-restricted adapter、Docker adapter、资源限制 | 明确标注隔离强度；不可信任务默认不能落到 host adapter |
| 6 | Skill/MCP | manifest loader、MCP stdio/HTTP、工具 allowlist | 恶意描述、超大 schema、断连、secret 泄漏测试通过 |
| 7 | Web/PWA | React 多端布局、SSE resume、pairing/run console/cancel MVP | Web typecheck/build、API/SSE 单测和 React smoke test 通过；Playwright desktop/tablet/mobile、diff/log/approval 深化后置 |
| 8 | 低资源与硬化 | 运行时指标、事件保留、速率限制、备份/导出 | 达到 `product-brief.md` 的目标，报告实测数据 |
| 9 | 扩展生态 | plugin/adapter SDK、文档站、示例技能 | 第三方可在不改核心包的情况下增加 provider/tool |

## 推荐第一条实现链

`contracts → fake-model loop → event storage → API/SSE → web read-only view → policy/approval → real tools → sandbox → MCP/Skills`。

当前已完成 `contracts → testkit → in-memory event storage → scheduler → SQLite EventStore → daemon /health → fake-model loop → run API/SSE → ContextManager/provider → agent 接入 → ToolRegistry/ApprovalPolicy → sandbox/execution 安全边界 → tool adapter → auth/transport 门禁 → Web/PWA MVP`；随后接 certificate manager、external sandbox runtime 与 UI 深化。

这样早期就能证明“远程观察和可恢复”主路径，同时把危险工具放在经过测试的边界之后。

## 暂缓决策

- 是否引入 Next.js/SSR：MVP 采用静态 Vite SPA；只有真实需求出现才评估。
- 是否采用 Redis/Postgres：单用户本地场景先不用；并发/协作需求出现时再增加 storage adapter。
- 是否支持浏览器自动化：不属于最小 coding harness，后续作为独立工具包评估。
