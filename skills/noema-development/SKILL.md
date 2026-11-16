---
name: noema-development
description: 在 Noema 仓库推进开发、需要填立项三件套或决议条目时使用：只给骨架模板与字段提示。流程、门槛、出口、命令都不在这里，见 AGENTS.md 与 docs/OPERATIONS.md；冲突以 AGENTS.md 为准。
---

# Noema 开发：填写模板

本技能只做一件事：**给需要你手写的文件提供骨架**。九步流程、条目结构、讨论规则、三类出口在 `AGENTS.md` §1–§2；所有命令与报错修法在 `docs/OPERATIONS.md`；本文件不重复它们。

## 1. 立项三件套

`openspec/changes/<name>/proposal.md`

```markdown
Plan: <卡片链接> # 治理变更写 Plan: none，并在 .openspec.yaml 写 skip_specs: true

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

- [ ] <问题>：候选 A / B；建议 A；确认前不执行（没有就写“无”）

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
- [x] 1.2 <动作>（验证：<命令 + 输出摘要，如 887/887>）
- [ ] 2.1 [用户] <只有人能判断的验收>（完成后写「用户确认：YYYY-MM-DD」）
```

## 2. 决议条目

`docs/DECISIONS.md` 的一条对一轮（或一个专案）；字段含义、阶段流转、讨论规则见 `AGENTS.md` §1，这里只是骨架。

```markdown
## <阶段标记> [#<issue>](https://github.com/Noema-Harness/noema-agent/issues/<issue>) D-YYYYMMDD-<slug> <标题（范围变了就改）>

- **阶段**：决策中 | 执行中 | 待验收 | 已收口
- **结构**：入口 / 字段 / 校验 / 命令（仅机制类，≤10 行）
- **来源**：<由哪个议题引出，或复用哪条既有条目>
- **阻塞**：<哪条 task / 下一步> | 无

#### 1 决策

- 要定：…（用户确认后改写成 `- 决定：…（用户确认 YYYY-MM-DD）`）
- 纪要：随讨论追加，含被否决的选项与判断
- 重开：<新想法>（用户确认 YYYY-MM-DD）；原结论标注“已被重开”

#### 2 执行

- 批次：changes/<name>；发现：问题 → 证据 → 处理

#### 3 验收

- [ ] <可观察结果> — 怎么验 — 怎么跑（在 GitHub 勾选；勾完 `npm run decisions:sync` 收口）
- 用户确认：YYYY-MM-DD（收口时写）
```

## 3. 维护

- 本文件只跟着模板变；流程或规则变了改 `AGENTS.md`，命令变了改 `docs/OPERATIONS.md`。
- 改完跑 `npm run skill:install`；`docs:check` 校验已安装副本的哈希。
