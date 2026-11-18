# 任务

## 1 内核与命令

- [ ] 1.1 写 `scripts/decision-kernel.mjs`：读条目、追加轮次、待裁并入已定、换阶段与标记（纯文本、无 IO）。验证：`scripts/kernel.test.mjs` 覆盖四个函数。
- [ ] 1.2 写 `scripts/decision.mjs`：`round` / `settle` / `advance`，写盘前过行为门（原话 ≥10 字、合法转移、批次指针、验收项勾选），失败不落盘。验证：单测三组拒绝 + 一次成功写盘。
- [ ] 1.3 写 `scripts/stage.mjs`：打印阶段规则包、校验 `gate:` id、活动条目与恢复卡。验证：三阶段都能输出，未知阶段返回 2。
- [ ] 1.4 写 `scripts/transition.mjs`：模板打印 / `--write` 生成骨架 / `--check` 结构校验（design 与 kickoff 要求待确认项为无）。验证：单测覆盖缺节、待填、待确认项非无。
- [ ] 1.5 `package.json` 接线（`stage`/`transition`/`decision`/`kernel:test`）并把 `kernel.test.mjs` 加进 `tools:test`。验证：`npm run kernel:test` 14/14。

## 2 文档与规则同步

- [ ] 2.1 `docs/OPERATIONS.md`：清掉 `/plan` 残留（改为 `npm run transition` + `npm run decision advance`），命令清单与失败修法补三条。验证：`docs:check`。
- [ ] 2.2 `governance/README.md` 命令表与 E23 建档顺序一致。验证：人工核对 + `docs:check`。
- [ ] 2.3 三份规则包把「用 `npm run decision -- round`」等命令写实。验证：`npm run stage -- <阶段>` 输出里命令可直接执行。
- [ ] 2.4 技能指针补 `npm run stage` / `npm run decision` 两个入口。验证：`npm run skill:install` 与 `docs:check`。

## 3 行为门登记

- [ ] 3.1 `scripts/governance.mjs` 的 RULES 新增 `decision-advance-approval`、`round-changes-line`（观察期 notice）。验证：`npm run governance:test`。

## 4 验证与收口

- [ ] 4.1 `npm run tools:test`、`npm run docs:check`、`npm run figure:check` 通过。
- [ ] 4.2 `npm run check` 全绿。
- [ ] 4.3 更新 `docs/STATUS.md`（治理内核一节 + 最后更新 2026-11-18）；更新看板卡片正文（治理内核交付说明；无卡片时在 STATUS 记录）。
- [ ] 4.4 `npm run milestone:check` 通过后归档 change，提交并推送。