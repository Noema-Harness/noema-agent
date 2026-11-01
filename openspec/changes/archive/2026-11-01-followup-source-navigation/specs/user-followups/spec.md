# Spec Delta

## ADDED Requirements

### Requirement: 点击回访通知可接回来源上下文
系统 SHALL 在用户点击带有来源的回访通知后打开并聚焦 Noema，并导航到来源聊天与消息；来源不可用时 SHALL 逐级回退到仍可用的聊天或 Noema 主聊。

#### Scenario: 来源消息与聊天仍存在
- **WHEN** 用户点击绑定了来源消息的回访通知
- **THEN** Noema 打开来源聊天并将该消息滚动到可见位置

#### Scenario: 来源消息已删除但聊天仍存在
- **WHEN** 用户点击通知且来源消息已不存在、来源聊天仍存在
- **THEN** Noema 打开来源聊天但不尝试滚动到不存在的消息

#### Scenario: 来源聊天已不可用
- **WHEN** 用户点击通知且来源聊天不存在
- **THEN** Noema 打开主聊

#### Scenario: 手动提醒没有来源
- **WHEN** 用户点击没有来源聊天的手动回访通知
- **THEN** Noema 打开主聊
