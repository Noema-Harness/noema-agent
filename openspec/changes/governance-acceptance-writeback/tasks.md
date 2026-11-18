## 1 验收项写回命令

- [ ] 1.1 `governance/core/edits.mjs` 新增 `replaceAcceptance(text, id, items)`：替换「#### 3 验收」的勾选行、保留阶段事件行。
- [ ] 1.2 `governance/core/entries.mjs` 再导出；`scripts/decision.mjs` 新增 `acceptance --entry <id> --from <file>`（非法行/缺文件拒绝，写前校验，打印未覆盖 E）。
- [ ] 1.3 用例：kernel 覆盖替换与拒绝路径；maintenance 覆盖「验收项增多放行」。
- [ ] 1.4 `docs/OPERATIONS.md` 补命令与失败修法。

## 2 验证与收口

- [ ] 2.1 `npm run kernel:test`、`npm run tools:test`、`node scripts/maintenance.mjs docs`、`npm run check` 全绿。
- [ ] 2.2 用命令把 `D-20261118-decision-dialog-flow` 的验收项补齐到覆盖 E1–E32，并推回待验收。
- [ ] 2.3 更新 `docs/STATUS.md`；`milestone:check`；归档 change；提交推送。