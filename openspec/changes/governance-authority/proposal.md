Plan: none

## 为什么

治理内容（流程说明、门槛、规则包、条目规则、治理图）散落在 `AGENTS.md`、`docs/OPERATIONS.md`、`docs/STATUS.md`、技能与 `docs/assets/`，没有单一权威；实测 `docs/STATUS.md` 36 行里 27 行、`docs/OPERATIONS.md` 230 行里 58 行是治理内容。用户 2026-11-18 批准设计方案 v2 与开工清单（条目 `D-20261118-decision-dialog-flow`，E1–E22）。

## 改什么

批次一 `governance-authority`，五个切片：

- S1 建 `governance/` 三层：`README.md`（索引）、`core/README.md`（内核契约）、`noema/README.md`（适配说明）、`noema/workflow/`（讨论 / 执行 / 验收规则包、过渡模板）、`assets/`（治理图）。
- S2 迁五处治理内容（E15）：`AGENTS.md` 流程段、`docs/OPERATIONS.md` 三节、`docs/STATUS.md` 四节、技能的治理规则、治理图 assets。
- S3 `AGENTS.md` 缩成阶段地图 + 边界 + 指针（44 行内）。
- S4 notice 门：`docs:check` 检测 `docs/` 新出现的治理词，只提示不阻断（E6 观察期）。
- S5 验证与证据。

## 不在本批

- 内核代码与 pm run stage / 	ransition / decision round|settle|advance 命令（批次二 governance-kernel）。
- 记忆议题试点与抽离评估（试点 P1、批次三）。
- scripts/ 既有门的判定逻辑（本批只为 doc 新增 notice 检查与图路径同步）。

## 影响

- 只改治理文档、`AGENTS.md`、技能指针、`scripts/figure.mjs` 图路径与 `scripts/maintenance.mjs` notice 检查；不含 `apps/desktop/src/` 产品代码，不动数据模型与既有门判定逻辑。
- 过渡期：`governance/` 是新写入点，旧位置可暂时保留指针（一次性迁移，不做双写）。
