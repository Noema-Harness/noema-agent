# Proposal

## Why

一期默认工作流通过 preload 将大量 renderer action 路由到主进程。当前 root IPC 检查发送方是否为主窗口 `webContents`，但没有检查 IPC 是否来自主框架；独立的 window-control handler 也没有主框架校验。权限和敏感数据范围需要成为可检查契约。

## What Changes

- 只接受当前主窗口的主框架发出的 invoke IPC；iframe、缺少 frame 身份和其他 window sender 均拒绝。
- 对照 preload、root IPC handlers、window-control、权限对话框和诊断导出列出 action owner、授权来源及敏感数据类别。
- 明确本地凭据、workspace grant、导入对话发送同意和本机诊断导出的数据边界；不增加遥测或新的 renderer 导出 API。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `project-execution`：要求工作区任务 IPC 来自主窗口主框架，并保留已有 workspace/task 授权边界。

## Impact

- `apps/desktop/src/main/platform/window-security.mjs`
- `apps/desktop/src/main/ipc/root-ipc.mjs`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/scripts/model-usage-diagnostics.mjs`
- `apps/desktop/test/main/platform/window-security.test.mjs`
- `apps/desktop/test/main/ipc/root-ipc.test.mjs`
- `openspec/specs/project-execution/spec.md`

没有新增 IPC channel、schema、凭据格式或外发 telemetry。
