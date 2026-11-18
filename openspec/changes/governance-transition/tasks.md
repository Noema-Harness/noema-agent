# 任务：change governance-transition

## 1 历史只增门（E32，先做）

- [x] 1.1 `governance/core/history.mjs`：从条目文本提取五类历史行（批次/完成/决定/验收项/阶段事件）并按类型计数；新增 `compareEntryHistory(previous, current)` 返回被删行与消失的有历史条目。（验证：`governance/core/history.mjs` 导出 `entryIdOfHeading/historyCounts/historyOf/compareEntryHistory`。）
- [x] 1.2 `scripts/maintenance.mjs` 在 `docs` 档接入：读 `git show HEAD:docs/DECISIONS.md` 比对，减行即报错并列出行；带历史条目整条消失也报错。验证：单测覆盖「删一行完成记录报错」「同量改写不报错」「带历史条目被删报错」。（验证：`scripts/maintenance.test.mjs`「entry history only grows: a removed completion line fails the check」通过；`docs:check` OK。）
- [x] 1.3 `scripts/governance.mjs` 的 RULES 登记 `entry-history-monotonic`（block；证据「不可逆：历史删除」）。（验证：`RULE_TABLE` 已含该行。）

## 2 验收页生成（E12）

- [x] 2.1 `governance/core/acceptance.mjs`：从条目读已定 E 列表与验收层勾选行，装配「按 E 分节 + 未覆盖 E」的数据结构。（验证：`governance/core/acceptance.test.mjs` 5/5。）
- [x] 2.2 `scripts/acceptance.mjs` + `npm run acceptance`：写 `.work/review/<date>-<id>-acceptance.md`，含决定摘要、分节验收项、未覆盖 E、手测步骤、结论。验证：单测覆盖按 E 出页与未覆盖标记。（验证：`npm run acceptance -- --entry … --write` 生成页面；未覆盖 E 列出。）
- [x] 2.3 用 `D-20261118-decision-dialog-flow` 自证生成一次。（验证：`.work/review/2026-11-19-D-20261118-decision-dialog-flow-acceptance.md`，决定 28 项、验收项 6 条、未覆盖 E 27 项——证明旧验收项没有按 E 映射。）
- [x] 2.4 `decision advance --stage 待验收` 前置：未覆盖 E 必须为 0，否则拒绝并列缺项（E32 的同类防再犯）。（验证：`kernel.test.mjs`「a decision cannot move to acceptance while some decided E has no acceptance item」通过。）

## 3 交接与报告生成（E19/E20）

- [ ] 3.1 `transition -- handoff --entry <id> --write`：证据索引取执行层批次/完成行，验收步骤取未勾选项。
- [ ] 3.2 `transition -- report --entry <id> --write`：勾选表 + 用户原话与日期 + 遗留项。
- [ ] 3.3 生成物通过 `--check`；单测覆盖。

## 4 设计稿行为门（E21）与计划反向校验（E23）

- [ ] 4.1 `decision advance --stage 执行中 --design <path>`：结构校验、待确认项=无、用户原话+日期；通过后执行层写 `- 设计：<path>（批准日期）`。
- [ ] 4.2 `advance` 进执行中时读 `openspec/changes/<batch>/proposal.md`，必须含条目 id，否则拒绝。
- [ ] 4.3 单测覆盖两者的失败与成功路径。

## 5 命令缺口（S6）

- [ ] 5.1 `decision -- wait add "T…"` / `-- wait drop --item T…`：待裁项增删，写盘前结构校验。
- [ ] 5.2 `--pending` 改名 `--ask`，旧名保留别名一个里程碑；帮助文案与 OPERATIONS 更新。
- [ ] 5.3 单测覆盖待裁增删与两个名字都能改「- 要定：」。

## 6 文档、验证与收口

- [ ] 6.1 `docs/OPERATIONS.md` 命令与失败修法补 acceptance / 历史只增门 / wait / ask。
- [ ] 6.2 规则包（execution / acceptance）补命令与门说明。
- [ ] 6.3 `npm run kernel:test`、`npm run tools:test`、`docs:check`、`figure:check`、`npm run check` 全绿。
- [ ] 6.4 `docs/STATUS.md` 记录本轮；`milestone:check`；归档 change；推送。
- [ ] 6.5 更新看板卡片（#166 记忆底座无关联，本轮在 D-20261118 条目内记录即可）。