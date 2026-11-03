# Proposal

## Why

Windows 命令策略已能在 Noema 内编译，但还没有原生执行器将策略落实到子进程生命周期。若继续保持关闭，工作区 Agent 缺少完整命令闭环；若过早启动，则策略尚未生效或进程树无法收束时可能留下未受限副作用。

## What Changes

- 增加满足 Windows 策略后端门禁后才可启动命令的执行生命周期。
- 命令输出、退出/超时/取消结果和清理状态关联到原请求及现有 task/tool ledger。
- 取消或执行器故障导致子进程收束不确定时，保留结果未知状态，不自动重放命令。
- 启动与结束阶段的诊断仅记录安全元数据和有限原因码。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 定义 Windows 原生 runner 的启动门禁、输出、取消和不确定清理结果。

## Impact

- 影响 `project-command-sandbox.mjs`、`noema-project-executor.mjs`、SocialWork task/tool lifecycle、Windows 原生 runner 与本机诊断事件。
- 以固定 Codex Windows sandbox 源码为窄子集参考；不直接依赖 Codex crate API 或整个 Codex workspace。
- 需要 Rust Windows target 与 Forge resource packaging；不安装/配置 sandbox identity 或 WFP，不运行受限命令作为本次源码构建的一部分。
