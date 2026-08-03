# 逐步讨论计划

**状态：Accepted（用于后续协作）**

文档先建立共同边界，再逐个模块收敛细节。每次讨论结束后，都应留下“决策、备选方案、约束、验收测试、文档变更”五项结果，然后再进入实现。

## 讨论顺序

1. **产品边界与信任模型**：单用户/单主机、远程访问方式、可信与不可信任务、是否接受 Docker 依赖。
2. **运行时与仓库骨架**：Node 版本、pnpm、Fastify/Node HTTP、SQLite/file adapter、包边界和 CI。
3. **Run/Turn/Event 合约**：状态机、事件字段、幂等、取消、恢复、错误与事件保留。
4. **模型层**：OpenAI-compatible 最小协议、流式、tool call、重试、模型配置与 secret。
5. **上下文管理**：消息来源、文件检索、token/字节预算、压缩、注入防护和可重放 fixture。
6. **工具/审批/沙箱**：shell、filesystem、Git、风险等级、自动批准边界、隔离强度和资源限制。
7. **Skill/MCP**：manifest、来源、schema、server 生命周期、工具映射、断连与权限。
8. **远程 API 与认证**：pairing、token 生命周期、SSE resume、反代/Tailscale、速率限制。
9. **Web 多端**：桌面/平板/手机布局、审批交互、PWA 缓存、可访问性、断线体验。
10. **质量与演进**：单元/集成/E2E、安全/性能门禁、插件 API、发布与迁移。

## 默认假设（可被讨论推翻）

- 首版只支持一个本地 daemon 和一个用户会话；
- 默认 loopback，远程访问由用户显式开启；
- Node.js 22 + TypeScript，React/Vite 静态 PWA；
- SQLite/file event store，不引入 Redis/Postgres；
- OpenAI-compatible provider 作为第一实现，真实模型之前先用 fake model；
- S0/S1 只服务可信 workspace；不可信任务需要 S2/S3；
- 自动审批只覆盖 R0/R1 的固定 allowlist，写文件和网络默认询问；
- 每个模块先文档、再 failing test、再实现、再测量和提交。

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

建议下一步先讨论第 1 项“产品边界与信任模型”，因为它会决定远程暴露、沙箱依赖和自动审批的所有后续取舍。

