# 设计：新建条目的两步机制（起草 → 确认 → 落库）

## 事实影响

- 类别：仅执行
- 依据：只改治理工具（`scripts/decision-entry.mjs` 及其测试）、入口文档与技能提示；不改产品行为、数据或架构，也不改条目结构与四态。

## 用户决策

- 用户 2026-11-18 在对话中批准本机制进入实现（原话：「没问题，本项可以执行」），并提出「程序先向 agent 发出确认信息，提问本次条目创建是否已得到用户批准，agent 确认后才真正创建」。
- 本条议题（条目生命周期与按阶段注入）仍在讨论中；本切片只实现「新建条目先申请」的两步机制，不依赖该议题定案。

## 目标 / 非目标

- 目标：让「新建条目前先申请」成为默认路径——起草只进草稿目录，命令停下来问批准，确认后才追加进 `docs/DECISIONS.md`，并把批准原话与日期带进「来源」。
- 非目标：不验证批准真伪（无法验证，只能要求给出原话）；不改四态、条目结构、"来源以用户开头" 的既有门；不接管既有条目的编辑与阶段推进。

## 取舍

- 两步而非一步：多一次命令，换来一个可停的确认点。一句文档提醒靠自觉（同类问题已出现两次），一步式提示也仍是提醒。
- 草稿放 `.work/decisions-draft/`：一次性过程材料，符合 `.work` 判据（以后不会再被维护）；落库后删除，不形成第二套记录。
- 工具只能问 agent、不能问用户：因此 `accept` 强制要求「用户原话」≥10 字并写进来源，退化路径从「悄悄创建」变成「明显编造一句原话」，可被对话记录对照。

## 用户可观察的改变

- 无产品行为变化。仓库侧：新建条目第一次必然出现草稿与确认问题；`docs/DECISIONS.md` 的新条目「来源」里带批准原话与日期。

## 手测步骤

1. `npm run decision:draft -- --title "示例" --slug demo --body .work/demo-entry.md` → 只出现 `.work/decisions-draft/D-<日期>-demo.md`，打印确认问题，`docs/DECISIONS.md` 不变。
2. `npm run decision:accept -- D-<日期>-demo` → 拒绝：缺少 `--approval`。
3. `npm run decision:accept -- D-<日期>-demo --approval "可以"` → 拒绝：原话不足 10 字。
4. `npm run decision:accept -- D-<日期>-demo --approval "没问题，本项可以执行"` → 条目追加进 `docs/DECISIONS.md`，来源含原话与日期，草稿删除，`npm run docs:check` 通过。

## 验收

- 没有批准原话时无法落库（`scripts/decision-entry.test.mjs` 覆盖）。
- 草稿写错结构时 `accept` 拒绝且不改动 `docs/DECISIONS.md`。
- `npm run check` 全绿；`docs:check` 仍校验来源与结构。