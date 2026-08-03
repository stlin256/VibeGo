# ADR 0003：单用户局域网访问与低摩擦审批

- 状态：Accepted
- 日期：2026-08-03

## 已确认需求

- 首版只支持单用户；
- coding 主机允许局域网浏览器访问；
- 必须有安全门禁，不能把“局域网”当作可信边界；
- 设计中保留 Tailscale/SSH 接入渠道；
- 不可信任务和自动审批参考 Codex 的低摩擦体验，但实现独立、可审计、默认拒绝高风险动作。

## 决策

1. daemon 仍以单用户、单主机为核心；不引入多租户/RBAC，但每个连接都必须经过配对和 token 校验。
2. LAN 是显式 opt-in：默认 loopback；`--listen lan` 才监听私网地址，并要求一次性配对、短期 access token、refresh token 轮换、Origin/CSRF 校验和速率限制。
3. LAN 和未来公网 HTTPS 默认强制 TLS；明文 HTTP 只能由用户显式关闭 TLS，且仅限 loopback/明确选择的私网场景，公网 transport 永远拒绝明文。提供证书管理能力（自签名、用户证书、未来 ACME），不使用公网穿透、UPnP 或隐式 mDNS 登录。
4. Transport 通过 `RemoteTransport` port 抽象。MVP 实现 `LanHttpTransport`；未来增加 `TailscaleTransport` 和 `SshStdioTransport`，不改 harness/API/event contracts。
5. 审批采用“确定性策略优先、自动审查可选、用户最终兜底”的三层模型：规则允许的低风险动作无感执行；不确定动作进入一次审批；高风险/不可逆动作默认拒绝。
6. 会话级批准只能在同一工具、workspace、命令前缀、网络目标和沙箱权限 key 下复用；不做全局永久 yes。
7. 不可信任务必须选择 external sandbox（Docker/VM 等）；没有可验证的 external sandbox 时，创建任务失败，不静默降级到主机执行。

## 为什么不是直接照搬 Codex

Codex 当前开源快照提供了有价值的行为模型，但其 Rust 运行时、Guardian、平台沙箱和产品权限模型不属于本项目可直接复用的代码或协议。我们只保留可验证的概念：分级审批、规则引擎、会话缓存、网络规则、沙箱/审批联动和明确的拒绝路径。

## 影响

- `docs/specs/01-sandbox-approval.md` 成为实现与讨论的详细合约；
- API 需要暴露“当前连接方式、sandbox 强度、审批来源和 grant 范围”，而不是只返回 boolean；
- UI 必须让“自动允许”“Guardian 审查通过”“用户批准”三种来源可区分；
- 未来 Tailscale/SSH 只能增加 transport，不得通过绕过 LAN auth 的隐藏通道取得更高权限。
- 证书私钥只存本机受限目录/系统密钥存储；证书轮换、指纹和过期告警可由 UI 管理，但 UI/API 永不返回私钥。
