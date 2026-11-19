# 决策记录存储分离

## Why

`docs/DECISIONS.md` 现在同时是三样东西：长期记录、机器运行状态、命令的输入格式。三者挤在一份 markdown 里，导致：

- 改文档格式等于改命令 API（`批次` → `当前批次` → `批次历史` 每次都要迁移与改解析）；
- 状态与记录互锁（历史只增 撞 验收项重写、批次历史 撞 批次改名），每撞一次加一条规则；
- 同一件事被拆成五份过渡文档，又需要"同类只留一份"的门。

用户 2026-11-19 定：把条目变成可控的数据，`DECISIONS.md` 退为渲染产物；本批不做 DSH 插件。

## What Changes

- 新增源数据 `governance/data/decisions.json`（版本化、字段明确），为唯一条目真相。
- 新增 `governance/core/persist.mjs`：`parseDecisions`（markdown → store）、`renderDecisions`（store → markdown，逐字节等价）、`loadStore`/`saveStore`/`validateStore`。
- 新增一次性迁移脚本 `scripts/migrate-decisions.mjs`：生成数据文件并渲染出与迁移前等价的 `docs/DECISIONS.md`。
- 条目操作改为读写数据文件：`record`/`move`/`check` 与旧的 `decision`/`stage`/`transition` 别名都经由 store；每次写入后重渲染 markdown。
- 写盘印记改为覆盖数据文件（真相）与渲染产物（视图）。
- 新增只读视图 `npm run decisions -- view`：列出讨论经过与待裁决，输出本地 HTML；`DECISIONS.md` 仍是 git 与 PR 复核用的渲染产物。
- `docs:check` 的结构规则改为读数据文件（历史只增门、阶段字段、批次指针、验收覆盖）。

## Impact

- 受影响：`governance/core/*`、`scripts/{decision,interface,maintenance,stage,transition}.mjs`、`docs/OPERATIONS.md`、`docs/STATUS.md`、`governance/README.md`。
- 不受影响：产品代码与产品可观察行为。
- 迁移不双写：切换后 markdown 只由数据渲染，手改 markdown 由写盘印记识别。

## 不在本批

- DSH 插件（视图与工具做成插件是下一阶段，可作为适配器，不持有数据）。
- 删除既有门或规则；本批只让它们改读数据文件。

Plan: none