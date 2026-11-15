# Proposal

## Why

SocialWork 已有隔离命令 runner 和可审阅的文件工具 journal，但 `run_command` 仍直接写真实工作区，因此命令副作用不能完整归因、撤回或在崩溃后恢复。Stage 5 需要把已确认的“隔离副本运行、结束后自动回写无冲突改动”落成 PE30–33 的明确行为契约。

## What Changes

- 将 SocialWork `run_command` 纳入 PE30–33：命令在受检私有副本中运行；进程树确定收束后自动同步无冲突文件；冲突不覆盖并保留恢复材料。
- 将每次命令的逐文件变更、来源和恢复状态纳入现有 SocialWork task/file-change owner，并扩展其审阅、撤回、诊断与恢复契约。
- 规定真实 Git 元数据只读、额外外部写根不获得命令写权限、未知或部分状态不得自动重放。
- 明确 Root/Legacy、DSH 派发与续跑不接入此执行和记录链。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：扩展 PE30–33，将已隔离命令的镜像、逐 job 变更记录、自动冲突安全回写、逐文件审阅撤回、Git 元数据只读和恢复纳入既有要求。

## Impact

影响 SocialWork `NoemaProjectExecutor`、`WindowsRunnerExecutionService`/文件 capability grants、`SocialChatStore` 的 task/file-change 持久记录、文件差异/恢复 blob 存储、审阅 renderer/IPC、诊断查询导出、OpenSpec 项目执行规格与阶段验收。此变更只冻结合同与实现边界；实现按 S5-02/03/04 进行，不在本设计门接线开放写入。
