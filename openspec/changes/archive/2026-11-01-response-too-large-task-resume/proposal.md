# Proposal

## Why

项目执行模型的单次响应超过读取上限时，工具回调尚未执行，但此前成功步骤和安全检查点已经持久化。当前该错误不可续接，用户只能重新提交任务，造成上下文丢失和重复模型调用。

## What Changes

- 允许执行记录完整、没有未决副作用的 `response_too_large` 失败任务从最近安全模型边界显式续接。
- 续接时加入一次简短恢复提示，要求模型缩小输出并避免重发大文件内容；不自动重试。
- 有运行中或结果未知的操作时继续禁止续接。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：补充超大模型响应后的安全检查点续接行为。

## Impact

影响项目执行服务、聊天记录恢复标记、SQLite 恢复入口、失败状态文案、OpenSpec 规格和执行服务测试；不增加模型请求或依赖。
