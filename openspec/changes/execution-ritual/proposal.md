Plan: none

## 为什么

2026-11-17 记忆底座那次，用户回答了三个设计问题，我把「回答问题」当成「批准开工」，直接写代码并推送，被用户拦下后整体回滚（`cc608ef` 回滚 `701befc`）。盘查结论：授权没有单独要求，规则里没有一处说明"从讨论进入执行"需要什么信号；同时 `.work/` 长期被当成存档，出现了会持续维护的文档（`planning/PROGRESS.md`、`releases/FINAL-GATE-STATUS.md`），把过程材料变成了第二套记录系统。

## 改什么

- `AGENTS.md` §1：讨论期边界、进入执行前用 DSH 计划模式（`/plan` + `exit_plan_mode`）交开工清单等批准；回答设计问题、选选项、含糊的「可以」不构成授权；决定绑用户原话。
- `skills/noema-development/SKILL.md`：新增「0 讨论、开工、执行」三段边界与开工清单三要素；决定行模板改 `用户原话：「…」，日期`。
- `scripts/maintenance.mjs`：决策层的用户确认除 `用户确认：日期` 外接受 `用户原话：「≥10 字」，日期`；拒绝短引用。
- `docs/OPERATIONS.md`：新增「过程材料（`.work/`）」小节（会不会再被维护的判据、允许/禁止、清命令）与计划模式说明。
- `scripts/workspace.mjs` + `scripts/workspace.config.json`：`clean` 增加保留期（默认 7 天）与 `artifactRetention.keep`，输出每个目标的 MB；`--days` 可改。
- `scripts/workspace.test.mjs`、`scripts/maintenance.test.mjs`：覆盖保留期清理与两种用户确认写法。

## 影响

- 代码：无产品代码（`apps/desktop/src` 不动）
- 文档：`AGENTS.md`、`docs/OPERATIONS.md`、`skills/noema-development/SKILL.md`
- 工具：`scripts/maintenance.mjs`、`scripts/workspace.mjs`、`scripts/workspace.config.json` 及两份测试