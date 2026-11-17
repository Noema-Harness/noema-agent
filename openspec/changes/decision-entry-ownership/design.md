# 设计：决策条目归用户

## 事实影响

- 类别：仅执行
- 依据：改动是治理机制（`scripts/maintenance.mjs` 的两道门）、提示层（`AGENTS.md`、两个技能、`docs/DECISIONS.md` 顶部说明）与失败修法（`docs/OPERATIONS.md`），不触及产品行为、数据模型、IPC、运行时或安装包。用户 2026-11-17 已定方向（条目由用户驱动、普通工作不建条目），故不新建决议条目，只在已收口的 `D-20261117-governance-boundary` 补落地证据。

## 用户决策

- 用户已定：`docs/DECISIONS.md` 由用户驱动，agent 不自行开条目、不把候选写成决定；这次是让技能与机器门对齐同一事实（用户 2026-11-17 两轮指出）。
- 待用户确认的：无新增取舍。若用户认为「直接修 / 只补验证 / 才登记条目」三档出口仍偏向写条目，回退点是只保留「直接修 / 登记条目」两档。

## 目标 / 非目标

- 目标：同一条规则在提示层（AGENTS、技能）、事实流（DECISIONS 顶部说明）、机器门（`checkDatedEntry`）三处一致；agent 自开条目或把候选写成决定时 `npm run check` 报错。
- 非目标：不给每个维修改建条目；不引入新的记录系统；不改动已收口条目的历史内容（`LIFECYCLE_FROM=20261116` 之前豁免）；不新增自动化的“异常检测脚本”。
- 取舍：门只校验「来源以用户开头」和「非决策中必须有用户确认日期」，不校验语义真伪——语义靠人读；这样最省力的过门方式是写真实来源，不是打卡。

## 用户可观察的改变

- 无界面与安装包变化。对用户可见的是：以后不再出现「维护者判断」来源的条目；条目在离开决策中之前必须带着用户确认日期。

## 手测步骤

1. `npm run review` — 现有条目仍能列出，`D-20261116-governance-extraction` 阶段为已收口。
2. 临时把某条目的 `- **来源**：用户 …` 改成 `- **来源**：维护者判断`，跑 `npm run docs:check`，应报「不是用户指令」，改回后通过。
3. 临时删掉已收口条目「#### 1 决策」中的「（用户确认：…）」，跑 `npm run docs:check`，应报「没有写「用户确认：YYYY-MM-DD」」。
4. 读 `skills/noema-governance/SKILL.md` 的「产物放哪」，确认三档出口与 SKILL 描述里的「决定直接修还是登记候选」一致；`npm run skill:install` 后 `~/.dsh/skills/noema-governance/SKILL.md` 哈希与仓库一致。

## 验收

- 机器门：`node --test scripts/maintenance.test.mjs` 覆盖来源缺失、来源非用户、缺用户确认三种失败；`npm run check` 全绿。
- 提示层：`skills/noema-governance`、`skills/noema-development`、`AGENTS.md`、`docs/DECISIONS.md` 顶部说明对「要不要建条目」说法一致。
- 事实流：`docs/OPERATIONS.md` 失败表能查到两种报错的修法。