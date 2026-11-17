## 事实影响

- 类别：结构
- 依据：`window.noema` 的组装从 preload 抽到 `shared/bridge`，宿主通道从 `root-ipc.mjs` 的散装 `ipcMain.handle` 抽到 `main/ipc/bridge-router.ts`；接口、通道名与用户可观察行为不变。

## 用户决策

- 用户选“只做传输抽象，不做伴侣客户端”：先把 IPC 契约抽象成可替换传输并保持本地 Electron 行为不变；配对、鉴权与伴侣客户端留到之后立项。

## 目标

- `BridgeTransport` 只搬一次请求（`invoke`）与一次事件（`on`），不包含通道清单、授权或业务判断。
- `createBridge(transport, options)` 产出与今天等价的 `NoemaBridge`；桌面专属的 `testArmSocialWorkReverseSnapshot` 只在 `includeSocialWorkRaceProbe` 为真时存在。
- Electron 传输隔离在 `preload/electron-transport.ts`；`preload.ts` 不再写桥本体。
- 宿主侧 `createBridgeRouter()` 负责重复注册、未知通道和位置参数转发；`root-ipc.mjs` 只保留窗口授权与 dispose，通道集合来自 router。
- 新增测试用假传输直接驱动 `createBridge`，并用 router 作为后端跑一次无 Electron 的往返。

## 非目标

- 不做配对、密钥交换、鉴权或任何远程传输实现。
- 不引入伴侣客户端或第二套桥 API。
- 不改 renderer 代码、不改通道名、不改事件名。

## 取舍

- 传输接口刻意只有 `invoke`/`on` 两个方法：否则传输会重新长成业务层；通道清单留在 `NoemaBridge` 契约与 router 两处。
- `createBridge` 对未在 `NoemaBridge` 声明返回类型的通道保留 `Promise<any>`，避免一次性改上百个返回类型；契约里的方法仍有返回类型校验。
- 授权判断留在桌面宿主（`root-ipc.mjs`）而不是 router：它在判断“哪个窗口在请求”，属于宿主关注点，不是分发逻辑。

## 用户可观察的改变

- 无：应用启动、聊天、设置、诊断与执行行为不变。

## 手测步骤

- `npm run typecheck`、`npm run lint`、`node scripts/source-structure.mjs` 通过。
- `node --test apps/desktop/test/main/ipc/bridge-transport.test.mjs` 6 条通过。
- 启动开发版，确认主界面加载、联系人/房间列表、发送消息、诊断弹窗仍能通过 `window.noema` 正常调用。

## 验收

- `window.noema` 由 `createBridge` 生成，preload 只剩一行暴露；`root-ipc.mjs` 的所有通道经 router 注册。
- 新增路由/桥测试通过；`npm run check` 全绿；无 Electron 的假传输可以完整驱动桥。
