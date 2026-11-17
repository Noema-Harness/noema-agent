# 决议条目归用户：统一提示层与机器门的归属

## Why

用户 2026-11-17 指出：`docs/DECISIONS.md` 必须由用户确认才能加条目，并非所有事都要进决议——有些直接修，有些只需验证。规则已经写进 `AGENTS.md`（用户驱动的记录，不是任务账本），但盘查技能仍把“DECISIONS 一条”写成主产物，`docs/DECISIONS.md` 顶部还是“任何可能走向决策的讨论先追加条目”，机器门也只校验阶段与三层结构、不校验来源与用户确认。结果是 agent 可以自行开条目、把候选写成决定，正是用户说的“把这份文档变成 agent 自理的工具”。

## What Changes

- `skills/noema-governance/SKILL.md`：产物从“默认写条目”改成三档出口——直接修 / 只补检查或验证 / 才登记条目；六步最后一步改成“能自己改的就改，要用户拍板的才登记候选”。
- `skills/noema-development/SKILL.md`：决议条目骨架前加“先确认这一条该存在”，来源字段要求写用户指令。
- `AGENTS.md` 与 `docs/DECISIONS.md` 顶部说明：条目由用户发起，agent 不自行开条目、不把候选写成决定。
- `scripts/maintenance.mjs` 的 `checkDatedEntry`：`来源` 必填且以「用户」开头；阶段过了 `决策中` 后「#### 1 决策」必须出现「用户确认：YYYY-MM-DD」。
- `scripts/maintenance.test.mjs` 补一条用例覆盖来源缺失、来源非用户、缺用户确认三种失败。

## Impact

- 代码：无产品代码。
- 文档：`AGENTS.md`、`docs/DECISIONS.md`（顶部说明 + `D-20261117-governance-boundary` 补落地证据）、`docs/OPERATIONS.md`（两条失败修法）、`docs/STATUS.md`。
- 机器门：`npm run check` 的 `docs:check` 会拦住来源缺失或非用户驱动的条目。

Plan: none