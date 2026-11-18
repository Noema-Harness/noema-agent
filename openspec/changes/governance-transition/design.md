## 事实影响

- 类别：仅执行
- 依据：只改治理工具（`scripts/`、`governance/core/`）、规则包与文档；不涉及产品行为、数据结构或渲染层。

## 用户决策

- 2026-11-19：用户批准 reopened 开工清单，原话「可以，请开始」。
- 依据条目：`D-20261118-decision-dialog-flow` 的 E28–E32。

## 目标

- 四个未落地项（E12/E19/E20/E21/E23）各有一个命令或门，并且都有单测。
- 历史删除这类写盘错误由机器门拦截，不再依赖 agent 记得。
- 待裁项增删可走命令，条目字段命令的命名与实际作用一致。

## 非目标

- 不做验收页的浏览器渲染，不做交接/报告正文代写。
- 不做治理内核抽离。

## 目标结构

- `governance/core/`：新增 `history.mjs`（条目标历史提取与比对，纯文本）与 `acceptance.mjs`（按 E 编号装配验收页数据）。
- `scripts/`：`acceptance.mjs`（Noema 路径与写盘）、`transition.mjs` 增 handoff/report 生成、`decision.mjs` 增 `--design` 与 proposal 校验、`maintenance.mjs` 接历史只增门。
- 规则包：`governance/noema/workflow/{execution,acceptance}.md` 补命令与门说明。

## 取舍

- 历史只增门按「同类型行数不减」判定，不按原文比对：改写措辞不误伤，减行即报错。
- 验收页数据只从条目取，不扫 change 目录：单一事实源，缺项就报错而不是猜。
- `--design` 门校验设计稿内现有原话与日期，不新增批准格式。

## 用户可观察的改变

- 提交时若条目历史行变少，`docs:check` 直接报错并列出行，提交被拦。
- `npm run acceptance -- --entry <id>` 一次出完整验收页，条目验收层不再手抄正文。
- 交接与报告从条目生成骨架（证据索引 + 验收步骤）。
- 进执行前若设计稿没填完或没有用户原话，阶段推进被拒绝。

## 手测步骤

1. `npm run acceptance -- --entry D-20261118-decision-dialog-flow`，打开生成的 `.work/review/*-acceptance.md`，确认按 E 编号分节、每项带证据与标记。
2. 故意删一条 `- 完成：` 行后跑 `node scripts/maintenance.mjs docs`，确认报错；恢复后通过。
3. `npm run transition -- handoff --entry D-20261118-decision-dialog-flow --write` 生成后 `--check` 通过。

## 验收

- [ ] [机制] S1 历史只增门：删任一类历史行即报错，同量改写不报错，带历史条目被删报错 — 单测
- [ ] [机制] S2 验收页：按 E 编号分节、未覆盖 E 标未验证 — 单测 + 自证生成
- [ ] [机制] S3 交接/报告：生成后 `--check` 通过 — 单测
- [ ] [机制] S4/S5 门：`--design` 与 proposal 反向校验各有失败与成功用例 — 单测
- [ ] [机制] S6 命令：待裁增删可用；`--ask` 与旧名 `--pending` 都能改「- 要定：」— 单测
- [ ] [机制] 全量门绿：`kernel:test`、`tools:test`、`docs:check`、`figure:check`、`npm run check` — 运行记录