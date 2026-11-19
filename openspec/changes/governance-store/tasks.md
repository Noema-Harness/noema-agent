# 任务：决策记录存储分离

## 1. 数据模型与读写

- [ ] 1.1 `governance/core/persist.mjs`：`parseDecisions(text)` 把 `docs/DECISIONS.md` 解析成 store
- [ ] 1.2 `renderDecisions(store)` 逐字节等价还原 markdown
- [ ] 1.3 `loadStore`/`saveStore`/`validateStore`（id 唯一、阶段合法、字段齐全）
- [ ] 1.4 `governance/data/decisions.json` 生成并通过 `validateStore`

## 2. 迁移可验证

- [ ] 2.1 `scripts/migrate-decisions.mjs`：生成数据文件并渲染
- [ ] 2.2 `--check` 模式：迁移前后逐字节等价，不等价时列第一处差异
- [ ] 2.3 `governance/core/persist.test.mjs`：roundtrip、异常格式拒绝、条目数与轮次数一致

## 3. 命令改读写

- [ ] 3.1 条目操作改为 entry 级（store 入参），不再解析全文
- [ ] 3.2 `record`/`move`/`check` 与 `decision`/`stage`/`transition` 别名都走 store
- [ ] 3.3 写盘印记覆盖数据文件与渲染产物；`precommit` 差异即阻断

## 4. 视图

- [ ] 4.1 `npm run decisions -- view`：生成含「讨论经过」「待裁决」的 HTML
- [ ] 4.2 `docs/DECISIONS.md` 顶部加「由数据渲染，勿手改」

## 5. 门与文档

- [ ] 5.1 `docs:check` 的结构规则改读 store
- [ ] 5.2 历史只增门比对 store 的上一版（git HEAD 的数据文件）
- [ ] 5.3 `docs/OPERATIONS.md`、`governance/README.md`、`governance/core/README.md` 同步

## 6. 收口

- [ ] 6.1 `npm run kernel:test`、`tools:test`、`docs:check`、`figure:check`
- [ ] 6.2 `npm run check` 全绿
- [ ] 6.3 更新 `docs/STATUS.md`
- [ ] 6.4 `milestone:check` → 归档 → 提交推送