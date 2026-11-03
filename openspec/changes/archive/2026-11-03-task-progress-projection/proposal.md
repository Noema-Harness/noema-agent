# Proposal

## Why

项目任务的持久状态与工具记录已经存在，但活跃任务卡对 `running` 只显示笼统的“处理中”，用户无法辨别 Noema 正在请求模型、等待本次授权、执行哪类工具，还是因限流暂停。把这些实际阶段呈现出来，能减少用户误判和重复操作；无需引入第二套任务状态源。

## What Changes

- 执行链在模型请求/响应、模型工具请求、用户授权等待、工具执行和限流等待等可观测阶段更新持久任务阶段。
- 任务卡将持久任务状态、阶段和运行中工具步骤投影为准确的用户说明；未知阶段回退为中性状态，不猜测。
- 重载时仍从 SocialChatStore 获取任务快照；短暂事件只触发刷新，不成为 renderer 的独立状态事实。
- 不显示模型隐藏推理内容，不改变工具权限、任务恢复策略或复杂协作界面。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: define task progress phases and require an authoritative persisted projection in the task UI.

## Impact

影响 SocialWork task phase persistence、NoemaProjectExecutor 的进度事件、main-process task 更新事件、共享呈现逻辑、renderer task 卡、任务类型契约与相关测试。无需新增 schema migration；现有 `phase` 字段可承载有限阶段标识。
