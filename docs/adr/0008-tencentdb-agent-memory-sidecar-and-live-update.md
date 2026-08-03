# ADR 0008：TencentDB Agent Memory sidecar 与自动更新

- 状态：Accepted（实施细节仍由 Spec 39 分阶段落地）
- 日期：2026-08-03
- 相关规格：[Spec 39：TencentDB Agent Memory 可切换融合与自动更新](../specs/39-tencentdb-agent-memory-integration.md)

## 背景

ready4vibe 和 TencentDB Agent Memory 都提供 Agent 相关能力，但后端边界不同：
ready4vibe 以 TypeScript daemon、AgentLoop、RunManager、SQLite `run_events`、Goal
Control、Scheduler、Approval、Sandbox 和 Web API 为中心；TencentDB 以独立的
MemoryCore/MemoryProxy/MemoryKnowledge 进程、自己的 HTTP Gateway、SDK 和记忆存储为
中心。

本项目需要能够从 Web 开关 TencentDB 融合，并随 Tencent 官方开源仓库更新自动更新，
同时不因为记忆服务故障而限制 Web 和普通任务使用。直接复制 TencentDB 源码或把它
作为 ready4vibe 的第二个 runtime，会产生两套进程生命周期、状态源、模型入口和更新
机制。

## 决策

### 1. 采用独立 sidecar，不 vendor TencentDB

TencentDB 作为 daemon 管理的独立进程运行。ready4vibe 只依赖自己的
`AgentMemoryProvider`、`TencentMemoryRuntimeSupervisor` 和版本化 DTO，不 import
TencentDB 的内部 module path。

首选运行方式是 MemoryCore + 官方 TypeScript SDK
`@tencentdb-agent-memory/memory-sdk-ts-v2`。MemoryProxy 和 MemoryKnowledge 是可选
运行模式，不是 ready4vibe 的默认模型或工具事实源。

### 2. 记忆层必须可关闭，默认关闭

稳定模式为 `off`、`memory-core`、`proxy`、`full-stack`。默认
`enabled=false`；关闭时不启动 sidecar、不调用 SDK、不改变 ContextManager 或模型
请求。开启/关闭只影响新 run，运行中的 run 使用已冻结的 memory/provider snapshot。

Web Settings 提供普通开关和模式选择，不增加额外的逐任务安全确认。sidecar 不可用时，
Web、RunManager 和直接模型 Provider 继续工作，并显示降级状态。

### 3. ready4vibe 保留所有执行事实源

TencentDB 只保存和召回长期记忆、Skill/知识摘要及其 metadata。以下能力仍归
ready4vibe 所有，TencentDB 不得绕过或替换：

- Goal、Todo、Gate、Evidence、Handoff、quota、`shouldRun` 和 `goal_events`；
- run/turn/tool/approval/sandbox 生命周期和 `run_events`；
- Scheduler 资源容量、Workspace lease、ApprovalPolicy 和 Sandbox；
- Web API、SSE、secret boundary、模型 Provider 的默认直连行为。

run 终态后只向 TencentDB 写入 compact summary、决策、验证结果和 bounded evidence
reference；不复制完整 transcript、原始工具输出或 Goal canonical event。

### 4. 通过 ContextManager 注入召回结果

MemoryCore recall 结果转换成现有 `ContextItem`，使用
`source='retrieval'` 和显式 `trust`，受 ContextManager 字节预算和裁剪规则约束。
记忆不是执行权限，也不能覆盖 system/developer/user 的保护顺序。MemoryKnowledge
先作为只读、bounded 的 retrieval adapter，完成工具 descriptor、取消和资源测试后
再考虑进入 ToolRuntime。

### 5. 由 Supervisor 做构建、切换和回滚

`TencentMemoryRuntimeSupervisor` 维护：

- immutable `revisions/<revision>` 和 `candidates/<revision>`；
- `currentRevision`（当前服务）和 `previousRevision`（上一个已知良好服务）；
- 候选 revision 的依赖安装、build/typecheck、health probe、SDK smoke test；
- 成功候选的原子切换、旧实例 drain、更新串行化和失败回滚。

上游更新采用“拉取新 revision → 候选构建 → 候选启动 → 健康检查 → 切换”的蓝绿式
流程，不在运行中的 Node 进程里热替换模块，也不在 current 目录内原地 `git pull`。
构建、health 或 smoke test 失败时 current 保持不变；切换后健康失败时回到 previous。

### 6. “实时更新”的产品定义

支持三种触发方式：定时检查、上游 webhook/事件通知、Web 的“立即更新”。三者都进入
同一个串行 Supervisor 队列。实时更新表示自动发现和自动切换，不承诺上游提交后零秒
生效，也不承诺在一个进行中的 Agent turn 中更换 revision。

上游分支、启动命令、健康路径和 Node/package-manager 要求从候选 revision 的 manifest
和 README 解析或由版本化 adapter 声明；任何 API/schema 不兼容都在候选阶段失败，
不得污染当前实例。

### 7. Proxy 模式不能复用隐式 URL 拼接

ready4vibe 现有 `OpenAICompatibleProvider` 会追加 `/chat/completions`。MemoryProxy
需要 `TencentMemoryProxyProvider` 或显式 endpoint contract 来定义路径、headers、
上游配置和 fallback。默认 Proxy 失效时回退到原始 Provider，除非用户显式选择“Proxy
失效即停止”的策略。

## 被拒绝的方案

### 完整复制 TencentDB 源码到 ready4vibe

拒绝。会把 upstream 的进程、存储、HTTP 和版本生命周期耦合进主进程；后续仓库更新
需要手工 merge，难以回滚，也会与 `run_events`/Goal Control 形成第二套事实源。

### 只把 MemoryProxy URL 填入现有模型设置

拒绝。现有 Provider 会隐式拼接路径，Proxy 的协议、鉴权和注入语义也不一定相同；这
会产生“看似可用但请求路径错误”的隐性兼容问题。

### 把 TencentDB 设为 Goal 或 run 的 canonical storage

拒绝。记忆召回可能过期或不完整，不能替代 ready4vibe 的 append-only event、claim、
revision、evidence 和 recovery 语义。

### 运行中热替换 upstream Node 模块

拒绝。热替换会让同一 run 的前后 turn 使用不同 SDK/协议，且无法安全处理连接、队列和
端口。采用候选 sidecar + 原子切换即可获得接近实时的更新并保留可回滚边界。

### 因记忆故障阻塞 Web 或 run

拒绝。TencentDB 是增强能力，不是最小执行链路。所有 recall/write/update 失败都必须
在 Adapter/Supervisor 边界转换为 degraded 状态；普通 Web、模型直连和已有 run 合约
继续工作。

## 影响

### 正面影响

- 不修改 AgentLoop 的核心状态机即可先接入 recall/write-back；
- Web 开关、运行时 snapshot、故障降级和 revision 回滚均可独立测试；
- upstream 更新不要求手工复制代码，current/previous 提供明确恢复路径；
- MemoryCore、Proxy、Knowledge 可以按实际收益分阶段启用；
- Goal Control、run 事件和安全执行边界保持稳定。

### 代价与约束

- daemon 需要管理子进程、端口、候选目录和历史 revision；
- 需要为 Windows 的 Node 版本、进程终止、临时目录和端口释放增加测试；
- Adapter 需要持续跟踪 upstream v3 API/SDK schema；
- recall budget、写回摘要和 memory identity 需要额外的合约与可观测性。

## 实施门禁

按以下顺序实施：

1. `AgentMemoryProvider`/status/identity contract、Noop provider 和 off-mode tests；
2. MemoryCore Adapter、ContextManager 注入和终态异步写回；
3. daemon settings API、Web 开关、状态卡片和新 run snapshot；
4. Supervisor 的 current/previous、候选 build/health/smoke、切换/回滚；
5. MemoryProxy 专用 Provider；
6. MemoryKnowledge 只读 Adapter 和后续工具评估。

任何阶段都不得把 TencentDB 接到 Goal admission、Scheduler、Approval 或 Sandbox 的
绕过路径；任何候选 revision 未通过 contract/health/smoke test，都不得成为 current。

## 回滚策略

- 关闭开关：停止 sidecar，后续 run 进入 `off`，已有 run 不被强制中止；
- Adapter 回滚：切回 `NoopAgentMemoryProvider`，保留 run/Goal 原有行为；
- revision 回滚：停止候选/当前异常实例，启动 `previousRevision`，重新执行 health 和
  SDK smoke test，通过后更新 current 指针；
- 文档/合约回滚：保留 `AgentMemoryProvider` 稳定接口，撤回具体 TencentDB adapter，
  不修改 `run_events`、`goal_events` 和历史 run 数据。

## 相关文档

- [Spec 39：TencentDB Agent Memory 可切换融合与自动更新](../specs/39-tencentdb-agent-memory-integration.md)
- [Spec 03：ModelProvider 与 ContextManager 合约](../specs/03-model-context-contract.md)
- [Spec 34：长期目标控制层与 LoopX 思路整合](../specs/34-goal-control-plane-loopx-integration.md)
- [ADR 0004：原生 Goal Control 与 LoopX 协议互操作](0004-native-goal-control-and-loopx-interop.md)
