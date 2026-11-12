# Proposal

## Why

运行诊断面板在本机读取失败时不能把失败误显示为空记录；长时间线也需要可用的筛选、明确的空结果和可靠重试。当前 UI-S15 已进入一期开发，需要把这些用户可见行为纳入诊断工作台契约并在阶段验收中核对。

## What Changes

- 诊断记录或时间线读取失败时显示错误状态和原位重试；无成功读取前的记录数保持未知。
- 时间线提供模块与执行阶段筛选、匹配数量和清除筛选；筛选只改变展示，不缩小导出报告范围。
- 诊断工作台在 420px 窄窗保持可见、无横向溢出，并通过隔离 renderer 探针覆盖筛选和失败恢复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`: 明确诊断记录/时间线查询失败的可恢复 UI 行为，以及时间线筛选仅作用于展示、不改变导出范围。

## Impact

影响 `diagnostics-dialog.tsx`、诊断工作台样式、Electron 隔离 UI 探针和 `project-execution` 行为规格；不增加依赖、持久化字段或 IPC 权限。
