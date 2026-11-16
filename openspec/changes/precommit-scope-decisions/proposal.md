Plan: none

# Scope the pre-commit decision gate to the decisions a change references

## Why

`checkPrecommit` 目前用全局决议队列阻塞所有 `apps/desktop/src/` 改动：只要有一条与本变更无关的
`决策中` 条目，协作者的产品代码就提交不了。PR 侧的检查按“本变更引用的决议”判定，两边不一致，
协作者在本机被挡、在 PR 上又能过，无法判断哪边是权威（协作者 issue #152、#156）。

## What Changes

- `checkPrecommit` 用 `referencedDecisionIds(design, decisions, change)` 只取本变更 `## 用户决策`
  引用的决议；未引用的待确认条目降为提示。
- 工具/治理改动的豁免保留；相关单测改为分别断言“引用即阻塞、不引用只提示”。

## Impact

- `scripts/maintenance.mjs`、`scripts/maintenance.test.mjs`。
- 不改产品代码、不改数据、不改 PR 侧检查语义（PR 侧本来就按引用判定）。
