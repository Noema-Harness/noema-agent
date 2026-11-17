# 成员经历：可查看、可删、可恢复

## Why

成长链路已经能把项目复盘写进成员资产（`social_agent_asset_revisions` 追加式 + 墓碑），但只对模型可见：用户打开成员看不到它沉淀了什么，也无法撤回一次错误的沉淀。结果是“成员会成长”在产品上不可核对，用户只能看到成员资料里几行字。C6 卡片（#137）的「还没做」第 3 项就是成员经历的查看 / 删除入口。

## What Changes

- bridge 暴露五个成员资产操作：列表、读取、版本历史、删除、恢复（沿用 `AgentAssetStore` 已有的语义与乐观锁，不新增数据表）。
- 成员列表每一行新增「经历」入口，打开对话框：显示该成员由项目沉淀的经历（路径、修订号、来源项目、时间），可展开内容、查看历史版本、删除当前经历、从历史版本恢复。
- 删除与恢复都记 `reason`（`用户在成员资料中手动删除` / `用户在成员资料中手动恢复`），沿用追加式版本表，删除是墓碑而不是物理删除。
- 规格增量：新增「成员经历由用户核对与撤回」要求；README/PRODUCT 不改。
- 测试：store 层已有覆盖，补 service/bridge 契约测试与渲染层交互测试。

## Impact

- 用户可见：成员经历可见、可撤回、可恢复；归档成员的经历仍可查看，但不能修改。
- 数据：复用 `social_agent_asset_revisions`，不迁移、不改 schema。
- 代码：`apps/desktop/src/main/chat/social-chat-service.mjs`、`apps/desktop/src/main/ipc/root-ipc.mjs`、`apps/desktop/src/shared/bridge/create-bridge.ts`、`apps/desktop/src/shared/contracts/noema-bridge.d.ts`、`apps/desktop/src/renderer/chat/**`、新对话框与样式。

Plan: https://github.com/Noema-Harness/noema-agent/issues/137