# Design

## Context

See proposal.md - Why. `shouldExposeExistingProjectTools` 根据主聊和近期上下文选择是否增加项目工具；`projectPlanTool` 生成 coordinator/member 两种描述及可选 project ID 字段。

## Goals / Non-Goals

**Goals:** 保证明确的核验/评审意图能看到项目工具；保持项目绑定身份为可信来源；向模型清楚传达证据读取与信任边界。

**Non-Goals:** 不改变项目权限、任务状态、数据库 schema、评审授权或一般聊天的默认路由。

## Decisions

- 将“核验、核对、评审”纳入现有项目动作准入词表。它们只会暴露工具，不会自动执行工具。
- 项目绑定会话从 tool schema 隐去 `project_id`，避免模型选择另一个项目；若 provider 仍返回 schema 外字段，处理器以 main-process session context 的 project 对象作为唯一目标。
- 在 coordinator/member 两种 tool description 中同时写出绑定项目、截断工作项和证据不可信约束，避免某一角色缺失提示。
- 更新提示词测试以匹配当前稳定交流原则；保留并补齐覆盖工具准入和 schema 的产品行为测试。

## Risks / Trade-offs

- 准入词增加可能在少数普通聊天中多暴露项目工具 → 仅增加工具定义，不触发副作用；处理器仍执行原有权限与状态检查。
- optional `project_id` 仍可能被模型误填 → handler 使用已绑定的 project object，不根据该字段改换目标；测试覆盖不匹配 ID。
