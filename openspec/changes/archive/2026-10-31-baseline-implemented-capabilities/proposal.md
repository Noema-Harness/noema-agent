# Proposal

## Why

OpenSpec 已有变更记录与归档，但没有任何当前能力规格。新变更因此缺少可对照的现行行为基线；`docs` 中的方向、架构导航和流程图也被迫承担规格职责。现在按已实现且有自动化证据的范围建立首批基线，让后续变更能描述真实差异。

## What Changes

- 为聊天连续性、专业成员和项目协作建立当前行为规格。
- 每条规格注明可核对的实现与测试入口；只记录代码和现有测试支持的行为，不将未实现规划写成事实。
- 明确 `docs` 保留方向、架构导航与逻辑全景，OpenSpec specs 记录可观察行为；ROADMAP 继续管理阶段顺序，不迁入 specs。

## Capabilities

### New Capabilities

- `social-conversations`: 聊天室、消息连续性、搜索/回链、主题续接、转发与附件。
- `specialist-agents`: 专业成员身份、常驻私聊、资料与能力管理、归档和受限委派。
- `project-collaboration`: 项目群、成员项目会话、计划与证据、归档恢复及评审边界。

### Modified Capabilities

无。

## Impact

只新增 OpenSpec 当前规格并澄清项目文档职责，不改动产品代码或运行行为。基线以 `apps/desktop/test/`、`apps/desktop/test-support/electron/` 和 `docs/decisions/` 中的现行实现证据为边界。
