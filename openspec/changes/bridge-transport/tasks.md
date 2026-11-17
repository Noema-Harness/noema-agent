# 任务

## 1. 契约与传输抽象

- [x] 1.1 新增 `apps/desktop/src/shared/bridge/transport.ts`（`BridgeTransport`、`BridgeListener`）
- [x] 1.2 新增 `apps/desktop/src/shared/bridge/create-bridge.ts`，从 preload 抽出 `window.noema` 组装
- [x] 1.3 `preload.ts` 只剩 `contextBridge` 暴露，Electron 传输移入 `preload/electron-transport.ts`

## 2. 宿主分发

- [x] 2.1 新增 `apps/desktop/src/main/ipc/bridge-router.ts`（重复/未知通道、位置参数转发）
- [x] 2.2 `root-ipc.mjs` 的 `register` 改为 router，保留窗口授权与 dispose

## 3. 测试与静态检查

- [x] 3.1 新增 `apps/desktop/test/main/ipc/bridge-transport.test.mjs`（路由、映射、订阅、probe 开关、无 Electron 往返）
- [x] 3.2 typecheck、oxlint、oxfmt、`node scripts/source-structure.mjs` 通过

## 4. 文档与收口

- [x] 4.1 `docs/ARCHITECTURE.md` 记录 `shared/bridge` → 宿主 transport 的边界
- [x] 4.2 `docs/STATUS.md` 与 `docs/DECISIONS.md` 记录第④刀结果（含用户范围选择）
- [ ] 4.3 `npm run check` 全绿后提交
- [x] 4.4 更新卡片正文（现在能做什么 + 手测步骤 / 还没做）：issue #151 正文与第④刀评论
