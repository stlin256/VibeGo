# 逐步讨论计划

**状态：Accepted（用于后续协作）**

文档先建立共同边界，再逐个模块收敛细节。每次讨论结束后，都应留下“决策、备选方案、约束、验收测试、文档变更”五项结果，然后再进入实现。

## 讨论顺序

1. **产品边界与信任模型**：单用户/单主机、LAN 门禁、Tailscale/SSH transport、可信与不可信任务。**已初步收敛，见 ADR 0003/Spec 01。**
2. **运行时与仓库骨架**：Node 版本、pnpm、Fastify/Node HTTP、SQLite/file adapter、包边界和 CI。
3. **Run/Turn/Event 合约**：状态机、事件字段、幂等、取消、恢复、错误与事件保留。
4. **模型层**：OpenAI-compatible 最小协议、流式、tool call、重试、模型配置与 secret。**Spec 03 已建立。**
5. **上下文管理**：消息来源、文件检索、token/字节预算、压缩、注入防护和可重放 fixture。**Spec 03 已建立。**
6. **工具/审批/沙箱**：shell、filesystem、Git、风险等级、自动批准边界、隔离强度和资源限制。**详细规格已建立，待逐项讨论。**
7. **Skill/MCP**：manifest、来源、schema、server 生命周期、工具映射、断连与权限。
8. **远程 API 与认证**：pairing、token 生命周期、SSE resume、LAN/Tailscale/SSH、速率限制。
9. **Web 多端**：桌面/平板/手机布局、审批交互、PWA 缓存、可访问性、断线体验。
10. **质量与演进**：单元/集成/E2E、安全/性能门禁、插件 API、发布与迁移。

## 默认假设（可被讨论推翻）

- 首版只支持一个本地 daemon 和一个用户会话；
- 默认 loopback，用户显式开启后允许 LAN；TLS 默认强制但可显式关闭，公网 transport 永远强制 TLS；证书管理先做状态/导入/轮换接口，ACME 后续实现；
- Node.js 22 + TypeScript，React/Vite 静态 PWA；
- SQLite/file event store，不引入 Redis/Postgres；
- OpenAI-compatible provider 作为第一实现，真实模型之前先用 fake model；
- 可信任务使用受限 workspace-write；不可信任务需要可验证 external sandbox；
- 自动审批参考 Codex：MVP 只实现确定性 allow/prompt/forbidden + 精确 session key；Guardian-like reviewer 只留后续接口；写文件和网络只在明确规则/批准范围内无感；R4 默认拒绝；
- Run 支持并发，默认最多 2 个 active run；不同 workspace 可并行，同 workspace 写操作默认 exclusive lease；
- 规则持久化使用 JSON schema；Codex 风格文本规则编译器后置；每个模块先文档、再 failing test、再实现、再测量和提交。

## 每次讨论的输出模板

```text
决策：
选择理由：
备选与放弃原因：
不可违反的约束：
需要的接口/schema：
验收测试：
性能/安全测量：
需更新的文档与 Git 提交：
```

Spec 02 与 Spec 03 已建立为 Draft；并发默认已确认。当前进入第 2 项“运行时与仓库骨架”，先实现 contracts/testkit/scheduler/storage，再根据测试结果继续讨论 SQLite、模型协议和上下文压缩。
