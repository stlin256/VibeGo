# Spec 11：Filesystem/Shell Tool Adapter 边界

**状态：Accepted（MVP handler/runner contract，不接入 daemon agent loop）**

本阶段把工具元数据和执行边界连接起来，但不改变 daemon 的默认行为：工具必须经过
`ApprovalPolicy` 和 `SandboxResolver`，然后才能进入 adapter。测试使用临时目录和 fake
runner；默认 runner 不启动主机进程。

## 统一 ToolExecutor

- 请求包含 `ToolIntent`、sandbox policy、task trust、资源上限和结构化 input；不接受任意
  shell command 字符串；
- 先做 registry/version/risk/sandbox/network 校验，再做 approval 判定，再 resolve sandbox；
  `prompt` 与 `forbidden` 都 fail-closed，executor 不自行批准；
- sandbox resolver 失败直接返回 `SANDBOX_UNAVAILABLE`，禁止 fallback；
- handler 只接收经过 `PathGuard`/`ArgvGuard` 的结构化输入，结果不得泄露完整 daemon 环境、
  API key 或未授权绝对路径；
- adapter 错误使用稳定 code，消息为脱敏安全文本。

## Filesystem adapter

- 支持 `filesystem.read@1.0.0`、`filesystem.write@1.0.0` 的最小输入；路径必须是 workspace
  相对路径；
- read 有最大字节上限，write 有内容字节上限，父目录必须已存在且经过 realpath 检查；
- adapter 不自动创建父目录、不跟随 workspace 外 symlink；返回相对路径和内容/字节统计；
- 生产 wiring 后续再决定是否使用真实 `node:fs/promises`，本阶段默认通过注入接口测试。

## Shell adapter

- 输入只有 `argv[]`、可选 workspace-relative `cwd`、allowlist 环境变量和执行上限；
- 永远以 `shell=false` 交给 `ProcessRunner`，不拼接命令字符串；
- `ProcessRunner` 是独立接口，负责取消、超时和输出截断；本阶段没有默认主机 runner，未注入
  runner 时返回 `TOOL_EXECUTION_UNAVAILABLE`；
- command prefix 仅用于 approval cache 元数据，不能替代 argv 校验；
- shell 适配器不把 stdout/stderr 原样写入日志或模型上下文之外的远程响应，后续由事件层做
  字节/脱敏处理。

## 测试门禁

- 未批准、未知版本、风险不匹配、sandbox 不可用均不调用 handler/runner；
- filesystem 路径穿越、symlink escape、字节上限和父目录缺失均拒绝；
- shell 空 argv、NUL、控制字符、未知环境变量、`shell=true` 均拒绝；
- 测试不启动真实 shell，不改动用户 workspace，不包含或记录任何模型凭据。
