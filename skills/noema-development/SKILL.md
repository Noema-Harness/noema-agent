---
name: noema-development
description: 在 Noema 仓库推进开发时使用：开一轮、立项三件套模板、闸门失败对照表、收口与出口。给模板与命令；九步流程与规则以 AGENTS.md 为准，本技能不重复规则，两者冲突时以 AGENTS.md 为准。
---

# Noema 开发运行手册

本技能只放三类东西：**模板**、**失败对照**、**命令指针**。九步流程在 `AGENTS.md` §1；文档角色与出口在 AGENTS §2–§3；所有规则冲突以 AGENTS 为准。

## 0. 开场

```powershell
npm run inbox        # GitHub 收件箱：CI 红、PR、被 @
npm run review       # 需要你决定 / 待你验收 / 执行中
git log --oneline -3
git status --short
```

然后读：`docs/STATUS.md` 的「最后一次验证」、`docs/DECISIONS.md` 里阶段为 `决策中` 的条目、看板 `gh project item-list 1 --owner Noema-Harness --format json`。

## 0.5 决议条目模板

`docs/DECISIONS.md` 一条对一轮（或一个专案）。阶段在第一条、三层并存、阶段可回退；完整规则见 AGENTS §1。

```markdown
## [#<issue>](链接) D-YYYYMMDD-<slug> <标题（范围变了就改）>

- **阶段**：决策中 | 执行中 | 待验收 | 已收口
- **结构**：入口 / 字段 / 校验 / 命令（仅机制类，≤10 行）
- **来源**：<由哪个议题引出，或复用哪条既有条目>
- **阻塞**：<哪条 task / 下一步> | 无

#### 1 决策

- 要定：…（用户确认后删掉这一行，改写成 `- 决定：…（用户确认 YYYY-MM-DD）`）
- 纪要：随讨论追加，含被否决的选项与我的判断
- 重开：<新想法>（用户确认 YYYY-MM-DD）；原结论标注“已被重开”

#### 2 执行

- 批次：changes/<name>；发现：问题 → 证据 → 处理

#### 3 验收

- <可观察结果> — 怎么验 — 待验收 / 通过 / 不通过
- 用户确认：YYYY-MM-DD（收口时写）
```

规则冲突以 AGENTS §1 为准；接口、命令与门的具体实现在 `scripts/review.mjs` 与 `scripts/maintenance.mjs`。

## 1. 立项三件套模板

`openspec/changes/<name>/proposal.md`

```markdown
Plan: <卡片链接> # 治理变更写 Plan: none，并加 .openspec.yaml 的 skip_specs: true

## 为什么

<一句话说清要解决的失败或能力缺口，带可核对的事实>

## 改什么

- <改动点，含影响的文档与脚本>

## 影响

- 代码：`apps/desktop/...`（无则写“无产品代码”）
- 文档：<PRODUCT / ARCHITECTURE / DECISIONS / OPERATIONS / STATUS 中实际会动的>
```

`design.md`

```markdown
## 开工声明

- 计划先于代码：本变更的提交信息含变更名，tasks 记录证据
- 事实影响：行为 / 结构 / 取舍 / 仅执行（四选一或多选，各一句依据）

## 用户决策

- [ ] <问题>：候选 A / B；建议 A；确认前不执行

## 实现选择

- <维护者判断，可被推翻>

## 用户可观察的改变

- <用户能看到的差异>

## 手测步骤

1. <命令或点击路径>
```

`tasks.md`

```markdown
- [ ] 1.1 <动作>（验证：<命令或可观察结果>）
- [x] 1.2 <动作>（验证：<命令 + 输出摘要，如 878/878>）
- [ ] 2.1 [用户] <只有人能判断的验收>（完成后写「用户确认：YYYY-MM-DD」）
```

## 2. 闸门失败对照

| 报错                                             | 修法                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `docs:check` 三行头 / 版本基线                   | 补 `Authority/Update when/Does not own`；同步版本号与基线提交            |
| `plan:check` 缺 `Plan:` 链接                     | 卡片变更写卡片链接；治理变更写 `Plan: none`                              |
| `plan:check` 缺「用户可观察的改变」/「手测步骤」 | 产品变更两节都不能空，写可执行的手测                                     |
| 决议条目 `阶段：决策中` 未获确认                 | 先讨论、更新条目；用户确认前不实现相关产品行为                           |
| `precommit-check` 代码未配对计划                 | 同一提交里勾 tasks 或写证据（`docs/`、`openspec/changes/`、`AGENTS.md`） |
| `milestone:check` 任务未完成 / 缺卡片正文        | 勾完任务、更新卡片正文「现在能做什么 / 还没做」                          |
| `source:check` 依赖越界                          | 生产代码不导入 `test-support`；新源码写 TypeScript（D-039）              |
| `figure:check` 图与架构文档不一致                | `npm run figure:build` 重出图，或更新 `docs/ARCHITECTURE.md` 后重建      |
| CI 红                                            | 收件箱会在下一轮带回；不等 CI，先看失败步骤日志，按上表修                |
| 分支已合并 / 陈旧                                | `npm run branches:check` 看提示，`npm run branches:prune -- --apply`     |

## 3. 收口与出口

收口顺序：`npm run check` → `milestone:check` → 更新卡片正文与 STATUS → `openspec archive <name> --yes` → 提交（含变更名与数字）→ 推送。

出口见 AGENTS §3：被否（条目写否决理由）、计划门拒绝（补计划或认定规则本身错了）、执行失败（重试或换路，`revert` 写原因）、验收未过（卡片回退、缺口重开）、CI 红（下一轮收件箱）、决定被替代（写 `**被替代**：<id>`）。

## 4. 维护

- 命令细节只写指针：`npm run` 全部在 `docs/OPERATIONS.md`。
- 流程规则变了改 `AGENTS.md`；本技能只跟着改模板与对照表，两者同一提交对齐。
- 改完本文件跑 `npm run skill:install`，`docs:check` 会校验已安装副本的哈希。
