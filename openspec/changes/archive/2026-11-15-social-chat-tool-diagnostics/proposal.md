# Proposal

## Why

Social 主聊的 provider 请求有 request ID 和 usage 记录，但工具实际执行没有与对应请求及 tool call ID 相连的终态记录。排查时无法区分模型请求已结束与工具成功、拒绝、失败或中断。

## What Changes

- 为 Social 聊天工具调用建立有限、脱敏的开始与终态事件，并关联 provider request、turn 和 tool call identity。
- 为每个模型请求设置有界总时限，使连接或响应体停滞可以终止；在 provider 失败终态记录有限安全错误码，并区分请求超时与用户取消。
- 在本机诊断时间线显示工具名称、类别、执行状态、耗时和安全错误码；不记录参数或结果正文。
- 增加独立单次普通主聊的 live acceptance，隔离数据库与 Electron profile，仅读取当前用户已保存的 OS 加密模型凭据，并对所有退出路径清理临时数据。
- 保证诊断写入错误不改变聊天工具的授权、副作用与业务结果。

## Capabilities

### New Capabilities
- `social-chat-diagnostics`: Social 主聊的模型工具调用可追踪行为。

### Modified Capabilities

## Impact

影响 `SocialChatService`、OpenAI-compatible provider tool callback、main-process 诊断事件接线、诊断时间线 UI 与对应自动化用例；复用现有本机诊断事件表和详情 allowlist，不新增数据表或网络接口。

---

## 归档说明（2026-11-15）

本变更已关闭，不再作为活动计划：剩余任务要么已由后续交付覆盖，要么已被新决定替代（见 `docs/DECISIONS.md` 与 `docs/STATUS.md`），规格增量未合并进 `openspec/specs`。需要继续时按新变更重新立项，不要恢复旧任务表。
