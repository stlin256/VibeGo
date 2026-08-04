# Spec 55：公网部署、证书自动化与运维文档

- Status: Proposed（新增规划规格；不改变当前运行时）
- Date: 2026-08-04
- Related: [Spec 12](12-auth-transport.md)、[Spec 14](14-certificates-tls.md)、[Spec 24](24-certificate-status.md)、[Spec 51](51-host-first-release-and-client-boundary.md)、[Spec 52](52-capability-profiles-and-first-run-experience.md)、[研究记录](../research/53-57-release-install-model-operations-research.md)

## 1. 目标与适用场景

为技术用户提供可审计的 loopback、LAN TLS、Tailscale/SSH 和公网 HTTPS 部署路径，并提供
足够的运维文档，使用户能安全地安装证书、续期、回滚、备份、观察和处理故障。

公网能力是显式 opt-in，不把 VibeGo 变成云端托管服务，也不自动打开端口、配置 UPnP、
修改系统防火墙或安装反向代理。默认 transport、pairing、Origin、CSRF、Approval、
Sandbox、Scheduler 和 Workspace 边界保持不变。

## 2. 受支持的部署模式

| 模式 | 默认 | 适用 | 额外门禁 |
| --- | --- | --- | --- |
| Loopback HTTP/HTTPS | 是 | 本机开发和 first-run | 本机 pairing；HTTP 仅限明确 dev mode |
| LAN TLS | 否 | 同一局域网远程浏览器 | 有效证书、pairing、Origin/CSRF、连接/速率限制 |
| Tailscale Serve/Funnel | 否 | 私有 tailnet 或用户主动公网暴露 | 健康检查、ACL 身份、pairing，不能扩大 capability |
| SSH local forward | 否 | 不想开放入站端口 | host-key verification、进程生命周期和断开清理 |
| 公网 HTTPS direct | 否 | 有域名且能管理 80/443 | ACME、TLS、认证、限流、备份、回滚、运维 readiness |
| 公网 reverse proxy | 否 | 已有 Caddy/Nginx/Traefik 等 | trusted proxy allowlist、forwarded header 校验、后端只监听 loopback |

首个 stable profile 至少完整验收一种公网路径；其他路径可以 `degraded`，但不能伪称
“已启用”或静默切换到明文 HTTP。

## 3. ACME 证书自动化

### 3.1 流程

```text
preflight(domain, DNS/firewall, clock, port)
  -> staging account
  -> staging challenge/issuance
  -> staging install + health probe
  -> explicit production confirmation
  -> production issuance
  -> atomic certificate switch
  -> renewal timer with jitter
  -> expiry/health monitor
  -> previous certificate rollback on failure
```

HTTP-01 是默认向导路径，必须说明它依赖端口 80 且不能签发 wildcard；DNS-01 是高级路径，
只接受用户选择的 DNS provider adapter 和最小权限 token。TLS-ALPN-01 仅作为显式平台适配器，
不在默认向导中隐藏启用。

### 3.2 Secret 与证书边界

- ACME account key、DNS API token、certificate private key 只进入 OS secret store 或受保护
  进程内存；不返回 Web/settings，不写 events/logs/backup/diagnostic。
- DNS-01 不接受完整 DNS 管理凭据；adapter 必须声明 zone/name scope、过期时间和撤销能力。
- staging CA 的根证书只用于测试 trust store，不得写入普通系统信任库或产品 backup。
- 续期使用新 candidate 文件和临时 listener/health probe；验证成功后原子替换，失败保留
  current/previous certificate。
- 启动前检查 hostname、SAN、有效期、chain、私钥匹配、文件权限和 clock skew；不通过则
  `certificate-invalid`，LAN/public mode fail-closed。

### 3.3 反向代理与 forwarded headers

当用户选择 reverse proxy：

1. daemon 只监听 loopback，proxy 负责公网 TLS；
2. `X-Forwarded-*` 只接受配置的 trusted proxy 地址；
3. Host/Origin/CSRF/session binding 以验证后的 external origin 为准；
4. WebSocket/REST/SSE 超时、body/connection limits 和 graceful shutdown 必须有明确值；
5. 文档必须提供最小配置示例和错误配置的安全回退，不复制第三方完整配置模板或源码。

## 4. 公网安全门禁

- loopback/LAN/public 是 transport，不是 capability profile；公网用户不会获得额外工具权限；
- pairing 一次性或短期有效，二维码不含长期 bearer token；session refresh 可撤销并有设备列表；
- public mode 强制 TLS、Origin、CSRF、rate limit、connection limit、request body/output limit；
- Web 不显示 API key、certificate private key、绝对路径、完整环境变量和 raw proxy error；
- Tailscale/SSH 断开必须终止 child process/forwarder，并释放 scheduler/sandbox lease；
- 公网关闭后，daemon 回到 loopback，不保留隐藏监听或静默端口转发；
- 证书、provider、MCP、memory、sandbox 任一 adapter 故障只能产生 bounded degraded/blocked，
  不得转成 Web 500 或 host fallback。

## 5. 运维文档交付物

`docs/operations/` 在实现阶段新增、按 release version 管理以下文档；每份文档都要有
适用版本、前置条件、风险级别、回滚步骤和“不会收集什么数据”的说明：

1. **安装与首次启动**：平台前置条件、数据目录、pairing、首次 profile 和卸载；
2. **LAN/公网拓扑**：端口、DNS、防火墙、trusted proxy、Tailscale/SSH 选择；
3. **ACME runbook**：staging、HTTP-01、DNS-01、续期、失败、撤销和 previous rollback；
4. **升级与回滚**：artifact 验证、current/previous、migration blocked、safe mode；
5. **备份与迁移**：backup manifest、加密导出、workspace rebinding、restore dry-run；
6. **健康与资源**：`/health`、SSE 连接、SQLite/WAL、CPU/RSS/disk、usage/cost unknown；
7. **事故响应**：证书泄露、credential rotation、恶意 tool、错误 release、数据损坏；
8. **日志与隐私**：redaction、retention、用户主动导出、删除和诊断包检查；
9. **升级兼容矩阵**：当前/previous/db schema/model provider/browser/OS；
10. **安全披露与支持**：security contact、受支持版本窗口、已知限制和不受支持的环境。

文档示例不得要求用户把 API key、private key、环境变量或完整 workspace transcript 粘贴
到 issue、聊天、日志或第三方网站。命令示例必须使用占位符，危险操作前要有明确确认。

## 6. 运维状态与诊断

新增只读 projection（不进入 `run_events`/`goal_events`）：

```text
transportStatus
certificateStatus
pairingStatus
updateStatus
backupStatus
storageStatus
optionalAdapters
lastHealthAt
safeDiagnosticId
```

每项使用 `ready | degraded | blocked | unknown`，附稳定 reason code、下一步和是否影响
interactive run。诊断下载为 bounded、redacted bundle，并在生成前展示包含项和保留期限。

## 7. 测试与验收

- ACME staging HTTP-01 成功、port 80 不可用、DNS-01 propagation、scope 错误、续期、撤销、
  certificate mismatch、chain/clock/permission failure 和 rollback；
- direct TLS 与 reverse proxy 的 Host/Origin/CSRF/forwarded-header/SSE/connection limit；
- Tailscale/SSH adapter 的 unavailable、ACL/host-key mismatch、cancel、disconnect、child cleanup；
- LAN/public 未配 TLS 时 fail-closed；关闭 public 后无遗留监听；
- credential/private-key 永不出现在 Web、事件、日志、backup、诊断和 error body；
- restart、upgrade、restore、certificate rotation 后 pairing/session 及 run authority 不变；
- 运维文档命令在 Windows/macOS/Linux 至少各有一套可复现 fixture；
- `pnpm smoke:acme -- --staging`、`pnpm smoke:tailscale`、`pnpm smoke:ssh` 只在显式 release
  验收中运行，普通 `pnpm verify` 保持离线和无 secret。

## 8. 明确不做

- 不自动配置 UPnP、端口映射、DNS、系统防火墙或公网 reverse proxy；
- 不把 VibeGo 变成云端证书托管或集中式 telemetry 服务；
- 不在 daemon 中永久保存 ACME/DNS private credential；
- 不以“配置成功”代替真实 challenge、renewal、rollback 和断网恢复证据；
- 不创建第二套认证、session、scheduler、approval 或执行平面。
