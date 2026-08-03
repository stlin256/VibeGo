# ADR 0004：原生 Goal Control 与 LoopX 协议互操作

- 状态：Draft
- 日期：2026-08-03

## 背景

LoopX 解决的是跨 session、跨 run 的长期目标控制问题，提供 Goal、Todo、Gate、
Evidence、Handoff、quota 和状态投影等概念。`ready4vibe` 当前则是 Node.js/
TypeScript 的本地 Agent 执行 daemon，已有 run-centric SQLite EventStore、
AgentLoop、Scheduler、Approval、Sandbox、Workspace Registry 和 HTTP/SSE。

两者的后端所有权不同：LoopX 以 Python CLI、registry/Markdown/JSONL 和 goal
状态为中心；ready4vibe 以 daemon、SQLite、run/turn/tool 事件和安全执行边界
为中心。直接 vendor LoopX 会引入第二套 runtime、状态源、锁和调度语义。

## 决策

1. 在 ready4vibe 内实现原生 `Goal Control` bounded context。
2. 只吸收 LoopX 的稳定协议语义和可验证的纯状态算法，不直接复制 Python
   runtime、CLI、installer、文件锁、host bridge 或 dashboard。
3. Goal 事件使用独立的 `goal_events` stream，与 `run_events` 分离。
4. Goal Control 通过 daemon application service 与 RunManager 组合；
   `packages/agent`、`packages/scheduler` 和 `packages/policy` 保持现有职责。
5. LoopX-compatible import/export 是后续可选适配器，不是第一阶段的 canonical
   storage。
6. 所有 governed 自动执行必须先通过 Goal admission，再通过 ready4vibe 的
   Scheduler、Approval、Sandbox 和 Workspace 边界。

## 选择理由

### 保持现有执行平面

ready4vibe 已经持有模型、工具、审批、沙箱、认证和 raw run event。将这些能力
交给 LoopX 会造成权限和事实源分裂，尤其会破坏现有 `needs-recovery`、approval
continuation 和 workspace lease 语义。

### 引入独立 Goal 聚合

一个长期目标会关联多个 run，不能用 `runId` 或单个 run-local `seq` 表示。独立
Goal event stream 可以保留 Goal 的生命周期和交接关系，同时让现有 run 事件
保持向后兼容。

### 复用而不依赖 LoopX internals

LoopX 的公共价值集中在控制协议、事件幂等、隐私边界和投影，而不是某个必须
运行在 Python/Linux 上的实现。TypeScript 原生实现能复用 ready4vibe 的 Zod、
SQLite、auth 和测试基础设施。

## 备选方案与拒绝原因

### 完整 vendor LoopX

拒绝。会同时引入 Python runtime、文件型 registry、Markdown/JSONL state、POSIX
文件锁、LoopX CLI 和另一套 quota/scheduler。Windows 和 daemon 内嵌场景还需要
额外安装与进程管理。

### 外部 LoopX companion

保留为研究/互操作选项。它适合验证“长期目标控制是否有价值”，但不应成为
ready4vibe 默认运行依赖；在 Windows 上还需要固定 Python、可写 runtime root、
安装路径和跨进程锁验证。

### 只在 Web 层显示 LoopX dashboard

拒绝。dashboard 只能是 projection，不能变成 ready4vibe 的第二个 canonical
state，也不能绕过 daemon 的 auth、approval 或 sandbox。

## 影响

### 正面影响

- 现有 run API、SSE、AgentLoop 和安全边界保持稳定。
- 可逐步增加跨 run goal、Todo、Gate 和 handoff，而不要求一次性重构后端。
- SQLite 事务、UUIDv7、Zod schema 和 testkit 可以复用。
- 将来可以通过显式映射导入/导出 LoopX compact projection。

### 成本与风险

- 新增 Goal event、projection 和应用服务，短期会增加领域模型和测试量。
- Goal quota 与 Scheduler 必须明确分层，否则会产生双重调度。
- Goal event payload 需要独立的隐私扫描和长度约束。
- 如果产品最终只支持短生命周期单 run，Goal Control 可能暂时没有足够收益。

## 后续动作

实现前必须先完成 [Spec 34](../specs/34-goal-control-plane-loopx-integration.md)
中的 Phase 0：contract schema、projection fixture、幂等/冲突测试和隐私陷阱。
在 Phase 1 的只读 projection 通过验收前，不得把 Goal quota 接入默认 run 创建
路径，也不得修改现有 `run_events` 合同。
