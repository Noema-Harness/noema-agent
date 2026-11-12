# Proposal

## Why

本机诊断目前能显示安全的事件和用量元数据，却无法把用户刚实测时的输入与结果交给后续排查者。用户需要逐条复述上下文，导致问题定位慢；同时不能因此默认上传或扩大诊断采集范围。

## What Changes

- 诊断导出新增逐次可选的实测上下文，限于所选对话轮次和关联后台任务。
- 导出预览完整展示内容并标明敏感风险；凭据形状文本先脱敏，仍由用户选择本地保存，不自动发送。
- 加入 RootAgent 轮次与 DSH 后台执行的安全生命周期事件，减少核心旧路径的追踪空白。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-execution`: 增加逐次选择上下文导出及 RootAgent/DSH 生命周期追踪要求。

## Impact

- `apps/desktop/src/main/diagnostics/diagnostics-query-service.mjs`、RootStore、SocialChatStore、`RootAgent`、DSH adapter、诊断 IPC/preload/UI。
- 诊断导出版本、`project-execution` OpenSpec 与对应测试。
