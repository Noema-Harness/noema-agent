# Proposal

## Why

项目创建会在同一轮内先持久化团队与启动公告，再由模型补齐共享计划和回复。后续模型调用失败或用户停止时，当前失败状态没有明确指出团队已经建立，用户容易把部分成功误认为全盘失败。

## What Changes

- 在项目团队建立后记录本轮已完成的持久化结果。
- 后续失败或停止时，明确告知团队已建立、共享计划尚未完成，并指向原项目群继续处理。
- 不自动重建团队，也不把尚未完成的计划描述为已交付。

## Capabilities

### New Capabilities

### Modified Capabilities
- `project-collaboration`: 项目空间创建后的失败与停止状态必须保留并准确呈现已完成部分。

## Impact

- `apps/desktop/src/main/chat/social-chat-service.mjs` 的项目组建与回合失败处理。
- `apps/desktop/test/main/projects/project-collaboration.test.mjs` 的服务行为验证。
