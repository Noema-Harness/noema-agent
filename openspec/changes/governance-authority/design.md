# 设计：治理权威入口（批次一 `governance-authority`）

## 事实影响

- 类别：仅执行
- 依据：只改治理文档与治理工具（`AGENTS.md`、`docs/` 的治理段落、技能指针、`scripts/figure.mjs` 图路径、`scripts/maintenance.mjs` notice 检查）；不改产品行为、数据或产品架构。

## 用户决策

- 用户 2026-11-18 批准设计方案 v2（原话：「批准1」）与开工清单（原话：「批准」）。
- 对应条目 `D-20261118-decision-dialog-flow` 的 E2、E4、E6、E15、E17、E18、E22。

## 目标 / 非目标

- 目标：治理内容只有一个权威入口 `governance/`；`docs/` 只剩产品本体事实；从索引能走到每道门与规则包；notice 门开始观察。
- 非目标：本批不写内核代码（批次二 `governance-kernel`）、不实现 `npm run stage` 与 `transition` 命令、不抽离独立项目（批次三）。

## 取舍

- 一次性迁移、不做双写：避免两套规则并存；旧位置只留指针。
- 规则包先落 `governance/noema/workflow/` 正文，命令在批次二实现：先定内容再定执行方式，避免边写工具边改规则。
- notice 门只查 `docs/` **新出现**的治理词，不冻结历史行：观察期不误伤既有内容。

## 用户可观察的改变

- `AGENTS.md` 变短：阶段地图 + 边界 + 指针，不再有完整流程说明。
- `governance/README.md` 可读性强：三层结构、四道门、三个阶段规则包、条目生命周期。
- `docs/` 里不再有治理机制正文。

## 手测步骤

1. 打开 `governance/README.md`，沿链接走到三层说明、三个阶段规则包、过渡模板、治理图，确认无断链。
2. 打开 `AGENTS.md`，确认只剩阶段地图、边界、指针与不变量，行数 ≤45。
3. 在 `docs/PRODUCT.md`、`docs/ARCHITECTURE.md` 搜「治理分层」「决策门槛」「行为门」等治理词，确认无命中。
4. `npm run docs:check` 通过；`npm run check` 全绿。

## 验收

- `docs:check` / `figure:check` / `npm run check` 全绿，CI `verify` 绿。
- grep 走查确认产品文档无治理内容（`DECISIONS.md` 例外）。
- 索引可走通，无断链。
- notice 门首次报告为零或只报预期新增。
