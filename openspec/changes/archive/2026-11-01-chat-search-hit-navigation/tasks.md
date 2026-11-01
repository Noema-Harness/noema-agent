# Tasks

## 1. 当前聊天搜索定位

- [x] 1.1 将当前聊天搜索命中词与消息 ID 一并传入时间线；Electron 搜索 E2E 确认关闭弹窗后仍能跳转，其他历史跳转行为不变。
- [x] 1.2 在目标消息正文标亮所有匹配文本，并在重新搜索、切换聊天和卸载时清理；Electron 搜索 E2E 验证重复命中、定位可见和清理状态。
- [x] 1.3 更新 `social-conversations` 主规格并严格校验 change；搜索 E2E、renderer 类型检查、lint、格式检查与 diff 检查通过。

## Workflow follow-up

- 归档 change 后核对 `social-conversations` 主规格包含本次契约。
