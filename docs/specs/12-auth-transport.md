# Spec 12：单用户认证、LAN 门禁与未来 Transport

**状态：Accepted（MVP pairing/token gate；TLS/certificate manager 后置）**

## 默认策略

- 默认监听 `127.0.0.1`，loopback 可按现有本机开发流程访问；
- LAN 监听必须显式开启，且默认 `authRequired=true`、`tlsRequired=true`；
- 仅当用户显式设置 `allowInsecureLan=true` 时允许明文 LAN，启动日志/health 必须显示
  `tlsRequired=false` 与降级状态；
- 当前 daemon 尚未接入 HTTPS listener，因此 LAN 在默认 TLS 要求下会拒绝启动；只有显式
  `READY4VIBE_ALLOW_INSECURE_LAN=1` 才能进入明文开发模式，后续 certificate manager 接入后
  才移除此启动限制；
- `authRequired=false` 只能作为显式开发开关，不能由请求参数或模型内容关闭；
- Tailscale/SSH 先作为 transport identity 类型保留，仍复用同一 API authorization，不绕过
  pairing/token 和 approval。

## Pairing 与 token

- pairing start 仅允许 loopback，生成短时一次性 code；complete 消费 code，只返回一次随机
  access token 和 CSRF token；服务端只保存 token/code 的 hash 和过期时间；
- token 使用 Bearer header，禁止 query/cookie 传 token；验证使用 constant-time compare；
- token 有 TTL、撤销和单用户 session 标识；API、SSE、取消和未来 approval endpoint 都经过
  同一 gate；health 与 pairing complete 是有限的匿名例外；
- 错误只返回 `AUTH_REQUIRED`、`INVALID_TOKEN`、`PAIRING_REQUIRED`、`PAIRING_EXPIRED`、
  `TLS_REQUIRED` 等稳定 code，不回显 token、pairing code 或远端环境信息。

## Origin/CSRF 与远程边界

- 带 `Origin` 的 LAN 写请求必须匹配配置的 UI origin，并携带与 session 绑定的 CSRF header；
- 原生客户端可不发送 Origin，但仍必须带 Bearer token；Bearer 不放入 URL；
- pairing start/complete 与普通 API 分开授权，不能以 health 响应作为认证证明；
- 认证失败不得触发 run 创建、取消、SSE 订阅或文件/命令工具。

## 证书与后续接入

- 本阶段不生成/持久化私钥，不自动申请 ACME；只暴露 `tlsRequired`/transport 状态和后续
  certificate manager 的 adapter 接口位置；
- certificate import/rotate 后续仅允许 loopback 管理端，私钥不进入日志、EventStore、SSE
  或 API response；
- Tailscale/SSH adapter 只提供 peer identity，最终授权仍由 AuthGate 决定。

## 测试门禁

- pairing code 一次性、过期、错误 code、token 过期/撤销和 constant-time 验证；
- LAN 未认证请求统一拒绝，loopback pairing start 可用；health 不泄露 secret；
- Origin/CSRF、Bearer query 泄露、TLS 明文降级和未来 transport identity 均有 contract test；
- 测试不写入真实凭据、不启动公网监听。
