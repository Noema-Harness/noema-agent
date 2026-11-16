# 任务

## 1. 复盘（只读，已完成）

- [x] 1.1 三条线只读复盘：治理闭环、工作流编排、提示词融合
- [x] 1.2 把复盘结论与缺口清单写进 `design.md`
- [x] 1.3 报告阶段 1 结果并停下等用户确认（2026-11-16）

## 2. 缺口范围（2026-11-16 收口时改判）

- [x] 2.1 缺口不再等单独选批：按 §3 文档结构、§5 治理规则、§6 真实对照三节直接落地（用户 2026-11-16 要求“回归主线直到收口”）
- [x] 2.2 真实切口不再另跑 C6：用已发生的两个真实事件（C6 收口、协作者 PR #149 审核）对照九步，记录在 `design.md` 的「真实切口对照」

## 3. 文档与流程结构

- [x] 3.1 `AGENTS.md` §1 改为九步（每步：做什么 / 写哪份 / 漏做会怎样）
- [x] 3.2 六种文档角色写入 `AGENTS.md`（2026-11-16 晚删除，改为 design 的 `## 事实影响`，见 3.7）
- [x] 3.3 三类出口写入 `AGENTS.md`（被否 / 计划门拒绝 / 执行失败 / 验收未过 / CI 红 / 决定被替代）
- [x] 3.4 开场三问与收口三问写进 `AGENTS.md` §1
- [x] 3.5 `docs/OPERATIONS.md` 开发节只留命令，指回 `AGENTS.md` §1
- [x] 3.6 `npm run check` 全绿（2026-11-16 多次通过，最后一次 885/885，53,404ms）
- [x] 3.7 删除 `AGENTS.md` §2 六种文档角色；design 强制 `## 事实影响`（类别：行为/结构/取舍/仅执行 + 依据）；`plan:check` 与 `milestone:check` 校验、提交门/PR 门按类别配对（`scripts/maintenance.test.mjs` 19/19）

## 4. 提示词优先级

- [x] 4.1 `AGENTS.md` §4 写明「机制/治理改动不是可逆小动作」：改 AGENTS、门槛、文档结构或流程同样要立项（`Plan: none`）并记条目
- [x] 4.2 `AGENTS.md` §4 区分机械约束（门只拦可判定的形状）与判断准则（可测性、正文真实性、证据充分性靠收口三问与用户验收）
- [x] 4.3 新增 `skills/noema-development/SKILL.md`（九步步骤、模板、出口表；规则仍以 AGENTS 为准，不重复）
- [x] 4.4 `npm run skill:install` 同步到 `~/.dsh/skills`；`docs:check` 校验副本一致（CI 只提示），`scripts/skill-sync.test.mjs` 覆盖
- [x] 4.5 按 `D-20261116-governance-extraction` 把技能收缩为模板 + 闸门失败对照 + 命令指针（技能结构需随该条重新打开再改）

## 5. 治理规则（按证据处理）

- [x] 5.1 4 条「预防」规则不再以拦截出现：改为「观察期」（`scripts/governance.mjs` 的 `RULE_TABLE`），`audit` 输出里单列
- [x] 5.2 卡片正文三段不做机械校验：一句话“已更新”证明不了真实性，维持里程碑只校验“记了一条更新卡片正文”
- [x] 5.3 `node scripts/governance.mjs audit` 输出无「预防」拦截：22 拦截 / 2 提醒 / 4 观察期
- [x] 5.4 `plan:check` 的「待用户决定」原先只认 `- [ ]` 勾选，`- 问题` 时报“无”；已改为两种都算，并补 plain-bullet 用例

## 6. 真实切口对照

- [x] 6.1 用已发生的两个真实事件对照九步：C6 收口（2026-11-15）与协作者 PR #149 审核（2026-11-16），不再另跑产品切口
- [x] 6.2 对照差异写进 `design.md`「真实切口对照」：哪步没有文档可写、哪道门拦了但没有恢复路径、哪步被跳过
- [x] 6.3 工作流图先不入库：流程仍在实跑修正，图留在 `.work/workflow/`；等下一轮真实切口不再改结构时再进 `docs/assets/` 并接 README/AGENTS

## 7. 归档

- [x] 7.1 收口验证：`docs-check: OK`、`plan-check: OK`、`tools:test` 全过、`governance audit` 22/2/4（不跑全量 check：里程碑门要求恰好一个活动变更，归档后不存在活动变更）
- [x] 7.2 `npm run milestone:check` 通过（见本轮命令输出）
- [x] 7.3 卡片正文不适用（治理变更 `Plan: none`，不改用户可见能力）；`docs/STATUS.md` 已记录本轮
- [ ] 7.4 归档变更并提交（等用户验收与 `D-20261116-governance-extraction` 决策后执行；提交信息写 change 名与并入的结构）

## 8. 审核入口与决议条目（2026-11-16，D-20261116-review-inbox）

- [x] 8.1 新增 `scripts/review.mjs`（只读聚合，`npm run review`、`--json`）与 `scripts/review.test.mjs`
- [x] 8.2 `scripts/maintenance.mjs`：日期条目校验字段与阶段/状态（`checkDatedEntry`），`checkPlan`/`checkMilestone`/`checkPrecommit` 三道门
- [x] 8.3 `AGENTS.md` §1 改为条目生命周期（决策中 → 执行中 → 待验收 → 已收口）+ 讨论规则 + 唯一审核入口
- [x] 8.4 DECISIONS 条目改写成新格式（decision-scope / decision-lifecycle / governance-extraction / review-inbox / platform-layers），platform-layers 建看板 #151
- [x] 8.5 `package.json` 加 `review`/`review:test`，`tools:test` 覆盖 review
- [x] 8.6 `docs/OPERATIONS.md` 写审核入口、条目字段、三道门与失败修法
- [x] 8.7 `node scripts/governance.mjs audit` = 22 拦截 / 2 提醒 / 4 观察期（4 条原“预防”级改观察期）

## 9. 决议条目规范化（2026-11-16）

- [x] 9.1 9 条 `D-20261115-*` 旧格式条目转成新结构，保留原决定与理由原文
- [x] 9.2 新增 `D-20261116-workflow-closure` 收口条目（执行中；三层记录复盘、批次与验收项）
- [x] 9.3 design.md 的「待用户决定」改为「用户决策」并指向 DECISIONS 条目
- [x] 9.4 `npm run review` 分组与条目阶段一致；`docs:check` / `plan:check` 通过
- [x] 9.5 提交并推送

## 10. 协作者治理契约（2026-11-16，D-20261116-collaborator-governance）

- [x] 10.1 `scripts/collaboration.mjs`：维护者列表、维护者路径、`guardContribution`；5 个用例
- [x] 10.2 `CONTRIBUTING.md` 重写成协作者契约
- [x] 10.3 PR 模板加治理字段；CODEOWNERS 注明合并只由维护者执行
- [x] 10.4 CI 拆分：`Desktop checks`（verify + collaboration + range）、`Desktop package`
- [x] 10.5 `package.json` 加 `guard`；`tools:test` 纳入 collaboration 测试
- [x] 10.6 `docs/OPERATIONS.md` 加「协作与 PR 检查」；STATUS 记录本轮
- [x] 10.7 #149 审核结论写入 design；#148 去掉能力标签并关闭；STATUS 的 C15 引用改成 change 名
- [x] 10.8 平台侧提交门：`maintenance.mjs range`（PR diff 复用提交规则）+ `Desktop checks` 的 range 步骤
- [x] 10.9 仓库转公开 + MIT + `main` 分支保护（verify/collaboration 必过、1 位维护者审核、禁 force push/删 main）

## 11. 收口本轮（2026-11-16）

- [x] 11.1 `AGENTS.md` 删 §2 六角色并重编号（§2 出口 / §3 事实所有权 / §4 门槛 / §5 工程边界 / §6 不新建体系）
- [x] 11.2 `scripts/maintenance.mjs` 新增 `factImpact`/`factsRequired`/`checkFactSection`：新变更（`created >= 2026-11-16`）必须写「事实影响」，提交门按类别配对（仅执行却改产品代码、结构未更新 ARCHITECTURE、取舍未更新 DECISIONS 都拒绝）
- [x] 11.3 `design.md` 补 `## 事实影响`、`## 真实切口对照`，并记录六角色删除与图不入库的取舍
- [x] 11.4 `D-20261116-workflow-closure` 阶段改 `待验收`，三项验收写进条目
