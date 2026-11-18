Plan: none

# 收口验收与过渡这三块（change governance-transition）

## Why

`D-20261118-decision-dialog-flow` 重开回决策阶段后，E1–E32 覆盖矩阵显示真正没落地的只有四件：E12 验收页生成、E19/E20 交接与报告生成、E21 `--design` 门、E23 proposal 反向校验。另外这一轮重开发暴露出两个问题：条目历史被写盘动作删除（已修，但没有门拦得住下一次），以及待裁项没有增删命令、`--pending` 名字指向错位。

## What

1. **S1 历史只增门（E32）**：`docs:check` 比对 HEAD 与工作树条目，批次/完成/决定/验收项/阶段事件五类行只增不删；带历史条目被整条删除报错；RULES 登记 block。
2. **S2 验收页生成（E12）**：`npm run acceptance -- --entry <id>`，按 E 编号分节、`[用户]/[机制]/[未验证]` 标记与证据指针，未覆盖的 E 自动列出。
3. **S3 交接与报告生成（E19/E20）**：`transition -- handoff|report --entry <id> --write`，证据索引取自条目执行层，验收步骤取自未勾选项。
4. **S4 设计稿行为门（E21）**：`advance --stage 执行中 --design <path>`，校验结构、待确认项=无、用户批准原话与日期，并把设计稿路径写入执行层。
5. **S5 计划反向校验（E23）**：`advance` 进执行中时读 `proposal.md`，必须含条目 id。
6. **S6 命令缺口**：`decision -- wait add|drop`；`--pending` 改名 `--ask` 并保留旧名别名一个里程碑。

## 不在本批

- E8 记忆试点（E31 挂起，等 `D-20261117-agent-memory`）。
- 治理框架概念化与通用化、验收页浏览器渲染。

## 影响

只改治理工具、规则包与文档；产品行为、数据与渲染层不动。回退按切片 revert（每片一组提交）。