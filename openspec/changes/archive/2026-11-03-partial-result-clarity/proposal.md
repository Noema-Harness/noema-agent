# Proposal

## Why

任务卡目前对所有 task 状态都把 `resultText` 标为“执行结果”。在失败、中断或安全续接进行中，这可能把旧的阶段性输出误读成最终交付，弱化了执行记录与恢复提示的意义。

## What Changes

- completed task 的输出继续标为“执行结果”。
- failed/interrupted/active task 的已保存文本标为阶段内容，并显示任务是否尚未完成的说明。
- 保留现有执行记录、unknown-effect 检查提示、safe checkpoint 续接与“再次执行创建新任务”行为。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: require incomplete task output to remain distinguishable from completed results and retain a clear recovery cue.

## Impact

影响共享任务结果呈现逻辑、project task card 与对应测试/规格。不改变数据库、checkpoint、工具执行、模型调用、恢复许可或任务状态转换。
