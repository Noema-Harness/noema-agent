# Tasks

## 1. 计划状态契约

- [x] 1.1 在 `ProjectPlanStore.get()` 中仅为当前 `blocked` 工作项返回阻塞说明，并添加旧快照读取测试，验证历史修订文本仍保留。
- [x] 1.2 在 `updateItem()` 中离开 `blocked` 状态时清空当前 blocker；添加 blocked 恢复、审阅退回和继续工作测试。

## 2. 回归核查

- [x] 2.1 运行项目计划存储与协作定向测试，确认状态投影、历史和依赖行为通过。
- [x] 2.2 运行 `openspec validate project-plan-blocker-lifecycle --strict --no-interactive` 并检查差异。
