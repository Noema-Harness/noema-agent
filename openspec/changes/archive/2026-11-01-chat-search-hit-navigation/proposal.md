# Proposal

## Why

当前聊天搜索能滚动到匹配消息，但关闭搜索时查询词被清空，长消息中的具体命中位置仍要用户自己寻找。让搜索结果同时定位并标亮命中词，可完成查找闭环。

## What Changes

- 从当前聊天搜索结果跳转时，保留本次查询词供时间线定位使用。
- 在目标消息正文中标亮所有对应命中；离开该消息或开始新搜索时清除标亮。
- 保持侧栏筛选、全局搜索和当前聊天搜索各自的搜索范围不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `social-conversations`：当前聊天搜索结果定位时提供可见的词语命中标记。

## Impact

影响 Electron renderer 的当前聊天搜索弹窗、消息时间线与少量样式；不改 IPC、数据存储或依赖。
