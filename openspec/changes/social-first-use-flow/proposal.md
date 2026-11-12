# Proposal

## Why

首次使用应直接帮助用户完成“配置模型或开始对话”，而旧的创作者引介状态仍会被拼入 Noema 主聊提示词，使历史说明继续影响真实模型行为。需要让当前真实功能与对话内容成为唯一上下文，同时保留旧用户数据的兼容读取。

## What Changes

- 移除首次相遇/创作者引介文本进入 Noema 主聊模型请求的路径。
- 保留旧 onboarding 记录的兼容读取，但不再写入或把它呈现为产品行为依据。
- 清除不再挂载的创作者引介界面、样式和文本实现，并更新 Social 首用规格。
- 保持默认 Social 空态根据模型可用状态提供配置或开始对话的直接入口。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `social-conversations`: 明确兼容的旧首次相遇数据不得进入提示词；空主聊使用当前模型连接状态提供下一步。

## Impact

- SocialChatService 的请求上下文构造、SocialChatStore 的兼容状态读取、preload/IPC 首遇状态写入口、首次使用界面残留文件、相关测试和默认首用 E2E。
- 不迁移或删除已有 `first_meeting` 设置数据；不改变聊天消息、个人记忆、回访或模型配置状态。
