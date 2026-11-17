# 任务

## 1 提示层

- [x] 1.1 `skills/noema-governance/SKILL.md` 改为三档出口（直接修 / 只补检查或验证 / 才登记条目），六步最后一步改为“能自己改的就改，要拍板的才登记候选”
- [x] 1.2 `skills/noema-development/SKILL.md` 决议条目骨架前加“先确认这一条该存在”，来源字段要求写用户指令
- [x] 1.3 `AGENTS.md` 在“用户驱动的记录”句后补“条目由用户发起，agent 不自行开条目、不把候选写成决定，`来源` 必填”

## 2 事实流

- [x] 2.1 `docs/DECISIONS.md` 顶部 Authority / Update when 改写为“条目由用户驱动，普通实现、修复、只补验证不写”
- [x] 2.2 `D-20261117-governance-boundary` 的结构与执行层补 2026-11-17 补落地证据（不新建条目）
- [x] 2.3 `docs/OPERATIONS.md` 失败表加「来源不是用户指令」「阶段过决策中但缺用户确认日期」两条修法

## 3 机器门

- [x] 3.1 `scripts/maintenance.mjs` 的 `checkDatedEntry`：来源必填且以「用户」开头；非决策中「#### 1 决策」必须有「用户确认：YYYY-MM-DD」
- [x] 3.2 `scripts/maintenance.test.mjs` 新增用例覆盖三种失败，现有 fixture 来源改为用户指令
- [x] 3.3 `node --test scripts/maintenance.test.mjs` 22/22 通过；`node -e` 校验现有 `docs/DECISIONS.md` 0 错误

## 4 收口

- [x] 4.1 `docs/STATUS.md` 补本次修正（来源门、三档出口、测试 22/22）
- [x] 4.2 `npx oxfmt --write`、`npm run skill:install`、`npm run check` 全绿
- [x] 4.3 更新卡片正文 — 本次为 `Plan: none` 的治理机制改动，不改 GitHub 卡片正文
- [ ] 4.4 提交并推送；`npm run milestone:check` 通过后归档本 change