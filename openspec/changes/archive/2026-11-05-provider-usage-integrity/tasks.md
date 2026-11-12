# Tasks

## 1. Provider usage 归一化

- [x] 1.1 修正 provider usage 识别：空/无效对象不算已收到，真实 0 仍算有效；对冲突 hit/miss 保持整个缓存分解为 unknown；增加 provider fixture 覆盖 empty/invalid/zero/partial/inconsistent 状态（测试纳入阶段1 gate，不单独运行）。
- [x] 1.2 修正诊断时间线的 token 显示，不把缺失 output/input 补成 0，并对已知 token 用量但无 cache breakdown 显示 unknown；以 query/renderer 检查确认类型和文案。

## 2. 规格与阶段记录

- [x] 2.1 更新 `project-execution` usage delta 与本 change 任务状态；通过 `openspec validate provider-usage-integrity --strict --no-interactive`，并将判定依据与测试待办记录到 `.work/planning/PROGRESS.md` 及 C1 审计。

## Workflow follow-up

- change 通过阶段1 gate 后归档；本 change 的 provider/query 单测随阶段1完整 gate 一起运行，不发真实 provider 请求。
