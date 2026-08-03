# Spec 09：ToolRegistry 与确定性 ApprovalPolicy

**状态：Accepted（MVP policy/tool metadata 约束）**

本阶段只实现工具元数据、策略判定和会话批准缓存，不执行 shell/filesystem/Git。执行器必须在后续 sandbox/tool adapter 中再次检查策略，不能把本包的 `allow` 当作绕过沙箱的授权。

## ToolRegistry

- 每个工具必须有稳定 `id`、版本、风险等级、输入摘要 schema 和支持的 sandbox 模式；
- 同一 `id + version` 不可重复注册；未知工具请求直接 `forbidden`；
- registry 只返回安全元数据，不暴露 handler、环境变量、密钥或完整策略文件；
- 工具 descriptor 与执行器分离，便于 MCP/Skill 后续以 adapter 方式接入。

## ApprovalPolicy

- 决策只有 `allow`、`prompt`、`forbidden`；
- `read` 风险默认 allow；`write` 在 `on-request`/`untrusted` 下 prompt；不可逆/破坏性操作默认 forbidden；
- `taskTrust=untrusted-content` 若 sandbox 不是 `external-sandbox`，无条件 forbidden；
- `danger-full-access` 不得用于不可信任务；
- granular policy 的 `permissionRequest`/`sandboxApproval` 等开关只会收紧决策，不会扩大权限；
- 会话批准缓存 key 必须精确包含 workspace、tool、tool version、命令前缀、路径、网络目标、sandbox mode 和 policy revision；不同任一字段都不能复用批准。

## 测试门禁

- 注册冲突、未知工具和安全 descriptor 投影；
- trusted/untrusted、sandbox、风险等级、policy mode 的决策矩阵；
- 精确 approval cache key、命中/失效和过期；
- 不执行任何真实命令，不读取用户 workspace。
