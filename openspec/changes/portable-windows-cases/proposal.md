Plan: https://github.com/Noema-Harness/noema-agent/issues/151

# 让 windowsOnly 用例在三平台都跑

## Why

D-20261116-platform-layers 的第 ③ 刀（`96f95be`）把 12 个只在 Windows 上成立的用例标成 `windowsOnly`，让 Ubuntu/macOS 跳过。代价是：执行器的停止、超时、命令去重、越界写拒绝，Windows Runner 原生助手的日志与校验，工作区路径重定向等逻辑，在 macOS 与 Linux 上完全没有测试覆盖，而这些逻辑本身与平台无关。2026-11-17 #167 合入后，用户同意（PR #167 描述里的提议，用户回复“行 继续吧”）把它们改成三平台可跑。

逐条看，这 12 个用例跳过的原因都在测试夹具，不在被测代码：

- 夹具写死 Windows 路径（7 个）：`C:\outside.txt`、`..\outside.txt`、`src\matches.txt`、`commondir` 里的 `..\..`、ACL 授权项用 `os.tmpdir()`（校验只收 Windows 本地路径）、`runtime-paths` 的 `C:\`/`D:/` 夹具。
- 测试自带的命令执行器只会 `cmd.exe` + `taskkill.exe`（3 个）。
- 镜像命令断言 `cd /d … && set GIT_DIR=`（1 个）：被测代码在所有平台都生成这一行，断言本身与平台无关，跳过只因为 `commondir` 夹具。
- 其余 1 个同属 `runtime-paths`。

## What Changes

- 夹具按本机平台生成路径（`path.join`、`path.parse(cwd).root`），正则同时接受两种分隔符；ACL 授权夹具改用固定的 Windows 路径字符串（纯数据，不碰文件系统）。
- 执行器测试的命令执行器在 POSIX 上用 `/bin/sh -c` 做进程组长，停止与超时时结束整个进程组；Windows 上保持 `cmd.exe` + `taskkill.exe`。
- 去掉这 12 处 `windowsOnly`；`runtime-paths` 保留一个只在 Windows 跑的用例，专测 `D:/…` 归一成 `D:\…`。

## Impact

- 代码：`apps/desktop/test/main/**` 下 5 个测试文件；产品代码不变。
- Windows 覆盖不减少；macOS/Linux 多跑 11 个用例（12 个跳过 → 1 个跳过）。
- 不做：`windowsOnly` 辅助本身保留（仍有真正只在 Windows 成立的断言会用到）。
