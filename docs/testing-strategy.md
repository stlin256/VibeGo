# 测试策略与质量门禁

**状态：Accepted（文档阶段）**

目标不是追求一个漂亮覆盖率数字，而是让每一个会改变 agent 行为、执行权限或远程状态的模块都能被确定性验证。

## 测试分层

| 层级 | 工具 | 范围 | 运行频率 |
| --- | --- | --- | --- |
| 单元 | Vitest + fake clock | 纯函数、schema、状态机、预算、策略、路径和脱敏 | 每次提交 |
| 契约 | Vitest/JSON Schema | API、事件、ModelProvider、ToolProvider、MCP 映射 | 每次提交 |
| 集成 | Vitest + testkit | fake model + storage + harness + fake tools | 每次提交 |
| 沙箱集成 | Node test runner/平台脚本 | 子进程、取消、资源、路径边界、Windows/macOS/Linux adapter | PR 与 nightly |
| Web 组件 | Testing Library | approval、timeline、diff、断线状态、键盘可用性 | 每次提交 |
| E2E | Playwright | daemon mock + React PWA 桌面/平板/手机主流程 | PR 与 release |
| 性能 | 独立 benchmark | 启动、RSS、事件延迟、输出截断、事件保留 | release |
| 安全 | fuzz/property + adversarial fixtures | 注入、越权、secret、恶意 MCP/Skill、重放 | 每次提交（小集）+ nightly |

## 模块最低测试要求

- `contracts`：合法/非法 payload、未知可选字段、版本兼容。
- `harness`：正常完成、模型失败、工具失败、审批等待、拒绝、取消、超时、恢复。
- `model`：流式 delta 拼接、tool call replay、重试边界、预算截断、AbortSignal。
- `context`：大小/token 上限、压缩来源、敏感级别、重复事件和空上下文。
- `policy`：每个 R0-R4 fixture；服务端不降级客户端安全等级；过期 grant。
- `tools`：路径穿越、符号链接、原子写、输出上限、编码、进程树取消。
- `sandbox`：能力报告与真实隔离一致；无 Docker 时安全失败，不静默回退成“强隔离”。
- `mcp/skills`：schema 太大、名称冲突、恶意描述、断连、secret 继承和来源标签。
- `storage`：seq 单调、事务顺序、重启恢复、并发读、保留窗口。
- `api`：认证、CORS/Origin、幂等、错误 envelope、SSE `after`/`Last-Event-ID`。
- `web`：加载/断线/恢复、审批确认、风险展示、手机触控、键盘和屏幕阅读器语义。

## Deterministic testkit

`packages/testkit` 必须提供：

- scriptable `FakeModelProvider`：按请求返回 text/tool/错误/延迟；
- `FakeClock` 和 deterministic IDs；
- `InMemoryEventStore` 与可注入故障；
- `FakeTool`/`FakeSandbox`：记录调用、可配置审批和失败；
- event assertion helpers：按 `seq`、状态和 payload schema 验证；
- fixture redaction checker：扫描 token/secret 形态，防止测试数据泄漏。

真实模型 key、真实 workspace 和公网连接不得出现在默认测试。live tests 必须显式 profile、默认跳过，并且不能改变用户文件。

## 覆盖率与门禁

- 关键包（contracts、harness、policy、sandbox、storage）行/分支覆盖率至少 80%；policy/sandbox 的安全分支至少 90%。
- 覆盖率下降超过 2 个百分点或新增工具无安全 fixture 时，CI 失败。
- 每个行为性变更必须至少有一个失败路径测试；不要只测 happy path。
- 所有测试失败必须能通过 `correlationId/runId` 定位事件，不依赖当前时间或随机输出。

## 性能基准

基准脚本固定 Node 版本、机器信息和 fixture 大小，输出 JSON：

- daemon 冷启动和 `/health` 首次响应；
- 空闲 RSS、一个短 run 的峰值 RSS；
- 1/10/100 个并发 SSE 客户端的事件 p50/p95；
- 1 KB、100 KB、1 MB、10 MB 工具输出的截断和入库时间；
- 10k、100k 事件的恢复和保留窗口。

性能目标见 `product-brief.md`；未测量的数据只能写成“目标”。

## 失败处理

CI 禁止因为缺少 Docker、平台工具或模型 key 而把安全测试标绿。环境缺失时应标记为 skipped，并在 PR 摘要中说明覆盖缺口；发布门禁需要在支持矩阵中的环境补齐。

