# 把 bridge 契约与传输实现拆开

## Why

`D-20261116-platform-layers` 的第④刀要求把 `window.noema` 的 IPC 契约与 Electron 传输解耦，为后续伴侣客户端保留可替换传输，而不是另起一套接口（issue #151）。今天契约的组装逻辑写在 preload 里，通道注册直接铺在 `root-ipc.mjs`；任何非 Electron 传输都只能复制 preload。

## What Changes

- 新增 `apps/desktop/src/shared/bridge/transport.ts`：`BridgeTransport` 只负责一次请求与一次事件（`invoke` / `on`），通道名与授权不属于传输。
- 新增 `apps/desktop/src/shared/bridge/create-bridge.ts`：把原 preload 的 `window.noema` 组装逻辑抽成 `createBridge(transport, { appVersion, includeSocialWorkRaceProbe })`，返回同一个 `NoemaBridge`；桌面专属的 race probe 由选项开关，默认不挂。
- 新增 `apps/desktop/src/preload/electron-transport.ts`：Electron 实现（`ipcRenderer.invoke` / `ipcRenderer.on`），`preload.ts` 只保留 `contextBridge.exposeInMainWorld('noema', createBridge(...))`。
- 新增 `apps/desktop/src/main/ipc/bridge-router.ts`：`createBridgeRouter()` 统一登记通道、拒绝重复注册与未知通道、按位置参数转发；`root-ipc.mjs` 的 `register` 改为写入 router，末尾按 `router.channels` 注册 `ipcMain.handle` 并保留窗口授权判断与 dispose。

## Impact

- 结构：`shared/bridge` 是契约与组装，`preload/electron-transport.ts` 是 Electron 传输，`main/ipc/bridge-router.ts` 是宿主分发；三者互不依赖 Electron 之外的东西（传输层除外）。
- 行为：`window.noema` 的方法、通道名、事件名、授权与生命周期完全不变；renderer 不需要改动。
- 取舍：本轮只做传输抽象，不做配对、鉴权或伴侣客户端；远程传输不在本轮实现。

Plan: https://github.com/Noema-Harness/noema-agent/issues/151
