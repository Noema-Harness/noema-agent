# Design

## 事实影响

- 类别：取舍
- 依据：把提交门从“全局决议队列”改为“本变更引用的决议”，与 PR 侧同一判据；代价是未引用的
  待确认议题不再拦住任何人的提交，收益是协作者能按自己的变更推进。

## Goals

- 本机 pre-commit 与 PR 检查对“决议阻塞”使用同一判据。
- 未引用的待确认议题仍然提醒，但不阻塞。

## Non-Goals

- 不改变决议条目本身的确认流程（`npm run review` / `decisions:sync`）。
- 不改 PR 侧 `platform` 与提交门的上游逻辑。

## 实现选择

- `referencedDecisionIds(designText, decisionsText, change)` 已存在，直接复用；`plan.pending`
  按引用求交，其余输出一条 notice。

## 用户决策

- 无

## 用户可观察的改变

- 协作者在 `apps/desktop/src/` 提交时，只有自己变更引用的未确认决议会拦住；无关条目只显示提示。

## 手测步骤

1. `node --test scripts/maintenance.test.mjs` 全绿。
2. 在引用一条待确认决议的变更里提交产品代码：pre-commit 报“本变更引用的决议未获用户确认”。
3. 把 `## 用户决策` 改成 `- 无` 再提交：不再被决议阻塞（仍受“必须同时更新 docs/change”约束）。
