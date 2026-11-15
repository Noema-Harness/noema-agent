# 任务

## 1. 复盘（只读，已完成）

- [x] 1.1 三条线只读复盘：治理闭环、工作流编排、提示词融合
- [x] 1.2 把复盘结论与缺口清单写进 `design.md`
- [x] 1.3 报告阶段 1 结果并停下等用户确认（2026-11-16）

## 2. 待定（阻塞，等用户选择）

- [ ] 2.1 用户选定先补的缺口与顺序
- [ ] 2.2 用户确认真实产品切口（建议 C6 成员经历）

## 3. 文档与流程结构（第一个切口，建议先做）

- [x] 3.1 `AGENTS.md` §1 改为九步，逐步写明读什么、写哪份文档（九步表格：做什么 / 写哪份 / 漏做会怎样）
- [x] 3.2 增加「六种文档角色」（AGENTS §2：约束 / 议题 / 计划 / 契约 / 证据 / 观察，含漏写后果与校验者）
- [x] 3.3 增加「三类出口」（AGENTS §3：被否 / 计划门拒绝 / 执行失败 / 验收未过 / CI 红 / 决定被替代）
- [x] 3.4 开场三问与收口三问写进 AGENTS §1（第 0 步与第 6 步下方）
- [x] 3.5 `docs/OPERATIONS.md` 开发节指回 AGENTS §1，只保留命令与报错修法（新增一行指针）
- [ ] 3.7 删除 AGENTS §2「六种文档角色」，改为 design 强制 `## 事实影响` + milestone 配对校验（验证：`AGENTS.md` 无角色表；违反声明的提交被拒）
- [ ] 3.6 `npm run check` 全绿

## 4. 提示词优先级

- [ ] 4.1 写明「机制 / 治理变更不属于可逆小动作」，用户级与仓库级冲突以仓库治理为准
- [ ] 4.2 区分机械约束（门强制）与判断准则（提示词要求），在 AGENTS 与 OPERATIONS 各标一次
- [x] 4.3 新增项目治理运行手册 `skills/noema-development/SKILL.md`（九步步骤、模板、出口表；规则仍以 AGENTS 为准，不重复）
- [x] 4.4 `npm run skill:install` 同步到 `~/.dsh/skills`；`docs:check` 校验副本与仓库一致（CI 只提示），`scripts/skill-sync.test.mjs` 覆盖
- [x] 4.5 按 `D-20261116-governance-extraction` 决定把技能收缩为模板 + 闸门失败对照 + 命令指针，删除与 AGENTS 重复的九步正文（验证：技能正文只指针引用 AGENTS §1）

## 5. 治理规则（按证据处理）

- [x] 5.4 `plan:check` 的「待用户决定」原只认 `- [ ]` 勾选写法，改 `- 问题` 时报告“无”；已改为两种都算，并在 `scripts/maintenance.test.mjs` 覆盖
- [ ] 5.1 4 条「预防」规则逐条补触发证据，或降级为提醒
- [ ] 5.2 卡片正文三段（现在能做什么 / 还没做 / 证据位置）是否加机械校验，等真实切口后定
- [ ] 5.3 `node scripts/governance.mjs audit` 输出无「预防」拦截

## 6. 真实切口对照

- [ ] 6.1 按流程跑一遍 C6「成员经历可查看 / 删除」
- [ ] 6.2 对照流程图记录系统差异（哪步没有文档可写、哪个门拦了没恢复路径、哪步被跳过）写回 `design.md`
- [ ] 6.3 决定工作流图是否入库（`docs/assets/` + README / AGENTS 链接）

## 8. 审核入口与决议条目（2026-11-16，D-20261116-review-inbox）

- [x] 8.1 新增 `scripts/review.mjs`（只读聚合，`npm run review`、`--json`）与 `scripts/review.test.mjs`（2/2）
- [x] 8.2 `scripts/maintenance.mjs`：日期条目校验字段/阶段/状态（`checkDatedEntry`），`checkPlan`/`checkMilestone`/`checkPrecommit` 三道门（`node --test scripts/maintenance.test.mjs` 18/18）
- [x] 8.3 `AGENTS.md` §1 改为条目生命周期（决策中 → 执行中 → 待验收 → 已收口）+ 讨论规则 + 唯一审核入口
- [x] 8.4 DECISIONS 五条条目改写为新格式（decision-scope / decision-lifecycle / governance-extraction / review-inbox / platform-layers），platform-layers 建看板 #151
- [x] 8.5 `package.json` 加 `review`/`review:test`，`tools:test` 覆盖 review
- [x] 8.6 `docs/OPERATIONS.md` 写审核入口、条目字段、三道门与失败修法
- [ ] 8.7 `node scripts/governance.mjs audit` 仍为 26 拦截/2 提醒/0 观察期（新增规则前先登记触发证据）

## 9. 决议条目规范化（2026-11-16）

- [x] 9.1 把 9 条 `D-20261115-*` 旧格式条目转成新结构（形态 / 阶段 / 看板 / 来源 / 阻塞 / 结构 + 三层），保留原决定与理由原文
- [x] 9.2 新增 `D-20261116-workflow-closure` 收口条目（执行中；三层记录复盘、批次与验收项）
- [x] 9.3 design.md 的「待用户决定」改为「用户决策」并指向 DECISIONS 条目
- [x] 9.4 `npm run review` 的分组与条目阶段一致；`docs:check` / `plan:check` 通过（`tools:test` 47/47，9 条旧格式条目 + 收口条目均可解析）
- [x] 9.5 提交并推送（本提交）

## 7. 归档

- [ ] 7.1 `npm run check` 全绿
- [ ] 7.2 `npm run milestone:check` 通过
- [ ] 7.3 更新卡片正文（C7 #138 或治理卡）与 STATUS
- [ ] 7.4 归档变更并提交
