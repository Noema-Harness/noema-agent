# 任务：治理一致性修正

## 1. 批次模型

- [ ] 1.1 `governance/core/history.mjs` 的「批次」类行同时匹配 `- 批次：`、`- 当前批次：`、`- 批次历史：`
- [ ] 1.2 `governance/core/entries.mjs` 的 `readEntry` 优先取「当前批次」，回退最后一条「批次」
- [ ] 1.3 `governance/core/edits.mjs` 的 `replaceBatch` 维护「当前批次 + 批次历史」两行，迁移旧条目（3 条批次行 → 1 当前 + 3 历史）
- [ ] 1.4 进执行中要求活动 change；进待验收允许已归档 change 作为批次证据

## 2. 门强度

- [ ] 2.1 进执行中校验 kickoff 文档（`checkTransition`）并写 `- 开工清单：<path>（日期）`
- [ ] 2.2 写盘印记不一致时 `precommit` 阻断（由 notice 升为 error），提示 `move --restore`
- [ ] 2.3 `audit` 收进 `check net`，`milestone` 与 CI 跑它

## 3. 文档与索引

- [ ] 3.1 `governance/README.md`：三动词表、`check net`、落地状态（批次一/二已归档、试点与抽离挂起）
- [ ] 3.2 清掉「退回执行中」残留（`scripts/stage.mjs`、`transition/report.md`、`docs/STATUS.md`、条目已定细则）
- [ ] 3.3 `docs/OPERATIONS.md` 命令与失败修法同步

## 4. 条目与验收

- [ ] 4.1 已定块 E24–E26 前缀修复为 E24–E26；E27 指称并入 E28
- [ ] 4.2 验收项按 E1–E36 逐条重写，`check acceptance` 未覆盖为 0
- [ ] 4.3 重出验收页并记录对照结论（36 条 → 一致）

## 5. 收口

- [ ] 5.1 `npm run kernel:test`、`tools:test`、`docs:check`、`figure:check`
- [ ] 5.2 `npm run check` 全绿；`npm run governance -- check net` 无差异
- [ ] 5.3 更新 `docs/STATUS.md`（含最后更新日期）
- [ ] 5.4 `milestone:check` → 归档本 change → 提交推送