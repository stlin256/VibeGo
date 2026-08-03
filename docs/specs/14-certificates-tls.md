# Spec 14：LAN TLS 与证书管理最小闭环

**状态：Accepted（MVP）**

## 目标

- LAN 绑定默认使用 HTTPS；只有显式设置 `READY4VIBE_ALLOW_INSECURE_LAN=1` 才允许明文 HTTP；
- 证书在 daemon 启动时从文件加载并在进程内存中使用，不写入 EventStore、health、日志或 Web API；
- 为公网反向代理、Tailscale 和 SSH tunnel 保留清晰的传输适配边界；本阶段不引入常驻证书服务或外部数据库；
- 对证书/私钥缺失、只配置一半、不可读和不匹配提供稳定的错误 code，不回显 PEM 内容。

## 配置契约

LAN HTTPS 需要同时设置：

- `READY4VIBE_TLS_CERT_FILE`：服务器证书 PEM 文件，必须包含正确的 SAN（公网域名或访问 IP）；
- `READY4VIBE_TLS_KEY_FILE`：与服务器证书匹配的私钥 PEM 文件。

可选地，loopback 也可设置 `READY4VIBE_TLS_ENABLED=1` 使用 HTTPS；未设置时 loopback 仍使用 HTTP。LAN
若没有证书配置，daemon 必须 fail-closed 并给出修复提示；不能自动降级为明文。

`READY4VIBE_ALLOW_INSECURE_LAN=1` 只用于明确的开发/隔离网络场景。它不关闭 pairing、Bearer、Origin/CSRF
或 query token 禁止规则，也不改变未来 Tailscale/SSH transport 的安全策略。

## 证书管理边界

- `packages/certificates` 只负责环境变量解析、文件读取和 `tls.createSecureContext` 校验；私钥永不进入返回的
  status 对象；
- ACME/Let's Encrypt 自动签发、续期、Windows 证书存储和 UI 向导作为后续 adapter，不在 MVP 启动路径中隐式联网；
- 公网部署建议使用反向代理终止 TLS，daemon 仍绑定 loopback；若直接绑定 LAN，证书 SAN 必须覆盖客户端实际访问地址；
- Tailscale/SSH 通过 transport adapter 接入，不能通过把 token 放进 URL 或关闭 pairing 来绕过认证。

## 测试门禁

- 证书配置测试覆盖成对配置、缺失一项、读取失败和证书/私钥校验失败；
- daemon HTTPS 分支只接受经过校验的 credentials，health 的 transport kind 能区分 HTTP/HTTPS；
- 全仓 `typecheck`、`test`、`diff:check` 通过，测试不发起公网请求。
