# Spec 15：Skill/MCP Manifest 与工具 Allowlist

**状态：Accepted（manifest/allowlist MVP）**

## 目标与非目标

- 为 Skill 和 MCP server 提供版本化、严格、可审计的 manifest 边界；
- 默认拒绝未知字段、超大描述、任意环境变量、shell 元字符、公开 HTTP MCP 地址和 URL 中的 secret；
- 只返回经过 allowlist 过滤的公开工具描述，不把 input schema、环境值或 transport credential 暴露到 UI；
- 本阶段不启动 MCP stdio 子进程、不发起 HTTP 请求、不执行 Skill instructions；manifest 内容永远是“不可信数据”，不能改变 sandbox/approval 默认值。

## Manifest 形状

### Skill

```json
{
  "kind": "skill",
  "id": "typescript",
  "version": "1.0.0",
  "name": "TypeScript helper",
  "description": "...",
  "instructions": "...",
  "allowedTools": ["filesystem.read@1.0.0"],
  "allowedMcpServers": ["docs-server"],
  "envAllowlist": ["DOCS_CACHE_DIR"]
}
```

### MCP server

MCP 支持 `stdio` 和 `http` 两种 transport：

- `stdio` 只允许不含路径分隔符、shell 元字符和控制字符的 executable name；args 不经过 shell；
- `http` 只允许 HTTPS，或明确的 loopback HTTP（`localhost`、`127.0.0.1`、`::1`）；URL 不允许 userinfo、token/key/secret 查询参数；
- server 只能声明环境变量名称 allowlist，不能在 manifest 中携带环境变量值或 secret；
- 工具必须声明稳定 id/version、summary、risk；没有 allowlist 命中时默认不暴露。

## 安全限制

- 单个 JSON manifest 最大 64 KiB；Skill instructions 最大 32 KiB；单 server 最多 128 个工具；
- id、version、env name 和 tool reference 使用可打印字符白名单；禁止 NUL、控制字符和隐式换行注入；
- unknown field、secret-shaped field、非法 transport、公开明文 HTTP 和 argv shell 元字符均 fail-closed；
- `resolveMcpTools` 只返回 `id/version/summary/risk`，不返回原始 schema 或 transport 配置；
- 后续真实连接器必须在 `ApprovalPolicy`、`SandboxResolver` 和 scheduler 之后接入，并为每个请求生成审计事件。

## 测试门禁

- valid Skill、stdio、HTTPS/loopback HTTP manifest 能被解析；
- 超限、unknown field、secret、非法 argv、公开 HTTP、URL credential/query token 被拒绝；
- 空 allowlist 默认 deny，命中 allowlist 时仅返回脱敏的 public tool descriptor；
- 全仓 typecheck/test/diff:check 通过，测试不访问网络、不启动子进程。
