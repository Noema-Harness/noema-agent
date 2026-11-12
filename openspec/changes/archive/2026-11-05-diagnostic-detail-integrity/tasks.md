# Tasks

## 1. 安全读取与详情状态

- [x] 1.1 让诊断详情写入和读取共用 allowlist/redaction 投影；读取前限制 16 KiB，按 `complete`、`filtered`、`unavailable` 返回详情状态，并以存储单测覆盖安全字段保留、敏感值过滤、未知字段、损坏 JSON 与超限详情（测试纳入阶段1 gate，不单独运行）。
- [x] 1.2 将详情状态接入 timeline DTO、coverage gap、诊断面板和 schema v3 导出；以 query-service 测试覆盖不可用详情的 timeline/export gap，并以静态 UI/类型检查确认状态可见、业务读写无依赖。

## 2. 规格与阶段记录

- [x] 2.1 更新 `project-execution` delta 与本 change 任务状态；通过 `openspec validate diagnostic-detail-integrity --strict --no-interactive`，并在 `.work/planning/PROGRESS.md` 记录变更证据及仍属于 S1-04 的后续事项。

## Workflow follow-up

- change 通过阶段1 gate 后归档；本 change 的单测随阶段1完整 gate 一起运行。
