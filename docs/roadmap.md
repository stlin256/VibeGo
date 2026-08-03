# 分阶段路线图

**状态：Accepted（文档阶段已完成；阶段 1–2、认证门禁、Web/PWA、LAN TLS、Skill/MCP manifest 与 Sandbox runtime plan/CLI runner MVP 已落地）**

每个阶段都是一个可回滚的 Git 提交或小提交组。完成条件包含：代码、单元测试、文档更新、验证命令和已知限制。

| 阶段 | 目标 | 主要交付物 | 退出条件 |
| --- | --- | --- | --- |
| 0 | 研究与边界 | 本文档集、ADR、调研记录 | 方案评审通过；不再存在未记录的“隐含核心决策” |
| 1 | 工程骨架 | pnpm workspace、TS config、contracts、测试基础 | contracts、testkit、scheduler、storage 可 typecheck/test |
| 2 | 可恢复 loop | fake model、run 状态机、事件日志、取消/超时、并发 scheduler | fake-model 集成测试覆盖正常、失败、取消、重连、并发和 workspace lease |
| 3 | 模型与上下文 | OpenAI-compatible adapter、流式 delta、预算和压缩、上下文来源标签 | provider contract + replay fixture + token budget/injection tests |
| 4 | 工具与审批 | filesystem/patch/git/shell、风险分类、审批 UI API、审计 | 路径穿越、命令注入、超时、拒绝等安全测试通过 |
| 4.5 | LAN TLS | 证书文件解析、HTTPS listener、HTTP/HTTPS health 标识 | LAN 默认无证书 fail-closed；证书/私钥校验与 daemon 测试通过（已完成） |
| 5 | 沙箱 | host-restricted adapter、Docker/Podman 命令计划与受控 CLI runner、资源限制 | plan/resolver/runner 隔离强度测试通过（已完成）；daemon 默认不 wiring |
| 6 | Skill/MCP | 严格 manifest loader、stdio/HTTP transport 边界、工具 allowlist | manifest/allowlist MVP 已完成；真实连接器仍需断连、secret 泄漏与审批集成测试 |
| 7 | Web/PWA | React 多端布局、SSE resume、pairing/run console/cancel MVP | Web typecheck/build、API/SSE 单测和 React smoke test 通过；Playwright desktop/tablet/mobile、diff/log/approval 深化后置 |
| 8 | 低资源与硬化 | 运行时指标、事件保留、速率限制、备份/导出 | 达到 `product-brief.md` 的目标，报告实测数据 |
| 9 | 扩展生态 | plugin/adapter SDK、文档站、示例技能 | 第三方可在不改核心包的情况下增加 provider/tool |

## 推荐第一条实现链

`contracts → fake-model loop → event storage → API/SSE → web read-only view → policy/approval → real tools → sandbox → MCP/Skills`。

当前已完成 `contracts → testkit → in-memory event storage → scheduler → SQLite EventStore → daemon /health → fake-model loop → run API/SSE → ContextManager/provider → agent 接入 → ToolRegistry/ApprovalPolicy → sandbox/execution 安全边界 → tool adapter → auth/transport 门禁 → Web/PWA MVP → LAN TLS MVP → Skill/MCP manifest/allowlist MVP → Sandbox runtime 命令计划/CLI runner MVP`；随后接 daemon wiring、ACME/certificate manager adapter 与 UI 深化。

这样早期就能证明“远程观察和可恢复”主路径，同时把危险工具放在经过测试的边界之后。

## Spec 18：AgentLoop/daemon tool wiring（当前）

把模型 tool-call delta 接入已存在的 ToolRegistry、ApprovalPolicy、SandboxResolver
和 ToolExecutor。ToolRuntime 只允许显式注入；daemon 默认仍不启用主机工具。每次
调用都受 scheduler 的 toolProcesses 资源、run limits、沙箱和审批策略约束，并写入
`tool.requested`、`approval.required`、`tool.started`、`tool.output`、`tool.completed`
审计事件。审批续接 API、MCP/Skill 真实 transport 和默认 shell/container wiring
继续后置。

## Spec 19：MCP transport boundary（当前）

在 manifest/allowlist 之上增加 one-shot JSON-RPC transport client：连接器必须显式
注入，严格限制 server/tool/version、env key、消息大小、请求超时和 response id。
stdio/HTTP 仅共享 channel contract；本阶段不启动子进程、不发网络请求，后续再接
sandbox、approval 和 scheduler。

## 暂缓决策

- 是否引入 Next.js/SSR：MVP 采用静态 Vite SPA；只有真实需求出现才评估。
- 是否采用 Redis/Postgres：单用户本地场景先不用；并发/协作需求出现时再增加 storage adapter。
- 是否支持浏览器自动化：不属于最小 coding harness，后续作为独立工具包评估。
