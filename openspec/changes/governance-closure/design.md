## 事实影响

- 类别：仅执行
- 依据：改动只涉及 `governance/` 的规则与内核、`scripts/` 的适配命令、`docs/DECISIONS.md` 的条目结构校验；无产品行为、无数据、无对外契约变化。

## 用户决策

- 用户 2026-11-19（m109061）：「可以。而且要确定存在这种规范化的操作路径来调整条目的阶段状态，而不是你直接上手改」。
- 用户 2026-11-19（m109076）：「可以」，并说明开工清单是执行阶段第一步、openspec 建档其后；回工属补充式执行、不需要单独文档，此处区分交由我判断（本文 §4 给出结论）。

## 1 摘要

补三类缺口：**入口**（条目字段、暂停、ID 指向、阶段事件）缺命令，逼出了「一次性脚本改条目」；**验收**（已定项与验收项、change tasks 之间没有映射）让「局部完成」被说成「整体完成」；**未落地项**（E12/E19/E21/E23）。本批把入口补齐、把验收与已定项闭合、把四个未落地项实现。

## 2 决议全景与覆盖矩阵

| 已定项 | 本批切片 | 说明 |
| --- | --- | --- |
| E9 条目自足 | 组一·1、5 | 字段与阶段事件都能用命令维护，不手改 |
| E12 验收页生成 | 组二·8 | `npm run acceptance --entry <id>` 按 E 编号出页 |
| E14 中断/恢复 | 组一·3 | 暂停/恢复走命令；中断说明已有，补「搁置」 |
| E15 迁移 | 组一·5 | 阶段事件行规范化同时修旧条目 |
| E19 交接/报告 | 组三·11 | `transition -- handoff|report` 生成骨架 |
| E21 `--design` 校验 | 组三·9 | 设计稿待确认项与批准原话 |
| E23 proposal 引用校验 | 组三·10 | 建档门补「proposal 引用本条目」 |
| E24–E26 | 组一·4、5 | 阶段注入机制化、内核落位、退回路径的规则补全 |
| 覆盖闭合（本轮新增） | 组二·6、7 | `coverage` + 待验收门 |

## 3 问题模型

四类失败及其证据：

1. **入口缺失 → 绕过**：改「阻塞」字段只能整文件重写，我写了 `.work/entry-concept-roundN.mjs`；暂停议题没有命令，我直接开了 change（`b588fe0`，已撤回）。证据：m108990、m109001。
2. **验收项按批次写 → 局部完成冒充整体完成**：`D-20261118` 的 6 条验收项只覆盖 E24–E26，E12/E19/E21/E23 不在任何 change tasks 里。证据：`openspec/changes/archive/2026-11-18-*/tasks.md` 无对应条目，m109055。
3. **阶段事件无规范 → 条目自相矛盾**：同一条目两条「退回」、两条「转待验收」、顺序倒挂、`要定` 还写「E1–E22」。
4. **ID 前缀歧义**：`D-20261118` 当天有四条，引用无法唯一定位；命令只精确匹配，报「找不到」。

## 4 目标结构

- 内核 `governance/core/`：新增 `events.mjs`（阶段事件行的成对/去重/排序规则）与 `coverage.mjs`（已定项归属解析：从 change tasks 与条目切片行提取 `E<n>`）。`entries.mjs` 增 `editFields`、`pause/resume` 辅助；`lifecycle.mjs` 不变。
- 适配 `scripts/`: `decision.mjs` 扩 `edit`、`pause`、`resume`、`coverage`，`advance` 补 `--design` 与 proposal 引用校验、待验收覆盖率门；新增 `scripts/acceptance.mjs`（E12）；`scripts/transition.mjs` 支持 `handoff|report` 生成。
- 规则：`governance/noema/workflow/discussion.md` 补「暂停只走命令、缺能力先登记缺口」；`execution.md` 补「回工」段。
- **阶段边界（修正）**：开工清单是决策阶段的产物（E1 的批准对象），只存在于进执行之前。退回后已经处在执行阶段，不再有「开工清单」；回工写的是**回工范围**——执行层的一行当前状态加 change tasks，不把决策阶段的东西搬回来。
- **阶段事件的位置（修正）**：转待验收／退回／重开是执行层的状态记录，不写进决策层；条目只保留当前一条，更早的状态在 git 历史里，不堆在正文。

## 5 机制设计（逐机制）

1. **`decision -- edit`**：`--waits/--decided/--blocker/--conclusion`，整段替换语义；写前 `checkDecisionEntries`，失败不落盘；`--dry-run` 打印 diff 摘要。
2. **ID 保护**：`findEntryRange` 失败时做前缀匹配；1 条给提示「写全 id」，多条列出候选并拒绝。
3. **`pause/--resume`**：`pause` 写阻塞行为「暂停：<原因>（日期）」并追加轮次；`resume` 覆盖该行、继续同一轮次。
4. **阶段事件规范化**：`转待验收`/`退回` 各成对；同向事件不允许连续两条；按时间倒序；`docs:check` 校验「有转段无退回」「重复事件」「顺序倒挂」。
5. **`coverage`**：解析条目已定项 `E<n>` 与执行层切片、`openspec/changes/**/tasks.md` 的 `E<n>` 引用，输出归属表与缺项。
6. **待验收门**：`advance --stage 待验收` 要求覆盖率 100%（缺项列出）；允许 `--not-this-batch "原因"` 显式豁免（落条目）。
7. **`acceptance` 页**（E12）：按 E 编号逐条输出 `[用户]/[机制]/[未验证]`，证据指针来自切片与 change tasks；写 `.work/review/<date>-<id>-acceptance.md`。
8. **`--design` 校验**（E21）：`advance --stage 执行中` 若给 `--design`，校验模板节齐全、「待确认项」为 `- 无`、含用户批准原话与日期；未给则提示（观察期 notice）。
9. **proposal 引用**（E23）：`advance` 进执行中时校验 `openspec/changes/<name>/proposal.md` 含本条目标识。
10. **handoff/report**（E19）：`transition -- handoff|report --entry <id> --write` 生成骨架到 `.work/review/`。

## 6 迁移与兼容

- 旧条目的重复阶段事件用一次性 `docs:check` 修复清单列出，人工确认后由 `decision -- edit` 或整理命令修正；不批量自动改写正文。
- 新门（覆盖率、阶段事件）先 notice 一个里程碑，再升 block（E6）。

## 7 落地批次与依赖

- 组一（1–5）先做：入口是组二、组三的前置（coverage 依赖 edit；acceptance 依赖 coverage）。
- 组二（6–8）依赖组一。
- 组三（9–11）独立，可与组二并行，最后统一验证。

## 8 验证与风险

- 风险一：前缀匹配误伤（两个 id 前缀相同）→ 只在「精确匹配失败」时启用，并按最长公共前缀提示。
- 风险二：coverage 解析靠约定（`E<n>` 字样）→ 解析失败按「无归属」处理并列出，不静默通过。
- 风险三：待验收门变严导致正常推进被卡 → 先 notice，观察期一个里程碑。
- 验证：kernel:test、tools:test、`npm run check`、手测四步（见 proposal）。

## 9 待确认项

- 无