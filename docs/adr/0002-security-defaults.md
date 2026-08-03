# ADR 0002：本地优先、显式远程访问与审批/沙箱安全默认值

- 状态：Accepted
- 日期：2026-08-03

## 威胁模型

保护对象包括：源代码、未提交 diff、模型 API key、MCP credentials、shell 能力、审计记录和远程会话 token。默认假设模型输出、Skill 内容、MCP server 返回值和远程浏览器输入都可能是恶意或被提示注入污染的。

不在 MVP 威胁模型内：多用户协作的强隔离、内核级 exploit 防御、供应链完全证明、云端密钥托管。需要这些能力时必须升级到专用 sandbox/VM 和独立身份系统。

## 网络和身份默认值

1. daemon 默认绑定 `127.0.0.1`/`::1`，不监听局域网和公网。
2. 首版允许显式 `--listen lan` 开启局域网访问；只绑定用户选择的私网接口/CIDR，不允许无提示绑定 `0.0.0.0`，不自动 UPnP/端口映射。
3. LAN 不是可信边界：首次访问使用一次性配对码；配对后发放随机 refresh token 和短期 access token，token 只存 hash，并支持轮换/撤销。
4. 默认只接受已配对 Origin；CORS allowlist、Origin 校验、CSRF 防护、速率限制和失败退避由 daemon 负责。
5. LAN 和未来公网 transport 默认强制 HTTPS；用户可以显式关闭 TLS，但 `public-https` 永远不接受明文。MVP 提供证书状态/导入/轮换接口，未来再增加 ACME 自动续期。
6. MVP 实现 `LanHttpTransport`，但 API/事件只依赖 `RemoteTransport` port；未来 `TailscaleTransport`、`SshStdioTransport` 复用同一认证和权限模型。
7. 推荐通过 HTTPS 反代、Tailscale/WireGuard 或 SSH 隧道使用；产品不自带公网穿透服务。
7. SSE、WebSocket 和所有写 API 都需要认证；日志、URL、异常不得输出 token。

## 审批策略

| 风险 | 典型动作 | 默认 | 备注 |
| --- | --- | --- | --- |
| R0 | workspace 内列目录、读小文件、`git status`、解析已有日志 | 策略 allow 时自动 | 仍受路径、大小和速率限制 |
| R1 | 生成 diff、运行只读静态分析、读取 Git 历史 | 策略 allow 时自动，否则询问 | 必须来自固定工具，不允许任意 shell |
| R2 | 写入 workspace、应用 patch、运行项目测试/构建 | 询问 | 可按精确 key 授予短期/会话 grant |
| R3 | 网络访问、安装依赖、启动外部服务、访问 workspace 外路径 | 每个目标逐次询问或拒绝 | 命令批准不等于任意网络批准 |
| R4 | 删除、覆盖密钥、系统设置、提权、修改防火墙/服务 | 默认拒绝 | 不提供永久自动批准 |

自动审批规则必须是 allowlist，包含工具名、版本、workspace、参数约束、调用次数和过期时间。模型说“用户已经同意”不构成授权。移动端批准页必须显示可读命令、路径、网络目标、风险和 diff 摘要。

## 沙箱等级

- **read-only**：可读取声明范围，不写 workspace；
- **workspace-write**：只能写入规范化 `writableRoots`，默认网络受限；
- **external-sandbox**：Docker/Podman/VM 等独立边界，显式挂载、默认无网络和 CPU/内存/进程上限；
- **danger-full-access**：仅显式用户操作可开启，不进入默认快捷路径。

可信 workspace 默认 `workspace-write + restricted network`；不可信 Skill/MCP/仓库默认必须 `external-sandbox`。若机器没有可验证的 external sandbox，UI 阻止任务创建并解释原因，不静默降级到主机执行。

详细的 Codex-like rule、session grant、network approval、证书和自动审查流程见 [Spec 01](../specs/01-sandbox-approval.md)。

## Secret 与数据处理

- API key、refresh token、MCP secret 只进入 OS keychain/受限文件；不进入 Git、事件 payload、模型上下文或浏览器 localStorage。
- 子进程环境使用显式 allowlist；`process.env` 不得整体传递。
- 工具输出、日志和事件在入库/广播前做 secret redaction；长度、编码和二进制内容都有限制。
- 原始运行记录默认本地保存，用户主动导出；导出前显示包含哪些文件和敏感字段。
- telemetry 默认关闭；如未来增加，必须单独开关、文档和测试证明不含源码/secret。

## 审计与恢复

每次工具调用、审批决定、策略变更、登录/配对、取消和沙箱创建都记录 `auditId`、主体、时间、runId、tool/version、风险、决策、参数摘要 hash 和结果码。审计记录 append-only，UI 只读。

崩溃恢复时宁可把 run 标记为 `failed/needs_recovery`，也不能猜测上一个写操作是否成功；重试必须由用户确认并使用幂等键或文件 hash。

## Codex-like 低摩擦行为（独立实现）

本项目参考当前 Codex 开源快照的行为模型：三态执行规则（allow/prompt/forbidden）、沙箱与审批联动、按命令/文件 key 缓存会话批准、一次/会话/追加规则/网络规则等不同决策。我们不复制 Rust 实现、Guardian 提示词或私有协议；自动审查器超时/失败时 fail closed，且永远不能放行 R4。

## 安全验收门禁

- 路径穿越、符号链接逃逸、shell 注入、环境变量泄漏、MCP schema 注入、SSE 越权和 token 重放均有自动化测试；
- 高风险规则没有覆盖测试时，默认 deny；
- 任何新增工具必须补充风险分类、最小权限、审计字段、单元测试和安全文档；
- 发布说明必须列出当前 sandbox 强度和已知限制，不能用“安全”笼统宣称。
