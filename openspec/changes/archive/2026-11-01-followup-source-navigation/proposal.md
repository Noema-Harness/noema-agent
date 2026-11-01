# Proposal

## Why

提醒通知当前只会打开 Noema 主窗口，用户还得自己找回安排提醒的对话。提醒本来绑定了来源消息；利用这条关系可以让用户从通知直接接回当时的上下文。

## What Changes

- 点击有来源的回访通知时，打开并聚焦 Noema，定位到来源聊天中的来源消息。
- 点击无来源的手动提醒时，只打开并聚焦 Noema 主窗口。
- 若来源消息已删除但来源聊天仍在，则打开该聊天；若来源聊天也不可用，则回到 Noema 主聊。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `user-followups`: 回访通知点击行为新增来源导航与缺失来源回退。

## Impact

影响 Electron 通知点击处理、主进程到 renderer 的导航事件、聊天控制器与 IPC ready 握手，以及提醒规格和定向测试；不增加依赖或持久化状态。
