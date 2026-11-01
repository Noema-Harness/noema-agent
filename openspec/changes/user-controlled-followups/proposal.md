# 用户控制的一次性回访

## Why

Noema 已能保存由用户明确提供的个人记忆，但还不能在有明确时间和依据时回到一件未完的事。把这类回访留在聊天记录里，既容易被后续交流淹没，也会迫使用户自己记得回来。

## What Changes

- 用户可在主聊明确安排一次回访；Noema 可提出建议，但必须等用户明确接受后才建立。
- 在本机持久保存回访时间、文字、来源和投递状态；用户可在设置中查看、编辑、暂停、恢复或取消。
- 应用运行时到期发送桌面通知；睡眠或退出期间错过的通知在下次启动后补发。
- 到期只显示已保存的回访内容，不调用模型、不联网，也不把通知展示误当成用户已回复。

## Capabilities

### New Capabilities
- `user-followups`: 用户授权的一次性回访、持久状态、设置管理与本机通知。

### Modified Capabilities
- None.

## Impact

- `apps/desktop/src/main/chat`：SQLite 迁移、回访存储、主聊工具及到期调度。
- `apps/desktop/src/main/ipc`、`preload`、`renderer/settings`：可信管理 API 与设置界面。
- `apps/desktop/src/main/main.ts`：复用既有 Electron 通知能力并绑定应用生命周期。
- `docs/design/noema-core-flows.md` 与 `docs/ROADMAP.md`：记录回访边界及整体验收项。

## 边界

本变更只实现用户明确安排或明确接受的一次性回访。周期计划、未授权的主动推断、应用完全退出时由操作系统唤醒应用、以及到期自动调用模型均不在范围内。
