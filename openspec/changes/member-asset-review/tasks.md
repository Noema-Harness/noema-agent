# 任务

## 1 规格与契约

- [ ] 1.1 `openspec/changes/member-asset-review/specs/specialist-agents/spec.md`：新增「成员经历由用户核对与撤回」要求与场景
- [ ] 1.2 `apps/desktop/src/shared/contracts/noema-bridge.d.ts`：成员资产列表/读取/历史/删除/恢复的输入输出类型
- [ ] 1.3 `apps/desktop/src/shared/bridge/create-bridge.ts`：五个方法映射到通道

## 2 后端

- [ ] 2.1 `apps/desktop/src/main/chat/social-chat-service.mjs`：暴露 `listAgentAssets` / `getAgentAsset` / `listAgentAssetRevisions` / `deleteAgentAsset` / `restoreAgentAsset`，只读允许归档成员、写操作走 store 的可编辑校验
- [ ] 2.2 `apps/desktop/src/main/ipc/root-ipc.mjs`：登记五个通道并转发

## 3 前端

- [ ] 3.1 成员列表每行加「经历」按钮，点击打开对话框（`apps/desktop/src/renderer/chat/dialogs/member-assets-dialog.tsx`）
- [ ] 3.2 对话框：列表、展开内容、来源项目名、历史版本、删除（二次确认）、恢复、空态、归档成员只读
- [ ] 3.3 controller 接线：加载列表/详情/历史，删除与恢复后刷新；样式进 `apps/desktop/src/renderer/styles/index.css`

## 4 测试与验证

- [ ] 4.1 store 删除/恢复语义已有覆盖，补 service 代理用例（含归档成员只读）
- [ ] 4.2 bridge 通道映射测试补成员资产五个通道
- [ ] 4.3 `npm run typecheck`、`npm run check` 全绿

## 5 收口

- [ ] 5.1 更新卡片正文 — #137 的「现在能做什么 / 还没做」补本轮交付
- [ ] 5.2 `docs/STATUS.md` 记验证结果；用户验收后勾 tasks、归档 change