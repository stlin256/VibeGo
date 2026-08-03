# Spec 02：Run、Turn 与 Event 合约

**状态：Draft（等待逐步讨论；代码尚未实现）**

本规格把一次 coding agent 执行建模为可恢复的事件流。它先约束状态、序号、取消和恢复，再实现模型、工具和 Web UI。

## 1. 设计目标

- 一个 run 的事实来源是持久化事件，而不是内存中的 React/Node 对象；
- 客户端断线后可以按序号补发，不重复执行工具；
- 模型、工具、审批、沙箱和用户输入都使用统一事件 envelope；
- 崩溃时宁可标记 `needs_recovery`，不猜测写操作是否成功；
- API schema、SSE、SQLite/file store 和未来 transport 共用同一 contracts 包。

## 2. 标识与生命周期

所有 ID 使用带类型前缀的随机 ID（实现可选 UUIDv7/ULID），禁止用可预测的自增 ID 作为外部 API 标识：

```text
sessionId  sess_...
workspaceId ws_...
runId      run_...
turnId     turn_...
stepId     step_...
eventId    evt_...
approvalId ap_...
auditId    aud_...
```

单用户不等于无 session：每台配对设备仍有独立 session，可撤销、限速、审计和绑定最后访问时间。

## 3. Run 合约

```ts
type RunStatus =
  | 'created'
  | 'queued'
  | 'planning'
  | 'executing'
  | 'waiting-approval'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed-out'
  | 'needs-recovery';

interface RunLimits {
  maxTurns: number;
  maxWallTimeMs: number;
  maxModelInputTokens: number;
  maxModelOutputTokens: number;
  maxToolCalls: number;
  maxOutputBytes: number;
  maxContextBytes: number;
}

interface RunConfig {
  workspaceId: string;
  userMessage: string;
  model: { provider: string; name: string };
  taskTrust: 'trusted-workspace' | 'untrusted-content';
  sandbox: SandboxPolicy;
  approval: AskForApproval;
  limits: RunLimits;
  createdBySessionId: string;
  clientRequestId: string;
}

interface RunSnapshot {
  version: 1;
  runId: string;
  status: RunStatus;
  config: RunConfig;
  currentTurnId?: string;
  lastEventSeq: number;
  pendingApprovals: string[];
  usage: {
    turns: number;
    modelInputTokens: number;
    modelOutputTokens: number;
    toolCalls: number;
    outputBytes: number;
  };
  final?: { summary: string; changedFiles: string[]; exitReason: string };
}
```

服务端对所有 limits 做 clamp；客户端只能请求更小的值。MVP 支持并发 run，但由 scheduler 做全局资源准入和 workspace 写锁控制：默认最多 2 个 active run，硬上限由 daemon 配置；超过容量进入 `queued`。

## 3.1 并发调度

```ts
interface SchedulerPolicy {
  maxActiveRuns: number;       // 默认 2，不能超过服务端硬上限
  maxActiveModelCalls: number; // provider/global semaphore
  maxActiveToolProcesses: number;
  maxExternalSandboxes: number;
  workspaceWriteMode: 'exclusive' | 'worktree-only';
}

interface WorkspaceLease {
  workspaceId: string;
  mode: 'read' | 'write';
  holderRunId: string;
  acquiredAt: string;
  expiresAt: string;
}
```

- 不同 workspace 的 run 可以并行；同一 workspace 的多个 read-only run 可以并行。
- 同一 workspace 的写 run 默认持有 exclusive write lease；已有写 lease 时，后续写 run 排队，不允许隐式交错修改。
- `worktree-only` 是后续能力，只有 run 明确使用独立 Git worktree 才允许同 workspace 并发写。
- external sandbox 仍按 workspace lease 协调，因为多个容器可能挂载同一主机工作树。
- scheduler 采用 FIFO + 交互任务优先级；优先级只能影响排队顺序，不能绕过审批、资源或 workspace lease。
- run 取消、超时、崩溃恢复时必须释放 lease；lease 过期由 daemon watchdog 回收并写审计事件。
- provider/tool/sandbox 的 semaphore 都是硬上限；等待资源的 run 保持 `queued`/`planning`，不能占用模型上下文和无限内存。

## 4. 状态转移

```text
created → queued → planning → executing
                              ↘ waiting-approval → executing
                              ↘ completed
                              ↘ failed
                              ↘ cancelling → cancelled
                              ↘ timed-out
```

额外规则：

- `created` 只有校验成功后才能进入 `queued`；workspace、模型、sandbox capability 不满足时直接 `failed`，不启动工具。
- `waiting-approval` 只能由待处理 approval 事件进入；批准回到 `executing`，拒绝进入 `failed` 或继续由 loop 决定，但必须写明原因。
- `cancelling` 是幂等请求；停止模型、子进程、MCP、SSE producer 后才能进入 `cancelled`。
- 终态不可原地恢复；“继续”创建新 run，引用旧 `runId`/`lastEventSeq`。
- daemon 重启发现没有终态的 run，先写 `needs-recovery`；用户确认后才能重试未完成 step。

## 5. Turn 与 Step

```ts
type StepKind = 'context-build' | 'model' | 'approval' | 'tool' | 'compaction' | 'finalize';

interface Turn {
  turnId: string;
  runId: string;
  index: number;
  status: 'started' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
}

interface Step {
  stepId: string;
  turnId: string;
  kind: StepKind;
  attempt: number;
  startedAt: string;
  endedAt?: string;
  correlationId: string;
}
```

同一 `stepId + attempt` 只能有一个执行结果。模型重试、sandbox 重试和用户重新批准必须增加 `attempt`，不能覆盖旧事件。

## 6. Event envelope

```ts
interface DomainEvent<TType extends string, TPayload> {
  version: 1;
  id: string;
  seq: number;
  runId: string;
  at: string;
  type: TType;
  source: 'user' | 'orchestrator' | 'model' | 'tool' | 'policy' | 'sandbox' | 'system';
  correlationId: string;
  payload: TPayload;
}
```

事件类型分组：

| 类型 | 示例 payload | 约束 |
| --- | --- | --- |
| run | `run.created/started/completed/failed/cancelled/needs_recovery` | 改变 snapshot 状态 |
| turn/step | `turn.started/step.started/step.completed` | `index/attempt` 单调 |
| model | `model.requested/delta/completed` | delta 可重放，长度受限 |
| context | `context.item-added/compacted` | 摘要带 source seq 范围 |
| tool | `tool.requested/started/output/completed` | tool/version、risk、退出码和截断标记 |
| approval | `approval.required/decided/expired` | 决策来源、key 摘要、过期时间 |
| sandbox | `sandbox.prepared/denied/disposed` | provider、strength、capability snapshot |
| diff/test | `diff.updated/test.started/test.completed` | 文件 hash/退出码，不宣称已提交 |
| system | `warning/error/heartbeat` | 不改变业务状态 |

模型 delta、工具 stdout/stderr、diff 和错误详情必须有 byte limit 和 redaction；超过限制只追加摘要、hash、`truncated: true` 和存储引用。

## 7. EventStore 原子性

```ts
interface EventStore {
  append<T>(event: DomainEvent<string, T>): Promise<StoredEvent<T>>;
  appendBatch(events: readonly DomainEvent<string, unknown>[]): Promise<StoredEvent[]>;
  read(runId: string, afterSeq?: number): AsyncIterable<StoredEvent>;
  snapshot(runId: string): Promise<RunSnapshot | undefined>;
  markRecovery(runId: string, reason: string): Promise<void>;
}
```

- `seq` 在每个 run 内单调递增且无重复；跨 run 不要求连续；
- 事务顺序：校验 payload → 追加事件/快照 → commit → 广播；广播失败不能回滚已提交事件；
- `appendBatch` 要么全部成功，要么全部失败；工具 output 可分批，但每批均有序；
- SSE `after`/`Last-Event-ID` 先读持久化事件再接入 live subscription；
- 事件保留窗口过期返回 `EVENT_WINDOW_EXPIRED`，客户端先拉 snapshot 再继续。

## 8. 幂等、取消与恢复

- `POST /runs` 使用 `(createdBySessionId, clientRequestId)` 幂等键；重复请求返回原 run；
- approval/ cancel/input 都要求 `expectedVersion` 或 `Idempotency-Key`；旧版本返回 `CONFLICT`，不重复执行；
- cancel 只发出取消意图，实际终止由 orchestrator 写 `cancelling/cancelled`；
- 进程已退出但状态未知时写 `needs-recovery`，提供 `inspect`、`retry-step`（需用户确认）和 `discard`；
- 重试写工具前需比较目标文件 hash/patch base；不满足则进入人工确认，不自动覆盖。

## 9. 资源和并发预算

MVP 默认：最多 2 个 active run、每 run 一个 orchestrator、事件输出有上限、SSE 客户端有连接上限。具体默认值进入实现前的 benchmark spec；服务端必须 clamp：

```text
maxTurns        ≤ 50
maxWallTimeMs   ≤ 30 min
maxToolCalls    ≤ 200
maxOutputBytes  ≤ 50 MiB/run
maxContextBytes ≤ configured model budget
maxActiveRuns   ≤ daemon hard limit
```

超限不是静默截断任务：写 `run.failed` 或 `run.timed-out`，payload 说明哪一项触顶。

## 10. 测试验收

- 状态机所有合法/非法转移；终态不可写；
- run 创建幂等、旧版本冲突、重复 approval/cancel；
- event seq 单调、appendBatch 原子、重启 recovery、SSE 补发和窗口过期；
- delta/output/diff 截断与 redaction；
- 取消传播到模型、tool、MCP、sandbox；
- 超过 active-run、provider、tool、sandbox 容量时进入 queued，资源释放后按公平顺序唤醒；
- 同 workspace 写 lease 冲突时排队，read/read 不互相阻塞；
- 并发 run 的事件、审批、取消、SSE 不串线，runId/correlationId 始终可追踪；
- fake model + fake tool 正常、失败、审批、超时和 needs-recovery replay。

## 11. 已收敛决策

1. ID 采用 UUIDv7；
2. SQLite 为主 EventStore，JSONL 作为导出/灾备 adapter；
3. 支持并发 run，默认最多 2 个 active run，服务端硬上限和资源 semaphore 可限制更低；
4. 同 workspace 写操作默认 exclusive lease；worktree 并发写后置；
5. `needs-recovery` 只允许检查后创建新 run，不自动重试未知写操作。
