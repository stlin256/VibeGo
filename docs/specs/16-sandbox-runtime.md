# Spec 16：External Sandbox Runtime 命令计划

**状态：Accepted（命令计划与注入式 runner MVP）**

## 目标与边界

- 把 `SandboxResolver` 的已验证结果转换为 Docker/Podman 的 argv 计划，供后续 runtime adapter 执行；
- 默认不调用 `child_process`、Docker、Podman 或网络；没有显式注入 runner 时必须 fail-closed；
- 让资源、网络、挂载、argv 和镜像策略在执行前成为可测试的数据，而不是散落在 daemon 中的字符串拼接；
- VM runtime 保留接口但本阶段不假装已支持，解析到 VM 时返回稳定不可用错误。

## 安全默认值

- 镜像默认要求 immutable digest：`name@sha256:<64 hex>`；允许 mutable tag 必须显式设置 `allowMutableImageTag`；
- 容器根文件系统 `--read-only`，删除全部 Linux capabilities、启用 `no-new-privileges`、限制 PID；
- `restricted` 网络映射为 `--network none`，只有显式 `enabled` 才使用 `bridge`；
- workspace 默认只读挂载到 `/workspace`；writable roots 必须是 workspace 内的绝对路径，并以独立 `rw` mount 显式列出；
- command/args 经过无 shell 的 argv 校验，拒绝控制字符和 shell 元字符；环境变量只接受显式 allowlist；
- 私钥、API key 和 runtime output 不能写入计划日志、EventStore 或 API 响应；runner 只在进程内存接收 env。

## 计划形状

```text
docker run --rm --init --read-only --cap-drop=ALL --security-opt=no-new-privileges
  --pids-limit 256 --network none --memory 512m --cpus 1.5
  --mount type=bind,src=<workspace>,dst=/workspace,readonly
  --mount type=bind,src=<writable-root>,dst=/workspace/<relative>,rw
  <image@sha256:digest> <command> <args...>
```

计划只是一组 argv + in-memory env；不经过 shell，不负责启动进程。真实 Docker/Podman adapter、镜像拉取策略、日志 redaction 和 cgroup 监控后置。

## 测试门禁

- digest/tag、Windows/Unix 绝对路径、workspace 越界、symlink 前置校验、网络/资源 flag、argv 和 env allowlist 均有单测；
- 没有 runner、VM runtime、无效资源或未授权 writable root 时 fail-closed；
- 测试不启动容器、不联网、不执行主机命令；全仓 typecheck/test/diff:check 通过。
