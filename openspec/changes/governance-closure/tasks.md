## 1 组一：入口

- [ ] 1.1 `governance/core/entries.mjs` 增 `editFields`（待裁/要定/阻塞/结论替换，写前校验，失败不落盘）
- [ ] 1.2 `scripts/decision.mjs` 增 `edit` 子命令与 `--dry-run`（验证：kernel:test 覆盖 dry-run 不落盘、字段越界拒绝）
- [ ] 1.3 `findEntryRange` 前缀歧义保护：精确失败时匹配前缀，多条列候选并拒绝（验证：kernel:test 覆盖「D-20261118」歧义）
- [ ] 1.4 `pause`/`resume`：暂停写阻塞行与轮次说明，恢复覆盖（验证：kernel:test 覆盖往返）
- [ ] 1.5 `governance/core/events.mjs`：阶段事件成对、倒序、去重；`advance` 写入时整理；`docs:check` 校验（验证：maintenance.test 覆盖重复与顺序倒挂）
- [ ] 1.6 `discussion.md` 补「暂停/恢复只走命令；命令缺能力时停下登记缺口，禁止一次性脚本或顺手立 change」

## 2 组二：验收闭合

- [ ] 2.1 `governance/core/coverage.mjs`：解析已定项、执行层切片与 `openspec/changes/**/tasks.md` 的 `E<n>` 归属（验证：kernel:test 覆盖有归属/缺归属两类）
- [ ] 2.2 `scripts/decision.mjs` 增 `coverage` 子命令，输出归属表与缺项（验证：手测 `coverage --entry D-20261118-decision-dialog-flow` 列出 E12/E19/E21/E23 无归属）
- [ ] 2.3 `advance --stage 待验收` 覆盖率门：缺项拒绝并列清单，支持 `--not-this-batch "原因"` 豁免（验证：kernel:test 覆盖缺项拒绝与豁免）
- [ ] 2.4 `scripts/acceptance.mjs` 与 `npm run acceptance`：按 E 编号生成验收页到 `.work/review/`（验证：生成 `D-20261118` 的页，E 全覆盖）
- [ ] 2.5 覆盖率与阶段事件新门先 notice、evidence 写「观察期」（`scripts/governance.mjs`）

## 3 组三：补未落地校验与产物

- [ ] 3.1 `advance --design <path>` 校验模板节、`待确认项：- 无`、用户批准原话与日期（验证：kernel:test 覆盖缺项拒绝）
- [ ] 3.2 `advance` 校验 `openspec/changes/<name>/proposal.md` 含本条目标识（验证：kernel:test 覆盖 proposal 未引用拒绝）
- [ ] 3.3 `transition -- handoff|report --entry <id> --write` 生成骨架（验证：手测生成两份到 `.work/review/`）
- [ ] 3.4 `execution.md` 补「回工」段：范围由退回原因定义、清单直接落 change tasks、不单独成文档

## 4 验证与收口

- [ ] 4.1 `npm run kernel:test`、`npm run tools:test` 全绿
- [ ] 4.2 `npm run check` 全绿（含 lint/typecheck/docs/figure）
- [ ] 4.3 重写 `D-20261118-decision-dialog-flow` 验收项（按 E 全覆盖）并用 `npm run acceptance` 重新生成验收页
- [ ] 4.4 更新 `docs/STATUS.md`（治理闭合一节、最后更新 2026-11-19）
- [ ] 4.5 更新看板卡片正文（`#166` 或新建闭合卡，记录本轮修复与未验证项）
- [ ] 4.6 `npm run milestone:check` → 归档 `governance-closure` → 推送