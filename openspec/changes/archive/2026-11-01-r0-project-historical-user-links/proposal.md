# Proposal

## Why

项目成员需要读取用户先前在同一项目群中明确分享的链接，才能继续真实项目里的研究；只检查原始委托和当前消息，会让稍早分享的来源无法使用。

## What Changes

- 将项目成员可直读的 URL 扩展到同一项目群中有限数量的近期、已完成用户消息。
- 保持精确 URL 授权；agent 消息、其他会话以及失败消息中的链接不获得授权。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-collaboration`：项目成员可读取同一项目群中近期用户消息提供的精确 URL。

## Impact

影响项目群来源读取授权与提示、聊天存储查询、协作集成测试；不新增依赖或持久数据。
