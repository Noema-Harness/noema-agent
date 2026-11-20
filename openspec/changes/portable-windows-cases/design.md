# 让 windowsOnly 用例在三平台都跑：设计

改动落点：`test/main/` 下 `chat/social-chat-store`、`execution/noema-project-executor`、`execution/social-work-command-runner`、`execution/windows-runner-native-helper`、`platform/runtime-paths` 五个测试文件。
共享逻辑下沉：无；命令执行器的平台分支只在执行器测试里用，不抽到 `test/support/`。
不新增兼容层：产品代码不改。

## 事实影响

- 类别：仅执行
- 依据：只改测试夹具，产品的可观察行为、结构与取舍不变；`docs/` 无需改动（STATUS 里跳过数如有记录，由维护者合并时更新）。

## 用户决策

- D-20261116-platform-layers

## Context

- `windowsOnly`（`test/support/platform-cases.mjs`）在非 Windows 上返回 `{ skip }`；main 上 12 处调用，全部在上述 5 个文件。
- 执行器的 `run_command` 在产品里只有 Windows Runner 提供；测试注入 `commandRunner` 验证的是执行器自己的停止、超时、去重逻辑，与平台无关。

## 实现选择（协作者判断，维护者可推翻）

- **POSIX 命令执行器按进程组结束**：`detached: true` 让 `/bin/sh` 成为进程组长，`process.kill(-pid, 'SIGKILL')` 结束整组，对应 Windows 的 `taskkill /T /F`；用例里的命令（`echo x>>count.txt`、`node 脚本`）两种 shell 都能执行。
- **保留一个 Windows 专属断言**：`D:/scratch/…` 归一成 `D:\scratch\…` 只在 Windows 有意义，单独成用例并继续用 `windowsOnly`。
- **ACL 夹具用 Windows 路径字面量**：Windows Runner 的日志校验只收 Windows 本地路径，这是产品约束；夹具是传给假助手的数据，不需要在磁盘上存在。

## 用户可观察的改变

- 无。

## 手测步骤

1. 不涉及界面。在 macOS 或 Linux 上执行 `cd apps/desktop && npm test`。
2. 预期：0 失败，跳过数比 main 少 11。

## 验证

- macOS 全量 `npm test` 0 失败，跳过数减少 11。
- `npm run typecheck`、`npm run lint`。
- Windows（`verify`）与 Ubuntu（`portable`）由 CI 确认。
