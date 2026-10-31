# Proposal

## Why

共享计划允许工作项离开“受阻”状态，却会继续携带旧阻塞说明。成员和 Noema 因此会同时看到新的状态与过时原因，真实项目中已经出现“已完成”工作仍显示旧阻塞的情况，干扰了后续判断和交接。

## What Changes

- 工作项处于 `blocked` 以外状态时，当前计划视图不再暴露旧阻塞说明。
- 工作项离开 `blocked` 状态时清除当前阻塞说明；退回修改的理由继续保存在独立审阅记录中。
- 增加回归验证，覆盖状态转换、旧快照读取和审阅退回。

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-collaboration`: 计划当前状态中的阻塞说明只描述仍处于受阻状态的工作项。

## Impact

- 影响项目计划读取与状态更新，以及 `project-collaboration` 行为规格和计划存储测试。
- 不修改数据库结构，不删除追加式计划修订中的历史记录。
