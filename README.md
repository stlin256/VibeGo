# ready4vibe

> 本项目的目标是一个“本地运行、远程访问、多端适配”的最小化 coding-agent harness 与 Web 控制台。

当前仓库处于文档与架构基线阶段，尚未承诺任何可运行的 agent 功能。实现会严格按文档中的模块边界、合约和测试门禁推进，并以小步 Git 提交交付。

## 先说明一个技术边界

React 是 UI/视图层技术，不是后端运行时。为满足“React + TypeScript”的目标，本项目采用 TypeScript 端到端：

- 后端：Node.js + TypeScript，默认 Fastify/Node HTTP 单进程 daemon；
- 前端：React + TypeScript + Vite，输出可安装 PWA；
- 共享：`packages/contracts` 提供版本化 API、事件和工具 schema；
- 运行形态：coding 主机运行 daemon，手机、平板、桌面浏览器通过受保护的 Web API 连接。

如果后续确实需要 React Server Components，可以在 Web 层增加适配，但不改变本地 daemon 与 harness 的核心边界。

## 文档入口

- [文档索引](docs/README.md)
- [产品范围与非目标](docs/product-brief.md)
- [总体架构](docs/architecture.md)
- [开源项目调研](docs/open-source-research.md)
- [harness 模块合约](docs/harness-contracts.md)
- [安全、沙箱与审批默认值](docs/adr/0002-security-defaults.md)
- [LAN 与 Codex-like 审批决策](docs/adr/0003-lan-access-and-codex-like-approval.md)
- [沙箱/执行策略/审批详细 Spec](docs/specs/01-sandbox-approval.md)
- [Run/Turn/Event 详细 Spec（Draft）](docs/specs/02-run-event-contract.md)
- [HTTP/SSE API 合约](docs/api-contract.md)
- [Web 多端设计](docs/web-ux.md)
- [测试策略](docs/testing-strategy.md)
- [分步开发与提交规范](docs/development-workflow.md)
- [路线图](docs/roadmap.md)

## 设计原则

1. 本地优先：默认只监听 loopback，远程访问必须显式开启并认证。
2. 最小权限：工具、文件路径、网络、环境变量和审批均采用 allowlist。
3. 可恢复：运行事件追加写入，客户端可按序号续传；agent 可取消、暂停和恢复。
4. 可替换：模型、存储、沙箱、MCP 和 UI 通过窄接口解耦。
5. 可验证：每个模块先写合约和测试，再实现功能；危险动作必须有审计记录。
6. 低资源：单进程、静态 SPA、懒加载编辑器、无默认遥测，不引入不必要的常驻服务。

## 当前状态

- [x] Git 仓库和文档基线初始化
- [x] 架构、模块、API、安全和测试策略定稿（文档阶段）
- [ ] TypeScript monorepo 骨架
- [ ] fake-model agent loop 与事件日志
- [ ] shell/filesystem 工具、审批和沙箱
- [ ] MCP/Skill 接入
- [ ] React PWA 与远程连接

详见 [路线图](docs/roadmap.md)。
