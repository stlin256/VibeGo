# Spec 17：Docker/Podman CLI Runner

**状态：Accepted（受控 runner MVP）**

## 目标与边界

- 将 `SandboxLaunchPlan` 交给 Docker/Podman CLI 时使用 `spawn` + `shell:false`，不拼接 shell 命令；
- 只把计划中的 allowlisted env 和运行所需的最小 `PATH/SystemRoot` 传给 CLI，不继承完整 daemon 环境；
- 实现 AbortSignal 取消、wall-timeout、合并 stdout/stderr 上限和可辨识的退出结果；
- runner 作为显式依赖注入到 `ExternalSandboxExecutor`，daemon 默认不创建、不调用它；
- 本阶段不自动 pull 镜像、不修改 Docker daemon 配置、不把输出/token/private key 写入日志或 EventStore。

## 结果与错误

- 正常退出返回 `exitCode`、stdout、stderr、`truncated=false`、`timedOut=false`；
- 超过 output 上限立即终止子进程并返回 `truncated=true`；
- timeout 终止子进程并返回 `timedOut=true`；AbortSignal 终止子进程并返回 `cancelled=true`；
- CLI 无法启动抛出稳定 `PROCESS_START_FAILED`，不回显完整环境或 secret；
- spawn options 必须固定 `shell:false`、`windowsHide:true`、stdin 不继承。

## 测试门禁

- fake spawn 覆盖 argv 不经 shell、最小 env、stdout/stderr 上限、timeout、abort、正常退出和启动失败；
- 测试不启动 Docker/Podman、不联网、不读取真实 API key；
- 全仓 typecheck/test/diff:check 通过，runner 只有显式注入时才可被上层调用。
