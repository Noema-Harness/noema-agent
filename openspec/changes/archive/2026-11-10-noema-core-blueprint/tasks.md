# Tasks

## 1. 总体蓝图

- [x] 定义五平面、对象模型、依赖方向和非目标（`docs/architecture/NOEMA_CORE_BLUEPRINT.md`）
- [x] 写当前到目标的映射与迁移边界（同文件）
- [x] 定义单条常驻时间线、检查点/分支、编辑即分支（ADR-0002）

## 2. 选型与 ADR

- [x] 六条研究线（kernel、memory、context、checkpoint、execution、eval）完成报告
- [x] 写 D1–D9 选型矩阵（`docs/architecture/TECH_SELECTION_MATRIX.md`）
- [x] 写 ADR-0001 模块边界
- [x] 写 ADR-0002 单条常驻时间线
- [x] 写 ADR-0003 原生执行边界
- [x] 写 ADR-0004 Agent 内核适配
- [x] 写 ADR-0005 自主性阶梯

## 3. OpenSpec 与图示

- [x] 写 Phase 0–5 分期与门禁（`OPENSPEC_PHASING.md`）
- [x] 生成 current/planned 系统全景、运行流程、能力参照图
- [x] 在 `docs/architecture/README.md` 写维护规则
- [x] 将架构文档接入 `.codex/workspace.json`

## 4. 门禁与交付

- [x] `npm run workspace:check` 通过（26 篇当前文档，0 错误）
- [x] 架构文档/ADR/HTML 格式检查通过
- [x] 记录 0.6.9 安装与 836/836 检查作为回退基线
- [x] 用户确认按 Phase 1 顺序推进
- [x] 用户确认自主性 A→B→C 串联阶梯
- [x] 归档 Phase 0 变更
- [x] 创建 `noema-continuity-checkpoints` 作为下一变更

## 5. 后续阶段（不属于本变更）

Phase 1–5 分别由 `noema-continuity-checkpoints`、`noema-context-compiler`、`noema-memory-lifecycle`、`noema-execution-capability-ledger`、`noema-relationship-external` 承接，不在本变更内逐项跟踪。
