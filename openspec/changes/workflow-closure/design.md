# 工作流闭环：设计

## 事实影响

- 类别：取舍
- 依据：只改治理结构、门槛与流程文档；产品行为（`apps/desktop/src/`）与系统结构不变，取舍变化记在 `docs/DECISIONS.md`。

## Context

2026-11-16 对治理框架做了一次只读复盘，三条线各自的问题如下（证据取自仓库现状与真实事故）：

### A. 治理框架闭环

用五条不变量对照 `node scripts/governance.mjs audit` 的 28 条登记规则（26 拦截 / 2 提醒 / 0 观察期）：

| 不变量   | 覆盖情况                                                                                                   | 缺口                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 意图可追 | 强：decision-shape、plan-link、one-active-change、plan-before-code、code-needs-plan、governance-no-product | 「把反馈直接当工单」没有检测点；「被否 / 撤销」没有约定        |
| 变更可逆 | 弱：只有 source-boundary（依赖边界）                                                                       | 撤销提交、卡片回退、迁移回滚、替代决定都无流程位置             |
| 结果可验 | 强：user-acceptance-date、observable-sections、milestone-tasks、spec-delta、status-today                   | specs 与测试无绑定；卡片正文只校验「已更新」                   |
| 事实唯一 | 强：version-sync、doc-heads、docs-registered、status-facts、figure-sync 等 9 条                            | DECISIONS / 卡片 / tasks 冲突无检测，只靠 AGENTS §2 的表靠人判 |
| 成本受控 | 中：hooks-installed、branches-cleanup、inbox-per-round                                                     | 规则只增不减：4 条「预防」规则从未触发真实失败                 |

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

## 用户决策

- 本变更的决策与阶段见 `docs/DECISIONS.md` 的 `D-20261116-workflow-closure`（执行中），不再在本文件里列出待决项。
- 技能结构见 `D-20261116-governance-extraction`（决策中）；审核入口的验收见 `D-20261116-review-inbox`（待验收）。

## 实现选择

- 删除 AGENTS §2「六种文档角色」：它回答“文档是什么”，而每轮要判断的是“这一刀改了哪类事实”；前者是静态分类，放进常驻上下文既占预算又会随九步漂移。角色说明移进运行手册，按需加载（用户 2026-11-16 提出，维护者代裁）。
- 以 design.md 强制 `## 事实影响`（行为 / 结构 / 取舍 / 仅执行，各一行依据）替代角色表；milestone 按声明配对校验：声明行为变化→本变更提交必须动 `docs/PRODUCT.md` 或 `openspec/specs/`；声明结构变化→必须动 `docs/ARCHITECTURE.md`；只声明“仅执行”却改 `apps/desktop/src/`→拒绝。
- 理由：分类必须前置在立项（否则收口才发现该改的文档没改），且这是门槛能机械校验的少数事实。

## 协作者治理契约（2026-11-16）

- 事实：私有 Free 组织仓库不能启用分支保护或 ruleset（`GET /branches/main/protection`、`/rulesets` 均 403），协作者的路径越界只能靠 CI 红灯与维护者审核发现。
- 落点：`CONTRIBUTING.md`（角色、可改/只能维护者改、PR 必备、CI 覆盖、合并与发布）；`scripts/collaboration.mjs`（`MAINTAINER_ONLY_PATHS` + `guardContribution`，CI job `collaboration`）；PR 模板治理字段；CODEOWNERS 说明。
- 审核 #149（2026-11-15 合入，macOS DSH 支持）：行为变更有 change 证据（`plan → feat → archive → 移除归档目录`），但三处不符合契约：①作者自行合并（用户已明确不要擅自 merge）；②在 PR 里直接改 `docs/DECISIONS.md`、`docs/STATUS.md`，且决定条目用旧格式；③自造能力编号 C15 与 issue #148，和看板 14 卡不一致。后续：`#148` 去掉 `capability` 标签并关闭；STATUS 里的 C15 引用改成 change 名；`D-20261116-platform-layers` 的用户确认日期待用户核实；specs 的约 230 行空行抖动保留但记录在案。
- 打包检查拆出：`Desktop checks` 只跑 `npm run check`；`Desktop package` 在触达 `apps/desktop/**` 或锁文件时跑 smoke/打包/安装包，避免文档 PR 背 10 分钟 Windows 打包，同时保住打包回归。

## 真实切口对照（2026-11-16）

用两个已经发生的真实事件对照九步，而不是再跑一个产品切口。

### C6 收口（2026-11-15，project-growth-integrity）

- 跳过的步：立项晚于取证——先探真实库再建 change，计划成了实现清单。
- 没有文档可写的位置：给下一轮的“证伪”没有位置；失败注入只在 tasks 写一行，没进 DECISIONS。
- 门拦了但无恢复路径：`milestone:check` 要求“更新卡片正文”，但正文三段不校验真实性，收口时按印象更新。
- 结论：这次补了 3.7（事实影响前置于立项）与 5.2（不做正文机械校验），保留这条差异作为下次核对锚点。

### 协作者 PR #149（2026-11-16）

- 跳过的步：没有第 1 步定性；作者先 park 提案、后自行写成 `决定`，绕过状态语义。
- 门拦了但无恢复路径：当时 CI 只有 `verify`，没有 range 与 collaboration，自行 merge 后无法退回“未合入”；现在补了 range + collaboration + 分支保护，并接受“已合入只能前向修正”。
- 没有文档可写的位置：看板没有对应能力卡（作者自造 C15 #148），规划层缺席；已关闭 #148 并把 STATUS 的 C15 引用改成 change 名。
- 结论：平台门必要（private Free 无保护时只能靠 CI），但“擅自合并”没有自动检测，只在收件箱里靠人看。

### 工作流图是否入库

- 决定：暂不入库。图已因结构变化重画三次（四 lane → 三 lane → 全图），现在入库会立刻过期；等下一轮真实切口不再改结构时再放 `docs/assets/`、接 README/AGENTS 与 `figure:check`。

## 用户可观察的改变

- 打开 `AGENTS.md` 能看到与实际一致的九步、六种文档角色、三类出口，以及每一步写哪份文档。
- `node scripts/governance.mjs audit` 输出里不再有「预防」级拦截规则（或每条都有触发证据）。
- 工作流图入库后，README / AGENTS 可点开对照；在此之前图与复盘只在 `.work/`。

- 协作者在 PR 被拦时，CI 的 `collaboration` job 会列出被拦的维护者路径，PR 模板要求填看板卡与 change。
- `CONTRIBUTING.md` 能独立回答“我这个改动能不能提、提了会被什么检查”。

## 手测步骤

1. `node scripts/maintenance.mjs docs` → `docs-check: OK`
2. `node scripts/maintenance.mjs plan` → `plan-check: OK`
3. `node scripts/governance.mjs audit` → 拦截 / 提醒 / 观察期三行数字，确认没有无证据的拦截规则
4. 读 `AGENTS.md` §1，对照流程图逐步核对：每步都能指出写入的文档
5. 真实产品切口跑一遍后，在 `tasks.md` 记录对照差异
6. `npm run guard -- --actor ichika0130 --files scripts/workspace.mjs` → 退出码 1 并列出被拦路径；`--actor c3115644151` → 退出码 0
7. 对照 `CONTRIBUTING.md` 的表与 `scripts/collaboration.mjs` 的 `MAINTAINER_ONLY_PATHS`，确认两处一致
