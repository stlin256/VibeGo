# Spec 01：沙箱、执行策略与低摩擦审批

**状态：Accepted（首版详细规格，代码尚未实现）**

## 1. 目标与非目标

### 目标

- 对 shell、filesystem、patch、Git、MCP/Skill 工具提供统一的执行前策略；
- 让可信 workspace 的常见只读/构建流程尽量无感；
- 让不可信任务默认进入 external sandbox；
- 让每次授权都可解释、可撤销、可审计、可测试；
- 保留 LAN、Tailscale、SSH 三种远程传输的共同认证/事件模型。

### 非目标

- 不承诺 Node 进程本身抵御内核或容器逃逸；
- 不允许模型自行修改审批规则、sandbox 等级或网络 allowlist；
- 不提供永久 `danger-full-access` 自动批准；
- 不把用户在某一次对话中的自然语言“同意”当作可复用授权。

## 2. 有效权限模型

执行权限是以下 tuple 的函数，而不是单个布尔值：

```text
EffectivePermission = f(
  taskTrust,
  sandboxPolicy,
  filesystemPolicy,
  networkPolicy,
  execPolicy,
  approvalPolicy,
  sessionGrants,
  userDecision
)
```

### 2.1 SandboxPolicy

```ts
type SandboxPolicy =
  | { mode: 'read-only'; network: 'restricted' | 'enabled' }
  | { mode: 'workspace-write'; writableRoots: string[]; network: 'restricted' | 'enabled' }
  | { mode: 'external-sandbox'; provider: 'docker' | 'podman' | 'vm'; network: 'restricted' | 'enabled' }
  | { mode: 'danger-full-access'; enabledBy: 'explicit-user-only' };
```

- MVP 默认：可信任务 `workspace-write + restricted network`；不可信任务 `external-sandbox + restricted network`。
- `danger-full-access` 不进入默认 UI 快捷选项；即使用户开启，也必须逐次确认并写入高风险审计。
- `writableRoots` 必须是规范化绝对路径；实际执行前重新解析符号链接并验证未逃逸。
- `network: enabled` 只表示允许连接，还要经过 network allowlist/approval；不能凭 sandbox 模式自动放行任意域名。
- denied-read 路径一旦配置，任何“升级权限”都不得丢失该限制；如果无法保留，操作必须拒绝。

### 2.2 Task trust

```ts
type TaskTrust = 'trusted-workspace' | 'untrusted-content';
```

来源：用户在创建 run 时明确选择，或 workspace policy 强制指定。Skill/MCP 内容、未知仓库、下载的补丁和外部 issue 默认按 `untrusted-content` 处理，不能通过 prompt 改回 trusted。

## 3. 执行策略

### 3.1 AskForApproval

```ts
type AskForApproval =
  | 'untrusted'
  | 'on-request'
  | {
      granular: {
        sandboxApproval: boolean;
        ruleApproval: boolean;
        skillApproval: boolean;
        permissionRequest: boolean;
        mcpElicitation: boolean;
      };
    }
  | 'never';
```

语义：

- `untrusted`：默认对不可信/未被规则允许的动作询问；可信 workspace 的明确低风险规则可自动执行；
- `on-request`：只有执行器判定需要权限提升时询问；
- `granular`：按审批类型独立开关，关闭某类审批时该类请求必须 `deny`，不能静默执行；
- `never`：不显示审批弹窗；不满足规则或沙箱能力的动作直接 `deny`，不得把 `never` 解释为全权执行。

### 3.2 ExecPolicy

采用独立的、版本化的 prefix-rule 数据模型，而不是把任意表达式直接交给 shell。MVP 的持久化格式是 JSON schema；Codex 风格文本规则编译器属于后续适配器，不进入第一版执行路径：

```ts
type RuleDecision = 'allow' | 'prompt' | 'forbidden';

interface PrefixRule {
  pattern: Array<string | string[]>;
  decision: RuleDecision;
  justification: string;
  matchExamples: string[][];
  notMatchExamples: string[][];
}

interface HostExecutable {
  name: string;
  absolutePaths: string[];
}

interface PolicyDocumentFile {
  version: 1;
  workspaceId: string;
  rules: PrefixRule[];
  hostExecutables: HostExecutable[];
  networkRules: NetworkRule[];
}

interface LoadedPolicyDocument extends PolicyDocumentFile {
  revision: string; // canonical JSON hash, computed by the loader
}
```

评估算法：

1. 将 argv 规范化为 token，同时保留原始展示文本；禁止把未解析的字符串拼成新 shell。
2. 先精确匹配第一个 token；需要 basename fallback 时，仅允许 `HostExecutable.absolutePaths` 中的真实路径。
3. 收集所有 prefix 命中，取最严格结果：`forbidden > prompt > allow`。
4. 未命中规则时运行平台相关危险命令启发式，但启发式只能升级为 `prompt/forbidden`，不能自动升级为 allow。
5. `forbidden` 不可被一次批准、会话批准或网络规则覆盖；只能由用户修改规则文件后重新运行。
6. `matchExamples/notMatchExamples` 在规则加载时执行，作为规则自身的单元测试。

默认规则至少覆盖：提权、编码命令、删除/覆盖、任意解释器执行、修改系统服务/防火墙、推送受保护分支、任意外部网络上传。允许规则必须绑定 workspace、工具版本和参数约束。`LoadedPolicyDocument.revision` 为规范化 JSON 的 hash；直接编辑规则文件会使旧 grant 失效。

示例文件：

```json
{
  "version": 1,
  "workspaceId": "ws_01",
  "rules": [
    {
      "pattern": ["git", "status"],
      "decision": "allow",
      "justification": "只读仓库状态",
      "matchExamples": [["git", "status"]],
      "notMatchExamples": [["git", "reset", "--hard"]]
    }
  ],
  "hostExecutables": [],
  "networkRules": []
}
```

Schema 校验、revision 计算和 `matchExamples/notMatchExamples` 验证在加载时完成；首版不解析 Starlark/任意脚本。

### 3.3 NetworkPolicy

```ts
interface NetworkRule {
  protocol: 'http' | 'https' | 'socks5-tcp' | 'socks5-udp';
  host: string;
  decision: 'allow' | 'prompt' | 'forbidden';
  expiresAt?: string;
}
```

网络审批独立于命令审批：用户批准 `npm install` 不等于批准它访问所有域名。首版默认 `restricted`；一次允许只授予显示的 protocol + host + run/session 范围。

## 4. 审批决策与缓存

```ts
type ApprovalDecision =
  | 'accept'
  | 'accept-for-session'
  | { acceptWithRule: PrefixRule }
  | { acceptWithNetworkRule: NetworkRule }
  | 'decline'
  | 'cancel';
```

### 4.1 ApprovalKey

```ts
interface ApprovalKey {
  workspaceId: string;
  taskTrust: TaskTrust;
  tool: string;
  toolVersion: string;
  resolvedExecutable?: string;
  normalizedPrefix?: string[];
  targetPaths: string[];
  sandboxMode: SandboxPolicy['mode'];
  networkTarget?: { protocol: string; host: string };
  policyRevision: string;
}
```

- `accept-for-session` 只写入内存 session store，daemon 重启或 session 结束即失效；
- 一个 patch 触及多个文件时，为每个文件生成 key；只有全部 key 已批准，才跳过询问；
- 命令参数、路径、解释器、网络 host、sandbox 等级或 policyRevision 变化时不得命中旧 grant；
- key 中不得存原始 secret/完整 token，只存规范化摘要和 hash；
- grant 必须带 `createdAt/expiresAt/source/auditId`，用户可在 UI 撤销。

### 4.2 低摩擦流程

1. 规则 `allow` + sandbox 能力满足：直接执行，不弹窗。
2. 规则 `prompt` 或 sandbox 权限不足：弹一次审批卡，先尝试受限 sandbox；不要先执行无沙箱命令。
3. 用户可一键“允许本次”或“本会话允许同类操作”；后者明确展示 key 范围。
4. 沙箱失败时，只有策略允许且 denied-read 等限制仍可保留，才显示“升级执行环境”；否则直接解释拒绝原因。
5. 网络请求单独显示 host/protocol/原因；批准后只对该 network key 生效。
6. 审批超时、连接断开、用户取消和 daemon 重启都按 `cancel/deny/needs-recovery` 处理，不自动重试写操作。

## 5. 自动审查（Guardian-like，可选）

为保持 Codex 式低摩擦，同时避免让模型直接获得权限，采用三层：

### Layer A：确定性本地策略（必须）

Prefix rule、路径/网络 allowlist、sandbox capability 和 session cache 先做决定。R0/R1 的明确 allow 可以无感执行；R4 直接拒绝。

### Layer B：自动审查器（后续接口，MVP 不实现）

未来当规则无法确定且动作不属于 R4，可把**结构化 action**提交给本地 Guardian provider：工具、argv、路径、网络目标、diff 摘要、sandbox 和用户目标。Guardian 只能返回 `allow-once | ask-user | deny`，不能修改规则、增加路径或读取 secret。MVP 只实现 Layer A + Layer C。

- 超时、解析失败、输入不完整、provider 不可用：`deny` 或转人工，不回退到 allow；
- Guardian 结果必须和 User decision 区分记录；
- Guardian 永远不能自动批准提权、secret 读取、任意外传、破坏性 Git、系统设置和 `danger-full-access`；
- 默认关闭外部 Guardian 网络调用，避免把代码/命令发送出本机。

### Layer C：用户审批

移动端/桌面端显示最终 action；用户可以一次批准、会话批准、追加规则、追加网络规则、拒绝或取消。任何用户批准仍受 sandbox 和 deny rule 的硬约束。

## 6. 不可信任务流程

```text
create run(taskTrust=untrusted-content)
  → detect external sandbox capability
  → no capability: reject with actionable explanation
  → prepare container/VM (readonly image, explicit mounts, restricted network)
  → run deterministic policy inside boundary
  → low-risk actions auto-approved
  → write/network/escape attempts ask or deny
  → dispose and record audit
```

不可信任务不能使用 host `workspace-write` 作为“临时兼容模式”。如果用户明确把任务改为 trusted workspace，必须新建 run，并在审计中记录变更。

## 7. LAN 安全门禁

### 启动

- 默认 `127.0.0.1`；`--listen lan` 才开启私网监听；
- 绑定前枚举网卡和私网 CIDR，仅允许用户选择的接口；不允许 `0.0.0.0` 无提示；
- LAN 默认强制 HTTPS；显式 `--allow-insecure-http` 只能用于 loopback/明确选择的私网场景，公网模式永远拒绝；
- 显示 LAN 地址、端口、配对状态、TLS 状态、证书指纹和当前 sandbox 能力；
- 本机 CLI 仍可通过 loopback 管理配对、撤销 token 和关闭 LAN。

### 证书管理

```ts
type CertificateSource = 'managed-self-signed' | 'provided-files' | 'acme';

interface CertificateManager {
  inspect(): Promise<CertificateStatus>;
  importProvided(input: { certificatePath: string; privateKeyPath: string }): Promise<void>;
  rotate(source: CertificateSource): Promise<void>;
  reload(): Promise<void>;
}
```

- `managed-self-signed`：为局域网 IP/主机名生成证书，展示 fingerprint/有效期，私钥只存本机受限目录；
- `provided-files`：用户导入 fullchain/key，启动时校验 SAN、有效期和权限，支持热加载；
- `acme`：后续实现，支持 HTTP-01/DNS-01 provider，但不自动开端口、不自动修改 DNS/路由；
- 证书过期前 30 天告警，轮换失败保持旧证书并告警；
- 私钥不进入 API 响应、日志、事件、模型上下文或浏览器存储；
- `public-https` 未来 transport 必须存在有效证书和 token/Origin/速率限制，不能用 `--allow-insecure-http` 绕过。

### 请求

- 首次使用一次性 pairing code；兑换后 access token 短期有效，refresh token 轮换并只存 hash；
- 写 API、SSE、WebSocket 都鉴权；`Origin` 必须匹配已配对浏览器或显式 allowlist；
- 同源 cookie 方案需 CSRF token；Bearer 方案不把 token 放 URL；
- 对登录、配对、创建 run、审批、事件订阅限速；失败不泄露“用户是否存在”；
- token、pairing code、源码、命令原文和 secret 不写访问日志。

### 未来 Transport port

```ts
interface RemoteTransport {
  readonly kind: 'lan-http' | 'tailscale' | 'ssh-stdio';
  start(handler: ApiHandler, signal: AbortSignal): Promise<void>;
  peerIdentity(request: IncomingRequest): Promise<PeerIdentity>;
  close(): Promise<void>;
}
```

Tailscale adapter 复用 API/auth/event contracts，可额外绑定 tailnet identity；SSH adapter 通过 stdin/stdout 或本地转发，不开放额外公网端口。transport 不能修改 sandbox/approval 决策，只提供连接身份和数据通道。

## 8. 必须自动化验证

### 策略

- allow/prompt/forbidden 优先级、精确 token、basename fallback、host executable 限制；
- match/notMatch 示例在加载时验证；
- `never` 不得把 prompt 变成 allow；关闭 granular 子项必须 deny；
- denied-read 存在时升级权限不得绕过；
- session key 命中/不命中、patch 多路径、policy revision 变化、过期 grant。

### 沙箱

- trusted workspace 的 read-only/workspace-write；
- untrusted 无 external sandbox 时安全失败；
- Docker/VM 挂载仅包含 allowlist，网络默认禁用；
- 子进程树取消、CPU/内存/输出/时间上限；
- Windows/macOS/Linux adapter 能力报告与实际行为一致。

### LAN

- loopback 默认，LAN 未显式开启时拒绝；
- 私网绑定 allowlist、TLS/证书状态、Origin/CORS/CSRF、token 轮换、重放、速率限制；
- SSE 断线恢复不越权、不跨 run 泄露事件；
- 未来 Tailscale/SSH transport 通过同一 contract test suite。
