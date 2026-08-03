# Spec 10：SandboxResolver 与执行输入安全边界

**状态：Accepted（MVP verifier/path/argv 约束）**

本阶段不启动用户命令，不挂载真实 workspace，也不自动安装 Docker/Podman。目标是先把安全门禁做成可测试的 resolver 和输入校验。

## SandboxResolver

- `taskTrust=untrusted-content` 只能选择 `external-sandbox`；缺少 provider、provider 未验证或 capability 不匹配时直接 `SANDBOX_UNAVAILABLE`；
- 不可信任务绝不降级到 `read-only`、`workspace-write` 或主机 shell；
- external provider 统一接口保留 Docker、Podman、VM adapter；provider 必须报告 runtime、版本、隔离模式、网络模式和资源限制能力；
- `danger-full-access` 只允许 trusted task 且由显式用户开关开启；
- resolver 只决定可用执行边界，不代表 approval 已通过。

MVP 的 provider verifier 只返回健康状态和能力快照，不启动容器或虚拟机。resolver 的失败统一使用
`SANDBOX_UNAVAILABLE`（通过错误对象的 `reason` 区分 `provider-missing`、`provider-unhealthy`、
`capability-mismatch`、`untrusted-host-fallback` 等），调用方不得把失败转换成 host 执行。

`danger-full-access` 需要同时满足 `taskTrust=trusted-workspace`、配置模式为
`enabledBy=explicit-user-only`，以及本次请求携带显式用户确认；untrusted task 永远拒绝该模式。

## PathGuard

- workspace 工具只接受相对路径；拒绝 NUL、驱动器路径、UNC 路径和 `..` 越界；
- 对已存在目标使用 `realpath` 检查 symlink escape；新文件检查真实父目录；
- 输出统一为规范化绝对路径，但不进入模型上下文或远程响应，除非 API 明确请求安全 diff。

## ArgvGuard

- shell adapter 只接受 argv 数组，默认 `shell=false`，禁止拼接 shell 字符串；
- 环境变量使用 allowlist，默认不继承 daemon 全量环境；
- command prefix 仅用于 policy/cache 元数据，不能替代 argv 校验；
- 超时、输出字节上限和取消信号由执行器强制，不能由模型输入覆盖。

MVP `ArgvGuard` 的输出是 `{ argv, shell: false, env }`：`env` 只包含调用方声明的 allowlist
键，默认是空对象，不继承 daemon 环境。空 argv、NUL、控制字符、shell 元字符和未知环境变量
均在执行前拒绝；此阶段不启动真实进程。

`PathGuard` 与 `ArgvGuard` 的错误码是稳定的机器可读字符串，供后续 tool/approval/UI 映射，
错误消息不得包含 API key、完整环境变量或未授权的绝对路径。

## 测试门禁

- untrusted 缺 external provider、provider 不健康、能力不匹配均拒绝且无 host fallback；
- 路径穿越、symlink escape、Windows 驱动器/UNC/NUL；
- argv 空数组、NUL、shell 元字符策略和环境 allowlist；
- 测试不执行真实 shell，不改变用户 workspace。
