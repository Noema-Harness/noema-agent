# Proposal

## Why

工作区选择取消时不会创建任务，这是正确的；但该结果没有进入诊断时间线，无法与同一次 Noema 主聊入口、ready 状态和成功任务关联核查。readiness 目前也只有展示文案，无法稳定区分执行器、凭据和模型选择等阻塞原因。

## What Changes

- 为 Noema 主聊的工作区任务入口提供稳定的 readiness reason code，同时保留面向用户的说明。
- 将现有 composer 工作区任务模式作为当前 turn 的显式准入状态传至主进程；关闭模式时，同一段文字按普通聊天处理，主进程不向模型提供工作区执行工具。
- 记录工作区选择取消的脱敏终态事件；不创建 task，不记录用户指令、工作区路径或凭据。
- 验证入口、取消/拒绝/成功与 SocialWork task 的 application execution 关联可从诊断查询中还原。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 为 readiness 原因、工作区选择取消和同一入口诊断链增加可观察行为要求。

## Impact

- `SocialWorkService` readiness 与工作区选择取消事件。
- Social state shared contract、主进程诊断记录与查询。
- SocialWork、IPC 和诊断查询测试；不新增 task/store 或执行路径。
