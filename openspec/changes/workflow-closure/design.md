# 工作流闭环：设计

## Context

2026-11-16 对治理框架做了一次只读复盘，三条线各自的问题如下（证据取自仓库现状与真实事故）：

### A. 治理框架闭环

用五条不变量对照 `node scripts/governance.mjs audit` 的 28 条登记规则（26 拦截 / 2 提醒 / 0 观察期）：

| 不变量 | 覆盖情况 | 缺口 |
| --- | --- | --- |
| 意图可追 | 强：decision-shape、plan-link、one-active-change、plan-before-code、code-needs-plan、governance-no-product | 「把反馈直接当工单」没有检测点；「被否 / 撤销」没有约定 |
| 变更可逆 | 弱：只有 source-boundary（依赖边界） | 撤销提交、卡片回退、迁移回滚、替代决定都无流程位置 |
| 结果可验 | 强：user-acceptance-date、observable-sections、milestone-tasks、spec-delta、status-today | specs 与测试无绑定；卡片正文只校验「已更新」 |
| 事实唯一 | 强：version-sync、doc-heads、docs-registered、status-facts、figure-sync 等 9 条 | DECISIONS / 卡片 / tasks 冲突无检测，只靠 AGENTS §2 的表靠人判 |
| 成本受控 | 中：hooks-installed、branches-cleanup、inbox-per-round | 规则只增不减：4 条「预防」规则从未触发真实失败 |

### B. 工作流编排

- `AGENTS.md` §1 是 5 步，实际是 9 步；缺开场（收件箱 / 待定 / STATUS）、定性（只读 / 待定 / 执行）、CI 回收。
- 六个文档角色与三类出口只在 `.work/workflow/analysis.md`，未入库；流程图 `docs/assets/` 里只有架构图，没有工作流图。
- `figure:check` 只校验架构图与 `docs/ARCHITECTURE.md` 的哈希，工作流图与 AGENTS 之间没有校验。
- 出口（被否 / 撤销 / 规则退役 / 验收未过 / CI 红）在 AGENTS 没有位置。

### C. 提示词工程

- 三层提示词：用户级 `~/.dsh/AGENTS.md`（跨项目判断）、仓库 `AGENTS.md`（治理与门）、技能目录（按需加载）。
- 冲突点：用户级说「可逆、低成本、授权内的事直接做」，治理要求「机制改动先待定、批准后执行」。2026-11-16 的「反馈当工单」就发生在这里。
- 同一知识三处存放：`AGENTS.md` §3 门槛表、`docs/OPERATIONS.md` 修法、`scripts/governance.mjs` 规则表；只有 `audit` 能对齐三者，且只在 milestone 跑。
- 没有区分「机械约束（门强制）」与「判断准则（提示词要求）」，对外看起来全是规则。

## Goals

- 把实际运行的 9 步写进 AGENTS，并让每一步能回答「读什么、写哪份文档、漏做什么会没有检测」。
- 六个文档角色与三类出口进入仓库，成为下一位 agent 能直接读到的结构，而不是本机分析。
- 逆向与异常有明确落点：被否、撤销、替代、回退、退役、CI 红各自写到哪里。
- 4 条预防型规则按「无触发证据就降级」处理。
- 真实产品切口跑一遍后，对照流程图记录系统差异，再决定工作流图是否入库。

## Non-Goals

- 不改产品行为、不改 `apps/desktop/src/`、不改 schema。
- 不新建第二套流程文档（六角色与出口写进 AGENTS / OPERATIONS 既有结构）。
- 不把 DECISIONS 扩成功能验收清单（范围问题见 `D-20261116-decision-scope`，仍待定）。

## 结构草案

### 九步

1. 开场：收件箱、DECISIONS 待定、STATUS 当前数字。
2. 定性：只读 / 待定（先存一轮）/ 已批准执行；产品行为还是机制改动。
3. 立项：看板卡 + `openspec/changes/<name>/`（proposal 写 `Plan:`，design 三行声明与用户可观察改变，tasks 切口）。
4. `plan:check`：计划先于实现；未决决策未答不写产品代码。
5. 实现：一个纵切；行为变化同时写 specs delta 与测试。
6. 自验：typecheck、受影响测试、真实运行；证据留在 tasks。
7. 收口：卡片正文三段（现在能做什么 / 还没做 / 证据位置）、tasks 证据行、STATUS。
8. 归档提交：`milestone:check`、归档合并 specs、提交信息写 change 名、push、CI 异步。
9. 下一轮：收件箱带回 CI 失败与协作者更新。

### 三类出口

- 被否 / 不批：改方向；条目写否决理由，不直接删除过程。
- 计划门拒绝：补计划，或认定规则本身错了 → 走规则调整（改规则要写原因）。
- 执行失败 / 提交要撤：重试或换路；revert 提交信息写原因，代码与文档一起退。
- 验收未过：卡片回退 Done → In Progress，回缺口，不开新卡。
- CI 红：下一轮开场由收件箱带回；不静默累积。
- 决定被替代：新决定写 `**被替代**：D-xxx`，引用旧决定的文档同步。
- 规则退役：拦截 → 提醒 → 删除；`audit` 输出观察期与提醒清单，里程碑人工确认一次。

## 待用户决定

- 先补哪几条缺口、按什么顺序（建议 A 反馈分类 + D 九步 + E 六角色与出口 作为第一个切口；B 逆向链随后；F/G 放到真实切口之后再定）。
- 真实产品切口是否用 C6「成员经历可查看 / 删除」。

## 用户可观察的改变

- 打开 `AGENTS.md` 能看到与实际一致的九步、六种文档角色、三类出口，以及每一步写哪份文档。
- `node scripts/governance.mjs audit` 输出里不再有「预防」级拦截规则（或每条都有触发证据）。
- 工作流图入库后，README / AGENTS 可点开对照；在此之前图与复盘只在 `.work/`。

## 手测步骤

1. `node scripts/maintenance.mjs docs` → `docs-check: OK`
2. `node scripts/maintenance.mjs plan` → `plan-check: OK`
3. `node scripts/governance.mjs audit` → 拦截 / 提醒 / 观察期三行数字，确认没有无证据的拦截规则
4. 读 `AGENTS.md` §1，对照流程图逐步核对：每步都能指出写入的文档
5. 真实产品切口跑一遍后，在 `tasks.md` 记录对照差异
