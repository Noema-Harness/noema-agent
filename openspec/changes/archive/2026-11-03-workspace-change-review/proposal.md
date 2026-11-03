# Proposal

## Why

Noema 目前允许项目工具直接修改工作区，但持久步骤只说明工具成功或失败，用户无法在任务中看到具体改了哪些文件，也没有受到并发修改保护的恢复依据。与此同时，应用内搜索和文件工具未采用 D3 native runner 的 hard-link root scan，导致受限命令的读写边界比内置文件工具更严格。

## What Changes

- 为项目文件工具增加工作区范围、hard-link/reparse 检查和失败关闭行为。
- 持久记录 Noema `edit_file` / `write_file` 的逐文件变更、摘要和有界差异；继续立即应用已授权的写入。
- 在任务结果中展示可核对的相对路径、差异、写入状态，并提供显式保留或安全撤回。
- 撤回前核对文件当前内容；若用户或其他程序后来改过文件，拒绝覆盖并清楚报告冲突。
- 提供 Git 工作区当前 tracked/staged/untracked 变更的只读审阅；明确标注该视图可能包含任务开始前已有的修改，不自动改动 index 或工作区。
- 诊断事件仅记录有界计数和状态，不保存路径、文件内容、diff、哈希或工具参数。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-execution`: 项目文件操作的读写边界、文件变更审阅和安全撤回行为。

## Impact

- Main: `NoemaProjectExecutor`, `SocialWorkService`, `SocialChatStore`, project workspace path and file authorization.
- Renderer/preload/IPC: task file-change review and explicit keep/revert actions.
- SQLite: bounded file-change metadata and restore snapshots with additive schema migration.
- Git review: fixed-argument, read-only inspection of the selected workspace; no commit, reset, clean, network, or arbitrary hook invocation.
- Diagnostics: bounded action/result summary only; file paths and source material remain in the user-visible local task record, not diagnostic events.
