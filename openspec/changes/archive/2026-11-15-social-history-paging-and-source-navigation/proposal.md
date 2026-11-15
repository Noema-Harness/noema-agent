# Proposal

## Why

聊天 Store 已有有界消息窗口，但默认 renderer IPC 仍读取整间房的历史，消息越多首屏和搜索跳转的读取量越大。历史搜索或回忆来源在房间/消息不可达时也缺少一致的反馈，用户可能只看到无响应。

## What Changes

- 默认 renderer 房间读取改为最近消息窗口，不再全量载入消息正文。
- 提供向前分页，并在加载较旧消息后保持用户正在阅读的位置。
- 全局搜索、聊天内搜索及历史回忆来源按消息 ID 读取目标相邻窗口；目标已失效时显示可理解的错误，不静默失败。
- 当前聊天搜索改为在 main 侧查询该房间完整历史，最多返回 50 条；显示加载、无结果和可重试错误状态。
- 为分页读取增加无效参数、快速切房、空历史和数据库读取失败的行为覆盖。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `social-conversations`: 明确房间历史分页上限、来源定位以及已删除/失效来源的反馈。

## Impact

`SocialChatStore`、Social room/search IPC 与 preload contract、Social renderer room loading/search navigation、对话历史 UI，以及对应 OpenSpec 行为测试。内部服务继续使用不带分页参数的全量 snapshot 时保持既有行为，renderer 入口始终采用有界读取。

---

## 归档说明（2026-11-15）

本变更已关闭，不再作为活动计划：剩余任务要么已由后续交付覆盖，要么已被新决定替代（见 `docs/DECISIONS.md` 与 `docs/STATUS.md`），规格增量未合并进 `openspec/specs`。需要继续时按新变更重新立项，不要恢复旧任务表。
