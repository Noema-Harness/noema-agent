# Design

## Context

`SocialChatStore.getRoomMessageWindow` 已经实现最新页、`beforeSequence`、`afterSequence` 和 `aroundMessageId` 查询，窗口上限最高为 200。当前 renderer IPC `noema:social-room` 没有传窗口选项，`getRoomSnapshot` 因而返回全量消息；全局搜索打开来源也先读取完整房间。当前聊天搜索则只过滤 renderer 已载入的消息，因此早于最新页的匹配内容不可搜索。历史回忆来源跳转会查房间列表，找不到房间时直接返回。

## Goals / Non-Goals

**Goals:** 让 renderer 读取始终有界；利用数据库序号稳定分页；新旧窗口合并时保留用户阅读位置；直接定位搜索/回忆来源；过期来源有明确反馈。

**Non-Goals:** 不改变历史消息删除策略，不删除或重建数据，不改搜索索引格式，不为内部模型上下文读取强行分页。

## Decisions

- Renderer IPC 接收可选分页选项，由 main/store 校验并将 `getRoomSnapshot` 绑定到默认 200 条；内部服务不经此 renderer IPC 的全量 snapshot 行为不变。
- 当前聊天 search IPC 显式带 room ID，使用既有 SQL literal-search 语义，并把结果限制在 50 条；错误保留为错误状态，不能伪装成空结果。
- room state 增加 page metadata；较早页通过最旧消息序号请求并按消息 ID 去重合并。
- 前端以加载前 scrollTop 与 scrollHeight 差值恢复可视锚点；加载期间切换房间时丢弃过期响应。
- 来源导航直接带 `aroundMessageId` 读取目标窗口；main 返回 `targetFound`，前端依据目标在源查询中是否仍存在报告 stale state。
- 保持 `messagePage` 字段可选，避免服务内部构造的旧型 room snapshots 受到影响；renderer IPC 响应始终带字段。

## Risks / Trade-offs

- [Room list preview 仍有单独的 bounded excerpt/search query] → 仅为 renderer 房间正文读取加分页，不更改其余业务读取。
- [分页合并与迟到请求可能串房] → 请求序号与 active room ID 双重检查，状态更新仅应用到同一房间。
- [历史消息被真正删除后其序号消失] → `targetFound=false` 时显示不可用提示；不尝试把跳转静默改为最新消息。

## Migration Plan

不涉及数据迁移。旧 UI 不依赖历史页字段；IPC 默认分页兼容既有调用。回滚时移除 renderer 分页参数即可恢复原 snapshot 路径，不变更数据库。
